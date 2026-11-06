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
export function classifySourceCategory(source: string): string {
	const lower = source.toLowerCase();

	if (lower.includes('(ai)')) return 'AI Search';
	if (lower.includes('ai_crawl')) return 'AI Crawler';
	if (lower.includes('(in-app)')) return 'Social (Organic)';
	if (lower.startsWith('direct')) return 'Direct';

	// Search engines
	const searchEngines = ['google.', 'bing.', 'duckduckgo.', 'yahoo.', 'baidu.', 'yandex.'];
	if (searchEngines.some((se) => lower.includes(se))) return 'Organic Search';

	// Social platforms
	const socialPlatforms = [
		'twitter.com',
		'x.com',
		'facebook.com',
		'linkedin.com',
		'reddit.com',
		'youtube.com',
		'instagram.com',
		'tiktok.com',
		'threads.net',
		'mastodon.',
		'bsky.app',
	];
	if (socialPlatforms.some((sp) => lower.includes(sp))) return 'Social (Organic)';

	return 'Referral';
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

/**
 * Converts a date range string to start/end unix timestamps.
 */
export function dateRangeToTimestamps(
	range: '24h' | '7d' | '30d' | '90d',
	now?: number,
): { start: number; end: number } {
	const end = now ?? Math.floor(Date.now() / 1000);
	const durations: Record<string, number> = {
		'24h': 24 * 3600,
		'7d': 7 * 24 * 3600,
		'30d': 30 * 24 * 3600,
		'90d': 90 * 24 * 3600,
	};
	const duration = durations[range] ?? durations['30d'] ?? 30 * 24 * 3600;
	return { start: end - duration, end };
}
