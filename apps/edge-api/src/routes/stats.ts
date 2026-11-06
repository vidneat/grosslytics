import { Hono } from 'hono';
import * as v from 'valibot';
import { DashboardQuerySchema } from '@grosslytics/shared/schemas';
import { dateRangeToTimestamps } from '@grosslytics/shared/attribution';
import { D1StorageAdapter, queryDashboard } from '@grosslytics/db-d1';
import type { DashFilter } from '@grosslytics/shared/dashboard';
import type { AttributionModel } from '@grosslytics/shared/types';
import type { Bindings } from '../env.js';

export const statsRoute = new Hono<{ Bindings: Bindings }>();

// GET /api/stats - Channel analytics with multi-touch attribution
statsRoute.get('/', async (c) => {
	const query = c.req.query();
	const parsed = v.safeParse(DashboardQuerySchema, query);
	if (!parsed.success) {
		return c.json({ error: 'Invalid query parameters', issues: parsed.issues }, 400);
	}

	const { siteId, range = '30d', model = 'first' } = parsed.output;
	const { start, end } = dateRangeToTimestamps(range as '24h' | '7d' | '30d' | '90d');

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

// GET /api/stats/sites - sites this API serves
statsRoute.get('/sites', async (c) => {
	const { results } = await c.env.DB.prepare('SELECT site_id AS id, domain, name, public_share_enabled AS shared FROM sites ORDER BY created_at').all();
	return c.json({ sites: results });
});

const SiteBody = v.object({
	domain: v.pipe(v.string(), v.toLowerCase(), v.regex(/^[a-z0-9.-]+\.[a-z]{2,}$/), v.maxLength(255)),
	name: v.optional(v.pipe(v.string(), v.maxLength(255))),
});

// POST /api/stats/sites - add a site; returns its id for the tracker's data-site-id
statsRoute.post('/sites', async (c) => {
	const parsed = v.safeParse(SiteBody, await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: 'domain required, e.g. acme.io' }, 400);
	const id = `gl_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
	await c.env.DB.prepare('INSERT INTO sites (site_id, domain, name) VALUES (?, ?, ?)').bind(id, parsed.output.domain, parsed.output.name || parsed.output.domain).run();
	return c.json({ id, domain: parsed.output.domain }, 201);
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
