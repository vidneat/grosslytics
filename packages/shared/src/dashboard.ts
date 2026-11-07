/**
 * The dashboard contract: one response feeds every panel. Produced by the edge API
 * (`GET /api/stats/dashboard`) and by the marketing-site demo, consumed by the dashboard island.
 * Money is in cents; `revenue` is already in the requested mode (gross, net or profit).
 */

export type DashRange = '24h' | '7d' | '30d' | '90d';
export type DashModel = 'first' | 'last' | 'linear';
export type DashMode = 'gross' | 'net' | 'profit';
export type DashDimension = 'source' | 'page' | 'country' | 'device';
export interface DashFilter {
	dim: DashDimension;
	value: string;
}

export interface DashRow {
	key: string;
	label: string;
	/** Domain for a favicon, an emoji flag, or '@desktop' style glyph keys */
	icon?: string;
	visitors: number;
	revenue: number;
	sales: number;
	note?: string;
}

export interface DashSource extends DashRow {
	cat: string;
	gross: number;
	fee: number;
	ad: number;
}

export interface DashSale {
	currency?: string;
	id: string;
	email: string;
	plan: string;
	gross: number;
	fee: number;
	gateway: string;
	country: string;
	city: string;
	/** Unix seconds */
	at: number;
	first: string;
	last: string;
	visitorId?: string;
	/** Hours from first visit to payment */
	hours: number;
	renewal: boolean;
	/** Fully refunded: listed in recent sales, excluded from revenue */
	refunded?: boolean;
}

export interface DashboardData {
	live: boolean;
	currency: string;
	/** IANA zone the buckets, heatmap and labels use */
	timezone: string;
	/** Historical payments retained in their original currency, excluded from reporting totals. */
	excludedCurrencies: string[];
	/** Spend is only attributable to a source, not a page/country/device cohort. */
	adSpendAvailable: boolean;
	totals: { visitors: number; gross: number; fee: number; ad: number; revenue: number; sales: number };
	prev: { visitors: number; revenue: number; sales: number };
	/** Buckets of `step` seconds starting at `start` (hours for 24h, days otherwise) */
	series: {
		n: number;
		start: number;
		step: number;
		visitors: number[];
		revenue: number[];
		sales: number[];
		prevVisitors: number[];
		prevRevenue: number[];
		prevSales: number[];
	};
	sources: DashSource[];
	groups: DashRow[];
	campaigns: DashRow[];
	pages: DashRow[];
	entry: DashRow[];
	exit: DashRow[];
	countries: DashRow[];
	cities: DashRow[];
	devices: DashRow[];
	browsers: DashRow[];
	oses: DashRow[];
	behaviour: Array<{ label: string; buyers: string; others: string }>;
	/** 7 x 24 sales counts, Monday first, site-local hours */
	heat: number[][];
	/** Same grid for refunds, at the hour the refund happened. */
	heatRefunds: number[][];
	funnel: Array<{ label: string; count: number }>;
	timeToConvert: Array<{ label: string; share: number }>;
	ltv: Array<{ key: string; icon: string; ltv: number; customers: number }>;
	direct: Array<{ key: string; icon: string; share: number }>;
	sales: DashSale[];
	annotations: Array<{ at: number; label: string }>;
}

/** 'x.com (in-app)' -> 'x.com'; Direct and Unattributed have no favicon. */
export function sourceIcon(source: string): string {
	if (/^(direct|unattributed)/i.test(source)) return '';
	return source.replace(/\s*\(.*\)$/, '');
}

/** Readable duration: 252 -> '4m 12s' */
export function formatDuration(sec: number): string {
	const s = Math.round(sec);
	return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
