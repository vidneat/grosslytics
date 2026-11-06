import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import { MIGRATION_001_INIT, MIGRATION_002_ANNOTATIONS } from '@grosslytics/db-d1/migrations';
import { requireToken } from './auth.js';
import { mcpRoute } from './mcp.js';
import { statsRoute } from './routes/stats.js';
import { webhooksRoute } from './routes/webhooks.js';
import { shareRoute } from './routes/share.js';
import { queryDashboard } from '@grosslytics/db-d1';
import { verifyWebhook } from './verify.js';

// Minimal D1 shim over bun:sqlite — enough for drizzle's d1 driver
function fakeD1() {
	const db = new Database(':memory:');
	db.exec(MIGRATION_001_INIT + MIGRATION_002_ANNOTATIONS);
	// D1 binds every JS number as REAL; mimic that so integer-math bugs show up here too
	const asD1 = (sql: string, p: any[]) => sql.replace(/\?(\d+)/g, (m, n) => (typeof p[n - 1] === 'number' ? `CAST(${m} AS REAL)` : m));
	const stmt = (sql: string, params: any[] = []): any => ({
		bind: (...p: any[]) => stmt(asD1(sql, p), p),
		all: async () => ({ results: db.query(sql).all(...params), success: true, meta: {} }),
		raw: async () => db.query(sql).values(...params),
		run: async () => (db.query(sql).run(...params), { results: [], success: true, meta: {} }),
		first: async () => db.query(sql).get(...params),
	});
	return {
		sqlite: db,
		d1: {
			prepare: (sql: string) => stmt(sql),
			batch: async (stmts: any[]) => Promise.all(stmts.map((s) => s.all())),
		} as unknown as D1Database,
	};
}

const SECRET = 'whsec_test';
const enc = new TextEncoder();
async function hmacHex(msg: string) {
	const k = await crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg))), (b) =>
		b.toString(16).padStart(2, '0'),
	).join('');
}
async function stripeHeaders(body: string, t = Math.floor(Date.now() / 1000)) {
	return { 'stripe-signature': `t=${t},v1=${await hmacHex(`${t}.${body}`)}` };
}

function makeApp() {
	const { d1, sqlite } = fakeD1();
	const app = new Hono<any>();
	app.use('/api/stats/*', requireToken);
	app.use('/api/mcp/*', requireToken);
	app.route('/api/stats', statsRoute);
	app.route('/api/webhooks', webhooksRoute);
	app.route('/api/mcp', mcpRoute);
	app.route('/api/share', shareRoute);
	const env = { DB: d1, STRIPE_WEBHOOK_SECRET: SECRET, API_TOKEN: 'tok' };
	return { fetch: (url: string, init?: RequestInit) => app.fetch(new Request(`http://x${url}`, init), env), sqlite, d1 };
}

test('verify: stripe accepts valid, rejects tampered, stale and missing signatures', async () => {
	const body = '{"id":"evt_1"}';
	const ok = new Headers(await stripeHeaders(body));
	expect(await verifyWebhook('stripe', SECRET, body, ok)).toBe(true);
	expect(await verifyWebhook('stripe', SECRET, `${body} `, ok)).toBe(false);
	expect(await verifyWebhook('stripe', SECRET, body, new Headers(await stripeHeaders(body, 1000)))).toBe(false);
	expect(await verifyWebhook('stripe', SECRET, body, new Headers())).toBe(false);
});

test('verify: razorpay, lemonsqueezy, paddle, polar', async () => {
	const body = '{"a":1}';
	expect(await verifyWebhook('razorpay', SECRET, body, new Headers({ 'x-razorpay-signature': await hmacHex(body) }))).toBe(true);
	expect(await verifyWebhook('lemonsqueezy', SECRET, body, new Headers({ 'x-signature': await hmacHex(body) }))).toBe(true);
	const ts = String(Math.floor(Date.now() / 1000));
	expect(
		await verifyWebhook('paddle', SECRET, body, new Headers({ 'paddle-signature': `ts=${ts};h1=${await hmacHex(`${ts}:${body}`)}` })),
	).toBe(true);
	// Polar / Standard Webhooks with a raw (non-whsec_) secret
	const raw = 'polar_secret';
	const k = await crypto.subtle.importKey('raw', enc.encode(raw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(`msg_1.${ts}.${body}`)))));
	const h = new Headers({ 'webhook-id': 'msg_1', 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` });
	expect(await verifyWebhook('polar', raw, body, h)).toBe(true);
	expect(await verifyWebhook('polar', 'wrong', body, h)).toBe(false);
});

test('webhooks: unsigned rejected; signed sale attributed, deduped, and in linear stats', async () => {
	const app = makeApp();
	const now = Math.floor(Date.now() / 1000);
	app.sqlite.run(
		`INSERT INTO visitors (site_id, visitor_id, first_seen_at, first_source, last_seen_at, last_source, total_active_read_sec, max_scroll_pct)
		 VALUES ('s1', 'v1', ?, 'google.com', ?, 'x.com (in-app)', 120, 80)`,
		[now - 7200, now],
	);
	const body = JSON.stringify({
		id: 'evt_1',
		type: 'checkout.session.completed',
		data: { object: { id: 'cs_1', payment_status: 'paid', amount_total: 10000, currency: 'usd', client_reference_id: 'v1', customer_details: { email: 'a@b.com' } } },
	});
	const post = async (headers: Record<string, string>) =>
		app.fetch('/api/webhooks/stripe?siteId=s1', { method: 'POST', body, headers });

	expect((await post({})).status).toBe(401);
	expect(await (await post(await stripeHeaders(body))).json()).toEqual({ received: true });
	expect(await (await post(await stripeHeaders(body))).json()).toEqual({ received: true, deduplicated: true });

	const pay = app.sqlite.query('SELECT * FROM payments').all() as any[];
	expect(pay.length).toBe(1);
	expect(pay[0].first_touch_source).toBe('google.com');
	expect(pay[0].last_touch_source).toBe('x.com (in-app)');
	expect(pay[0].time_to_convert_hours).toBe(2);
	expect(pay[0].buyer_read_sec).toBe(120);
	// email hash linked to the visitor for future renewals
	expect((app.sqlite.query('SELECT customer_email_hash h FROM visitors').get() as any).h).toBe(pay[0].customer_email_hash);

	// Stats require the token, and report revenue even with no traffic rows
	expect((await app.fetch('/api/stats?siteId=s1')).status).toBe(401);
	const stats = (await (await app.fetch('/api/stats?siteId=s1&model=linear', { headers: { authorization: 'Bearer tok' } })).json()) as any;
	const by = Object.fromEntries(stats.channels.map((ch: any) => [ch.source, ch]));
	// $100 gross, Stripe fee 320¢ → net 9680¢, split 50/50
	expect(by['google.com'].grossRevenueCents).toBe(5000);
	expect(by['google.com'].netRevenueCents).toBe(4840);
	expect(by['google.com'].conversions).toBe(0.5);
	expect(by['x.com (in-app)'].netRevenueCents).toBe(4840);
});

test('mcp: requires token; initialize and tools/list work over Streamable HTTP', async () => {
	const app = makeApp();
	const rpc = (body: object, token = 'tok') =>
		app.fetch('/api/mcp?site=s1', {
			method: 'POST',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
			body: JSON.stringify(body),
		});
	expect((await rpc({}, 'bad')).status).toBe(401);
	const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
	expect(((await init.json()) as any).result.serverInfo.name).toBe('grosslytics-mcp');
	const list = (await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()) as any;
	expect(list.result.tools.map((t: any) => t.name)).toContain('query_channel_roas');
});

// 2026-03-31 12:00 UTC (a Tuesday)
const FIXED_NOW = Date.UTC(2026, 2, 31, 12) / 1000;
const NOW = FIXED_NOW;
function seedDashboard(sqlite: Database, NOW = FIXED_NOW) {
	const ev = sqlite.prepare('INSERT INTO events (site_id, visitor_id, session_id, event_type, event_name, source, duration_sec, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
	const vis = sqlite.prepare("INSERT INTO visitors (site_id, visitor_id, first_seen_at, first_source, last_seen_at, last_source, country, device_type, browser, os, first_utm_campaign, total_active_read_sec, max_scroll_pct) VALUES ('s1', ?, ?, ?, ?, ?, ?, ?, 'Chrome', 'macOS', ?, ?, ?)");
	sqlite.exec("INSERT INTO sites (site_id, domain, name, public_share_enabled) VALUES ('s1', 'acme.io', 'Acme', 1)");
	// v1: found us on X three days ago, came back from ChatGPT, read pricing, paid
	vis.run('v1', NOW - 3 * 86400, 'x.com (in-app)', NOW - 7200, 'chatgpt.com (AI)', 'US', 'desktop', 'launch', 300, 90);
	ev.run('s1', 'v1', 'a', 'pageview', '/', 'x.com (in-app)', 0, NOW - 3 * 86400);
	ev.run('s1', 'v1', 'a', 'leave', '/', 'x.com (in-app)', 120, NOW - 3 * 86400 + 120);
	ev.run('s1', 'v1', 'b', 'pageview', '/pricing', 'chatgpt.com (AI)', 0, NOW - 7200);
	ev.run('s1', 'v1', 'b', 'goal', 'checkout', 'chatgpt.com (AI)', 0, NOW - 7100);
	// v2: one look from Google on a phone, no purchase
	vis.run('v2', NOW - 86400, 'google.com', NOW - 86400, 'google.com', 'IN', 'mobile', null, 20, 30);
	ev.run('s1', 'v2', 'c', 'pageview', '/', 'google.com', 0, NOW - 86400);
	// crawler traffic never counts as visitors
	ev.run('s1', 'bot', 'd', 'ai_crawl', '/', 'GPTBot', 0, NOW - 3600);
	sqlite.exec(`INSERT INTO payments (payment_id, site_id, gateway, visitor_id, customer_email_masked, gross_amount_cents, fee_amount_cents, net_amount_cents, status, first_touch_source, last_touch_source, country, time_to_convert_hours, created_at)
		VALUES ('p1', 's1', 'stripe', 'v1', 'm***@hey.com', 10000, 320, 9680, 'succeeded', 'x.com (in-app)', 'chatgpt.com (AI)', 'US', 70, ${NOW - 3600}),
		       ('p0', 's1', 'stripe', 'v1', 'm***@hey.com', 5000, 175, 4825, 'refunded', 'x.com (in-app)', 'chatgpt.com (AI)', 'US', 70, ${NOW - 3600})`);
	sqlite.exec("INSERT INTO ad_spend (site_id, source, spend_date, amount_cents) VALUES ('s1', 'x.com (in-app)', '2026-03-30', 2000)");
	sqlite.exec(`INSERT INTO annotations (site_id, at, label) VALUES ('s1', ${NOW - 86400}, 'Launched')`);
}

test('dashboard: totals, attribution models, filters, pages, funnel and profit agree', async () => {
	const { sqlite, d1 } = makeApp();
	seedDashboard(sqlite);
	const q = (o: Partial<Parameters<typeof queryDashboard>[2]> = {}) =>
		queryDashboard(d1, 's1', { range: '30d', model: 'first', mode: 'net', filters: [], now: NOW, ...o });

	const d = await q();
	expect(d.totals).toEqual({ visitors: 2, gross: 10000, fee: 320, ad: 2000, revenue: 9680, sales: 1 }); // refund and bot excluded
	expect(d.series.n).toBe(30);
	expect(d.series.revenue.reduce((a, b) => a + b, 0)).toBe(9680);
	expect(d.series.revenue[29]).toBe(9680); // today is the last bucket
	const src = (data: typeof d, k: string) => data.sources.find((s) => s.key === k);
	expect(src(d, 'x.com (in-app)')).toMatchObject({ visitors: 1, revenue: 9680, sales: 1, cat: 'Social (Organic)', icon: 'x.com' });
	expect(src(d, 'chatgpt.com (AI)')?.revenue).toBe(0);

	const last = await q({ model: 'last' });
	expect(src(last, 'chatgpt.com (AI)')?.revenue).toBe(9680);
	const linear = await q({ model: 'linear' });
	expect(src(linear, 'x.com (in-app)')?.revenue).toBe(4840);
	expect(src(linear, 'chatgpt.com (AI)')?.revenue).toBe(4840);

	expect(d.pages.find((p) => p.key === '/pricing')).toMatchObject({ visitors: 1, revenue: 9680 });
	expect(d.pages.find((p) => p.key === '/')).toMatchObject({ visitors: 2, note: '2m 00s read' });
	expect(d.entry.find((p) => p.key === '/')?.visitors).toBe(2);
	expect(d.countries.map((c) => [c.key, c.label, c.revenue])).toEqual([['IN', 'India', 0], ['US', 'United States', 9680]].sort((a, b) => (a[0]! < b[0]! ? 1 : -1)) as any);
	expect(d.funnel.map((f) => f.count)).toEqual([2, 1, 1, 1]);
	expect(d.campaigns[0]).toMatchObject({ key: 'launch', revenue: 9680 });
	expect(d.timeToConvert[1]!.share).toBe(1); // 70 hours = 1-3 days
	expect(d.heat[1]![11]).toBe(1); // Tuesday 11:00 UTC
	expect(d.behaviour[3]).toEqual({ label: 'Read /pricing', buyers: '100%', others: '0%' });
	expect(d.sales[0]).toMatchObject({ id: 'p1', email: 'm***@hey.com', first: 'x.com (in-app)', visitorId: 'v1' });
	expect(d.annotations).toEqual([{ at: NOW - 86400, label: 'Launched' }]);
	expect(d.ltv[0]).toMatchObject({ key: 'x.com (in-app)', ltv: 9680, customers: 1 });

	expect((await q({ mode: 'profit' })).totals.revenue).toBe(7680);
	expect((await q({ mode: 'gross' })).totals.revenue).toBe(10000);

	const india = await q({ filters: [{ dim: 'country', value: 'IN' }] });
	expect(india.totals).toMatchObject({ visitors: 1, gross: 0, sales: 0, ad: 0 });
	const mobile = await q({ filters: [{ dim: 'device', value: 'Mobile' }] });
	expect(mobile.totals.visitors).toBe(1);
	const fromX = await q({ filters: [{ dim: 'source', value: 'x.com (in-app)' }] });
	expect(fromX.totals).toMatchObject({ visitors: 1, gross: 10000, ad: 2000 });
	const pricing = await q({ filters: [{ dim: 'page', value: '/pricing' }] });
	expect(pricing.totals).toMatchObject({ visitors: 1, sales: 1 });

	const day = await q({ range: '24h' });
	expect(day.series.n).toBe(24);
	expect(day.totals.visitors).toBe(1); // only v1 was active in the last 24 hours

	// A renewal adds revenue but is not a new sale (conversion and the buyer heatmap stay honest)
	sqlite.exec(`INSERT INTO payments (payment_id, site_id, gateway, visitor_id, gross_amount_cents, fee_amount_cents, net_amount_cents, status, is_renewal, first_touch_source, last_touch_source, created_at)
		VALUES ('p2', 's1', 'stripe', 'v1', 4000, 146, 3854, 'succeeded', 1, 'x.com (in-app)', 'chatgpt.com (AI)', ${NOW - 1800})`);
	const renewed = await q();
	expect(renewed.totals).toMatchObject({ gross: 14000, sales: 1 });
	expect(src(renewed, 'x.com (in-app)')).toMatchObject({ revenue: 9680 + 3854, sales: 1 });
	expect(renewed.heat.flat().reduce((a, b) => a + b, 0)).toBe(1);
});

test('dashboard routes: token required, params validated, share page public but private data hidden', async () => {
	const { fetch, sqlite } = makeApp();
	seedDashboard(sqlite, Math.floor(Date.now() / 1000)); // routes use the real clock
	expect((await fetch('/api/stats/dashboard?siteId=s1')).status).toBe(401);
	const auth = { headers: { authorization: 'Bearer tok' } };
	expect((await fetch('/api/stats/dashboard?siteId=s1&range=1y', auth)).status).toBe(400);
	const ok = await fetch('/api/stats/dashboard?siteId=s1&model=linear&country=US', auth);
	expect(ok.status).toBe(200);
	expect(((await ok.json()) as any).totals.visitors).toBe(1);

	const pub = (await (await fetch('/api/share/acme.io')).json()) as any;
	expect(pub.sales).toEqual([]);
	expect(pub.live).toBe(true);
	expect((await fetch('/api/share/unknown.io')).status).toBe(404);
	sqlite.exec("UPDATE sites SET public_share_enabled = 0 WHERE site_id = 's1'");
	expect((await fetch('/api/share/acme.io')).status).toBe(404);

	const post = (path: string, body: unknown) => fetch(path, { method: 'POST', headers: { authorization: 'Bearer tok', 'content-type': 'application/json' }, body: JSON.stringify(body) });
	const site = (await (await post('/api/stats/sites', { domain: 'New.io' })).json()) as any;
	expect(site.domain).toBe('new.io');
	expect((await post('/api/stats/sites', { domain: 'not a domain' })).status).toBe(400);
	expect((await post('/api/stats/ad-spend', { siteId: 's1', source: 'x.com (in-app)', date: '2026-03-30', amountCents: 500 })).status).toBe(200);
	expect(sqlite.query("SELECT amount_cents FROM ad_spend WHERE site_id = 's1'").get()).toEqual({ amount_cents: 500 }); // replaced, not added
	expect((await post('/api/stats/annotations', { siteId: 's1', at: NOW, label: '  ' })).status).toBe(400);
});
