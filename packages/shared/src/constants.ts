/** AI Crawler User-Agent identifiers */
export const AI_CRAWLER_AGENTS = [
	'GPTBot',
	'OAI-SearchBot',
	'ChatGPT-User',
	'ClaudeBot',
	'PerplexityBot',
	'anthropic-ai',
	'Google-Extended',
	'Bytespider',
	'Applebot-Extended',
	'meta-externalagent',
	'CCBot',
] as const;

/** Source categories for analytics grouping */
export const SOURCE_CATEGORIES = {
	DIRECT: 'Direct',
	ORGANIC_SEARCH: 'Organic Search',
	PAID_SEARCH: 'Paid Search',
	SOCIAL_ORGANIC: 'Social (Organic)',
	SOCIAL_PAID: 'Social (Paid)',
	REFERRAL: 'Referral',
	EMAIL: 'Email',
	AI_SEARCH: 'AI Search',
	AI_CRAWLER: 'AI Crawler',
	MIXED: 'Mixed',
} as const;

/** Payment gateway identifiers */
export const PAYMENT_GATEWAYS = ['stripe', 'razorpay', 'polar', 'paddle', 'lemonsqueezy', 'gumroad', 'paypal', 'cashfree', 'revenuecat'] as const;

/** Visitor presence TTL (milliseconds) */
export const PRESENCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
