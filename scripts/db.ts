/**
 * Database setup.
 *   bun scripts/db.ts migrate          create or update tables in the local D1 (.wrangler/state)
 *   bun scripts/db.ts seed             replace local site `gl_local_acme` (acme.io) with 180 days of sample data
 *   bun scripts/db.ts migrate-remote   create or update tables in your Cloudflare D1 (needs `wrangler login`)
 * Only migrate-remote touches Cloudflare, and migrations only ever CREATE ... IF NOT EXISTS.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ALL_MIGRATIONS } from '../packages/db-d1/src/migrations.ts';
import { classifySourceCategory } from '../packages/shared/src/attribution.ts';
import { calculateNetRevenue } from '../packages/shared/src/fees.ts';
import type { PaymentGateway } from '../packages/shared/src/types.ts';

const SITE = 'gl_local_acme';
const DOMAIN = 'acme.io';
const DAYS = 180;

function d1(file: string, where: '--local' | '--remote' = '--local') {
	execFileSync('bunx', ['wrangler', 'd1', 'execute', 'grosslytics-db', where, `--file=${file}`], { stdio: 'inherit' });
}

function write(name: string, sql: string) {
	mkdirSync('.wrangler', { recursive: true });
	const file = `.wrangler/${name}`;
	writeFileSync(file, sql);
	return file;
}

// D1 manages journal mode itself and rejects these pragmas
const migrations = () => (ALL_MIGRATIONS).replace(/^PRAGMA .*$/gm, '');

// Deterministic randomness, so every seed produces the same dataset shape
let state = 42;
const rand = () => {
	state = (state + 0x6d2b79f5) | 0;
	let t = Math.imul(state ^ (state >>> 15), 1 | state);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T extends { w: number }>(list: T[]): T => {
	let x = rand() * list.reduce((a, b) => a + b.w, 0);
	for (const item of list) if ((x -= item.w) <= 0) return item;
	return list[list.length - 1]!;
};
const between = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
const q = (v: unknown) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(Math.round(v * 10) / 10) : `'${String(v).replace(/'/g, "''")}'`);

// conv: chance a visitor buys; ad: daily spend in cents
const SOURCES = [
	{ src: 'google.com', w: 26, conv: 0.008, ad: 0 },
	{ src: 'x.com (in-app)', w: 18, conv: 0.02, ad: 4000, campaign: 'launch-week', utm: 'x' },
	{ src: 'chatgpt.com (AI)', w: 9, conv: 0.03, ad: 0 },
	{ src: 'linkedin.com (in-app)', w: 11, conv: 0.014, ad: 2500, campaign: 'linkedin-ads-q1', utm: 'linkedin' },
	{ src: 'Direct (Shared Link)', w: 10, conv: 0.012, ad: 0 },
	{ src: 'perplexity.ai (AI)', w: 7, conv: 0.026, ad: 0 },
	{ src: 'news.ycombinator.com', w: 7, conv: 0.013, ad: 0 },
	{ src: 'Direct (Typed/Bookmark)', w: 5, conv: 0.012, ad: 0 },
	{ src: 'instagram.com (in-app)', w: 4, conv: 0.006, ad: 0 },
	{ src: 'reddit.com', w: 3, conv: 0.008, ad: 0 },
	{ src: 'newsletter', w: 2, conv: 0.03, ad: 0, campaign: 'newsletter-14', utm: 'newsletter' },
];
const PLACES = [
	{ cc: 'US', city: 'San Francisco', w: 9 },
	{ cc: 'US', city: 'New York', w: 8 },
	{ cc: 'US', city: 'Austin', w: 5 },
	{ cc: 'IN', city: 'Bengaluru', w: 8 },
	{ cc: 'IN', city: 'Pune', w: 4 },
	{ cc: 'GB', city: 'London', w: 7 },
	{ cc: 'DE', city: 'Berlin', w: 6 },
	{ cc: 'CA', city: 'Toronto', w: 4 },
	{ cc: 'FR', city: 'Paris', w: 4 },
	{ cc: 'BR', city: 'São Paulo', w: 3 },
	{ cc: 'AU', city: 'Sydney', w: 3 },
	{ cc: 'NL', city: 'Amsterdam', w: 2 },
];
const DEVICES = [
	{ device: 'desktop', os: 'macOS', browser: 'Chrome', w: 22 },
	{ device: 'desktop', os: 'macOS', browser: 'Safari', w: 10 },
	{ device: 'desktop', os: 'Windows', browser: 'Chrome', w: 12 },
	{ device: 'desktop', os: 'Windows', browser: 'Edge', w: 4 },
	{ device: 'desktop', os: 'Linux', browser: 'Firefox', w: 4 },
	{ device: 'mobile', os: 'iOS', browser: 'Safari', w: 20 },
	{ device: 'mobile', os: 'Android', browser: 'Chrome', w: 16 },
	{ device: 'tablet', os: 'iOS', browser: 'Safari', w: 3 },
];
const PAGES = [
	{ p: '/', w: 30 },
	{ p: '/blog/how-we-hit-10k-mrr', w: 14 },
	{ p: '/docs', w: 9 },
	{ p: '/changelog', w: 5 },
	{ p: '/compare/datafast', w: 6 },
	{ p: '/blog/stripe-fees-explained', w: 5 },
	{ p: '/pricing', w: 12 },
];
const PLANS = [
	{ plan: 'Pro · monthly', gross: 4900, w: 6 },
	{ plan: 'Pro · yearly', gross: 49000, w: 2 },
	{ plan: 'Team · monthly', gross: 14900, w: 2 },
];
const GATEWAYS: Array<{ g: PaymentGateway; w: number }> = [
	{ g: 'stripe', w: 6 },
	{ g: 'paddle', w: 2 },
	{ g: 'razorpay', w: 1 },
	{ g: 'polar', w: 1 },
	{ g: 'lemonsqueezy', w: 1 },
];
const NAMES = ['maya', 'arjun', 'jonas', 'sofia', 'kenji', 'lea', 'omar', 'priya', 'tom', 'ines', 'noah', 'zara'];
const MAILS = ['gmail.com', 'hey.com', 'proton.me', 'outlook.com', 'fastmail.com', 'acme.dev'];

function seed(): string {
	const now = Math.floor(Date.now() / 1000);
	const dayStart = Math.floor(now / 86400) * 86400;
	const events: string[] = [];
	const visitors: string[] = [];
	const payments: string[] = [];
	const ads: string[] = [];
	const rollups = new Map<string, { k: string[]; v: Set<string>; s: Set<string>; pv: number; rd: number; sc: number }>();
	let vn = 0;
	let pn = 0;

	for (let day = DAYS - 1; day >= 0; day--) {
		const base = dayStart - day * 86400;
		const weekday = new Date(base * 1000).getUTCDay();
		const growth = 0.55 + 0.45 * ((DAYS - day) / DAYS); // the startup is growing
		const spike = day === 22 ? 3.2 : day === 21 ? 1.8 : 1; // Product Hunt launch
		const count = Math.round((weekday === 0 || weekday === 6 ? 95 : 150) * growth * spike * (0.85 + rand() * 0.3));

		for (const s of SOURCES) if (s.ad) ads.push(`(${q(SITE)}, ${q(s.src)}, ${q(new Date(base * 1000).toISOString().slice(0, 10))}, ${Math.round(s.ad * (0.8 + rand() * 0.4))})`);

		for (let i = 0; i < count; i++) {
			const vid = `v${(++vn).toString(36)}`;
			const first = pick(SOURCES);
			const place = pick(PLACES);
			const dev = pick(DEVICES);
			// Visitors arrive in daytime hours (UTC-ish blend of US/EU/IN)
			const hour = Math.min(23, Math.max(0, Math.round(14 + (rand() + rand() + rand() - 1.5) * 9)));
			let t = base + hour * 3600 + between(0, 3599);
			if (t > now - 60) t = now - between(60, 6 * 3600); // today's visitors are in the past
			const firstSeen = t;
			const buys = rand() < first.conv * (dev.device === 'mobile' ? 0.6 : 1.2);
			const sessions = buys ? between(2, 4) : rand() < 0.2 ? 2 : 1;
			let last = first;
			let readTotal = 0;
			let maxScroll = 0;

			for (let sn = 0; sn < sessions; sn++) {
				const src = sn === 0 ? first : rand() < 0.5 ? first : pick(SOURCES);
				last = src;
				const ses = `${vid}s${sn}`;
				const n = buys && sn === sessions - 1 ? between(2, 5) : between(1, 3);
				const path = [pick(PAGES).p];
				for (let k = 1; k < n; k++) path.push(pick(PAGES).p);
				if (buys && sn === sessions - 1 && !path.includes('/pricing')) path.push('/pricing');
				for (const p of path) {
					const read = buys ? between(40, 260) : between(5, 120);
					const scroll = buys ? between(55, 100) : between(10, 90);
					readTotal += read;
					maxScroll = Math.max(maxScroll, scroll);
					events.push(`(${q(SITE)}, ${q(vid)}, ${q(ses)}, 'pageview', ${q(p)}, ${q(src.src)}, 0, 0, ${t})`);
					t += read;
					events.push(`(${q(SITE)}, ${q(vid)}, ${q(ses)}, 'leave', ${q(p)}, ${q(src.src)}, ${scroll}, ${read}, ${t})`);
					t += between(2, 20);
					const hb = t - (t % 3600);
					const key = `${hb}|${src.src}|${path[0]}|${place.cc}`;
					const r = rollups.get(key) ?? { k: [String(hb), src.src, path[0]!, place.cc], v: new Set(), s: new Set(), pv: 0, rd: 0, sc: 0 };
					r.v.add(vid);
					r.s.add(ses);
					r.pv++;
					r.rd += read;
					r.sc += scroll;
					rollups.set(key, r);
				}
				if (buys && sn === sessions - 1) {
					events.push(`(${q(SITE)}, ${q(vid)}, ${q(ses)}, 'goal', 'checkout', ${q(src.src)}, 0, 0, ${t})`);
					t += between(30, 240);
					if (t >= now) t = now - 30;
					const plan = pick(PLANS);
					const gateway = pick(GATEWAYS).g;
					const { feeCents, netCents } = calculateNetRevenue(gateway, plan.gross);
					const name = NAMES[between(0, NAMES.length - 1)]!;
					const email = `${name[0]}***@${MAILS[between(0, MAILS.length - 1)]}`;
					const pay = (at: number, renewal: boolean) =>
						payments.push(
							`(${q(`pay_${(++pn).toString(36)}`)}, ${q(SITE)}, ${q(gateway)}, ${q(vid)}, ${q(`hash_${vid}`)}, ${q(email)}, ${q(plan.plan + (renewal ? ' · renewal' : ''))}, ${plan.gross}, ${feeCents}, ${netCents}, 'usd', 'succeeded', ${renewal ? 1 : 0}, ${q(first.src)}, ${q(src.src)}, ${q(place.cc)}, ${q(place.city)}, ${(at - firstSeen) / 3600}, ${readTotal}, ${maxScroll}, ${at})`,
						);
					pay(t, false);
					if (plan.plan.includes('monthly')) for (let m = 1; t + m * 30 * 86400 < now; m++) if (rand() < 0.85) pay(t + m * 30 * 86400, true);
				}
				t += between(1, 6) * 86400 * (rand() < 0.5 ? 0 : 1) + between(600, 7200); // next session: same day or days later
				if (t > now - 60) break;
			}
			visitors.push(
				`(${q(SITE)}, ${q(vid)}, ${buys ? q(`hash_${vid}`) : 'NULL'}, ${firstSeen}, ${q(first.src)}, ${q(classifySourceCategory(first.src))}, ${q(first.utm)}, NULL, ${q(first.campaign)}, ${q('/')}, ${Math.min(t, now)}, ${q(last.src)}, ${q(classifySourceCategory(last.src))}, ${q(last.utm)}, ${q(last.campaign)}, ${q(place.cc)}, ${q(place.city)}, ${q(dev.device)}, ${q(dev.os)}, ${q(dev.browser)}, ${sessions}, ${readTotal}, ${maxScroll})`,
			);
		}
	}

	const chunks = (table: string, cols: string, rows: string[]) => {
		const out: string[] = [];
		for (let i = 0; i < rows.length; i += 150) out.push(`INSERT INTO ${table} (${cols}) VALUES\n${rows.slice(i, i + 150).join(',\n')};`);
		return out.join('\n');
	};
	const rollupRows = [...rollups.values()].map((r) => `(${q(SITE)}, ${r.k[0]}, ${q(r.k[1])}, ${q(classifySourceCategory(r.k[1]!))}, ${q(r.k[2])}, ${q(r.k[3])}, ${r.v.size}, ${r.s.size}, ${r.pv}, ${r.rd}, ${r.sc})`);

	console.log(`Seeding ${DOMAIN}: ${visitors.length} visitors, ${events.length} events, ${payments.length} payments over ${DAYS} days`);
	return [
		...['events', 'visitors', 'payments', 'hourly_rollups', 'ad_spend', 'annotations', 'sites'].map((t) => `DELETE FROM ${t} WHERE site_id = ${q(SITE)};`),
		`INSERT INTO sites (site_id, domain, name, public_share_enabled) VALUES (${q(SITE)}, ${q(DOMAIN)}, 'Acme', 1);`,
		chunks('visitors', 'site_id, visitor_id, customer_email_hash, first_seen_at, first_source, first_category, first_utm_source, first_utm_medium, first_utm_campaign, first_landing_page, last_seen_at, last_source, last_category, last_utm_source, last_utm_campaign, country, city, device_type, os, browser, total_sessions, total_active_read_sec, max_scroll_pct', visitors),
		chunks('events', 'site_id, visitor_id, session_id, event_type, event_name, source, scroll_depth, duration_sec, created_at', events),
		chunks('payments', 'payment_id, site_id, gateway, visitor_id, customer_email_hash, customer_email_masked, plan_name, gross_amount_cents, fee_amount_cents, net_amount_cents, currency, status, is_renewal, first_touch_source, last_touch_source, country, city, time_to_convert_hours, buyer_read_sec, buyer_scroll_pct, created_at', payments),
		chunks('hourly_rollups', 'site_id, hour_bucket, source, category, landing_page, country, visitors_count, sessions_count, pageviews_count, active_read_sec_sum, scroll_pct_sum', rollupRows),
		chunks('ad_spend', 'site_id, source, spend_date, amount_cents', ads),
		`INSERT INTO annotations (site_id, at, label) VALUES (${q(SITE)}, ${dayStart - 22 * 86400 + 9 * 3600}, 'Launched on Product Hunt'), (${q(SITE)}, ${dayStart - 9 * 86400 + 15 * 3600}, 'New pricing page');`,
	].join('\n');
}

const cmd = process.argv[2];
if (cmd === 'migrate') d1(write('migrate.sql', migrations()));
else if (cmd === 'migrate-remote') d1(write('migrate.sql', migrations()), '--remote');
else if (cmd === 'seed') {
	d1(write('migrate.sql', migrations()));
	d1(write('seed.sql', seed()));
	console.log(`\nSeeded. Site id: ${SITE}  (public page: /share/${DOMAIN})`);
} else {
	console.log('Usage: bun scripts/db.ts migrate | seed | migrate-remote');
	process.exit(1);
}
