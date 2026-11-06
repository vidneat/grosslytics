import { classifySourceCategory } from '@grosslytics/shared/attribution';
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

const HOUR = 3600;
const DAY = 86400;
const BUCKETS: Record<DashRange, { n: number; step: number }> = {
	'24h': { n: 24, step: HOUR },
	'7d': { n: 7, step: DAY },
	'30d': { n: 30, step: DAY },
	'90d': { n: 90, step: DAY },
};

/**
 * `sales` counts first purchases only (renewals are revenue, not new customers).
 * Every statement starts with these CTEs and binds the same 10 parameters:
 * ?1 site, ?2 start, ?3 end (exclusive), ?4-?7 source/page/country/device filters (NULL = off),
 * ?8/?9 first/last-touch weights, ?10 bucket step.
 * A filter narrows the visitor set (fv); payments count when their buyer is in that set.
 */
const CTE = `WITH
w AS (SELECT ?8 AS wf, ?9 AS wl, ?10 AS step), -- D1 binds JS numbers as REAL: cast bucket math back to integers
fv AS (
	SELECT DISTINCT visitor_id FROM events
	WHERE site_id = ?1 AND created_at >= ?2 AND created_at < ?3 AND event_type != 'ai_crawl'
	AND (?4 IS NULL OR visitor_id IN (SELECT visitor_id FROM events WHERE site_id = ?1 AND created_at >= ?2 AND created_at < ?3 AND source = ?4))
	AND (?5 IS NULL OR visitor_id IN (SELECT visitor_id FROM events WHERE site_id = ?1 AND created_at >= ?2 AND created_at < ?3 AND event_type = 'pageview' AND event_name = ?5))
	AND (?6 IS NULL OR visitor_id IN (SELECT visitor_id FROM visitors WHERE site_id = ?1 AND country = ?6))
	AND (?7 IS NULL OR visitor_id IN (SELECT visitor_id FROM visitors WHERE site_id = ?1 AND lower(device_type) = lower(?7)))
),
ev AS (SELECT * FROM events WHERE site_id = ?1 AND created_at >= ?2 AND created_at < ?3 AND event_type != 'ai_crawl' AND visitor_id IN fv),
vv AS (SELECT * FROM visitors WHERE site_id = ?1 AND visitor_id IN fv),
pay AS (
	SELECT * FROM payments WHERE site_id = ?1 AND status = 'succeeded' AND created_at >= ?2 AND created_at < ?3
	AND ((?4 IS NULL AND ?5 IS NULL AND ?6 IS NULL AND ?7 IS NULL) OR visitor_id IN fv)
)
`;

/** Traffic rows and revenue rows for one visitor-level column, merged by key. */
const byVisitorColumn = (col: string) => `${CTE}
SELECT k, SUM(v) AS v, SUM(g) AS g, SUM(f) AS f, SUM(s) AS s, MAX(x) AS x FROM (
	SELECT ${col} AS k, COUNT(*) AS v, 0 AS g, 0 AS f, 0 AS s, MAX(country) AS x FROM vv GROUP BY k
	UNION ALL
	SELECT vv.${col}, 0, SUM(p.gross_amount_cents), SUM(p.fee_amount_cents), SUM(p.is_renewal = 0), NULL FROM pay p JOIN vv ON vv.visitor_id = p.visitor_id GROUP BY vv.${col}
) WHERE k IS NOT NULL AND k != '' GROUP BY k ORDER BY v DESC LIMIT 50`;

const SQL = {
	totals: `${CTE} SELECT (SELECT COUNT(*) FROM fv) AS v, (SELECT COALESCE(SUM(gross_amount_cents), 0) FROM pay) AS g, (SELECT COALESCE(SUM(fee_amount_cents), 0) FROM pay) AS f, (SELECT COUNT(*) FROM pay WHERE is_renewal = 0) AS s`,
	seriesVisitors: `${CTE} SELECT CAST((created_at - ?2) / (SELECT step FROM w) AS INTEGER) AS b, COUNT(DISTINCT visitor_id) AS v FROM ev GROUP BY b`,
	seriesRevenue: `${CTE} SELECT CAST((created_at - ?2) / (SELECT step FROM w) AS INTEGER) AS b, SUM(gross_amount_cents) AS g, SUM(fee_amount_cents) AS f, SUM(is_renewal = 0) AS s FROM pay GROUP BY b`,
	sourceTraffic: `${CTE} SELECT source AS k, COUNT(DISTINCT visitor_id) AS v FROM ev WHERE event_type = 'pageview' GROUP BY source`,
	// Each payment credits its first and last touch by the model's weights (linear = 0.5 each)
	sourceRevenue: `${CTE} SELECT k, SUM(wt * g) AS g, SUM(wt * f) AS f, SUM(wt * n) AS s FROM (
		SELECT first_touch_source AS k, (SELECT wf FROM w) AS wt, gross_amount_cents AS g, fee_amount_cents AS f, is_renewal = 0 AS n FROM pay
		UNION ALL
		SELECT last_touch_source, (SELECT wl FROM w), gross_amount_cents, fee_amount_cents, is_renewal = 0 FROM pay
	) WHERE wt > 0 GROUP BY k`,
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
	LEFT JOIN (SELECT event_name AS k, AVG(duration_sec) AS x FROM ev WHERE event_type = 'leave' AND duration_sec > 0 GROUP BY event_name) rd ON rd.k = pv.k
	ORDER BY pv.v DESC LIMIT 50`,
	entry: `${CTE} SELECT e.k, COUNT(DISTINCT e.visitor_id) AS v, COALESCE(SUM(r.g), 0) AS g, COALESCE(SUM(r.f), 0) AS f, COALESCE(SUM(r.s), 0) AS s FROM (
		SELECT visitor_id, event_name AS k, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at, id) AS rn FROM ev WHERE event_type = 'pageview'
	) e LEFT JOIN (SELECT visitor_id, SUM(gross_amount_cents) AS g, SUM(fee_amount_cents) AS f, SUM(is_renewal = 0) AS s FROM pay GROUP BY visitor_id) r ON r.visitor_id = e.visitor_id
	WHERE e.rn = 1 GROUP BY e.k ORDER BY v DESC LIMIT 50`,
	exit: `${CTE} SELECT k, COUNT(DISTINCT visitor_id) AS v, 0 AS g, 0 AS f, 0 AS s FROM (
		SELECT visitor_id, event_name AS k, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at DESC, id DESC) AS rn FROM ev WHERE event_type IN ('pageview', 'leave')
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
	heat: `${CTE} SELECT (CAST(strftime('%w', created_at, 'unixepoch') AS INTEGER) + 6) % 7 AS d, CAST(strftime('%H', created_at, 'unixepoch') AS INTEGER) AS h, COUNT(*) AS s FROM pay WHERE is_renewal = 0 GROUP BY d, h`,
	funnel: `${CTE} SELECT (SELECT COUNT(*) FROM fv) AS visited,
		(SELECT COUNT(DISTINCT visitor_id) FROM ev WHERE event_type = 'pageview' AND event_name LIKE '/pricing%') AS pricing,
		(SELECT COUNT(DISTINCT visitor_id) FROM ev WHERE event_type = 'goal') AS goal,
		(SELECT COUNT(DISTINCT COALESCE(visitor_id, payment_id)) FROM pay WHERE is_renewal = 0) AS paid`,
	timeToConvert: `${CTE} SELECT CASE WHEN time_to_convert_hours < 24 THEN 0 WHEN time_to_convert_hours < 96 THEN 1 WHEN time_to_convert_hours < 192 THEN 2 WHEN time_to_convert_hours < 744 THEN 3 ELSE 4 END AS b, COUNT(*) AS s FROM pay WHERE is_renewal = 0 GROUP BY b`,
	// Lifetime value is all-time by design: a range would cut renewals off
	ltv: `${CTE} SELECT first_touch_source AS k, SUM(net_amount_cents) AS net, COUNT(DISTINCT COALESCE(customer_email_hash, visitor_id, payment_id)) AS c
		FROM payments WHERE site_id = ?1 AND status = 'succeeded' GROUP BY first_touch_source HAVING c > 0 ORDER BY net * 1.0 / c DESC LIMIT 6`,
	sales: `${CTE} SELECT payment_id, customer_email_masked, plan_name, gross_amount_cents, fee_amount_cents, gateway, country, city, created_at, first_touch_source, last_touch_source, visitor_id, time_to_convert_hours, is_renewal FROM pay ORDER BY created_at DESC LIMIT 8`,
	adSpend: `${CTE} SELECT source AS k, spend_date AS d, SUM(amount_cents) AS a FROM ad_spend WHERE site_id = ?1 AND spend_date >= date(?2, 'unixepoch') AND spend_date < date(?3, 'unixepoch', '+1 day') GROUP BY source, spend_date`,
	annotations: `${CTE} SELECT at, label FROM annotations WHERE site_id = ?1 AND at >= ?2 AND at < ?3 ORDER BY at`,
} as const;

type Q = keyof typeof SQL;
type Rec = Record<string, any>;

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
const BROWSER_ICON: Record<string, string> = { Chrome: 'google.com', Safari: 'apple.com', Firefox: 'mozilla.org', Edge: 'microsoft.com', Arc: 'arc.net' };
const OS_ICON: Record<string, string> = { macOS: 'apple.com', iOS: 'apple.com', Windows: 'microsoft.com', Android: 'android.com', Linux: 'kernel.org' };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Builds the full dashboard for one site in a single D1 batch (one round trip). */
export async function queryDashboard(db: D1Database, siteId: string, q: DashboardQuery): Promise<DashboardData> {
	const { n, step } = BUCKETS[q.range];
	const now = q.now ?? Math.floor(Date.now() / 1000);
	// Buckets align to whole hours/days so chart labels are clean; the last bucket is "now".
	const start = Math.floor(now / step) * step - (n - 1) * step;
	const end = start + n * step;
	const prevStart = start - n * step;

	const f = (dim: DashFilter['dim']) => q.filters.find((x) => x.dim === dim)?.value ?? null;
	const [wf, wl] = q.model === 'first' ? [1, 0] : q.model === 'last' ? [0, 1] : [0.5, 0.5];
	const params = (s: number, e: number) => [siteId, s, e, f('source'), f('page'), f('country'), f('device'), wf, wl, step];

	const names = Object.keys(SQL) as Q[];
	const stmts = names.map((k) => db.prepare(SQL[k]).bind(...params(start, end)));
	for (const k of ['totals', 'seriesVisitors', 'seriesRevenue', 'adSpend'] as const) stmts.push(db.prepare(SQL[k]).bind(...params(prevStart, start)));
	const results = await db.batch<Rec>(stmts);
	const r = Object.fromEntries(names.map((k, i) => [k, results[i]!.results])) as Record<Q, Rec[]>;
	const [prevTotals, prevVisitors, prevRevenue, prevAd] = results.slice(names.length).map((x) => x.results);

	// Ad spend: by source and by day. Only a source filter can scope it; other filters can't split ad spend.
	const anyFilter = q.filters.length > 0;
	const sourceFilter = f('source');
	const adBySource = new Map<string, number>();
	const adByBucket = new Array<number>(n).fill(0);
	for (const a of r.adSpend) {
		if (anyFilter && a.k !== sourceFilter) continue;
		adBySource.set(a.k, (adBySource.get(a.k) ?? 0) + a.a);
		const day = Date.parse(`${a.d}T00:00:00Z`) / 1000;
		if (step === DAY) {
			const b = Math.floor((day - start) / DAY);
			if (b >= 0 && b < n) adByBucket[b]! += a.a;
		} else for (let b = 0; b < n; b++) adByBucket[b]! += a.a / 24; // a day's spend spread over its hours
	}
	const adTotal = [...adBySource.values()].reduce((s, x) => s + x, 0);
	const prevAdTotal = (prevAd ?? []).reduce((s, a) => s + (anyFilter && a.k !== sourceFilter ? 0 : a.a), 0);

	const money = (g: number, fee: number, ad = 0) => (q.mode === 'gross' ? g : q.mode === 'net' ? g - fee : g - fee - ad);
	const row = (x: Rec, extra: Partial<DashRow> = {}): DashRow => ({
		key: String(x.k),
		label: String(x.k),
		visitors: Number(x.v ?? 0),
		revenue: money(Number(x.g ?? 0), Number(x.f ?? 0)),
		sales: Number(x.s ?? 0),
		...extra,
	});

	// Sources: traffic by the visit's source, revenue by the model's touch
	const traffic = new Map(r.sourceTraffic.map((x) => [String(x.k), Number(x.v)]));
	const revenue = new Map(r.sourceRevenue.map((x) => [String(x.k), x]));
	const keys = new Set([...traffic.keys(), ...revenue.keys(), ...adBySource.keys()]);
	const sources: DashSource[] = [...keys].map((k) => {
		const rv = revenue.get(k);
		const gross = Number(rv?.g ?? 0);
		const fee = Number(rv?.f ?? 0);
		const ad = adBySource.get(k) ?? 0;
		const cat = classifySourceCategory(k);
		return { key: k, label: k, icon: sourceIcon(k), cat, note: cat, visitors: traffic.get(k) ?? 0, sales: Number(rv?.s ?? 0), gross, fee, ad, revenue: money(gross, fee, ad) };
	});

	const groupMap = new Map<string, DashRow>();
	for (const s of sources) {
		const g = groupMap.get(s.cat) ?? { key: s.cat, label: s.cat, visitors: 0, revenue: 0, sales: 0 };
		g.visitors += s.visitors;
		g.revenue += s.revenue;
		g.sales += s.sales;
		groupMap.set(s.cat, g);
	}

	const t = r.totals[0] ?? {};
	const pt = prevTotals?.[0] ?? {};
	const totals = { visitors: Number(t.v ?? 0), gross: Number(t.g ?? 0), fee: Number(t.f ?? 0), ad: adTotal, revenue: 0, sales: Number(t.s ?? 0) };
	totals.revenue = money(totals.gross, totals.fee, adTotal);

	const fill = (rows: Rec[] | undefined, pick: (x: Rec, b: number) => number) => {
		const out = new Array<number>(n).fill(0);
		for (const x of rows ?? []) if (x.b >= 0 && x.b < n) out[x.b] = pick(x, x.b);
		return out;
	};
	const revSeries = fill(r.seriesRevenue, (x, b) => money(x.g, x.f, adByBucket[b]));
	if (q.mode === 'profit') for (let b = 0; b < n; b++) if (revSeries[b] === 0) revSeries[b] = -adByBucket[b]!; // spend on days without sales

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

	const heat = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
	for (const x of r.heat) heat[x.d]![x.h] = x.s;

	const fu = r.funnel[0] ?? {};
	const geo = (x: Rec) => row(x, { label: countryName(String(x.k)), icon: flagOf(String(x.k)) });

	return {
		live: true,
		totals,
		prev: { visitors: Number(pt.v ?? 0), revenue: money(Number(pt.g ?? 0), Number(pt.f ?? 0), prevAdTotal), sales: Number(pt.s ?? 0) },
		series: {
			n,
			start,
			step,
			visitors: fill(r.seriesVisitors, (x) => x.v),
			revenue: revSeries,
			sales: fill(r.seriesRevenue, (x) => x.s),
			prevVisitors: fill(prevVisitors, (x) => x.v),
			prevRevenue: fill(prevRevenue, (x) => money(x.g, x.f, prevAdTotal / n)), // shortcut: previous-period ad spend is spread evenly across buckets
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
					}),
				),
		annotations: r.annotations.map((x) => ({ at: Number(x.at), label: String(x.label) })),
	};
}
