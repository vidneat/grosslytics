import { reportingCurrency } from '@grosslytics/shared/money';
import { classifySourceCategory, dateRangeToTimestamps, tzOffsetSec, AI_SOURCES, SEARCH_SOURCES, SOCIAL_SOURCES } from '@grosslytics/shared/attribution';
import type { AttributionModel, ChannelStats } from '@grosslytics/shared/types';
import { allocateAdSpend } from './ad-spend.js';
import { formatDuration, sourceIcon } from '@grosslytics/shared/dashboard';
import type { DashboardData, DashFilter, DashMode, DashModel, DashRange, DashRow, DashSale, DashSource } from '@grosslytics/shared/dashboard';

export interface DashboardQuery {
	range: DashRange;
	model: DashModel;
	mode: DashMode;
	filters: DashFilter[];
	/** Unix seconds; defaults to now (tests pin it) */
	now?: number;
	/** Public share pages never see customer emails or journeys */
	publicView?: boolean;
}

// Historical events without stored dimensions use the same source-only fallback as ingestion.
const sourceCategory = (source: string) => `CASE
 WHEN lower(${source}) LIKE '%(ai)%' OR ${AI_SOURCES.map((name) => `(lower(${source}) = '${name}' OR lower(${source}) LIKE '%${name}.%')`).join(' OR ')} THEN 'AI Search'
 WHEN lower(${source}) LIKE '%ai_crawl%' THEN 'AI Crawler'
 WHEN lower(${source}) LIKE '%(in-app)%' THEN 'Social (Organic)'
 WHEN lower(${source}) LIKE 'direct%' THEN 'Direct'
 WHEN ${SOCIAL_SOURCES.map((name) => `(lower(${source}) = '${name}' OR lower(${source}) LIKE '%${name}.%')`).join(' OR ')} THEN 'Social (Organic)'
 WHEN ${SEARCH_SOURCES.map((name) => `(lower(${source}) = '${name}' OR lower(${source}) LIKE '%${name}.%')`).join(' OR ')} THEN 'Organic Search'
 ELSE 'Referral' END`;
const eventCategory = (alias: string) => `COALESCE(CASE WHEN json_valid(${alias}.meta_json) THEN json_extract(${alias}.meta_json, '$._grosslytics.category') END, ${sourceCategory(`${alias}.source`)})`;
const touchCategory = (touch: 'first' | 'last') => `COALESCE((SELECT ${eventCategory('a')} FROM events a WHERE a.site_id = p.site_id AND a.visitor_id = p.visitor_id AND a.source = p.${touch}_touch_source AND a.created_at <= p.created_at ORDER BY a.created_at ${touch === 'first' ? 'ASC' : 'DESC'}, a.id ${touch === 'first' ? 'ASC' : 'DESC'} LIMIT 1), ${sourceCategory(`p.${touch}_touch_source`)})`;

/**
 * `sales` counts first purchases only (renewals are revenue, not new customers).
 * Every statement starts with these CTEs and binds the same 12 parameters:
 * ?1 site, ?2 start, ?3 end (exclusive), ?4-?7 source/page/country/device filters (NULL = off),
 * ?8/?9 first/last-touch weights, ?10 bucket step, ?11 reporting currency, ?12 site UTC offset in seconds.
 * A filter narrows the visitor set (fv); payments count when their buyer is in that set.
 */
const CTE = `WITH
w AS (SELECT ?8 AS wf, ?9 AS wl, ?10 AS step, ?11 AS currency, CAST(?12 AS INTEGER) AS off), -- D1 binds JS numbers as REAL: cast bucket math back to integers
fv AS (
	SELECT DISTINCT visitor_id FROM events
	WHERE site_id = ?1 AND created_at >= ?2 AND created_at < ?3 AND event_type != 'ai_crawl'
	AND (?4 IS NULL OR visitor_id IN (SELECT visitor_id FROM events WHERE site_id = ?1 AND created_at >= ?2 AND created_at < ?3 AND source = ?4))
	AND (?5 IS NULL OR visitor_id IN (SELECT visitor_id FROM events WHERE site_id = ?1 AND created_at >= ?2 AND created_at < ?3 AND event_type = 'pageview' AND event_name = ?5))
	AND (?6 IS NULL OR visitor_id IN (SELECT visitor_id FROM visitors WHERE site_id = ?1 AND country = ?6))
	AND (?7 IS NULL OR visitor_id IN (SELECT visitor_id FROM visitors WHERE site_id = ?1 AND lower(device_type) = lower(?7)))
),
ev AS (SELECT e.*, ${eventCategory('e')} AS category FROM events e WHERE site_id = ?1 AND created_at >= ?2 AND created_at < ?3 AND event_type != 'ai_crawl' AND visitor_id IN fv),
vv AS (SELECT * FROM visitors WHERE site_id = ?1 AND visitor_id IN fv),
pay AS (
	SELECT * FROM payments WHERE site_id = ?1 AND status = 'succeeded' AND upper(currency) = ?11 AND created_at >= ?2 AND created_at < ?3
	AND ((?4 IS NULL AND ?5 IS NULL AND ?6 IS NULL AND ?7 IS NULL) OR visitor_id IN fv)
)
`;

/** Traffic rows and revenue rows for one visitor-level column, merged by key. */
const byVisitorColumn = (col: string) => {
	const fallback = col === 'country' ? 'XX' : col === 'device_type' ? 'unknown' : '(not set)';
	const key = (alias: string) => `COALESCE(NULLIF(${alias}.${col}, ''), '${fallback}')`;
	return `${CTE}
SELECT k, SUM(v) AS v, SUM(g) AS g, SUM(f) AS f, SUM(s) AS s, MAX(x) AS x FROM (
	SELECT ${key('vv')} AS k, COUNT(*) AS v, 0 AS g, 0 AS f, 0 AS s, MAX(country) AS x FROM vv GROUP BY k
	UNION ALL
	SELECT ${key('v')}, 0, SUM(p.gross_amount_cents), SUM(p.fee_amount_cents), SUM(p.is_renewal = 0), MAX(v.country)
	FROM pay p LEFT JOIN visitors v ON v.site_id = p.site_id AND v.visitor_id = p.visitor_id GROUP BY ${key('v')}
) GROUP BY k ORDER BY v DESC LIMIT 50`;
};

const SQL = {
	totals: `${CTE} SELECT (SELECT COUNT(*) FROM fv) AS v, (SELECT COALESCE(SUM(gross_amount_cents), 0) FROM pay) AS g, (SELECT COALESCE(SUM(fee_amount_cents), 0) FROM pay) AS f, (SELECT COUNT(*) FROM pay WHERE is_renewal = 0) AS s`,
	seriesVisitors: `${CTE} SELECT CAST((created_at - ?2) / (SELECT step FROM w) AS INTEGER) AS b, COUNT(DISTINCT visitor_id) AS v FROM ev GROUP BY b`,
	seriesRevenue: `${CTE} SELECT CAST((created_at - ?2) / (SELECT step FROM w) AS INTEGER) AS b, SUM(gross_amount_cents) AS g, SUM(fee_amount_cents) AS f, SUM(is_renewal = 0) AS s FROM pay GROUP BY b`,
	sourceTraffic: `${CTE} SELECT source AS k, COUNT(DISTINCT visitor_id) AS v, COUNT(DISTINCT json_array(visitor_id, session_id)) AS ses,
	 SUM(event_type = 'pageview') AS pv, SUM(duration_sec) AS rd, AVG(CASE WHEN event_type = 'leave' THEN scroll_depth END) AS sc,
	 CASE WHEN COUNT(DISTINCT category) = 1 THEN MIN(category) ELSE 'Mixed' END AS cat FROM ev GROUP BY source`,
	categoryTraffic: `${CTE} SELECT category AS k, COUNT(DISTINCT visitor_id) AS v FROM ev GROUP BY category`,
	// Keep category credit separate when the same source has both paid and organic visits.
	sourceRevenue: `${CTE} SELECT k, cat, SUM(wt * g) AS g, SUM(wt * f) AS f, SUM(wt * n) AS s FROM (
		SELECT first_touch_source AS k, ${touchCategory('first')} AS cat, (SELECT wf FROM w) AS wt, gross_amount_cents AS g, fee_amount_cents AS f, is_renewal = 0 AS n FROM pay p
		UNION ALL
		SELECT last_touch_source, ${touchCategory('last')}, (SELECT wl FROM w), gross_amount_cents, fee_amount_cents, is_renewal = 0 FROM pay p
	) WHERE wt > 0 GROUP BY k, cat`,
	// Page revenue = money from buyers who viewed the page (pages overlap, so rows don't sum to the total)
	pages: `${CTE}
	SELECT pv.k, pv.v, COALESCE(r.g, 0) AS g, COALESCE(r.f, 0) AS f, COALESCE(r.s, 0) AS s, rd.x
	FROM (SELECT event_name AS k, COUNT(DISTINCT visitor_id) AS v FROM ev WHERE event_type = 'pageview' GROUP BY event_name) pv
	LEFT JOIN (
		-- each payment once per page its buyer viewed; walks idx_events_visitor_journey from the (few) buyers
		SELECT k, SUM(g) AS g, SUM(f) AS f, SUM(s) AS s FROM (
			SELECT DISTINCT p.payment_id, e.event_name AS k, p.gross_amount_cents AS g, p.fee_amount_cents AS f, p.is_renewal = 0 AS s
			FROM pay p JOIN events e ON e.site_id = ?1 AND e.visitor_id = p.visitor_id AND e.created_at >= ?2 AND e.created_at < ?3 AND e.event_type = 'pageview'
		) GROUP BY k
	) r ON r.k = pv.k
	LEFT JOIN (SELECT k, AVG(t) AS x FROM (SELECT session_id, event_name AS k, SUM(duration_sec) AS t FROM ev WHERE event_type = 'leave' GROUP BY visitor_id, session_id, event_name) WHERE t > 0 GROUP BY k) rd ON rd.k = pv.k
	ORDER BY pv.v DESC LIMIT 50`,
	// One entry per visitor in the period; untracked buyers remain visible so money reconciles.
	entry: `${CTE}, entries AS (SELECT visitor_id, k FROM (
		SELECT visitor_id, event_name AS k, ROW_NUMBER() OVER (PARTITION BY visitor_id ORDER BY created_at, id) AS rn FROM ev WHERE event_type = 'pageview'
	) WHERE rn = 1)
	SELECT k, SUM(v) AS v, SUM(g) AS g, SUM(f) AS f, SUM(s) AS s FROM (
		SELECT COALESCE(e.k, '(not tracked)') AS k, COUNT(*) AS v, 0 AS g, 0 AS f, 0 AS s FROM fv LEFT JOIN entries e USING (visitor_id) GROUP BY k
		UNION ALL
		SELECT COALESCE(e.k, '(not tracked)'), 0, SUM(p.gross_amount_cents), SUM(p.fee_amount_cents), SUM(p.is_renewal = 0) FROM pay p LEFT JOIN entries e USING (visitor_id) GROUP BY e.k
	) GROUP BY k ORDER BY v DESC LIMIT 50`,
	exit: `${CTE} SELECT k, COUNT(DISTINCT visitor_id) AS v, 0 AS g, 0 AS f, 0 AS s FROM (
		SELECT visitor_id, event_name AS k, ROW_NUMBER() OVER (PARTITION BY visitor_id, session_id ORDER BY created_at DESC, id DESC) AS rn FROM ev WHERE event_type IN ('pageview', 'leave')
	) WHERE rn = 1 GROUP BY k ORDER BY v DESC LIMIT 50`,
	countries: byVisitorColumn('country'),
	cities: byVisitorColumn('city'),
	devices: byVisitorColumn('device_type'),
	browsers: byVisitorColumn('browser'),
	oses: byVisitorColumn('os'),
	campaignsFirst: byVisitorColumn('first_utm_campaign'),
	campaignsLast: byVisitorColumn('last_utm_campaign'),
	behaviour: `${CTE} SELECT (vv.visitor_id IN (SELECT visitor_id FROM pay)) AS buyer, COUNT(*) AS n,
		AVG(vv.total_active_read_sec) AS rd, AVG(vv.max_scroll_pct) AS sc,
		AVG(COALESCE(a.pv, 0) * 1.0 / MAX(1, COALESCE(a.ses, 1))) AS ppv, AVG(COALESCE(a.pricing, 0)) AS pr
		FROM vv LEFT JOIN (
			SELECT visitor_id, SUM(event_type = 'pageview') AS pv, COUNT(DISTINCT session_id) AS ses,
			MAX(event_type = 'pageview' AND event_name LIKE '/pricing%') AS pricing FROM ev GROUP BY visitor_id
		) a ON a.visitor_id = vv.visitor_id GROUP BY buyer`,
	heat: `${CTE} SELECT (CAST(strftime('%w', created_at + (SELECT off FROM w), 'unixepoch') AS INTEGER) + 6) % 7 AS d, CAST(strftime('%H', created_at + (SELECT off FROM w), 'unixepoch') AS INTEGER) AS h, COUNT(*) AS s FROM pay WHERE is_renewal = 0 GROUP BY d, h`,
	heatRefunds: `${CTE} SELECT (CAST(strftime('%w', r.refunded_at + (SELECT off FROM w), 'unixepoch') AS INTEGER) + 6) % 7 AS d, CAST(strftime('%H', r.refunded_at + (SELECT off FROM w), 'unixepoch') AS INTEGER) AS h, COUNT(*) AS s
		FROM refunds r JOIN payments p ON p.payment_id = r.payment_id
		WHERE r.site_id = ?1 AND upper(p.currency) = ?11 AND r.refunded_at >= ?2 AND r.refunded_at < ?3 AND ((?4 IS NULL AND ?5 IS NULL AND ?6 IS NULL AND ?7 IS NULL) OR p.visitor_id IN fv) GROUP BY d, h`,
	funnel: `${CTE} SELECT (SELECT COUNT(*) FROM fv) AS visited,
		(SELECT COUNT(DISTINCT visitor_id) FROM ev WHERE event_type = 'pageview' AND event_name LIKE '/pricing%') AS pricing,
		(SELECT COUNT(DISTINCT visitor_id) FROM ev WHERE event_type = 'goal') AS goal,
		(SELECT COUNT(DISTINCT COALESCE(visitor_id, payment_id)) FROM pay WHERE is_renewal = 0) AS paid`,
	timeToConvert: `${CTE} SELECT CASE WHEN time_to_convert_hours < 24 THEN 0 WHEN time_to_convert_hours < 96 THEN 1 WHEN time_to_convert_hours < 192 THEN 2 WHEN time_to_convert_hours < 744 THEN 3 ELSE 4 END AS b, COUNT(*) AS s FROM pay WHERE is_renewal = 0 GROUP BY b`,
	// Lifetime value is all-time by design: a range would cut renewals off
	ltv: `${CTE} SELECT first_touch_source AS k, SUM(net_amount_cents) AS net, COUNT(DISTINCT COALESCE(customer_email_hash, visitor_id, payment_id)) AS c
		FROM payments WHERE site_id = ?1 AND status = 'succeeded' AND upper(currency) = ?11 GROUP BY first_touch_source HAVING c > 0 ORDER BY net * 1.0 / c DESC LIMIT 6`,
	// Recent sales include refunded ones (labelled in the UI); revenue never does
	sales: `${CTE} SELECT payment_id, customer_email_masked, plan_name, gross_amount_cents, fee_amount_cents, gateway, country, city, created_at, first_touch_source, last_touch_source, visitor_id, time_to_convert_hours, is_renewal, status
		FROM payments WHERE site_id = ?1 AND status IN ('succeeded', 'refunded') AND upper(currency) = ?11 AND created_at >= ?2 AND created_at < ?3
		AND ((?4 IS NULL AND ?5 IS NULL AND ?6 IS NULL AND ?7 IS NULL) OR visitor_id IN fv) ORDER BY created_at DESC LIMIT 8`,
	adSpend: `${CTE} SELECT source AS k, spend_date AS d, SUM(amount_cents) AS a FROM ad_spend WHERE site_id = ?1 AND spend_date >= date(?2 + (SELECT off FROM w), 'unixepoch') AND spend_date <= date(?3 - 1 + (SELECT off FROM w), 'unixepoch') GROUP BY source, spend_date`,
	annotations: `${CTE} SELECT id, at, label FROM annotations WHERE site_id = ?1 AND at >= ?2 AND at < ?3 ORDER BY at`,
} as const;

type Q = keyof typeof SQL;
type Rec = Record<string, any>;

function buildSources(trafficRows: Rec[], revenueRows: Rec[], adBySource: Map<string, number>, mode: DashMode): DashSource[] {
	const traffic = new Map(trafficRows.map((x) => [String(x.k), x]));
	const revenue = new Map<string, { gross: number; fee: number; sales: number; categories: Set<string> }>();
	for (const x of revenueRows) {
		const value = revenue.get(x.k) ?? { gross: 0, fee: 0, sales: 0, categories: new Set<string>() };
		value.gross += x.g;
		value.fee += x.f;
		value.sales += x.s;
		value.categories.add(x.cat);
		revenue.set(x.k, value);
	}
	return [...new Set([...traffic.keys(), ...revenue.keys(), ...adBySource.keys()])].map((key) => {
		const r = revenue.get(key);
		const gross = r?.gross ?? 0;
		const fee = r?.fee ?? 0;
		const ad = adBySource.get(key) ?? 0;
		const cat = traffic.get(key)?.cat ?? (r?.categories.size === 1 ? [...r.categories][0]! : r ? 'Mixed' : classifySourceCategory(key));
		return { key, label: key, cat, note: cat, icon: sourceIcon(key), visitors: traffic.get(key)?.v ?? 0, sales: r?.sales ?? 0,
			gross, fee, ad, revenue: mode === 'gross' ? gross : gross - fee - (mode === 'profit' ? ad : 0) };
	});
}

/** Channel API/MCP share dashboard math.
 * ponytail: raw distinct counts until mergeable unique rollups are justified by measured query cost.
 */
/** A preset range on the site's local calendar, for the channel API and MCP. */
export async function siteRange(db: D1Database, siteId: string, range: '24h' | '7d' | '30d' | '90d', now = Math.floor(Date.now() / 1000)) {
	const site = await db.prepare('SELECT timezone FROM sites WHERE site_id = ?').bind(siteId).first<{ timezone: string | null }>();
	return dateRangeToTimestamps(range, now, tzOffsetSec(site?.timezone || 'UTC', now));
}

export async function queryChannelStats(db: D1Database, siteId: string, start: number, end: number, model: AttributionModel): Promise<ChannelStats[]> {
	const site = await db.prepare('SELECT currency, timezone FROM sites WHERE site_id = ?').bind(siteId).first<{ currency: string; timezone: string | null }>();
	const currency = reportingCurrency(site?.currency ?? 'USD');
	const off = tzOffsetSec(site?.timezone || 'UTC', end);
	const [first, last] = model === 'first' ? [1, 0] : model === 'last' ? [0, 1] : [0.5, 0.5];
	const params = [siteId, start, end, null, null, null, null, first, last, 86400, currency, off];
	const [traffic, revenue, spend] = await db.batch<Rec>(['sourceTraffic', 'sourceRevenue', 'adSpend'].map((name) => db.prepare(SQL[name as Q]).bind(...params)));
	const ad = allocateAdSpend(spend!.results as Array<{ k: string; d: string; a: number }>, start, end, 86400, off);
	const trafficBySource = new Map(traffic!.results.map((row) => [row.k, row]));
	return buildSources(traffic!.results, revenue!.results, ad.bySource, 'net').map((source) => {
		const t = trafficBySource.get(source.key);
		return { source: source.key, currency, category: source.cat as ChannelStats['category'], visitors: source.visitors,
			sessions: t?.ses ?? 0, pageviews: t?.pv ?? 0, avgReadSec: t?.pv ? Math.round(t.rd / t.pv) : 0, avgScrollPct: Math.round(t?.sc ?? 0),
			grossRevenueCents: source.gross, feesCents: source.fee, netRevenueCents: source.revenue, adSpendCents: source.ad,
			trueProfitCents: source.revenue - source.ad, conversions: source.sales,
			rpvCents: source.visitors ? Math.round(source.revenue / source.visitors) : 0 };
	});
}

const COUNTRY_NAMES = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
const countryName = (cc: string) => {
	if (!/^[A-Z]{2}$/.test(cc) || cc === 'XX') return 'Unknown';
	try {
		return COUNTRY_NAMES?.of(cc) ?? cc;
	} catch {
		return cc;
	}
};
export const flagOf = (cc: string) =>
	/^[A-Z]{2}$/.test(cc) && cc !== 'XX' ? cc.replace(/./g, (c) => String.fromCodePoint(0x1f1a5 + c.charCodeAt(0))) : '';
const BROWSER_ICON: Record<string, string> = { Chrome: 'google.com', Safari: 'apple.com', Firefox: 'mozilla.org', Edge: 'microsoft.com', Opera: 'opera.com', Arc: 'arc.net' };
const OS_ICON: Record<string, string> = { macOS: 'apple.com', iOS: 'apple.com', Windows: 'microsoft.com', Android: 'android.com', Linux: 'kernel.org' };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Builds dashboard panels in one D1 batch, after reading site currency settings. */
export async function queryDashboard(db: D1Database, siteId: string, q: DashboardQuery): Promise<DashboardData> {
	const site = await db.prepare('SELECT currency, timezone FROM sites WHERE site_id = ?').bind(siteId).first<{ currency: string; timezone: string | null }>();
	const currency = reportingCurrency(site?.currency ?? 'USD');
	const timezone = site?.timezone || 'UTC';
	const now = q.now ?? Math.floor(Date.now() / 1000);
	const off = tzOffsetSec(timezone, now);
	const { results: excluded } = await db.prepare('SELECT DISTINCT upper(currency) AS currency FROM payments WHERE site_id = ? AND upper(currency) != ? ORDER BY currency').bind(siteId, currency).all<{ currency: string }>();
	const { n, step, start, end } = dateRangeToTimestamps(q.range, now, off);
	const prevStart = start - n * step;

	const f = (dim: DashFilter['dim']) => q.filters.find((x) => x.dim === dim)?.value ?? null;
	const [wf, wl] = q.model === 'first' ? [1, 0] : q.model === 'last' ? [0, 1] : [0.5, 0.5];
	const params = (s: number, e: number) => [siteId, s, e, f('source'), f('page'), f('country'), f('device'), wf, wl, step, currency, off];

	const names = Object.keys(SQL) as Q[];
	const stmts = names.map((k) => db.prepare(SQL[k]).bind(...params(start, end)));
	for (const k of ['totals', 'seriesVisitors', 'seriesRevenue', 'adSpend'] as const) stmts.push(db.prepare(SQL[k]).bind(...params(prevStart, start)));
	const results = await db.batch<Rec>(stmts);
	const r = Object.fromEntries(names.map((k, i) => [k, results[i]!.results])) as Record<Q, Rec[]>;
	const [prevTotals, prevVisitors, prevRevenue, prevAd] = results.slice(names.length).map((x) => x.results);

	// Ad spend: by source and by day. Only a source filter can scope it; other filters can't split ad spend.
	const anyFilter = q.filters.length > 0;
	const sourceFilter = f('source');
	const scopedSpend = (rows: Rec[]) => rows.filter((a) => !anyFilter || a.k === sourceFilter) as Array<{ k: string; d: string; a: number }>;
	const ad = allocateAdSpend(scopedSpend(r.adSpend), start, end, step, off);
	const prevSpend = allocateAdSpend(scopedSpend(prevAd ?? []), prevStart, start, step, off);
	const adTotal = ad.total;
	const prevAdTotal = prevSpend.total;

	const money = (g: number, fee: number, ad = 0) => (q.mode === 'gross' ? g : q.mode === 'net' ? g - fee : g - fee - ad);
	const row = (x: Rec, extra: Partial<DashRow> = {}): DashRow => ({
		key: String(x.k),
		label: String(x.k),
		visitors: Number(x.v ?? 0),
		revenue: money(Number(x.g ?? 0), Number(x.f ?? 0)),
		sales: Number(x.s ?? 0),
		...extra,
	});

	const sources = buildSources(r.sourceTraffic, r.sourceRevenue, ad.bySource, q.mode);
	const groupMap = new Map<string, DashRow>(r.categoryTraffic.map((x) => [x.k, { key: x.k, label: x.k, visitors: x.v, revenue: 0, sales: 0 }]));
	for (const x of r.sourceRevenue) {
		const g = groupMap.get(x.cat) ?? { key: x.cat, label: x.cat, visitors: 0, revenue: 0, sales: 0 };
		g.revenue += money(x.g, x.f);
		g.sales += x.s;
		groupMap.set(x.cat, g);
	}
	// Spend is entered by source, not category; don't guess how a mixed source's costs split.
	if (q.mode === 'profit' && adTotal) groupMap.set('Ad spend', { key: 'Ad spend', label: 'Ad spend (not split by channel)', visitors: 0, revenue: -adTotal, sales: 0 });

	const t = r.totals[0] ?? {};
	const pt = prevTotals?.[0] ?? {};
	const totals = { visitors: Number(t.v ?? 0), gross: Number(t.g ?? 0), fee: Number(t.f ?? 0), ad: adTotal, revenue: 0, sales: Number(t.s ?? 0) };
	totals.revenue = money(totals.gross, totals.fee, adTotal);

	const fill = (rows: Rec[] | undefined, pick: (x: Rec, b: number) => number) => {
		const out = new Array<number>(n).fill(0);
		for (const x of rows ?? []) if (x.b >= 0 && x.b < n) out[x.b] = pick(x, x.b);
		return out;
	};
	const revenueSeries = (rows: Rec[] | undefined, spend: number[]) => {
		const gross = fill(rows, (x) => x.g);
		const fees = fill(rows, (x) => x.f);
		return gross.map((g, b) => money(g, fees[b]!, spend[b]));
	};

	// Readable Direct: what other tools lump into "Direct"
	const directish = sources.filter((s) => /\(in-app\)$/.test(s.key) || /^direct/i.test(s.key));
	const directTotal = directish.reduce((a, s) => a + s.visitors, 0) || 1;

	const beh = new Map(r.behaviour.map((x) => [Number(x.buyer), x]));
	const b1 = beh.get(1);
	const b0 = beh.get(0);
	const pct = (x?: number) => (x == null ? '–' : `${Math.round(x)}%`);
	const fmt = (x: Rec | undefined, fn: (x: Rec) => string) => (x ? fn(x) : '–');

	const ttc = new Array<number>(5).fill(0);
	for (const x of r.timeToConvert) ttc[x.b] = x.s;
	const ttcSum = ttc.reduce((a, b) => a + b, 0) || 1;

	const grid = (rows: Rec[]) => {
		const g = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
		for (const x of rows) g[x.d]![x.h] = x.s;
		return g;
	};
	const heat = grid(r.heat);
	const heatRefunds = grid(r.heatRefunds);

	const fu = r.funnel[0] ?? {};
	const geo = (x: Rec) => row(x, { label: countryName(String(x.k)), icon: flagOf(String(x.k)) });

	return {
		live: true,
		currency,
		timezone,
		excludedCurrencies: excluded.map((row) => row.currency),
		adSpendAvailable: !q.filters.some((filter) => filter.dim !== 'source'),
		totals,
		prev: { visitors: Number(pt.v ?? 0), revenue: money(Number(pt.g ?? 0), Number(pt.f ?? 0), prevAdTotal), sales: Number(pt.s ?? 0) },
		series: {
			n,
			start,
			step,
			visitors: fill(r.seriesVisitors, (x) => x.v),
			revenue: revenueSeries(r.seriesRevenue, ad.byBucket),
			sales: fill(r.seriesRevenue, (x) => x.s),
			prevVisitors: fill(prevVisitors, (x) => x.v),
			prevRevenue: revenueSeries(prevRevenue, prevSpend.byBucket),
			prevSales: fill(prevRevenue, (x) => x.s),
		},
		sources,
		groups: [...groupMap.values()],
		campaigns: (q.model === 'last' ? r.campaignsLast : r.campaignsFirst).map((x) => row(x)),
		pages: r.pages.map((x) => row(x, x.x ? { note: `${formatDuration(x.x)} read` } : {})),
		entry: r.entry.map((x) => row(x)),
		exit: r.exit.map((x) => row(x)),
		countries: r.countries.map(geo),
		cities: r.cities.map((x) => row(x, { icon: flagOf(String(x.x ?? '')) })),
		devices: r.devices.map((x) => row(x, { label: cap(String(x.k)), key: cap(String(x.k)), icon: `@${String(x.k).toLowerCase()}` })),
		browsers: r.browsers.map((x) => row(x, { icon: BROWSER_ICON[x.k] })),
		oses: r.oses.map((x) => row(x, { icon: OS_ICON[x.k] })),
		behaviour: [
			{ label: 'Time on site', buyers: fmt(b1, (x) => formatDuration(x.rd)), others: fmt(b0, (x) => formatDuration(x.rd)) },
			{ label: 'Pages per visit', buyers: fmt(b1, (x) => x.ppv.toFixed(1)), others: fmt(b0, (x) => x.ppv.toFixed(1)) },
			{ label: 'Scroll depth', buyers: pct(b1?.sc), others: pct(b0?.sc) },
			{ label: 'Read /pricing', buyers: pct(b1 && b1.pr * 100), others: pct(b0 && b0.pr * 100) },
		],
		heat,
		heatRefunds,
		funnel: [
			{ label: 'Visited', count: Number(fu.visited ?? 0) },
			{ label: 'Viewed /pricing', count: Number(fu.pricing ?? 0) },
			{ label: 'Reached a goal', count: Number(fu.goal ?? 0) },
			{ label: 'Paid', count: Number(fu.paid ?? 0) },
		],
		timeToConvert: ['Same day', '1–3 days', '4–7 days', '8–30 days', '30+ days'].map((label, i) => ({ label, share: ttc[i]! / ttcSum })),
		ltv: r.ltv.map((x) => ({ key: String(x.k), icon: sourceIcon(String(x.k)), ltv: Math.round(x.net / x.c), customers: Number(x.c) })),
		direct: directish
			.sort((a, b) => b.visitors - a.visitors)
			.slice(0, 6)
			.map((s) => ({ key: s.key, icon: s.icon ?? '', share: s.visitors / directTotal })),
		sales: q.publicView
			? []
			: r.sales.map(
					(x): DashSale => ({
						id: String(x.payment_id),
								currency,
						email: x.customer_email_masked || 'customer',
						plan: x.plan_name || '',
						gross: Number(x.gross_amount_cents),
						fee: Number(x.fee_amount_cents),
						gateway: String(x.gateway),
						country: String(x.country ?? ''),
						city: String(x.city ?? ''),
						at: Number(x.created_at),
						first: String(x.first_touch_source),
						last: String(x.last_touch_source),
						visitorId: x.visitor_id ?? undefined,
						hours: Number(x.time_to_convert_hours ?? 0),
						renewal: !!x.is_renewal,
						refunded: x.status === 'refunded',
					}),
				),
		annotations: q.publicView ? r.annotations.map((x) => ({ at: Number(x.at), label: String(x.label) })) : r.annotations.map((x) => ({ id: Number(x.id), at: Number(x.at), label: String(x.label) })),
	};
}
