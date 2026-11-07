import { Hono } from 'hono';
import * as v from 'valibot';
import { DashboardQuerySchema } from '@grosslytics/shared/schemas';
import { isTimeZone } from '@grosslytics/shared/attribution';
import { D1StorageAdapter, queryDashboard, siteRange } from '@grosslytics/db-d1';
import type { DashFilter } from '@grosslytics/shared/dashboard';
import type { AttributionModel } from '@grosslytics/shared/types';
import type { Bindings } from '../env.js';
import { hashToken, newTokenSecret } from '../auth.js';
import { REPORTING_CURRENCIES } from '@grosslytics/shared/money';
import { PAYMENT_GATEWAYS } from '@grosslytics/shared/constants';
import { accountActive, isCloud, sessionAccount } from '../cloud.js';

export const statsRoute = new Hono<{ Bindings: Bindings }>();

// GET /api/stats - Channel analytics with multi-touch attribution
statsRoute.get('/', async (c) => {
	const query = c.req.query();
	const parsed = v.safeParse(DashboardQuerySchema, query);
	if (!parsed.success) {
		return c.json({ error: 'Invalid query parameters', issues: parsed.issues }, 400);
	}

	const { siteId, range = '30d', model = 'first' } = parsed.output;
	const { start, end } = await siteRange(c.env.DB, siteId, range as '24h' | '7d' | '30d' | '90d');

	const adapter = new D1StorageAdapter(c.env.DB);
	const stats = await adapter.queryChannelStats(
		siteId,
		start,
		end,
		model as AttributionModel,
	);

	return c.json({
		siteId,
		range,
		model,
		start,
		end,
		channels: stats,
	});
});

// GET /api/stats/journey/:vid - Buyer Journey Inspector
statsRoute.get('/journey/:vid', async (c) => {
	const vid = c.req.param('vid');
	const siteId = c.req.query('siteId');

	if (!siteId) {
		return c.json({ error: 'siteId required' }, 400);
	}

	const adapter = new D1StorageAdapter(c.env.DB);
	const journey = await adapter.getBuyerJourney(siteId, vid);

	return c.json({
		siteId,
		visitorId: vid,
		events: journey,
	});
});

// GET /api/stats/live - WebSocket upgrade to SiteLiveHub Durable Object
statsRoute.get('/live', async (c) => {
	const siteId = c.req.query('siteId');
	if (!siteId) {
		return c.text('siteId required', 400);
	}

	if (!c.env.SITE_LIVE_HUB) {
		return c.text('Durable Objects not configured', 500);
	}

	const id = c.env.SITE_LIVE_HUB.idFromName(siteId);
	const stub = c.env.SITE_LIVE_HUB.get(id);

	return stub.fetch(c.req.raw);
});


const DashParams = v.object({
	siteId: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
	range: v.optional(v.picklist(['24h', '7d', '30d', '90d']), '30d'),
	model: v.optional(v.picklist(['first', 'last', 'linear']), 'first'),
	mode: v.optional(v.picklist(['gross', 'net', 'profit']), 'net'),
	source: v.optional(v.pipe(v.string(), v.maxLength(512))),
	page: v.optional(v.pipe(v.string(), v.maxLength(2048))),
	country: v.optional(v.pipe(v.string(), v.maxLength(8))),
	device: v.optional(v.pipe(v.string(), v.maxLength(16))),
});
export type DashParamsInput = v.InferInput<typeof DashParams>;

/** Parses dashboard query params into queryDashboard() options; shared with the public share route. */
export function parseDashParams(query: Record<string, string>) {
	const parsed = v.safeParse(DashParams, query);
	if (!parsed.success) return null;
	const p = parsed.output;
	const filters: DashFilter[] = (['source', 'page', 'country', 'device'] as const).flatMap((dim) => (p[dim] ? [{ dim, value: p[dim]! }] : []));
	return { siteId: p.siteId, range: p.range, model: p.model, mode: p.mode, filters };
}

// GET /api/stats/dashboard - every dashboard panel in one response
statsRoute.get('/dashboard', async (c) => {
	const p = parseDashParams(c.req.query());
	if (!p) return c.json({ error: 'Invalid query parameters' }, 400);
	return c.json(await queryDashboard(c.env.DB, p.siteId, p), 200, { 'Cache-Control': 'private, no-store' });
});

// A Hosted Cloud customer, or null for the owner / API_TOKEN (who see every site)
const cloudAccount = (c: Parameters<typeof sessionAccount>[0]) => (isCloud(c.env) ? sessionAccount(c) : Promise.resolve(null));

// GET /api/stats/sites - sites this API serves (on Hosted Cloud, the signed-in account's), with the payment gateways that have a webhook secret
statsRoute.get('/sites', async (c) => {
	const account = await cloudAccount(c);
	const cols = "s.site_id AS id, s.domain, s.name, s.public_share_enabled AS shared, COALESCE(s.timezone, 'UTC') AS timezone, (SELECT group_concat(gateway) FROM site_secrets x WHERE x.site_id = s.site_id) AS payments";
	const { results } = await (account
		? c.env.DB.prepare(`SELECT ${cols} FROM sites s JOIN account_sites a ON a.site_id = s.site_id WHERE a.account_id = ? ORDER BY s.created_at`).bind(account.id)
		: c.env.DB.prepare(`SELECT ${cols} FROM sites s ORDER BY s.created_at`)
	).all<Record<string, unknown> & { payments: string | null }>();
	return c.json({ sites: results.map((r) => ({ ...r, payments: r.payments ? r.payments.split(',') : [] })) });
});

const SiteBody = v.object({
	// Accepts a pasted URL ("https://www.acme.io/pricing" → "acme.io"); `localhost` is for local testing
	domain: v.pipe(
		v.string(),
		v.transform((d) => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/:?#].*$/, '')),
		v.regex(/^(localhost|[a-z0-9.-]+\.[a-z]{2,})$/),
		v.maxLength(255),
	),
	name: v.optional(v.pipe(v.string(), v.maxLength(255))),
	currency: v.optional(v.picklist(REPORTING_CURRENCIES), 'USD'),
	// Sent automatically from the browser, so an unknown zone falls back to UTC instead of blocking site creation
	timezone: v.fallback(v.optional(v.pipe(v.string(), v.maxLength(64), v.check(isTimeZone)), 'UTC'), 'UTC'),
});

// POST /api/stats/sites - add a site; returns its id for the tracker's data-site-id
statsRoute.post('/sites', async (c) => {
	const parsed = v.safeParse(SiteBody, await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: 'Enter a domain like acme.io, or localhost for testing.' }, 400);
	const account = await cloudAccount(c);
	if (account && !accountActive(account)) return c.json({ error: 'Your trial has ended. Subscribe to add sites.' }, 402);
	const id = `gl_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
	const insert = c.env.DB.prepare('INSERT INTO sites (site_id, domain, name, currency, timezone) VALUES (?, ?, ?, ?, ?)').bind(id, parsed.output.domain, parsed.output.name || parsed.output.domain, parsed.output.currency, parsed.output.timezone);
	await c.env.DB.batch(account ? [insert, c.env.DB.prepare('INSERT INTO account_sites (site_id, account_id) VALUES (?, ?)').bind(id, account.id)] : [insert]);
	return c.json({ id, domain: parsed.output.domain }, 201);
});

// POST /api/stats/sites/:id/timezone - the IANA zone the dashboard's days, hours and heatmap use
statsRoute.post('/sites/:id/timezone', async (c) => {
	const body = (await c.req.json().catch(() => ({}))) as { timezone?: unknown };
	if (typeof body.timezone !== 'string' || body.timezone.length > 64 || !isTimeZone(body.timezone)) return c.json({ error: 'Pick a timezone such as Europe/London.' }, 400);
	await c.env.DB.prepare('UPDATE sites SET timezone = ? WHERE site_id = ?').bind(body.timezone, c.req.param('id')).run();
	return c.json({ ok: true });
});

// POST /api/stats/sites/:id/secrets {gateway, secret} - the payment webhook's signing secret; an empty secret removes it.
// Write-only: secrets are never returned. Needed on Hosted Cloud, where env secrets can't be per customer.
statsRoute.post('/sites/:id/secrets', async (c) => {
	const body = (await c.req.json().catch(() => ({}))) as { gateway?: unknown; secret?: unknown };
	const gateway = body.gateway as (typeof PAYMENT_GATEWAYS)[number];
	if (!PAYMENT_GATEWAYS.includes(gateway)) return c.json({ error: 'Unknown payment provider.' }, 400);
	const secret = typeof body.secret === 'string' ? body.secret.trim() : '';
	if (secret && (secret.length < 8 || secret.length > 512)) return c.json({ error: 'That does not look like a webhook signing secret.' }, 400);
	const site = c.req.param('id');
	await (secret
		? c.env.DB.prepare('INSERT INTO site_secrets (site_id, gateway, secret) VALUES (?, ?, ?) ON CONFLICT (site_id, gateway) DO UPDATE SET secret = excluded.secret').bind(site, gateway, secret)
		: c.env.DB.prepare('DELETE FROM site_secrets WHERE site_id = ? AND gateway = ?').bind(site, gateway)
	).run();
	return c.json({ ok: true });
});

// POST /api/stats/sites/:id/share - turn the public revenue page on or off
statsRoute.post('/sites/:id/share', async (c) => {
	const body = (await c.req.json().catch(() => ({}))) as { enabled?: unknown };
	await c.env.DB.prepare('UPDATE sites SET public_share_enabled = ? WHERE site_id = ?').bind(body.enabled ? 1 : 0, c.req.param('id')).run();
	return c.json({ ok: true });
});

const AdSpendBody = v.object({
	siteId: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
	source: v.pipe(v.string(), v.minLength(1), v.maxLength(512)),
	date: v.pipe(v.string(), v.isoDate()),
	amountCents: v.pipe(v.number(), v.integer(), v.minValue(0)),
});

// POST /api/stats/ad-spend - daily spend per source (sets, not adds, so re-imports are safe)
statsRoute.post('/ad-spend', async (c) => {
	const parsed = v.safeParse(AdSpendBody, await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: 'siteId, source, date (YYYY-MM-DD) and amountCents required' }, 400);
	const b = parsed.output;
	await c.env.DB.prepare('INSERT INTO ad_spend (site_id, source, spend_date, amount_cents) VALUES (?, ?, ?, ?) ON CONFLICT (site_id, source, spend_date) DO UPDATE SET amount_cents = excluded.amount_cents')
		.bind(b.siteId, b.source, b.date, b.amountCents)
		.run();
	return c.json({ ok: true });
});

const AnnotationBody = v.object({
	siteId: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
	at: v.pipe(v.number(), v.integer(), v.minValue(0)),
	label: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
});

// POST /api/stats/annotations - a marker on the chart ("Launched on Product Hunt")
statsRoute.post('/annotations', async (c) => {
	const parsed = v.safeParse(AnnotationBody, await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: 'siteId, at (unix seconds) and label required' }, 400);
	const b = parsed.output;
	await c.env.DB.prepare('INSERT INTO annotations (site_id, at, label) VALUES (?, ?, ?)').bind(b.siteId, b.at, b.label).run();
	return c.json({ ok: true }, 201);
});

// API tokens: read-only, one site each, for MCP, scripts or a teammate. Master API_TOKEN only (enforced in requireToken).
const TokenBody = v.object({
	siteId: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
	name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80)),
});

// GET /api/stats/tokens?siteId= - tokens for one site (never the secrets)
statsRoute.get('/tokens', async (c) => {
	const siteId = c.req.query('siteId');
	if (!siteId) return c.json({ error: 'siteId required' }, 400);
	const { results } = await c.env.DB.prepare('SELECT id, name, suffix, created_at AS createdAt, last_used_at AS lastUsedAt FROM api_tokens WHERE site_id = ? ORDER BY created_at DESC').bind(siteId).all();
	return c.json({ tokens: results });
});

// POST /api/stats/tokens - create one; the secret is returned this once and only its hash is stored
statsRoute.post('/tokens', async (c) => {
	const parsed = v.safeParse(TokenBody, await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: 'Give the token a name.' }, 400);
	const site = await c.env.DB.prepare('SELECT site_id FROM sites WHERE site_id = ?').bind(parsed.output.siteId).first();
	if (!site) return c.json({ error: 'Unknown site.' }, 404);
	const token = newTokenSecret();
	const id = crypto.randomUUID();
	await c.env.DB.prepare('INSERT INTO api_tokens (id, site_id, name, token_hash, suffix) VALUES (?, ?, ?, ?, ?)')
		.bind(id, parsed.output.siteId, parsed.output.name, await hashToken(token), token.slice(-4))
		.run();
	return c.json({ id, name: parsed.output.name, token }, 201, { 'Cache-Control': 'no-store' });
});

// POST /api/stats/tokens/:id/revoke - takes effect on the next request
statsRoute.post('/tokens/:id/revoke', async (c) => {
	await c.env.DB.prepare('DELETE FROM api_tokens WHERE id = ?').bind(c.req.param('id')).run();
	return c.json({ ok: true });
});
