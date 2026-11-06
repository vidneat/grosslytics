import { Hono } from 'hono';
import * as v from 'valibot';
import { DashboardQuerySchema } from '@grosslytics/shared/schemas';
import { dateRangeToTimestamps } from '@grosslytics/shared/attribution';
import { D1StorageAdapter } from '@grosslytics/db-d1';
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

