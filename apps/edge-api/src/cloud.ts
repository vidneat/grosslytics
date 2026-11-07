import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Bindings } from './env.js';
import { hashToken, SESSION_COOKIE } from './auth.js';

/** Hosted Cloud: one shared deployment, many customer accounts. Off unless the `CLOUD` var is "1"; self-host is unchanged. */
export const isCloud = (env: Bindings) => env.CLOUD === '1';

/** The $5.99/mo Indie Cloud plan */
export const CLOUD_EVENT_CAP = 100_000;
export const TRIAL_DAYS = 14;

/** Usage is counted per calendar month in UTC, e.g. "2026-11". */
// shortcut: calendar month, not the Stripe billing period; switch to current_period_end when plans differ in cap.
export const usageMonth = (at = Date.now()) => new Date(at).toISOString().slice(0, 7);

export interface AccountRow {
	id: string;
	email: string;
	status: string;
	trial_ends_at: number;
	current_period_end: number | null;
}

/** Trial still running, or a live subscription. past_due keeps working while Stripe retries the card. */
export function accountActive(a: Pick<AccountRow, 'status' | 'trial_ends_at'>, now = Math.floor(Date.now() / 1000)): boolean {
	return a.status === 'active' || a.status === 'past_due' || (a.status === 'trial' && a.trial_ends_at > now);
}

/** The signed-in customer account from the session cookie, or null. */
export async function sessionAccount(c: Context<{ Bindings: Bindings }>): Promise<AccountRow | null> {
	const id = getCookie(c, SESSION_COOKIE);
	if (!id) return null;
	return c.env.DB.prepare(
		'SELECT a.id, a.email, a.status, a.trial_ends_at, a.current_period_end FROM account_sessions s JOIN accounts a ON a.id = s.account_id WHERE s.id_hash = ? AND s.expires_at > ?',
	)
		.bind(await hashToken(id), Math.floor(Date.now() / 1000))
		.first<AccountRow>();
}

/**
 * Which site a stats/MCP request touches: `?siteId=`, MCP's `?site=`, `/sites/:id/…`, a token being revoked, or a JSON body's siteId.
 * Every place is read, because routes act on different ones. Null when none is named, or when two places name different sites
 * (`/sites/<theirs>/share?siteId=<mine>`), so the caller can refuse.
 */
export async function requestSite(c: Context<{ Bindings: Bindings }>): Promise<string | null> {
	const named = new Set<string>();
	const add = (x: unknown) => typeof x === 'string' && named.add(x);
	add(c.req.query('siteId'));
	add(c.req.query('site'));
	const path = c.req.path;
	const inPath = path.match(/^\/api\/stats\/sites\/([^/]+)\//)?.[1];
	if (inPath) add(decodeURIComponent(inPath));
	const token = path.match(/^\/api\/stats\/tokens\/([^/]+)\/revoke$/)?.[1];
	if (token) {
		const row = await c.env.DB.prepare('SELECT site_id FROM api_tokens WHERE id = ?').bind(decodeURIComponent(token)).first<{ site_id: string }>();
		if (!row) return null;
		add(row.site_id);
	}
	if (c.req.method !== 'GET') {
		const body = (await c.req.raw.clone().json().catch(() => null)) as { siteId?: unknown } | null;
		add(body?.siteId);
	}
	return named.size === 1 ? [...named][0]! : null;
}

export async function ownsSite(db: D1Database, accountId: string, siteId: string): Promise<boolean> {
	return !!(await db.prepare('SELECT 1 AS ok FROM account_sites WHERE site_id = ? AND account_id = ?').bind(siteId, accountId).first());
}

/** Adds accepted events to each owning account's monthly usage. Sites without an account (self-host, admin-made) count nowhere. */
export async function countUsage(db: D1Database, perSite: Map<string, number>, at = Date.now()): Promise<void> {
	if (!perSite.size) return;
	const month = usageMonth(at);
	await db.batch(
		[...perSite].map(([siteId, n]) =>
			db
				.prepare(
					'INSERT INTO account_usage (account_id, month, events) SELECT account_id, ?, ? FROM account_sites WHERE site_id = ? ON CONFLICT (account_id, month) DO UPDATE SET events = events + excluded.events',
				)
				.bind(month, n, siteId),
		),
	);
}
