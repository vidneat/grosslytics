/**
 * Deterministic sample data for the demo dashboard (fictional SaaS, 30-day baseline).
 * Every panel is derived from one `buildDemo(filters)` call, so numbers agree across panels.
 * No Math.random here: server and client render identical markup.
 */

import type { DashboardData, DashFilter, DashMode, DashModel, DashRange, DashRow, DashSale } from '@grosslytics/shared/dashboard';

export type Range = DashRange;
export type Model = DashModel;
export type Mode = DashMode;
export type Filter = DashFilter;
export type Dimension = DashFilter['dim'];
export type Metric = 'visitors' | 'revenue' | 'rpv' | 'conversion';
type Row = DashRow;

/** The demo's fixed "now": end of 2026-03-31 UTC, so server and client render the same labels. */
export const DEMO_NOW = Date.UTC(2026, 2, 31, 23, 30) / 1000;

const RANGE_SCALE: Record<Range, number> = { '24h': 1 / 30, '7d': 7 / 30, '30d': 1, '90d': 3 };
export const RANGE_POINTS: Record<Range, number> = { '24h': 24, '7d': 7, '30d': 30, '90d': 90 };
const FEE_RATE = 0.0296;

// lastTouch: share of revenue this source gets when credited by last touch instead of first.
const SOURCES = [
	{ key: 'x.com (in-app)', domain: 'x.com', cat: 'Social', visitors: 4820, gross: 4950_00, sales: 45, last: 0.7, ad: 1200_00 },
	{ key: 'google.com', domain: 'google.com', cat: 'Search', visitors: 6200, gross: 1980_00, sales: 18, last: 1.25, ad: 0 },
	{ key: 'chatgpt.com (AI)', domain: 'chatgpt.com', cat: 'AI search', visitors: 2450, gross: 3850_00, sales: 35, last: 1.35, ad: 0 },
	{ key: 'linkedin.com (in-app)', domain: 'linkedin.com', cat: 'Social', visitors: 3100, gross: 2200_00, sales: 20, last: 0.8, ad: 800_00 },
	{ key: 'Direct (Shared Link)', domain: '', cat: 'Direct', visitors: 2840, gross: 1650_00, sales: 15, last: 1.1, ad: 0 },
	{ key: 'perplexity.ai (AI)', domain: 'perplexity.ai', cat: 'AI search', visitors: 1890, gross: 2420_00, sales: 22, last: 1.2, ad: 0 },
	{ key: 'news.ycombinator.com', domain: 'news.ycombinator.com', cat: 'Referral', visitors: 2015, gross: 1487_00, sales: 13, last: 0.9, ad: 0 },
	{ key: 'instagram.com (in-app)', domain: 'instagram.com', cat: 'Social', visitors: 1250, gross: 640_00, sales: 6, last: 0.9, ad: 300_00 },
	{ key: 'Direct (Typed/Bookmark)', domain: '', cat: 'Direct', visitors: 1209, gross: 620_00, sales: 6, last: 1.6, ad: 0 },
	{ key: 'reddit.com', domain: 'reddit.com', cat: 'Social', visitors: 1008, gross: 372_00, sales: 4, last: 0.8, ad: 0 },
];

const CAMPAIGNS = [
	{ key: 'launch-week', note: 'utm_source=x', share: 0.31, rev: 0.36 },
	{ key: 'newsletter-14', note: 'utm_source=newsletter', share: 0.12, rev: 0.17 },
	{ key: 'ph-launch', note: 'utm_source=producthunt', share: 0.09, rev: 0.08 },
	{ key: 'linkedin-ads-q1', note: 'utm_source=linkedin', share: 0.07, rev: 0.05 },
];

const PAGES = [
	{ key: '/', share: 0.4, rev: 0.22, read: 38 },
	{ key: '/pricing', share: 0.17, rev: 0.41, read: 96 },
	{ key: '/blog/how-we-hit-10k-mrr', share: 0.12, rev: 0.11, read: 212 },
	{ key: '/docs', share: 0.09, rev: 0.07, read: 141 },
	{ key: '/compare/datafast', share: 0.06, rev: 0.12, read: 118 },
	{ key: '/changelog', share: 0.05, rev: 0.03, read: 54 },
	{ key: '/blog/stripe-fees-explained', share: 0.04, rev: 0.04, read: 187 },
];
const ENTRY = [
	{ key: '/', share: 0.46, rev: 0.31 },
	{ key: '/blog/how-we-hit-10k-mrr', share: 0.19, rev: 0.18 },
	{ key: '/pricing', share: 0.11, rev: 0.29 },
	{ key: '/compare/datafast', share: 0.08, rev: 0.14 },
	{ key: '/docs', share: 0.06, rev: 0.05 },
];
const EXIT = [
	{ key: '/', share: 0.33, rev: 0 },
	{ key: '/pricing', share: 0.22, rev: 0 },
	{ key: '/checkout/success', share: 0.08, rev: 0 },
	{ key: '/docs', share: 0.11, rev: 0 },
	{ key: '/blog/how-we-hit-10k-mrr', share: 0.1, rev: 0 },
];

const COUNTRIES = [
	{ key: 'US', label: 'United States', share: 0.38, rev: 0.47 },
	{ key: 'IN', label: 'India', share: 0.14, rev: 0.09 },
	{ key: 'GB', label: 'United Kingdom', share: 0.09, rev: 0.11 },
	{ key: 'DE', label: 'Germany', share: 0.08, rev: 0.09 },
	{ key: 'CA', label: 'Canada', share: 0.06, rev: 0.07 },
	{ key: 'FR', label: 'France', share: 0.05, rev: 0.04 },
	{ key: 'BR', label: 'Brazil', share: 0.05, rev: 0.02 },
	{ key: 'AU', label: 'Australia', share: 0.04, rev: 0.05 },
];
const CITIES = [
	{ key: 'San Francisco', flag: 'US', share: 0.08, rev: 0.13 },
	{ key: 'New York', flag: 'US', share: 0.07, rev: 0.09 },
	{ key: 'London', flag: 'GB', share: 0.06, rev: 0.08 },
	{ key: 'Bengaluru', flag: 'IN', share: 0.06, rev: 0.04 },
	{ key: 'Berlin', flag: 'DE', share: 0.04, rev: 0.05 },
	{ key: 'Toronto', flag: 'CA', share: 0.03, rev: 0.04 },
];

const DEVICES = [
	{ key: 'Desktop', share: 0.58, rev: 0.74 },
	{ key: 'Mobile', share: 0.38, rev: 0.23 },
	{ key: 'Tablet', share: 0.04, rev: 0.03 },
];
const BROWSERS = [
	{ key: 'Chrome', domain: 'google.com', share: 0.55, rev: 0.52 },
	{ key: 'Safari', domain: 'apple.com', share: 0.27, rev: 0.3 },
	{ key: 'Arc', domain: 'arc.net', share: 0.07, rev: 0.1 },
	{ key: 'Firefox', domain: 'mozilla.org', share: 0.06, rev: 0.05 },
	{ key: 'Edge', domain: 'microsoft.com', share: 0.05, rev: 0.03 },
];
const OSES = [
	{ key: 'macOS', domain: 'apple.com', share: 0.41, rev: 0.56 },
	{ key: 'iOS', domain: 'apple.com', share: 0.22, rev: 0.15 },
	{ key: 'Windows', domain: 'microsoft.com', share: 0.18, rev: 0.15 },
	{ key: 'Android', domain: 'android.com', share: 0.15, rev: 0.08 },
	{ key: 'Linux', domain: 'kernel.org', share: 0.04, rev: 0.06 },
];

export const flag = (cc: string) =>
	cc.toUpperCase().replace(/./g, (c) => String.fromCodePoint(0x1f1a5 + c.charCodeAt(0)));

/** Deterministic pseudo-random in [0,1) from an integer seed. */
const noise = (i: number) => {
	const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
	return x - Math.floor(x);
};

function wave(n: number, total: number, seed: number, lift = 0.5): number[] {
	const raw = Array.from({ length: n }, (_, i) => 1 + 0.3 * Math.sin((i + seed) * 0.9) + 0.35 * noise(i + seed * 101) + (i / n) * lift);
	const sum = raw.reduce((a, b) => a + b, 0);
	return raw.map((r) => (r / sum) * total);
}

export const ANNOTATIONS_30D = [
	{ at: 8, label: 'Launched on Product Hunt' },
	{ at: 20, label: 'New pricing page' },
];

export function buildDemo(range: Range, model: Model, mode: Mode, filters: Filter[]): DashboardData {
	const scale = RANGE_SCALE[range];
	const weight = (last: number) => (model === 'first' ? 1 : model === 'last' ? last : (1 + last) / 2);

	// Filters narrow everything to a share of traffic (demo approximation of a real query).
	let visitShare = 1;
	let revShare = 1;
	for (const f of filters) {
		const pick = (list: Array<{ key: string; share: number; rev: number }>) => list.find((r) => r.key === f.value);
		if (f.dim === 'source') {
			const s = SOURCES.find((x) => x.key === f.value);
			const totV = SOURCES.reduce((a, x) => a + x.visitors, 0);
			const totR = SOURCES.reduce((a, x) => a + x.gross, 0);
			if (s) {
				visitShare *= s.visitors / totV;
				revShare *= s.gross / totR;
			}
		} else {
			const r = pick(f.dim === 'page' ? PAGES : f.dim === 'country' ? COUNTRIES : DEVICES);
			if (r) {
				visitShare *= r.share;
				revShare *= r.rev || r.share;
			}
		}
	}
	const sourceFilter = filters.find((f) => f.dim === 'source')?.value;

	// Sources, with model re-weighting that keeps total money constant (only credit moves).
	const baseTotal = SOURCES.reduce((s, c) => s + c.gross, 0);
	const wTotal = SOURCES.reduce((s, c) => s + c.gross * weight(c.last), 0);
	const toMode = (gross: number, ad: number) => (mode === 'gross' ? gross : mode === 'net' ? gross * (1 - FEE_RATE) : gross * (1 - FEE_RATE) - ad);
	const otherShare = sourceFilter ? 1 : revShare;
	const otherVisits = sourceFilter ? 1 : visitShare;

	const sources = SOURCES.map((c) => {
		const gross = ((c.gross * weight(c.last)) / wTotal) * baseTotal * scale * otherShare;
		const ad = c.ad * scale * otherShare;
		return {
			key: c.key,
			label: c.key,
			icon: c.domain,
			cat: c.cat,
			visitors: Math.max(1, Math.round(c.visitors * scale * otherVisits)),
			sales: c.sales * weight(c.last) * scale * otherShare,
			gross,
			fee: gross * FEE_RATE,
			ad,
			revenue: toMode(gross, ad),
		};
	});
	const shown = sourceFilter ? sources.filter((s) => s.key === sourceFilter) : sources;

	const totals = shown.reduce(
		(t, s) => ({ visitors: t.visitors + s.visitors, gross: t.gross + s.gross, fee: t.fee + s.fee, ad: t.ad + s.ad, revenue: t.revenue + s.revenue, sales: t.sales + s.sales }),
		{ visitors: 0, gross: 0, fee: 0, ad: 0, revenue: 0, sales: 0 },
	);
	const totalVisitors = totals.visitors;
	const totalRevenue = totals.revenue;

	// Channel groups (category)
	const groups = new Map<string, Row>();
	for (const s of shown) {
		const g = groups.get(s.cat) ?? { key: s.cat, label: s.cat, visitors: 0, revenue: 0, sales: 0 };
		g.visitors += s.visitors;
		g.revenue += s.revenue;
		g.sales += s.sales;
		groups.set(s.cat, g);
	}

	const fromShares = (list: Array<{ key: string; share: number; rev: number; label?: string; domain?: string; flag?: string; read?: number; note?: string }>, iconOf?: (r: any) => string): Row[] =>
		list.map((r) => ({
			key: r.key,
			label: r.label ?? r.key,
			icon: iconOf?.(r),
			visitors: Math.max(1, Math.round(totalVisitors * r.share)),
			revenue: totalRevenue * r.rev,
			sales: totals.sales * r.rev,
			note: r.read ? `${Math.floor(r.read / 60)}m ${r.read % 60}s read` : r.note,
		}));

	// Time series for current and previous period
	const n = RANGE_POINTS[range];
	const visitSeries = wave(n, totalVisitors, 3, 0.4);
	const grossSeries = wave(n, totals.gross, 7, 0.6);
	const k = totals.gross ? totalRevenue / totals.gross : 0;
	const revenueSeries = grossSeries.map((g) => g * k);
	const step = range === '24h' ? 3600 : 86400;
	const seriesStart = Math.floor(DEMO_NOW / step) * step - (n - 1) * step;
	const start30 = Math.floor(DEMO_NOW / 86400) * 86400 - 29 * 86400;
	const prevVisit = wave(n, totalVisitors * 0.89, 11, 0.2);
	const prevRevenue = wave(n, totalRevenue * 0.85, 13, 0.2);
	const salesSeries = revenueSeries.map((r) => (totalRevenue ? (r / totalRevenue) * totals.sales : 0));
	const prevSales = prevRevenue.map((r) => (totalRevenue ? (r / (totalRevenue * 0.85)) * totals.sales * 0.9 : 0));

	// Buyers vs everyone else (reading behaviour)
	const behaviour = [
		{ label: 'Time on site', buyers: '4m 12s', others: '1m 03s' },
		{ label: 'Pages per visit', buyers: '5.8', others: '1.9' },
		{ label: 'Scroll depth', buyers: '81%', others: '44%' },
		{ label: 'Read /pricing', buyers: '94%', others: '17%' },
	];

	// When buyers buy: 7 x 24 heatmap of sales
	const heat = Array.from({ length: 7 }, (_, d) =>
		Array.from({ length: 24 }, (_, h) => {
			const work = d < 5 ? 1 : 0.55;
			const day = Math.exp(-((h - 15) ** 2) / 18) + 0.45 * Math.exp(-((h - 21) ** 2) / 8);
			return Math.max(0, work * day + 0.15 * noise(d * 24 + h) - 0.05);
		}),
	);

	// A few refunds, at the hour they happened (sample data)
	const heatRefunds = Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => (noise(d * 31 + h * 7) > 0.965 ? 1 : 0)));

	const funnelBase = totalVisitors;
	const funnel = [
		{ label: 'Visited', count: funnelBase },
		{ label: 'Viewed /pricing', count: Math.round(funnelBase * 0.27) },
		{ label: 'Started checkout', count: Math.round(funnelBase * 0.031) },
		{ label: 'Paid', count: Math.round(totals.sales) },
	];

	const timeToConvert = [
		{ label: 'Same day', share: 0.38 },
		{ label: '1–3 days', share: 0.27 },
		{ label: '4–7 days', share: 0.16 },
		{ label: '8–30 days', share: 0.14 },
		{ label: '30+ days', share: 0.05 },
	];

	// Lifetime value per first-touch source (renewals included), independent of range
	const ltv = SOURCES.filter((s) => s.sales > 5)
		.map((s) => ({ key: s.key, icon: s.domain, ltv: (s.gross / s.sales) * (2.2 + s.last), customers: s.sales * 3 }))
		.sort((a, b) => b.ltv - a.ltv)
		.slice(0, 6);

	// Readable Direct: what would otherwise be "Direct"
	const direct = [
		{ key: 'x.com (in-app)', icon: 'x.com', share: 0.34 },
		{ key: 'Direct (Shared Link)', icon: '', share: 0.24 },
		{ key: 'linkedin.com (in-app)', icon: 'linkedin.com', share: 0.17 },
		{ key: 'instagram.com (in-app)', icon: 'instagram.com', share: 0.1 },
		{ key: 'Direct (Typed/Bookmark)', icon: '', share: 0.1 },
		{ key: 'Checkout return', icon: 'stripe.com', share: 0.05 },
	];

	return {
		totals,
		sources: shown.map((s) => ({ ...s, note: s.cat })),
		groups: [...groups.values()],
		campaigns: CAMPAIGNS.map((c) => ({ key: c.key, label: c.key, visitors: Math.round(totalVisitors * c.share), revenue: totalRevenue * c.rev, sales: totals.sales * c.rev, note: c.note })),
		pages: fromShares(PAGES),
		entry: fromShares(ENTRY),
		exit: fromShares(EXIT),
		countries: fromShares(COUNTRIES, (r) => flag(r.key)),
		cities: fromShares(CITIES.map((c) => ({ ...c })), (r) => flag(r.flag)),
		devices: fromShares(DEVICES, (r) => `@${r.key.toLowerCase()}`),
		browsers: fromShares(BROWSERS, (r) => r.domain),
		oses: fromShares(OSES, (r) => r.domain),
		series: { n, start: seriesStart, step, visitors: visitSeries, revenue: revenueSeries, sales: salesSeries, prevVisitors: prevVisit, prevRevenue, prevSales },
		behaviour,
		heat,
		heatRefunds,
		funnel,
		timeToConvert,
		ltv,
		direct,
		prev: { visitors: totalVisitors * 0.89, revenue: totalRevenue * 0.85, sales: totals.sales * 0.9 },
		live: false,
		sales: DEMO_SALES,
		annotations: ANNOTATIONS_30D.map((a) => ({ at: start30 + a.at * 86400 + 12 * 3600, label: a.label })),
	};
}


/** Recent sales with full journeys, for the sales list and journey drawer. */
export const SALES = [
	{
		id: 's1', email: 'm***@hey.com', plan: 'Pro · yearly', gross: 990_00, gateway: 'Stripe', country: 'US', city: 'Austin', ago: '4 min ago', first: 'x.com (in-app)', last: 'chatgpt.com (AI)', firstIcon: 'x.com', lastIcon: 'chatgpt.com', days: 3,
		journey: [
			{ t: 'Mar 27 · 09:14', kind: 'visit', what: 'Landed on /blog/how-we-hit-10k-mrr', src: 'x.com (in-app)', detail: '3m 41s read · 92% scrolled' },
			{ t: 'Mar 27 · 09:18', kind: 'leave', what: 'Left the site', src: '', detail: '' },
			{ t: 'Mar 30 · 14:02', kind: 'visit', what: 'Came back to /', src: 'chatgpt.com (AI)', detail: 'Asked ChatGPT for revenue analytics tools' },
			{ t: 'Mar 30 · 14:03', kind: 'visit', what: 'Read /pricing', src: '', detail: '2m 14s read · 100% scrolled' },
			{ t: 'Mar 30 · 14:06', kind: 'goal', what: 'Clicked "Start Pro trial"', src: '', detail: 'data-gl-goal="checkout"' },
			{ t: 'Mar 30 · 14:08', kind: 'pay', what: 'Paid $990.00 with Stripe', src: '', detail: 'Pro · yearly' },
		],
	},
	{ id: 's2', email: 'a***@gmail.com', plan: 'Pro · monthly', gross: 99_00, gateway: 'Razorpay', country: 'IN', city: 'Bengaluru', ago: '18 min ago', first: 'linkedin.com (in-app)', last: 'linkedin.com (in-app)', firstIcon: 'linkedin.com', lastIcon: 'linkedin.com', days: 0, journey: [] },
	{ id: 's3', email: 'j***@acme.dev', plan: 'Team · monthly', gross: 249_00, gateway: 'Paddle', country: 'DE', city: 'Berlin', ago: '1 h ago', first: 'news.ycombinator.com', last: 'google.com', firstIcon: 'news.ycombinator.com', lastIcon: 'google.com', days: 9, journey: [] },
	{ id: 's4', email: 's***@proton.me', plan: 'Pro · monthly', gross: 99_00, gateway: 'Polar', country: 'GB', city: 'London', ago: '2 h ago', first: 'perplexity.ai (AI)', last: 'perplexity.ai (AI)', firstIcon: 'perplexity.ai', lastIcon: 'perplexity.ai', days: 1, journey: [] },
	{ id: 's5', email: 'k***@outlook.com', plan: 'Pro · monthly', gross: 99_00, gateway: 'Stripe', country: 'CA', city: 'Toronto', ago: '3 h ago', first: 'x.com (in-app)', last: 'Direct (Shared Link)', firstIcon: 'x.com', lastIcon: '', days: 6, journey: [] },
	{ id: 's6', email: 'r***@studio.io', plan: 'Pro · yearly · renewal', gross: 990_00, gateway: 'Lemon Squeezy', country: 'US', city: 'New York', ago: '5 h ago', first: 'google.com', last: 'google.com', firstIcon: 'google.com', lastIcon: 'google.com', days: 371, journey: [] },
];

const AGO_MIN = [4, 18, 60, 120, 180, 300];
const DEMO_SALES: DashSale[] = SALES.map((s, i) => ({
	id: s.id,
	email: s.email,
	plan: s.plan,
	gross: s.gross,
	fee: Math.round(s.gross * FEE_RATE),
	gateway: s.gateway,
	country: s.country,
	city: s.city,
	at: DEMO_NOW - AGO_MIN[i]! * 60,
	first: s.first,
	last: s.last,
	hours: s.days * 24,
	renewal: s.plan.includes('renewal'),
}));

export interface JourneyStep {
	t: string;
	kind: 'visit' | 'leave' | 'goal' | 'pay';
	what: string;
	src: string;
	detail: string;
}

/** Demo journey for a sale: hand-written for the first, generic for the rest. */
export function journeyFor(id: string): JourneyStep[] {
	const s = SALES.find((x) => x.id === id);
	if (!s) return [];
	if (s.journey.length) return s.journey as JourneyStep[];
	return [
		{ t: `${s.days ? `${s.days} days before` : 'Same day'}`, kind: 'visit', what: 'First visit', src: s.first, detail: '1m 52s read' },
		{ t: 'Purchase day', kind: 'visit', what: 'Read /pricing', src: s.last, detail: '1m 20s read · 88% scrolled' },
		{ t: 'Purchase day', kind: 'pay', what: `Paid ${(s.gross / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} with ${s.gateway}`, src: '', detail: s.plan },
	];
}

/** Pools for the simulated live feed. */
export const LIVE_POOL = [
	{ cc: 'US', city: 'Seattle', page: '/pricing', src: 'chatgpt.com', label: 'chatgpt.com' },
	{ cc: 'IN', city: 'Pune', page: '/', src: 'x.com', label: 'x.com' },
	{ cc: 'GB', city: 'Manchester', page: '/blog/how-we-hit-10k-mrr', src: 'news.ycombinator.com', label: 'Hacker News' },
	{ cc: 'DE', city: 'Munich', page: '/docs', src: 'google.com', label: 'google.com' },
	{ cc: 'BR', city: 'São Paulo', page: '/', src: 'instagram.com', label: 'Instagram app' },
	{ cc: 'FR', city: 'Paris', page: '/compare/datafast', src: 'perplexity.ai', label: 'perplexity.ai' },
	{ cc: 'CA', city: 'Vancouver', page: '/pricing', src: 'linkedin.com', label: 'LinkedIn app' },
	{ cc: 'AU', city: 'Sydney', page: '/changelog', src: '', label: 'Shared link' },
	{ cc: 'NL', city: 'Amsterdam', page: '/pricing', src: 'reddit.com', label: 'reddit.com' },
];
