import type { EnrichedEvent } from '@grosslytics/shared/types';

export interface Bindings {
	DB: D1Database;
	INGEST_QUEUE: Queue<EnrichedEvent>;
	SITE_LIVE_HUB: DurableObjectNamespace;
	ENVIRONMENT?: string;
	TRACKER_ORIGIN?: string;
	STRIPE_WEBHOOK_SECRET?: string;
	RAZORPAY_WEBHOOK_SECRET?: string;
	POLAR_WEBHOOK_SECRET?: string;
	PADDLE_WEBHOOK_SECRET?: string;
	LEMONSQUEEZY_WEBHOOK_SECRET?: string;
	/** Bearer token for /api/stats and /api/mcp (`wrangler secret put API_TOKEN`) */
	API_TOKEN?: string;
	/** "1" turns on Hosted Cloud: customer signup, per-account sites, the event cap and Stripe billing */
	CLOUD?: string;
	/** Signing secret of the Stripe webhook for Grosslytics' own subscriptions (not a customer's payments) */
	STRIPE_BILLING_WEBHOOK_SECRET?: string;
	/** Lifetime licenses (operator only): HMAC key that derives each license key from its Stripe checkout session */
	LICENSE_SECRET?: string;
	/** Optional: only checkouts from this Payment Link (plink_…) mint a license */
	LIFETIME_PAYMENT_LINK_ID?: string;
	/** R2 bucket holding the installer's release bundle, `latest.tgz` (scripts/release.ts) */
	RELEASES?: R2Bucket;
	/** Workers Rate Limiting binding for /api/waitlist */
	WAITLIST_LIMITER?: { limit(o: { key: string }): Promise<{ success: boolean }> };
}

