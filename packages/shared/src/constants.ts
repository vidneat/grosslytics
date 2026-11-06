/** AI Search engine referrer domains and their display labels */
export const AI_SEARCH_ENGINES = {
	'chatgpt.com': 'ChatGPT (AI)',
	'perplexity.ai': 'Perplexity (AI)',
	'claude.ai': 'Claude (AI)',
	'gemini.google.com': 'Google Gemini (AI)',
	'copilot.microsoft.com': 'Microsoft Copilot (AI)',
	'you.com': 'You.com (AI)',
	'phind.com': 'Phind (AI)',
	'kagi.com': 'Kagi (AI)',
} as const;

/** In-App WebView User-Agent patterns for unmasking "fake Direct" traffic */
export const IN_APP_WEBVIEW_PATTERNS: ReadonlyArray<{ pattern: RegExp; source: string }> = [
	{ pattern: /Instagram/i, source: 'instagram.com (in-app)' },
	{ pattern: /FBAN|FBAV/i, source: 'facebook.com (in-app)' },
	{ pattern: /LinkedInApp/i, source: 'linkedin.com (in-app)' },
	{ pattern: /BytedanceWebview|musical_ly/i, source: 'tiktok.com (in-app)' },
	{ pattern: /Telegram/i, source: 'telegram.org (in-app)' },
	{ pattern: /Twitter|X-Client/i, source: 'x.com (in-app)' },
] as const;

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
} as const;

/** Payment gateway identifiers */
export const PAYMENT_GATEWAYS = ['stripe', 'razorpay', 'polar', 'paddle', 'lemonsqueezy'] as const;

/** Default tracker script filename */
export const TRACKER_FILENAME = 'g.js';

/** Max events per queue batch */
export const QUEUE_MAX_BATCH_SIZE = 100;

/** Queue consumer max wait (seconds) */
export const QUEUE_MAX_BATCH_TIMEOUT = 1;

/** Visitor presence TTL (milliseconds) */
export const PRESENCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Hour bucket size in seconds */
export const HOUR_BUCKET_SECONDS = 3600;
