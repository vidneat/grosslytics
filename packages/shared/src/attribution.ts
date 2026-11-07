// Types used by consumers of these utilities
// import type { AttributionModel, ChannelStats } from './types.js';

/**
 * Calculates Revenue Per Visitor (RPV) for a channel.
 * RPV = DisplayedRevenue / UniqueVisitors
 *
 * @param revenueCents - Revenue in cents (could be gross, net, or profit depending on mode)
 * @param visitors - Number of unique visitors attributed to the channel
 * @returns RPV in cents, or 0 if no visitors
 */
export function calculateRPV(revenueCents: number, visitors: number): number {
	if (visitors === 0) return 0;
	return Math.round(revenueCents / visitors);
}

/**
 * Splits a payment's revenue between first-touch and last-touch sources
 * using the Linear attribution model (50/50 split).
 *
 * NetProfit(c) = (Σ 0.5 * (G_i - F_i) for first-touch) + (Σ 0.5 * (G_j - F_j) for last-touch) - AdSpend(c)
 */
export function linearSplitPayment(
	grossCents: number,
	feeCents: number,
): { firstTouchShare: number; lastTouchShare: number } {
	const netCents = grossCents - feeCents;
	const half = Math.round(netCents / 2);
	return {
		firstTouchShare: half,
		lastTouchShare: netCents - half, // Handles odd cent rounding
	};
}

/**
 * Calculates True Net Profit for a channel.
 * True Profit = Net Revenue (after gateway fees) - Ad Spend
 */
export function calculateTrueProfit(netRevenueCents: number, adSpendCents: number): number {
	return netRevenueCents - adSpendCents;
}

/**
 * Computes time-to-convert in hours from first visit to payment.
 */
export function timeToConvertHours(firstSeenAt: number, paymentAt: number): number {
	const diffSec = paymentAt - firstSeenAt; // both are unix epoch seconds
	return Math.round((diffSec / 3600) * 10) / 10; // 1 decimal place
}

/**
 * Classifies a referrer domain into a source category.
 */
export const SEARCH_SOURCES = ['google', 'bing', 'duckduckgo', 'yahoo', 'baidu', 'yandex'];
export const SOCIAL_SOURCES = [
	'twitter',
	'x',
	'facebook',
	'linkedin',
	'reddit',
	'youtube',
	'instagram',
	'tiktok',
	'threads',
	'mastodon',
	'bsky',
];

export function classifySourceCategory(source: string, medium = '', reported = ''): string {
	const lower = source.toLowerCase();
	const social =
		lower.includes('(in-app)') ||
		SOCIAL_SOURCES.some((name) => lower === name || lower.includes(`${name}.`));
	if (/^(email|e-mail|newsletter)$/i.test(medium) || reported === 'Email') return 'Email';
	if (/^(cpc|ppc|cpm|paid|paid[_ -]?(search|social)|display|retargeting)$/i.test(medium)) {
		return social || /social/i.test(medium) ? 'Social (Paid)' : 'Paid Search';
	}
	if (reported === 'Paid Search' || reported === 'Social (Paid)') return reported;
	if (lower.includes('(ai)')) return 'AI Search';
	if (lower.includes('ai_crawl')) return 'AI Crawler';
	if (social) return 'Social (Organic)';
	if (lower.startsWith('direct')) return 'Direct';
	if (SEARCH_SOURCES.some((name) => lower === name || lower.includes(`${name}.`)))
		return 'Organic Search';
	return 'Referral';
}

/** Preserve classification and UTM data with each event; custom metadata is kept verbatim. */
export function eventAttribution(event: {
	src: string;
	cat: string;
	us?: string;
	um?: string;
	uc?: string;
	meta?: string;
}) {
	const category = classifySourceCategory(event.src, event.um, event.cat);
	return {
		category,
		meta: JSON.stringify({
			_grosslytics: {
				category,
				utm_source: event.us,
				utm_medium: event.um,
				utm_campaign: event.uc,
			},
			custom: event.meta ?? null,
		}),
	};
}

/**
 * Generates a daily-rotating salt key for privacy-preserving visitor ID hashing.
 * Format: "grosslytics:salt:YYYY-MM-DD"
 */
export function getDailySaltKey(date?: Date): string {
	const d = date ?? new Date();
	const yyyy = d.getUTCFullYear();
	const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(d.getUTCDate()).padStart(2, '0');
	return `grosslytics:salt:${yyyy}-${mm}-${dd}`;
}

/**
 * Truncates a unix timestamp to the nearest hour bucket.
 * hour_bucket = ts - (ts % 3600)
 */
export function toHourBucket(unixEpochSeconds: number): number {
	return unixEpochSeconds - (unixEpochSeconds % 3600);
}

/** Seconds the IANA zone is ahead of UTC at `atSec` (e.g. Asia/Kolkata → 19800). Unknown zones count as UTC. */
export function tzOffsetSec(timeZone: string, atSec = Math.floor(Date.now() / 1000)): number {
	try {
		const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(atSec * 1000);
		const p = Object.fromEntries(parts.map((x) => [x.type, Number(x.value)]));
		return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) / 1000 - atSec;
	} catch {
		return 0;
	}
}

/** True for an IANA zone name this runtime knows. */
export const isTimeZone = (tz: string) => {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz });
		return true;
	} catch {
		return false;
	}
};

/**
 * Same calendar buckets in the dashboard, channel API and MCP, aligned to the site's local midnight/hour. End is exclusive.
 * shortcut: one fixed offset (the zone's offset now) for the whole range, so days before a DST change are off by an hour; switch to per-day boundaries if users report it.
 */
export function dateRangeToTimestamps(
	range: '24h' | '7d' | '30d' | '90d',
	now = Math.floor(Date.now() / 1000),
	offsetSec = 0,
): { start: number; end: number; step: number; n: number } {
	const n = range === '24h' ? 24 : range === '7d' ? 7 : range === '90d' ? 90 : 30;
	const step = range === '24h' ? 3600 : 86400;
	const end = Math.floor((now + offsetSec) / step) * step + step - offsetSec;
	return { start: end - n * step, end, step, n };
}
