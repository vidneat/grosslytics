import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import { MIGRATION_001_INIT } from '@grosslytics/db-d1/migrations';
import { requireToken } from './auth.js';
import { mcpRoute } from './mcp.js';
import { statsRoute } from './routes/stats.js';
import { webhooksRoute } from './routes/webhooks.js';
import { verifyWebhook } from './verify.js';

// Minimal D1 shim over bun:sqlite — enough for drizzle's d1 driver
function fakeD1() {
	const db = new Database(':memory:');
	db.exec(MIGRATION_001_INIT);
	const stmt = (sql: string, params: any[] = []): any => ({
		bind: (...p: any[]) => stmt(sql, p),
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
	const env = { DB: d1, STRIPE_WEBHOOK_SECRET: SECRET, API_TOKEN: 'tok' };
	return { fetch: (url: string, init?: RequestInit) => app.fetch(new Request(`http://x${url}`, init), env), sqlite };
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
