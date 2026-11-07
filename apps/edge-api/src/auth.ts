import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Bindings } from './env.js';
import { isCloud, ownsSite, requestSite, sessionAccount } from './cloud.js';

export const TOKEN_PREFIX = 'gl_pat_';
export const SESSION_COOKIE = 'gl_session';

const sha256Hex = async (s: string) =>
	Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, '0')).join('');

/** A new token secret: prefix + 160 random bits. High entropy, so plain SHA-256 (no salt/KDF) is enough to store it. */
export function newTokenSecret(): string {
	return TOKEN_PREFIX + Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => b.toString(16).padStart(2, '0')).join('');
}
export const hashToken = sha256Hex;

/** Constant-time string comparison (both sides hashed to equal length first). */
export async function isMaster(given: string, expected: string): Promise<boolean> {
	const [a, b] = await Promise.all([given, expected].map((x) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(x))));
	const x = new Uint8Array(a!);
	const y = new Uint8Array(b!);
	let diff = 0;
	for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
	return diff === 0;
}

/** True when the request carries a live owner session cookie (the /app login). */
export async function hasSession(c: Context<{ Bindings: Bindings }>): Promise<boolean> {
	const id = getCookie(c, SESSION_COOKIE);
	if (!id) return false;
	const row = await c.env.DB.prepare('SELECT 1 AS ok FROM sessions WHERE id_hash = ? AND expires_at > ?')
		.bind(await sha256Hex(id), Math.floor(Date.now() / 1000))
		.first();
	return !!row;
}

/**
 * Guard for /api/stats and /api/mcp; fails closed when API_TOKEN is unset. Accepts, in order:
 * - API_TOKEN (bearer or `?token=` for WebSocket upgrades): the owner's master key.
 * - a `gl_pat_` token: read-only, one site. GET requests whose `siteId` is that site, and MCP calls whose `site` is that site.
 * - the owner's session cookie from the /app password login: full access, same as API_TOKEN.
 * - on Hosted Cloud, a customer's session cookie: only that account's sites (`/api/stats/sites` scopes itself).
 * Token management is never open to `gl_pat_` tokens.
 */
export async function requireToken(
	c: Context<{ Bindings: Bindings }>,
	next: Next,
): Promise<Response | void> {
	const expected = c.env.API_TOKEN;
	const given = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') || c.req.query('token') || '';
	if (!expected) return c.text('API_TOKEN not configured', 503); // fail closed
	if (given && (await isMaster(given, expected))) return next();

	if (!given.startsWith(TOKEN_PREFIX)) {
		// CSRF: requiring a JSON content type forces a CORS preflight, and preflights never allow credentials, so other sites can't write with the cookie
		const csrfOk = c.req.method === 'GET' || !!c.req.header('content-type')?.startsWith('application/json');
		if (!isCloud(c.env) && (await hasSession(c))) return csrfOk ? next() : c.text('Unauthorized', 401);
		const account = isCloud(c.env) ? await sessionAccount(c) : null;
		if (!account || !csrfOk) return c.text('Unauthorized', 401);
		if (c.req.path === '/api/stats/sites') return next();
		const site = await requestSite(c);
		if (!site || !(await ownsSite(c.env.DB, account.id, site))) return c.text('Not your site', 403);
		return next();
	}

	const row = await c.env.DB.prepare('SELECT id, site_id, last_used_at FROM api_tokens WHERE token_hash = ?')
		.bind(await sha256Hex(given))
		.first<{ id: string; site_id: string; last_used_at: number | null }>();
	if (!row) return c.text('Unauthorized', 401);

	const path = c.req.path;
	const isMcp = path.startsWith('/api/mcp');
	const site = isMcp ? c.req.query('site') : c.req.query('siteId');
	const readOnly = isMcp || (c.req.method === 'GET' && !path.startsWith('/api/stats/tokens'));
	if (!readOnly || site !== row.site_id) return c.text('This token can only read its own site', 403);

	const now = Math.floor(Date.now() / 1000);
	// At most one write a minute per token
	if (!row.last_used_at || row.last_used_at < now - 60) await c.env.DB.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').bind(now, row.id).run();
	await next();
}
