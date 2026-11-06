import { Hono } from 'hono';
import { queryDashboard } from '@grosslytics/db-d1';
import type { Bindings } from '../env.js';
import { parseDashParams } from './stats.js';

/** Public revenue pages: no token, only for sites that opted in, and never customer emails or journeys. */
export const shareRoute = new Hono<{ Bindings: Bindings }>();

shareRoute.get('/:domain', async (c) => {
	const domain = c.req.param('domain').toLowerCase();
	const site = await c.env.DB.prepare('SELECT site_id FROM sites WHERE domain = ? AND public_share_enabled = 1 LIMIT 1').bind(domain).first<{ site_id: string }>();
	if (!site) return c.json({ error: 'No public page for this domain' }, 404);
	const p = parseDashParams({ ...c.req.query(), siteId: site.site_id });
	if (!p) return c.json({ error: 'Invalid query parameters' }, 400);
	const data = await queryDashboard(c.env.DB, site.site_id, { ...p, publicView: true });
	return c.json(data, 200, { 'Cache-Control': 'public, max-age=60' });
});
