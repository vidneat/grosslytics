import { Hono, type Context } from 'hono';
import { queryDashboard } from '@grosslytics/db-d1';
import type { Bindings } from '../env.js';
import { parseDashParams } from './stats.js';
import { footerRequired } from '../footer.js';

/** Public revenue pages: no token, only for sites that opted in, and never customer emails or journeys. */
export const shareRoute = new Hono<{ Bindings: Bindings }>();

/** Cloudflare only caches a Worker's own responses through the Cache API; without it every badge view reran the dashboard queries. */
const edgeCache = () => (globalThis as { caches?: { default?: Cache } }).caches?.default;

shareRoute.get('/:domain', async (c) => {
	// shortcut: per-datacenter cache for 60s, so turning the page off takes up to a minute to show; purge on toggle if that matters.
	const cache = edgeCache();
	const hit = await cache?.match(c.req.raw);
	if (hit) return new Response(hit.body, hit); // a mutable copy, so CORS adds this caller's origin
	const res = await shareResponse(c);
	if (cache && res.status === 200) {
		// Stored without CORS headers: they name whichever origin asked first
		const stored = new Response(res.clone().body, res);
		stored.headers.delete('access-control-allow-origin');
		stored.headers.delete('vary');
		c.executionCtx.waitUntil(cache.put(c.req.raw, stored));
	}
	return res;
});

async function shareResponse(c: Context<{ Bindings: Bindings }>) {
	const domain = c.req.param('domain')!.toLowerCase();
	const site = await c.env.DB.prepare(
		// A locked dashboard has no public page either, or sharing would be a way around the footer link
		"SELECT site_id FROM sites s WHERE domain = ?1 AND public_share_enabled = 1 AND (?2 = 0 OR domain = 'localhost' OR EXISTS (SELECT 1 FROM site_footer f WHERE f.site_id = s.site_id)) LIMIT 1",
	).bind(domain, footerRequired(c.env) ? 1 : 0).first<{ site_id: string }>();
	if (!site) return c.json({ error: 'No public page for this domain' }, 404);
	const p = parseDashParams({ ...c.req.query(), siteId: site.site_id });
	if (!p) return c.json({ error: 'Invalid query parameters' }, 400);
	const data = await queryDashboard(c.env.DB, site.site_id, { ...p, publicView: true });
	return c.json(data, 200, { 'Cache-Control': 'public, max-age=60' });
}
