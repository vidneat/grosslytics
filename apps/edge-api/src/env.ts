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
}

