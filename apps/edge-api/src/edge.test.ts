import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import { ALL_MIGRATIONS } from '@grosslytics/db-d1/migrations';
import { requireToken } from './auth.js';
import { mcpRoute } from './mcp.js';
import { statsRoute } from './routes/stats.js';
import { webhooksRoute } from './routes/webhooks.js';
import { shareRoute } from './routes/share.js';
import { waitlistRoute } from './routes/waitlist.js';
import { collectRoute, originAllowed } from './routes/collect.js';
import { authRoute } from './routes/auth.js';
import { billingRoute } from './routes/billing.js';
import { CLOUD_EVENT_CAP, countUsage, usageMonth } from './cloud.js';
import { licenseRoute } from './routes/license.js';
import { verifyPassword } from './routes/auth.js';
import { apiToml, hashPassword as cliHashPassword, isHost, noindex } from '../../../packages/cli/src/install.ts';
import { handleQueueBatch } from './consumer.js';
import type { EnrichedEvent } from '@grosslytics/shared/types';
import { formatMoney } from '@grosslytics/shared/money';
import { D1StorageAdapter, ingestEvents, queryDashboard, siteRange } from '@grosslytics/db-d1';
import { dateRangeToTimestamps, tzOffsetSec } from '@grosslytics/shared/attribution';
import { verifyWebhook } from './verify.js';

// Minimal D1 shim over bun:sqlite — enough for drizzle's d1 driver
function fakeD1() {
	const db = new Database(':memory:');
	db.exec(ALL_MIGRATIONS);
	// D1 binds every JS number as REAL; mimic that so integer-math bugs show up here too
	const asD1 = (sql: string, p: any[]) => sql.replace(/\?(\d+)/g, (m, n) => (typeof p[n - 1] === 'number' ? `CAST(${m} AS REAL)` : m));
	const stmt = (sql: string, params: any[] = []): any => {
		const execute = () => ({ results: db.query(sql).all(...params), success: true, meta: { changes: (db.query('SELECT changes() n').get() as any).n } });
		return {
			bind: (...p: any[]) => stmt(asD1(sql, p), p),
			execute,
			all: async () => execute(),
			raw: async () => db.query(sql).values(...params),
			run: async () => execute(),
			first: async () => db.query(sql).get(...params),
		};
	};
	return {
		sqlite: db,
		d1: {
			prepare: (sql: string) => stmt(sql),
			batch: async (stmts: any[]) => db.transaction(() => stmts.map((s) => s.execute()))(),
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

function makeApp(extra: Record<string, unknown> = {}) {
	const { d1, sqlite } = fakeD1();
	sqlite.exec("INSERT OR IGNORE INTO sites (site_id, domain, name, public_share_enabled) VALUES ('s1', 'acme.io', 'Acme', 1)");
	const app = new Hono<any>();
	app.use('/api/stats/*', requireToken);
	app.use('/api/mcp/*', requireToken);
	app.route('/api/stats', statsRoute);
	app.route('/api/webhooks', webhooksRoute);
	app.route('/api/mcp', mcpRoute);
	app.route('/api/share', shareRoute);
	app.route('/api/waitlist', waitlistRoute);
	app.route('/api/auth', authRoute);
	app.route('/api/billing', billingRoute);
	app.route('/api/license', licenseRoute);
	app.route('/api/event', collectRoute);
	const env = { DB: d1, STRIPE_WEBHOOK_SECRET: SECRET, API_TOKEN: 'tok', ...extra };
	const fetch = async (url: string, init?: RequestInit) => {
		const waits: Promise<unknown>[] = [];
		const res = await app.fetch(new Request(`http://x${url}`, init), env, { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {} } as any);
		await Promise.all(waits);
		return res;
	};
	return { fetch, sqlite, d1 };
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
	sqlite.exec("INSERT OR IGNORE INTO sites (site_id, domain, name, public_share_enabled) VALUES ('s1', 'acme.io', 'Acme', 1)");
	// v1: found us on X three days ago, came back from ChatGPT, read pricing, paid
	vis.run('v1', NOW - 3 * 86400, 'x.com (in-app)', NOW - 7200, 'chatgpt.com (AI)', 'US', 'desktop', 'launch', 300, 90);
	ev.run('s1', 'v1', 'a', 'pageview', '/', 'x.com (in-app)', 0, NOW - 3 * 86400);
	// read 90s, switched tabs, came back for 30s more: the tracker reports each piece once
	ev.run('s1', 'v1', 'a', 'leave', '/', 'x.com (in-app)', 90, NOW - 3 * 86400 + 90);
	ev.run('s1', 'v1', 'a', 'leave', '/', 'x.com (in-app)', 30, NOW - 3 * 86400 + 300);
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
	sqlite.exec(`INSERT INTO refunds (payment_id, site_id, refunded_at) VALUES ('p0', 's1', ${NOW - 1800})`);
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
	const cells = (g: number[][]) => g.flat().reduce((x, y) => x + y, 0);
	expect([cells(d.heat), cells(d.heatRefunds)]).toEqual([1, 1]); // the sale is green, the refund red
	expect(d.campaigns[0]).toMatchObject({ key: 'launch', revenue: 9680 });
	expect(d.timeToConvert[1]!.share).toBe(1); // 70 hours = 1-3 days
	expect(d.heat[1]![11]).toBe(1); // Tuesday 11:00 UTC
	expect(d.behaviour[3]).toEqual({ label: 'Read /pricing', buyers: '100%', others: '0%' });
	expect(d.sales.find((x) => x.id === 'p1')).toMatchObject({ email: 'm***@hey.com', first: 'x.com (in-app)', visitorId: 'v1', refunded: false });
	expect(d.sales.find((x) => x.id === 'p0')?.refunded).toBe(true); // listed, while totals above exclude it
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
	expect(((await (await post('/api/stats/sites', { domain: 'https://www.Shop.dev/pricing?x=1' })).json()) as any).domain).toBe('shop.dev');
	expect(((await (await post('/api/stats/sites', { domain: 'localhost' })).json()) as any).domain).toBe('localhost');
	expect((await post('/api/stats/sites', { domain: 'localhostx' })).status).toBe(400);
	expect((await post('/api/stats/ad-spend', { siteId: 's1', source: 'x.com (in-app)', date: '2026-03-30', amountCents: 500 })).status).toBe(200);
	expect(sqlite.query("SELECT amount_cents FROM ad_spend WHERE site_id = 's1'").get()).toEqual({ amount_cents: 500 }); // replaced, not added
	expect((await post('/api/stats/annotations', { siteId: 's1', at: NOW, label: '  ' })).status).toBe(400);
});

test('waitlist: validates, normalizes and dedupes without a token', async () => {
	const { fetch, sqlite } = makeApp();
	const join = (body: unknown) => fetch('/api/waitlist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
	expect((await join({ email: '  Maya@Example.com ', plan: 'cloud' })).status).toBe(201);
	expect((await join({ email: 'maya@example.com', plan: 'cloud' })).status).toBe(201); // repeat is a no-op
	expect((await join({ email: 'maya@example.com', plan: 'lifetime' })).status).toBe(201);
	expect((await join({ email: 'not-an-email', plan: 'cloud' })).status).toBe(400);
	expect((await join({ email: 'a@b.co', plan: 'enterprise' })).status).toBe(400);
	expect(sqlite.query('SELECT email, plan FROM waitlist ORDER BY plan').all()).toEqual([
		{ email: 'maya@example.com', plan: 'cloud' },
		{ email: 'maya@example.com', plan: 'lifetime' },
	]);
});

test('webhooks: a full Stripe refund marks the payment refunded once; partial refunds are ignored', async () => {
	const app = makeApp();
	const send = async (body: object) => {
		const raw = JSON.stringify(body);
		return (await app.fetch('/api/webhooks/stripe?siteId=s1', { method: 'POST', body: raw, headers: await stripeHeaders(raw) })).json();
	};
	await send({ id: 'evt_pay', type: 'checkout.session.completed', data: { object: { id: 'cs_9', payment_intent: 'pi_9', payment_status: 'paid', amount_total: 900, currency: 'usd' } } });
	expect(await send({ id: 'evt_part', type: 'charge.refunded', data: { object: { payment_intent: 'pi_9', refunded: false } } })).toEqual({ received: true, ignored: true });
	expect((app.sqlite.query("SELECT status FROM payments WHERE payment_id = 'pi_9'").get() as any).status).toBe('succeeded');
	const refund = { id: 'evt_ref', type: 'charge.refunded', data: { object: { payment_intent: 'pi_9', refunded: true } } };
	expect((await send(refund)) as any).toMatchObject({ received: true });
	expect(await send(refund)).toEqual({ received: true, deduplicated: true });
	expect((app.sqlite.query("SELECT status FROM payments WHERE payment_id = 'pi_9'").get() as any).status).toBe('refunded');
	expect(app.sqlite.query('SELECT payment_id FROM refunds').all()).toEqual([{ payment_id: 'pi_9' }]);
});

const checkout = (id = 'evt_checkout', invoice = 'in_1') => ({
	id, type: 'checkout.session.completed', data: { object: {
		id: 'cs_1', invoice, payment_status: 'paid', amount_total: 10000, currency: 'usd',
		client_reference_id: 'v1', customer_details: { email: 'buyer@example.com' }, metadata: { plan_name: 'Pro' },
	} },
});
const invoicePaid = (id = 'evt_invoice') => ({
	id, type: 'invoice.paid', data: { object: { id: 'in_1', amount_paid: 10000, currency: 'usd', customer_email: 'buyer@example.com' } },
});
const refund = { id: 'evt_refund', type: 'charge.refunded', data: { object: { payment_intent: 'pi_1', refunded: true } } };
const invoiceLink = { id: 'evt_link', type: 'invoice_payment.paid', data: { object: { invoice: 'in_1', status: 'paid', payment: { type: 'payment_intent', payment_intent: 'pi_1' } } } };
const stripePost = async (app: ReturnType<typeof makeApp>, event: object) => {
	const body = JSON.stringify(event);
	return app.fetch('/api/webhooks/stripe?siteId=s1', { method: 'POST', body, headers: await stripeHeaders(body) });
};
const seedBuyer = (sqlite: Database) => sqlite.run(
	"INSERT INTO visitors (site_id, visitor_id, first_seen_at, last_seen_at, first_source, last_source) VALUES ('s1', 'v1', ?, ?, 'google.com', 'x.com')",
	[Math.floor(Date.now() / 1000) - 3600, Math.floor(Date.now() / 1000)],
);

test('ingestion: 100-message redelivery, mixed retries and partial failures are atomic', async () => {
	const { d1, sqlite } = fakeD1();
	const body: EnrichedEvent = { sid: 's1', vid: 'v1', ses: 'a', t: 'pageview', n: '/', src: 'google.com', cat: 'Organic Search', ref: '', sd: 50, dur: 5,
		country: 'US', city: 'Austin', colo: 'DFW', asOrganization: '', deviceType: 'desktop', os: 'macOS', browser: 'Chrome', createdAt: Math.floor(Date.now() / 1000) };
	let acknowledged = 0;
	let retried = 0;
	const deliver = (messages: Array<{ id: string; body: EnrichedEvent }>) => handleQueueBatch({
		messages: messages.map((message) => ({ ...message, retry: () => retried++ })), ackAll: () => acknowledged++,
	} as unknown as MessageBatch<EnrichedEvent>, { DB: d1 } as any);
	const messages = Array.from({ length: 100 }, (_, i) => ({ id: String(i), body }));
	await deliver(messages);
	await deliver(messages);
	await deliver([...messages, { id: 'new', body }]);
	expect(sqlite.query('SELECT COUNT(*) n FROM events').get()).toEqual({ n: 101 });
	expect(sqlite.query('SELECT total_active_read_sec n FROM visitors').get()).toEqual({ n: 505 });
	expect(sqlite.query("SELECT COUNT(*) n FROM events WHERE event_type = 'pageview'").get()).toEqual({ n: 101 });
	sqlite.exec("CREATE TRIGGER fail_rollup BEFORE INSERT ON visitors WHEN NEW.last_source = 'fail' BEGIN SELECT RAISE(ABORT, 'injected rollup failure'); END");
	const failed = [{ id: 'retry', body: { ...body, src: 'fail' } }];
	const originalError = console.error;
	console.error = () => {};
	try { await deliver(failed); } finally { console.error = originalError; }
	expect(retried).toBe(1);
	expect(acknowledged).toBe(3);
	expect(sqlite.query("SELECT COUNT(*) n FROM processed_messages WHERE message_id = 'queue:retry'").get()).toEqual({ n: 0 });
	expect(sqlite.query('SELECT COUNT(*) n FROM events').get()).toEqual({ n: 101 });
	sqlite.exec('DROP TRIGGER fail_rollup');
	await deliver(failed);
	expect(sqlite.query('SELECT COUNT(*) n FROM events').get()).toEqual({ n: 102 });
	expect(sqlite.query('SELECT total_active_read_sec n FROM visitors').get()).toEqual({ n: 510 });
});

test('Stripe: either checkout/invoice order fills attribution and broadcasts only one sale', async () => {
	for (const events of [[invoicePaid(), checkout()], [checkout(), invoicePaid()]]) {
		let alerts = 0;
		const app = makeApp({ SITE_LIVE_HUB: { idFromName: () => 's1', get: () => ({ fetch: async () => { alerts++; return new Response('OK'); } }) } });
		seedBuyer(app.sqlite);
		for (const event of events) expect((await stripePost(app, event)).status).toBe(200);
		await Promise.all([stripePost(app, checkout()), stripePost(app, checkout())]);
		expect(app.sqlite.query('SELECT payment_id, visitor_id, first_touch_source, last_touch_source, plan_name FROM payments').all()).toEqual([
			{ payment_id: 'in_1', visitor_id: 'v1', first_touch_source: 'google.com', last_touch_source: 'x.com', plan_name: 'Pro' },
		]);
		expect(alerts).toBe(1);
	}
});

test('a queued visit arriving after checkout fills attribution and links future renewals', async () => {
	const app = makeApp();
	await stripePost(app, checkout());
	const body: EnrichedEvent = { sid: 's1', vid: 'v1', ses: 'a', t: 'pageview', n: '/', src: 'google.com', cat: 'Organic Search', ref: '', sd: 0, dur: 0,
		country: 'US', city: 'Austin', colo: 'DFW', asOrganization: '', deviceType: 'desktop', os: 'macOS', browser: 'Chrome', createdAt: Math.floor(Date.now() / 1000) - 20 };
	await handleQueueBatch({ messages: [{ id: 'late_visit', body }], ackAll: () => {} } as unknown as MessageBatch<EnrichedEvent>, { DB: app.d1 } as any);
	const renewal = invoicePaid('evt_renewal');
	renewal.data.object.id = 'in_renewal';
	await stripePost(app, renewal);
	expect(app.sqlite.query('SELECT first_touch_source FROM payments').all()).toEqual([{ first_touch_source: 'google.com' }, { first_touch_source: 'google.com' }]);
	expect((app.sqlite.query('SELECT customer_email_hash FROM visitors').get() as any).customer_email_hash).toBeTruthy();
});

test('Stripe: refunds survive every delivery order and late success events cannot revive them', async () => {
	for (const events of [
		[refund, invoiceLink, invoicePaid(), checkout()],
		[invoicePaid(), checkout(), refund, invoiceLink],
		[invoiceLink, invoicePaid(), refund, checkout()],
	]) {
		const app = makeApp();
		seedBuyer(app.sqlite);
		for (const event of events) expect((await stripePost(app, event)).status).toBe(200);
		await stripePost(app, invoicePaid('evt_late_success'));
		expect(app.sqlite.query('SELECT payment_id, status, first_touch_source FROM payments').all()).toEqual([
			{ payment_id: 'in_1', status: 'refunded', first_touch_source: 'google.com' },
		]);
		expect(app.sqlite.query('SELECT payment_id FROM refunds').all()).toEqual([{ payment_id: 'in_1' }]);
	}
});

test('Stripe: failed refund transaction leaves no receipt and succeeds on retry', async () => {
	const app = makeApp();
	await stripePost(app, invoicePaid());
	await stripePost(app, invoiceLink);
	app.sqlite.exec("CREATE TRIGGER fail_refund BEFORE UPDATE OF status ON payments WHEN NEW.status = 'refunded' BEGIN SELECT RAISE(ABORT, 'injected refund failure'); END");
	const originalError = console.error;
	console.error = () => {};
	try { expect((await stripePost(app, refund)).status).toBe(500); } finally { console.error = originalError; }
	expect(app.sqlite.query("SELECT COUNT(*) n FROM processed_messages WHERE message_id = 'webhook:s1:stripe:evt_refund'").get()).toEqual({ n: 0 });
	expect(app.sqlite.query('SELECT COUNT(*) n FROM refund_references').get()).toEqual({ n: 0 });
	app.sqlite.exec('DROP TRIGGER fail_refund');
	expect((await stripePost(app, refund)).status).toBe(200);
	expect(await (await stripePost(app, refund)).json()).toEqual({ received: true, deduplicated: true });
	expect(app.sqlite.query('SELECT status FROM payments').get()).toEqual({ status: 'refunded' });
});

test('money: one reporting currency, explicit rejection and no mixed historical totals', async () => {
	const app = makeApp();
	app.sqlite.exec("UPDATE sites SET currency = 'EUR' WHERE site_id = 's1'");
	const payment = checkout();
	expect((await stripePost(app, payment)).status).toBe(422);
	(payment.data.object as any).currency = 'jpy';
	expect((await stripePost(app, payment)).status).toBe(422);
	payment.data.object.currency = 'eur';
	expect((await stripePost(app, payment)).status).toBe(200); // a rejection never claims the event
	app.sqlite.exec("INSERT INTO payments (payment_id, site_id, gateway, gross_amount_cents, net_amount_cents, status, currency) VALUES ('legacy_usd', 's1', 'stripe', 5000, 5000, 'succeeded', 'usd')");
	const data = await queryDashboard(app.d1, 's1', { range: '30d', model: 'first', mode: 'gross', filters: [] });
	expect(data.currency).toBe('EUR');
	expect(data.excludedCurrencies).toEqual(['USD']);
	expect(data.totals.gross).toBe(10000);
	expect(data.ltv.reduce((sum, row) => sum + row.ltv * row.customers, 0)).toBe(9680);
	expect(data.sales).toHaveLength(1);
	expect(data.sales[0]?.currency).toBe('EUR');
	const stats = await (await app.fetch('/api/stats?siteId=s1', { headers: { authorization: 'Bearer tok' } })).json() as any;
	expect(stats.channels.reduce((sum: number, row: any) => sum + row.grossRevenueCents, 0)).toBe(10000);
	expect(stats.channels.every((row: any) => row.currency === 'EUR')).toBe(true);
	expect(formatMoney(12345, 'EUR', 2)).toContain('123.45');
	expect(formatMoney(12345, 'INR', 2)).toContain('₹');
	expect(() => formatMoney(100, 'JPY')).toThrow('Unsupported reporting currency');
	const create = (currency: string) => app.fetch('/api/stats/sites', { method: 'POST', headers: { authorization: 'Bearer tok', 'content-type': 'application/json' }, body: JSON.stringify({ domain: 'shop.test', currency }) });
	expect((await create('JPY')).status).toBe(400);
	const created = await (await create('INR')).json() as { id: string };
	expect(app.sqlite.query('SELECT currency FROM sites WHERE site_id = ?').get(created.id)).toEqual({ currency: 'INR' });
});

test('Polar: signed order reads the checkout reference_id and attributes the sale', async () => {
	const app = makeApp({ POLAR_WEBHOOK_SECRET: 'polar_secret' });
	seedBuyer(app.sqlite);
	const body = JSON.stringify({ type: 'order.paid', data: { id: 'polar_order', total_amount: 10000, currency: 'usd', metadata: { reference_id: 'v1' }, customer: { email: 'buyer@example.com' } } });
	const ts = String(Math.floor(Date.now() / 1000));
	const key = await crypto.subtle.importKey('raw', enc.encode('polar_secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`msg_order.${ts}.${body}`)))));
	const res = await app.fetch('/api/webhooks/polar?siteId=s1', { method: 'POST', body, headers: { 'webhook-id': 'msg_order', 'webhook-timestamp': ts, 'webhook-signature': `v1,${signature}` } });
	expect(res.status).toBe(200);
	expect(app.sqlite.query('SELECT visitor_id, first_touch_source FROM payments').get()).toEqual({ visitor_id: 'v1', first_touch_source: 'google.com' });
});

const trackedEvent = (changes: Partial<EnrichedEvent> = {}): EnrichedEvent => ({
	sid: 's1', vid: 'v1', ses: 'a', t: 'pageview', n: '/', src: 'google.com', cat: 'Organic Search', ref: '', sd: 0, dur: 0,
	country: 'US', city: 'Austin', colo: 'DFW', asOrganization: '', deviceType: 'desktop', os: 'macOS', browser: 'Chrome', createdAt: NOW - 100, ...changes,
});
const addPayment = (db: Database, id: string, amount: number, at = NOW - 50, visitor: string | null = 'v1', first = 'google.com', last = first) => db.run(
	"INSERT INTO payments (payment_id, site_id, gateway, visitor_id, gross_amount_cents, fee_amount_cents, net_amount_cents, status, first_touch_source, last_touch_source, created_at) VALUES (?, 's1', 'stripe', ?, ?, 0, ?, 'succeeded', ?, ?, ?)",
	[id, visitor, amount, amount, first, last, at],
);

test('channel counts stay distinct across batches, pages and hours, with exclusive boundaries', async () => {
	const { d1, sqlite } = makeApp();
	const window = dateRangeToTimestamps('7d', NOW);
	for (const [index, body] of [
		trackedEvent({ createdAt: NOW - 86400 }),
		trackedEvent({ t: 'leave', dur: 5, sd: 100, createdAt: NOW - 86390 }),
		trackedEvent({ n: '/pricing', ses: 'b' }),
		trackedEvent({ n: '/pricing', ses: 'b', t: 'leave', dur: 7, sd: 100 }),
		trackedEvent({ vid: 'too_early', createdAt: window.start - 1 }),
		trackedEvent({ vid: 'too_late', createdAt: window.end }),
		trackedEvent({ vid: 'bot', t: 'ai_crawl' }),
	].entries()) await ingestEvents(d1, [{ id: String(index), body }]);
	// D1 no longer writes or reads additive unique-visitor rollups.
	expect(sqlite.query('SELECT COUNT(*) n FROM hourly_rollups').get()).toEqual({ n: 0 });
	const stats = await new D1StorageAdapter(d1).queryChannelStats('s1', window.start, window.end, 'first');
	expect(stats).toHaveLength(1);
	expect(stats[0]).toMatchObject({ visitors: 1, sessions: 2, pageviews: 2, avgReadSec: 6, avgScrollPct: 100 });
	const dash = await queryDashboard(d1, 's1', { range: '7d', model: 'first', mode: 'net', filters: [], now: NOW });
	expect(dash.totals.visitors).toBe(1);
	expect(dash.sources[0]?.visitors).toBe(1);
});

test('event categories preserve paid/email traffic and category revenue matches purchase-time touches', async () => {
	const { d1, sqlite } = makeApp();
	await ingestEvents(d1, [
		{ id: 'paid', body: trackedEvent({ um: 'cpc', uc: 'ads', meta: '{"sku":1}' }) },
		{ id: 'organic', body: trackedEvent({ vid: 'v2' }) },
		{ id: 'email', body: trackedEvent({ vid: 'v3', src: 'newsletter', cat: 'Referral', um: 'email', uc: 'weekly' }) },
	]);
	await ingestEvents(d1, [{ id: 'organic_before_payment', body: trackedEvent({ ses: 'organic_return', createdAt: NOW - 75 }) }]);
	addPayment(sqlite, 'paid', 1000);
	addPayment(sqlite, 'organic', 2000, NOW - 50, 'v2');
	addPayment(sqlite, 'email', 3000, NOW - 50, 'v3', 'newsletter');
	await ingestEvents(d1, [{ id: 'return', body: trackedEvent({ ses: 'return', createdAt: NOW - 10 }) }]);
	const data = await queryDashboard(d1, 's1', { range: '7d', model: 'first', mode: 'net', filters: [], now: NOW });
	expect(data.sources.find((row) => row.key === 'google.com')).toMatchObject({ visitors: 2, cat: 'Mixed', revenue: 3000 });
	expect(data.groups.find((row) => row.key === 'Paid Search')).toMatchObject({ visitors: 1, revenue: 1000 });
	expect(data.groups.find((row) => row.key === 'Organic Search')).toMatchObject({ visitors: 2, revenue: 2000 });
	expect(data.groups.find((row) => row.key === 'Email')).toMatchObject({ visitors: 1, revenue: 3000 });
	expect(data.groups.reduce((sum, row) => sum + row.revenue, 0)).toBe(data.totals.revenue);
	const meta = JSON.parse((sqlite.query("SELECT meta_json FROM events WHERE visitor_id = 'v1' ORDER BY id LIMIT 1").get() as any).meta_json);
	expect(meta._grosslytics).toMatchObject({ category: 'Paid Search', utm_medium: 'cpc', utm_campaign: 'ads' });
	expect(meta.custom).toBe('{"sku":1}');
	const last = await queryDashboard(d1, 's1', { range: '7d', model: 'last', mode: 'net', filters: [], now: NOW });
	expect(last.groups.find((row) => row.key === 'Organic Search')?.revenue).toBe(3000);
	const linear = await queryDashboard(d1, 's1', { range: '7d', model: 'linear', mode: 'net', filters: [], now: NOW });
	expect(linear.groups.find((row) => row.key === 'Paid Search')?.revenue).toBe(500);
	expect(linear.groups.find((row) => row.key === 'Organic Search')?.revenue).toBe(2500);
});

test('current/previous profit series, source rows and channel API reconcile including zero-profit and spend-only days', async () => {
	const { d1, sqlite } = makeApp();
	addPayment(sqlite, 'break_even', 10000);
	sqlite.exec("INSERT INTO ad_spend VALUES ('s1', 'google.com', '2026-03-31', 10000), ('s1', 'google.com', '2026-03-30', 600), ('s1', 'google.com', '2026-03-20', 2400)");
	const query = (mode: 'gross' | 'net' | 'profit', model: 'first' | 'last' | 'linear') => queryDashboard(d1, 's1', { range: '7d', model, mode, filters: [], now: NOW });
	const zero = await query('profit', 'first');
	expect(zero.series.revenue.at(-1)).toBe(0);
	expect(zero.totals.revenue).toBe(-600);
	expect(zero.prev.revenue).toBe(-2400);
	addPayment(sqlite, 'odd_cent', 1, NOW - 40, 'v1', 'google.com', 'x.com');
	for (const mode of ['gross', 'net', 'profit'] as const) for (const model of ['first', 'last', 'linear'] as const) {
		const data = await query(mode, model);
		expect(data.series.revenue.reduce((sum, value) => sum + value, 0)).toBe(data.totals.revenue);
		expect(data.series.prevRevenue.reduce((sum, value) => sum + value, 0)).toBe(data.prev.revenue);
		expect(data.sources.reduce((sum, row) => sum + row.revenue, 0)).toBe(data.totals.revenue);
		expect(data.groups.reduce((sum, row) => sum + row.revenue, 0)).toBe(data.totals.revenue);
		const { start, end } = dateRangeToTimestamps('7d', NOW);
		const channels = await new D1StorageAdapter(d1).queryChannelStats('s1', start, end, model);
		expect(channels.reduce((sum, row) => sum + row.grossRevenueCents, 0)).toBe(data.totals.gross);
		expect(channels.reduce((sum, row) => sum + row.trueProfitCents, 0)).toBe(-599);
	}
});

test('daily spend is clipped to the 24-hour window and never includes the exclusive end date', async () => {
	const { d1, sqlite } = makeApp();
	sqlite.exec("INSERT INTO ad_spend VALUES ('s1', 'google.com', '2026-03-30', 2400), ('s1', 'google.com', '2026-03-31', 4800), ('s1', 'google.com', '2026-04-01', 999999)");
	const data = await queryDashboard(d1, 's1', { range: '24h', model: 'first', mode: 'profit', filters: [], now: NOW });
	// 13:00 Mar 30 to 13:00 Mar 31 UTC: 11 previous-day hours and 13 current-day hours.
	expect(data.totals.ad).toBe(1100 + 2600);
	expect(data.series.revenue.slice(0, 11)).toEqual(Array(11).fill(-100));
	expect(data.series.revenue.slice(11)).toEqual(Array(13).fill(-200));
	const { start, end } = dateRangeToTimestamps('24h', NOW);
	const channels = await new D1StorageAdapter(d1).queryChannelStats('s1', start, end, 'first');
	expect(channels[0]?.adSpendCents).toBe(data.totals.ad);
	for (const range of ['7d', '30d', '90d'] as const) {
		const daily = await queryDashboard(d1, 's1', { range, model: 'first', mode: 'profit', filters: [], now: NOW });
		expect(daily.totals.ad).toBe(7200);
		expect(daily.series.revenue.reduce((sum, value) => sum + value, 0)).toBe(-7200);
	}
	sqlite.exec("UPDATE ad_spend SET amount_cents = 5 WHERE spend_date = '2026-03-31'");
	const cents = await queryDashboard(d1, 's1', { range: '24h', model: 'first', mode: 'profit', filters: [], now: NOW });
	expect(cents.totals.ad).toBe(1103);
});

test('entry revenue counts a visitor once, includes untracked buyers, and filtered spend is explicit', async () => {
	const { d1, sqlite } = makeApp();
	await ingestEvents(d1, [
		{ id: 'landing', body: trackedEvent({ createdAt: NOW - 1000 }) },
		{ id: 'return', body: trackedEvent({ ses: 'b', createdAt: NOW - 900 }) },
		{ id: 'pricing', body: trackedEvent({ ses: 'c', n: '/pricing' }) },
	]);
	addPayment(sqlite, 'tracked', 10000);
	addPayment(sqlite, 'untracked', 2000, NOW - 50, null);
	const q = { range: '7d', model: 'first', mode: 'net', filters: [], now: NOW } as const;
	const data = await queryDashboard(d1, 's1', { ...q, filters: [] });
	expect(data.entry.find((row) => row.key === '/')).toMatchObject({ visitors: 1, revenue: 10000, sales: 1 });
	expect(data.entry.find((row) => row.key === '(not tracked)')).toMatchObject({ visitors: 0, revenue: 2000 });
	expect(data.entry.reduce((sum, row) => sum + row.revenue, 0)).toBe(data.totals.revenue);
	expect(data.countries.reduce((sum, row) => sum + row.revenue, 0)).toBe(data.totals.revenue);
	expect(data.campaigns.reduce((sum, row) => sum + row.revenue, 0)).toBe(data.totals.revenue);
	expect(data.pages.reduce((sum, row) => sum + row.revenue, 0)).toBe(20000); // deliberately overlapping page influence
	sqlite.exec("INSERT INTO ad_spend VALUES ('s1', 'google.com', '2026-03-31', 500)");
	const filtered = await queryDashboard(d1, 's1', { ...q, mode: 'profit', filters: [{ dim: 'country', value: 'US' }] });
	expect(filtered.adSpendAvailable).toBe(false);
	expect(filtered.totals.ad).toBe(0);
	expect(filtered.totals.revenue).toBe(10000);
});

test('collect: drops bots, rejects unknown sites and foreign origins, queues real visits', async () => {
	const { d1, sqlite } = fakeD1();
	sqlite.exec("INSERT INTO sites (site_id, domain, name) VALUES ('c1', 'acme.io', 'Acme')");
	const app = new Hono<any>().route('/api/event', collectRoute);
	const sent: any[] = [];
	const env = { DB: d1, INGEST_QUEUE: { send: async (m: any) => void sent.push(m) } };
	const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
	const post = async (sid: string, headers: Record<string, string>, cf: object = {}) => {
		const waits: Promise<unknown>[] = [];
		const req = new Request('http://x/api/event', { method: 'POST', headers, body: JSON.stringify({ sid, vid: 'v1', ses: 's1', t: 'pageview', n: '/', src: '', cat: '', ref: '', sd: 0, dur: 0 }) });
		Object.defineProperty(req, 'cf', { value: cf });
		const res = await app.fetch(req, env, { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {} } as any);
		await Promise.all(waits);
		return res.status;
	};
	expect(await post('c1', { 'user-agent': chrome, origin: 'https://www.acme.io' })).toBe(202);
	expect(await post('c1', { 'user-agent': chrome, origin: 'http://localhost:3000' })).toBe(202);
	expect(sent.length).toBe(2);
	expect(await post('c1', { 'user-agent': chrome, origin: 'https://evil.com' })).toBe(403);
	expect(await post('nope', { 'user-agent': chrome })).toBe(404);
	expect(await post('c1', { 'user-agent': 'HeadlessChrome/130' })).toBe(202);
	expect(await post('c1', {})).toBe(202);
	expect(await post('c1', { 'user-agent': chrome }, { asn: 16509 })).toBe(202);
	expect(await post('c1', { 'user-agent': chrome }, { verifiedBotCategory: 'Search Engine Crawler' })).toBe(202);
	expect(sent.length).toBe(2); // none of the bots were queued
	expect(originAllowed('https://notacme.io', 'acme.io')).toBe(false);
});

test('timezones: days, heatmap hours, ad-spend days and channel ranges follow the site zone', async () => {
	expect(tzOffsetSec('Asia/Kolkata', NOW)).toBe(19800);
	expect(tzOffsetSec('Not/AZone', NOW)).toBe(0);
	const app = makeApp();
	expect((await app.fetch('/api/stats/sites/s1/timezone', { method: 'POST', headers: { Authorization: 'Bearer tok' }, body: '{"timezone":"Mars/Base"}' })).status).toBe(400);
	expect((await app.fetch('/api/stats/sites/s1/timezone', { method: 'POST', headers: { Authorization: 'Bearer tok' }, body: '{"timezone":"Asia/Kolkata"}' })).status).toBe(200);
	const made = await (await app.fetch('/api/stats/sites', { method: 'POST', headers: { Authorization: 'Bearer tok' }, body: '{"domain":"b.io","timezone":"Mars/Base"}' })).json();
	expect(app.sqlite.query('SELECT timezone FROM sites WHERE site_id = ?').get(made.id)).toEqual({ timezone: 'UTC' });

	// 01:30 in India is 20:00 UTC the previous day: the sale belongs to today's local bar and the 1am heatmap row.
	const localMidnight = Math.floor((NOW + 19800) / 86400) * 86400 - 19800;
	const at = localMidnight + 3600 + 1800; // 01:30 local today
	app.sqlite.exec(`INSERT INTO payments (payment_id, site_id, gateway, gross_amount_cents, fee_amount_cents, net_amount_cents, status, first_touch_source, last_touch_source, created_at) VALUES ('tz1', 's1', 'stripe', 1000, 0, 1000, 'succeeded', 'x', 'x', ${at})`);
	app.sqlite.exec("INSERT INTO ad_spend VALUES ('s1', 'google.com', '2026-01-01', 0)"); // outside every range
	const data = await queryDashboard(app.d1, 's1', { range: '7d', model: 'first', mode: 'gross', filters: [], now: NOW });
	expect(data.timezone).toBe('Asia/Kolkata');
	expect(data.series.start + 6 * 86400).toBe(localMidnight);
	expect(data.series.revenue[6]).toBe(1000);
	const local = new Date((at + 19800) * 1000);
	expect(data.heat[(local.getUTCDay() + 6) % 7]![1]).toBe(1);
	const range = await siteRange(app.d1, 's1', '7d', NOW);
	expect(range.start).toBe(data.series.start);
});

test('api tokens: master creates read-only site tokens, stored hashed, scoped, revocable', async () => {
	const app = makeApp();
	app.sqlite.exec("INSERT INTO sites (site_id, domain, name) VALUES ('s2', 'other.io', 'Other')");
	const as = (token: string, url: string, init: RequestInit = {}) => app.fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });

	const created = await as('tok', '/api/stats/tokens', { method: 'POST', body: JSON.stringify({ siteId: 's1', name: 'Claude' }) });
	expect(created.status).toBe(201);
	const { id, token } = (await created.json()) as { id: string; token: string };
	expect(token).toMatch(/^gl_pat_[0-9a-f]{40}$/);
	const row = app.sqlite.query('SELECT token_hash, suffix FROM api_tokens WHERE id = ?').get(id) as { token_hash: string; suffix: string };
	expect(row.token_hash).not.toContain(token.slice(7, 20));
	expect(row.suffix).toBe(token.slice(-4));
	expect((await as('tok', '/api/stats/tokens', { method: 'POST', body: JSON.stringify({ siteId: 'nope', name: 'x' }) })).status).toBe(404);

	// Reads its own site, nothing else
	expect((await as(token, '/api/stats/dashboard?siteId=s1')).status).toBe(200);
	expect((await as(token, '/api/stats/dashboard?siteId=s2')).status).toBe(403);
	expect((await as(token, '/api/stats/sites')).status).toBe(403);
	expect((await as(token, '/api/stats/tokens?siteId=s1')).status).toBe(403);
	expect((await as(token, '/api/stats/tokens', { method: 'POST', body: JSON.stringify({ siteId: 's1', name: 'y' }) })).status).toBe(403);
	expect((await as(token, '/api/stats/ad-spend', { method: 'POST', body: '{}' })).status).toBe(403);
	expect((await as(token, '/api/mcp?site=s2', { method: 'POST', body: '{}' })).status).toBe(403);
	const mcp = await as(token, '/api/mcp?site=s1', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
	expect(mcp.status).toBe(200);
	expect((app.sqlite.query('SELECT last_used_at FROM api_tokens WHERE id = ?').get(id) as any).last_used_at).toBeGreaterThan(0);

	const listed = (await (await as('tok', '/api/stats/tokens?siteId=s1')).json()) as { tokens: any[] };
	expect(listed.tokens.map((t) => [t.name, t.suffix])).toEqual([['Claude', token.slice(-4)]]);
	expect(JSON.stringify(listed)).not.toContain(token);

	expect((await as('tok', `/api/stats/tokens/${id}/revoke`, { method: 'POST' })).status).toBe(200);
	expect((await as(token, '/api/stats/dashboard?siteId=s1')).status).toBe(401);
	expect((await as('gl_pat_' + '0'.repeat(40), '/api/stats/dashboard?siteId=s1')).status).toBe(401);
});

test('owner login: API_TOKEN sets the password, session cookie unlocks the API, lockout, reset and logout', async () => {
	const app = makeApp();
	const json = { 'content-type': 'application/json' };
	const post = (url: string, body: object, headers: Record<string, string> = {}) => app.fetch(url, { method: 'POST', headers: { ...json, ...headers }, body: JSON.stringify(body) });
	const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0]!;
	const status = async (cookie = '') => (await app.fetch('/api/auth/status', { headers: { cookie } })).json();

	expect(await status()).toEqual({ passwordSet: false, signedIn: false });
	expect((await post('/api/auth/login', { password: 'whatever123' })).status).toBe(409);
	expect((await post('/api/auth/setup', { setupKey: 'wrong', password: 'correct horse' })).status).toBe(401);
	expect((await post('/api/auth/setup', { setupKey: 'tok', password: 'short' })).status).toBe(400);
	const setup = await post('/api/auth/setup', { setupKey: 'tok', password: 'correct horse' });
	expect(setup.status).toBe(200);
	expect(setup.headers.get('set-cookie')).toMatch(/gl_session=[0-9a-f]{64}; Max-Age=2592000; Path=\/api; HttpOnly; SameSite=Strict/);
	const s1 = cookieOf(setup);
	expect((app.sqlite.query('SELECT password_hash FROM owner_auth').get() as any).password_hash).toMatch(/^pbkdf2\$100000\$/);
	expect(JSON.stringify(app.sqlite.query('SELECT * FROM sessions').all())).not.toContain(s1.split('=')[1]);
	expect(await status(s1)).toEqual({ passwordSet: true, signedIn: true });

	// The cookie works like API_TOKEN, but writes need a JSON content type (CSRF)
	expect((await app.fetch('/api/stats/sites', { headers: { cookie: s1 } })).status).toBe(200);
	expect((await app.fetch('/api/stats/sites')).status).toBe(401);
	expect((await app.fetch('/api/stats/sites/s1/share', { method: 'POST', headers: { cookie: s1, 'content-type': 'text/plain' }, body: '{"enabled":true}' })).status).toBe(401);
	expect((await post('/api/stats/sites/s1/share', { enabled: true }, { cookie: s1 })).status).toBe(200);

	// Login, then five wrong passwords lock it even for the right one
	const login = await post('/api/auth/login', { password: 'correct horse' });
	expect(login.status).toBe(200);
	const s2 = cookieOf(login);
	for (let i = 0; i < 5; i++) expect((await post('/api/auth/login', { password: 'nope' })).status).toBe(401);
	expect((await post('/api/auth/login', { password: 'correct horse' })).status).toBe(429);

	// Reset with API_TOKEN: unlocks, and signs every old session out
	const reset = await post('/api/auth/setup', { setupKey: 'tok', password: 'new password!' });
	expect(reset.status).toBe(200);
	expect((await app.fetch('/api/stats/sites', { headers: { cookie: s1 } })).status).toBe(401);
	expect((await app.fetch('/api/stats/sites', { headers: { cookie: s2 } })).status).toBe(401);
	const s3 = cookieOf(reset);
	expect((await post('/api/auth/logout', {}, { cookie: s3 })).status).toBe(200);
	expect((await app.fetch('/api/stats/sites', { headers: { cookie: s3 } })).status).toBe(401);
});

test('cloud: signup, per-account sites, own webhook secrets, trial and cap stop ingest, Stripe billing turns accounts on and off', async () => {
	const sent: unknown[] = [];
	const app = makeApp({ CLOUD: '1', STRIPE_BILLING_WEBHOOK_SECRET: SECRET, INGEST_QUEUE: { send: async (m: unknown) => void sent.push(m) } });
	const json = { 'content-type': 'application/json' };
	const post = (url: string, body: object, cookie = '') => app.fetch(url, { method: 'POST', headers: { ...json, cookie }, body: JSON.stringify(body) });
	const get = (url: string, cookie = '') => app.fetch(url, { headers: { cookie } });
	const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0]!;
	const status = async (cookie = '') => (await (await get('/api/auth/status', cookie)).json()) as any;

	expect(await status()).toEqual({ cloud: true, signedIn: false, account: null });
	expect((await post('/api/auth/setup', { setupKey: 'tok', password: 'correct horse' })).status).toBe(404);
	expect((await post('/api/auth/signup', { email: 'nope', password: 'correct horse' })).status).toBe(400);
	const a = cookieOf(await post('/api/auth/signup', { email: 'A@x.io ', password: 'correct horse' }));
	expect((await post('/api/auth/signup', { email: 'a@x.io', password: 'another one!' })).status).toBe(409);
	const b = cookieOf(await post('/api/auth/signup', { email: 'b@y.io', password: 'correct horse' }));
	const sa = await status(a);
	expect(sa.account).toMatchObject({ email: 'a@x.io', status: 'trial', active: true, used: 0, cap: CLOUD_EVENT_CAP });

	const siteA = ((await (await post('/api/stats/sites', { domain: 'a.io' }, a)).json()) as any).id;
	const siteB = ((await (await post('/api/stats/sites', { domain: 'b.io' }, b)).json()) as any).id;
	const ids = async (cookie: string) => ((await (await get('/api/stats/sites', cookie)).json()) as any).sites.map((x: any) => x.id);
	expect(await ids(a)).toEqual([siteA]);
	expect((await app.fetch('/api/stats/sites', { headers: { authorization: 'Bearer tok' } }).then((r) => r.json()) as any).sites.length).toBe(3);

	// Another account's site is off limits, whichever way it is named
	expect((await get(`/api/stats/dashboard?siteId=${siteA}`, a)).status).toBe(200);
	expect((await get(`/api/stats/dashboard?siteId=${siteB}`, a)).status).toBe(403);
	expect((await get('/api/stats/dashboard?siteId=s1', a)).status).toBe(403);
	expect((await post(`/api/stats/sites/${siteB}/share`, { enabled: true }, a)).status).toBe(403);
	expect((await post('/api/stats/ad-spend', { siteId: siteB, source: 'x', date: '2026-11-01', amountCents: 1 }, a)).status).toBe(403);
	expect((await post('/api/stats/annotations', { at: 1, label: 'x' }, a)).status).toBe(403);
	expect((await post('/api/stats/tokens', { siteId: siteB, name: 'x' }, a)).status).toBe(403);
	const tok = (await (await post('/api/stats/tokens', { siteId: siteA, name: 'mine' }, a)).json()) as any;
	expect((await post(`/api/stats/tokens/${tok.id}/revoke`, {}, b)).status).toBe(403);
	expect((await get(`/api/stats/live?siteId=${siteB}`, a)).status).toBe(403);

	// Payment webhooks use the site's own secret; the operator's env secret is never a fallback on Cloud
	expect((await post(`/api/stats/sites/${siteA}/secrets`, { gateway: 'stripe', secret: SECRET }, a)).status).toBe(200);
	expect((await post(`/api/stats/sites/${siteA}/secrets`, { gateway: 'nope', secret: SECRET }, a)).status).toBe(400);
	expect(((await (await get('/api/stats/sites', a)).json()) as any).sites[0].payments).toEqual(['stripe']);
	const ping = JSON.stringify({ id: 'evt_p', type: 'ping', data: { object: {} } });
	const hook = async (site: string) => (await app.fetch(`/api/webhooks/stripe?siteId=${site}`, { method: 'POST', headers: await stripeHeaders(ping), body: ping })).status;
	expect(await hook(siteA)).toBe(200);
	expect(await hook(siteB)).toBe(401);

	// Login
	expect((await post('/api/auth/login', { email: 'a@x.io', password: 'wrong password' })).status).toBe(401);
	expect((await post('/api/auth/login', { email: 'a@x.io', password: 'correct horse' })).status).toBe(200);

	// Ingest: on while the trial runs; an ended trial or a full month answers 202 but records nothing
	const visit = (sid: string, domain: string) =>
		app.fetch('/api/event', { method: 'POST', headers: { origin: `https://${domain}`, 'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130.0 Safari/537.36' }, body: JSON.stringify({ sid, vid: 'v1', ses: 's1', t: 'pageview', n: '/', src: '', cat: '', ref: '', sd: 0, dur: 0 }) });
	expect((await visit(siteA, 'a.io')).status).toBe(202);
	expect(sent.length).toBe(1);
	app.sqlite.query("UPDATE accounts SET trial_ends_at = 1 WHERE email = 'b@y.io'").run();
	expect((await visit(siteB, 'b.io')).status).toBe(202);
	const siteC = ((await (await post('/api/stats/sites', { domain: 'c.io' }, a)).json()) as any).id;
	app.sqlite.query('INSERT INTO account_usage (account_id, month, events) VALUES (?, ?, ?)').run(sa.account.id, usageMonth(), CLOUD_EVENT_CAP);
	expect((await visit(siteC, 'c.io')).status).toBe(202);
	expect(sent.length).toBe(1);
	await countUsage(app.d1 as any, new Map([[siteA, 3], ['s1', 5]]));
	expect((await status(a)).account.used).toBe(CLOUD_EVENT_CAP + 3);
	expect((await post('/api/stats/sites', { domain: 'd.io' }, b)).status).toBe(402);

	// Billing: the Payment Link carries the account id; subscription events follow it
	const bill = async (event: object, signed = true) => {
		const body = JSON.stringify(event);
		return app.fetch('/api/billing/stripe', { method: 'POST', headers: signed ? await stripeHeaders(body) : {}, body });
	};
	const bId = (await status(b)).account.id;
	expect((await bill({ type: 'checkout.session.completed', data: { object: { client_reference_id: bId, subscription: 'sub_1', customer: 'cus_1' } } }, false)).status).toBe(401);
	await bill({ type: 'checkout.session.completed', data: { object: { client_reference_id: bId, subscription: 'sub_1', customer: 'cus_1' } } });
	expect((await status(b)).account).toMatchObject({ status: 'active', active: true });
	await bill({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'past_due', items: { data: [{ current_period_end: 1900000000 }] } } } });
	expect((await status(b)).account).toMatchObject({ status: 'past_due', active: true, periodEnd: 1900000000 });
	await bill({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', status: 'canceled' } } });
	expect((await status(b)).account).toMatchObject({ status: 'canceled', active: false });
});

test('lifetime: a paid one-time checkout mints a license, the buyer claims it, and only valid keys download the release', async () => {
	const releases: Record<string, string> = {};
	const app = makeApp({ STRIPE_BILLING_WEBHOOK_SECRET: SECRET, LICENSE_SECRET: 'lic-secret', LIFETIME_PAYMENT_LINK_ID: 'plink_life', RELEASES: { get: async (k: string) => (k in releases ? { body: releases[k] } : null) } });
	const bill = async (object: object) => {
		const body = JSON.stringify({ type: 'checkout.session.completed', data: { object } });
		return (await app.fetch('/api/billing/stripe', { method: 'POST', headers: await stripeHeaders(body), body })).json() as Promise<any>;
	};
	const session = { id: 'cs_test_abcdefghij123', mode: 'payment', payment_status: 'paid', payment_link: 'plink_life', customer_details: { email: 'buyer@x.io' } };
	const claim = (id: string) => app.fetch(`/api/license/claim?session_id=${id}`);

	expect((await claim(session.id)).status).toBe(404); // webhook not here yet: the page keeps polling
	expect(await bill({ ...session, payment_status: 'unpaid' })).toMatchObject({ ignored: true });
	expect(await bill({ ...session, payment_link: 'plink_other' })).toMatchObject({ ignored: true });
	expect(await bill(session)).toMatchObject({ license: true });
	expect(await bill(session)).toMatchObject({ license: true }); // Stripe retry: still one license
	expect((app.sqlite.query('SELECT COUNT(*) AS n FROM licenses').get() as any).n).toBe(1);
	expect((await claim('bad')).status).toBe(400);

	const { key, email } = (await (await claim(session.id)).json()) as any;
	expect(key).toMatch(/^gl_lic_[0-9a-f]{32}$/);
	expect(email).toBe('buyer@x.io');
	expect(JSON.stringify(app.sqlite.query('SELECT * FROM licenses').all())).not.toContain(key);

	const dl = (k: string) => app.fetch('/api/license/download', { headers: { authorization: `Bearer ${k}` } });
	expect((await dl(key)).status).toBe(503); // nothing published yet
	releases['latest.tgz'] = 'TGZ';
	const ok = await dl(key);
	expect(ok.status).toBe(200);
	expect(await ok.text()).toBe('TGZ');
	expect((await dl('gl_lic_' + '0'.repeat(32))).status).toBe(401);
	expect((await dl('nope')).status).toBe(401);

	// The installer's password hash is accepted by /app's login, and its config targets the buyer's hostname
	expect(await verifyPassword('correct horse', cliHashPassword('correct horse'))).toBe(true);
	expect(await verifyPassword('wrong', cliHashPassword('correct horse'))).toBe(false);
	expect(apiToml({ host: 'analytics.acme.io', zone: 'acme.io' }, 'db-1')).toContain('pattern = "analytics.acme.io/api/*", zone_name = "acme.io"');
	expect([isHost('analytics.acme.io'), isHost('acme'), isHost('a.b/c')]).toEqual([true, false, false]);
});

test('installer: self-hosted copies are noindex, grosslytics.com is not', async () => {
	const { mkdtempSync, readFileSync, existsSync } = await import('node:fs');
	const { tmpdir } = await import('node:os');
	const self = mkdtempSync(`${tmpdir()}/gl-noindex-`);
	noindex('analytics.example.com', self);
	expect(readFileSync(`${self}/_headers`, 'utf8')).toContain('X-Robots-Tag: noindex');
	expect(readFileSync(`${self}/robots.txt`, 'utf8')).not.toContain('Sitemap');
	const ours = mkdtempSync(`${tmpdir()}/gl-noindex-`);
	noindex('grosslytics.com', ours);
	expect(existsSync(`${ours}/_headers`)).toBe(false);
});
