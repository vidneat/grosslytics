import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Bindings } from '../env.js';
import { hasSession, hashToken, isMaster, SESSION_COOKIE } from '../auth.js';
import { accountActive, CLOUD_EVENT_CAP, isCloud, sessionAccount, TRIAL_DAYS, usageMonth } from '../cloud.js';

/**
 * /app owner login, like Traks and DataBull: one dashboard password and a 30-day HttpOnly session cookie.
 * Setting (or resetting) the password needs API_TOKEN, so nobody else can claim a fresh deploy.
 */
export const authRoute = new Hono<{ Bindings: Bindings }>();
type C = Context<{ Bindings: Bindings }>;

const ITERATIONS = 100_000; // the Workers runtime caps PBKDF2 at 100k iterations
const SESSION_SECONDS = 30 * 86400;
const MAX_FAILS = 5;
const LOCK_SECONDS = 15 * 60;
const hex = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (h: string) => new Uint8Array((h.match(/../g) ?? []).map((x) => parseInt(x, 16)));
const now = () => Math.floor(Date.now() / 1000);

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<string> {
	const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
	return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}
export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	return `pbkdf2$${ITERATIONS}$${hex(salt)}$${await pbkdf2(password, salt, ITERATIONS)}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [, iter, salt, want] = stored.split('$');
	if (!iter || !salt || !want) return false;
	return isMaster(await pbkdf2(password, unhex(salt), Number(iter)), want);
}

/** Owner session (self-host), or a customer account's session on Hosted Cloud. */
async function startSession(c: C, accountId?: string) {
	const id = hex(crypto.getRandomValues(new Uint8Array(32)));
	const idHash = await hashToken(id);
	await (accountId
		? c.env.DB.prepare('INSERT INTO account_sessions (id_hash, account_id, expires_at) VALUES (?, ?, ?)').bind(idHash, accountId, now() + SESSION_SECONDS)
		: c.env.DB.prepare('INSERT INTO sessions (id_hash, expires_at) VALUES (?, ?)').bind(idHash, now() + SESSION_SECONDS)
	).run();
	setCookie(c, SESSION_COOKIE, id, {
		path: '/api',
		httpOnly: true,
		sameSite: 'Strict',
		secure: new URL(c.req.url).protocol === 'https:',
		maxAge: SESSION_SECONDS,
	});
}

/**
 * One password attempt against a lockable row (`owner_auth` or `accounts`). The try is counted before the slow PBKDF2 check,
 * in one statement, so parallel guesses can't all read "0 failures": the 6th concurrent guess is refused without being checked.
 */
async function attempt(db: D1Database, table: 'owner_auth' | 'accounts', id: string | number, password: unknown, hash: string): Promise<'ok' | 'wrong' | 'locked'> {
	const lock = () => db.prepare(`UPDATE ${table} SET failed_count = 0, locked_until = ? WHERE id = ?`).bind(now() + LOCK_SECONDS, id).run();
	const claimed = await db.prepare(`UPDATE ${table} SET failed_count = failed_count + 1 WHERE id = ? AND locked_until <= ? RETURNING failed_count`).bind(id, now()).first<{ failed_count: number }>();
	if (!claimed) return 'locked';
	if (claimed.failed_count > MAX_FAILS) return lock().then(() => 'locked');
	if (typeof password === 'string' && (await verifyPassword(password, hash))) {
		await db.prepare(`UPDATE ${table} SET failed_count = 0, locked_until = 0 WHERE id = ?`).bind(id).run();
		return 'ok';
	}
	if (claimed.failed_count >= MAX_FAILS) await lock();
	return 'wrong';
}
const lockedFor = async (db: D1Database, table: 'owner_auth' | 'accounts', id: string | number) => {
	const row = await db.prepare(`SELECT locked_until FROM ${table} WHERE id = ?`).bind(id).first<{ locked_until: number }>();
	return Math.max(1, Math.ceil(((row?.locked_until ?? 0) - now()) / 60));
};

const readBody = async (c: C) => ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
const owner = (db: D1Database) =>
	db.prepare('SELECT password_hash, failed_count, locked_until FROM owner_auth WHERE id = 1').first<{ password_hash: string; failed_count: number; locked_until: number }>();

// GET /api/auth/status - what /app should show: set a password, sign in, or the dashboard
authRoute.get('/status', async (c) => {
	if (isCloud(c.env)) {
		const a = await sessionAccount(c);
		const used = a
			? ((await c.env.DB.prepare('SELECT events FROM account_usage WHERE account_id = ? AND month = ?').bind(a.id, usageMonth()).first<{ events: number }>())?.events ?? 0)
			: 0;
		const account = a && { id: a.id, email: a.email, status: a.status, trialEndsAt: a.trial_ends_at, periodEnd: a.current_period_end, active: accountActive(a), used, cap: CLOUD_EVENT_CAP };
		return c.json({ cloud: true, signedIn: !!a, account }, 200, { 'Cache-Control': 'no-store' });
	}
	const row = await owner(c.env.DB);
	return c.json({ passwordSet: !!row, signedIn: !!row && (await hasSession(c)) }, 200, { 'Cache-Control': 'no-store' });
});

// POST /api/auth/setup {setupKey, password} - first password, or a reset; either way every other session is signed out
authRoute.post('/setup', async (c) => {
	if (isCloud(c.env)) return c.json({ error: 'Hosted Cloud has no owner password. Sign up with an email instead.' }, 404);
	const { setupKey, password } = await readBody(c);
	if (!c.env.API_TOKEN) return c.json({ error: 'API_TOKEN is not configured on this API.' }, 503);
	if (typeof setupKey !== 'string' || !setupKey || !(await isMaster(setupKey, c.env.API_TOKEN))) return c.json({ error: 'That is not this API’s API_TOKEN.' }, 401);
	if (typeof password !== 'string' || password.length < 10 || password.length > 200) return c.json({ error: 'Use a password of at least 10 characters.' }, 400);
	await c.env.DB.batch([
		c.env.DB.prepare(
			'INSERT INTO owner_auth (id, password_hash) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET password_hash = excluded.password_hash, failed_count = 0, locked_until = 0, updated_at = unixepoch()',
		).bind(await hashPassword(password)),
		c.env.DB.prepare('DELETE FROM sessions'),
	]);
	await startSession(c);
	return c.json({ ok: true });
});

// POST /api/auth/login {password} - five wrong passwords lock login for 15 minutes
authRoute.post('/login', async (c) => {
	if (isCloud(c.env)) return accountLogin(c);
	const { password } = await readBody(c);
	const row = await owner(c.env.DB);
	if (!row) return c.json({ error: 'Set a password first.' }, 409);
	const result = await attempt(c.env.DB, 'owner_auth', 1, password, row.password_hash);
	if (result === 'locked') {
		return c.json({ error: `Too many wrong passwords. Try again in ${await lockedFor(c.env.DB, 'owner_auth', 1)} minutes, or reset it with your API_TOKEN.` }, 429);
	}
	if (result === 'wrong') return c.json({ error: 'Wrong password.' }, 401);
	await c.env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now()).run();
	await startSession(c);
	return c.json({ ok: true });
});

// POST /api/auth/logout
authRoute.post('/logout', async (c) => {
	const id = getCookie(c, SESSION_COOKIE);
	if (id) {
		const h = await hashToken(id);
		await c.env.DB.batch([c.env.DB.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(h), c.env.DB.prepare('DELETE FROM account_sessions WHERE id_hash = ?').bind(h)]);
	}
	deleteCookie(c, SESSION_COOKIE, { path: '/api' });
	return c.json({ ok: true });
});

// Hosted Cloud accounts: email + password (same PBKDF2 and lockout as the owner login), 14-day trial, no card up front.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const credentials = async (c: C) => {
	const { email, password } = await readBody(c);
	return { email: typeof email === 'string' ? email.trim().toLowerCase() : '', password: typeof password === 'string' ? password : '' };
};

// POST /api/auth/signup {email, password} - Hosted Cloud only
authRoute.post('/signup', async (c) => {
	if (!isCloud(c.env)) return c.json({ error: 'Sign-up is only on Hosted Cloud.' }, 404);
	// Each sign-up is a fresh trial, so cap how fast one address can make them; without the binding there is no limit
	if (c.env.SIGNUP_LIMITER && !(await c.env.SIGNUP_LIMITER.limit({ key: c.req.header('cf-connecting-ip') || 'unknown' })).success) {
		return c.json({ error: 'Too many sign-ups from this network. Wait a minute and try again.' }, 429);
	}
	const { email, password } = await credentials(c);
	if (!EMAIL.test(email) || email.length > 254) return c.json({ error: 'Enter a valid email.' }, 400);
	if (password.length < 10 || password.length > 200) return c.json({ error: 'Use a password of at least 10 characters.' }, 400);
	const id = crypto.randomUUID();
	const res = await c.env.DB.prepare('INSERT INTO accounts (id, email, password_hash, trial_ends_at) VALUES (?, ?, ?, ?) ON CONFLICT (email) DO NOTHING')
		.bind(id, email, await hashPassword(password), now() + TRIAL_DAYS * 86400)
		.run();
	if (!res.meta.changes) return c.json({ error: 'That email already has an account. Sign in instead.' }, 409);
	await startSession(c, id);
	return c.json({ ok: true }, 201);
});

async function accountLogin(c: C) {
	const { email, password } = await credentials(c);
	const row = await c.env.DB.prepare('SELECT id, password_hash FROM accounts WHERE email = ?').bind(email).first<{ id: string; password_hash: string }>();
	if (!row) return c.json({ error: 'Wrong email or password.' }, 401);
	const result = await attempt(c.env.DB, 'accounts', row.id, password, row.password_hash);
	if (result === 'locked') return c.json({ error: `Too many wrong passwords. Try again in ${await lockedFor(c.env.DB, 'accounts', row.id)} minutes.` }, 429);
	if (result === 'wrong') return c.json({ error: 'Wrong email or password.' }, 401);
	await c.env.DB.prepare('DELETE FROM account_sessions WHERE expires_at <= ?').bind(now()).run();
	await startSession(c, row.id);
	return c.json({ ok: true });
}
