import type { PAYMENT_GATEWAYS, SOURCE_CATEGORIES } from './constants.js';

/** Core event types */
export type EventType = 'pageview' | 'leave' | 'goal' | 'ai_crawl';

/** Payment gateway identifiers */
export type PaymentGateway = (typeof PAYMENT_GATEWAYS)[number];

/** Source category identifiers */
export type SourceCategory = (typeof SOURCE_CATEGORIES)[keyof typeof SOURCE_CATEGORIES];

/** Attribution model identifiers */
export type AttributionModel = 'first' | 'last' | 'linear';

/** Device type classification */
export type DeviceType = 'desktop' | 'mobile' | 'tablet';

/** Payment status */
export type PaymentStatus = 'succeeded' | 'refunded';

/** Beacon payload sent from the tracker (g.js) to POST /api/collect */
export interface BeaconPayload {
	/** Site identifier */
	sid: string;
	/** Visitor identifier */
	vid: string;
	/** Session identifier */
	ses: string;
	/** Event type */
	t: EventType;
	/** Event name (page path or goal name) */
	n: string;
	/** Detected source */
	src: string;
	/** Source category */
	cat: string;
	/** Document referrer */
	ref: string;
	/** Max scroll depth percentage (0-100) */
	sd: number;
	/** Active reading duration in seconds */
	dur: number;
	/** UTM source */
	us?: string;
	/** UTM medium */
	um?: string;
	/** UTM campaign */
	uc?: string;
	/** Custom metadata JSON */
	meta?: string;
}

/** Enriched event after edge worker processing */
export interface EnrichedEvent extends BeaconPayload {
	/** Country code from request.cf */
	country: string;
	/** City from request.cf */
	city: string;
	/** Colo (Cloudflare data center) */
	colo: string;
	/** ASN organization */
	asOrganization: string;
	/** Device type */
	deviceType: DeviceType;
	/** Operating system */
	os: string;
	/** Browser name */
	browser: string;
	/** Unix timestamp */
	createdAt: number;
}

/** Channel stats returned by the dashboard API */
export interface ChannelStats {
	source: string;
	category: SourceCategory;
	visitors: number;
	sessions: number;
	pageviews: number;
	avgReadSec: number;
	avgScrollPct: number;
	/** Revenue figures (attribution-model-dependent) */
	grossRevenueCents: number;
	feesCents: number;
	netRevenueCents: number;
	adSpendCents: number;
	trueProfitCents: number;
	conversions: number;
	/** Revenue Per Visitor in cents */
	rpvCents: number;
}

/** Real-time presence data broadcast via Durable Object WebSocket */
export interface LivePresenceUpdate {
	type: 'presence';
	onlineVisitors: number;
	recentVisitors: Array<{
		visitorId: string;
		page: string;
		source: string;
		country: string;
		city: string;
		timestamp: number;
	}>;
}

/** Real-time sale notification broadcast via Durable Object WebSocket */
export interface LiveSaleUpdate {
	type: 'sale';
	gateway: PaymentGateway;
	grossAmountCents: number;
	netAmountCents: number;
	currency: string;
	customerEmailMasked: string;
	planName: string;
	firstTouchSource: string;
	lastTouchSource: string;
	country: string;
	isRenewal: boolean;
	timestamp: number;
}

/** Union type for all WebSocket messages */
export type LiveUpdate = LivePresenceUpdate | LiveSaleUpdate;

/** Dashboard filter state shared across Astro Islands via Nanostores */
export interface DashboardFilterState {
	siteId: string;
	dateRange: '24h' | '7d' | '30d' | '90d' | 'custom';
	customStart?: string;
	customEnd?: string;
	attributionModel: AttributionModel;
	revenueMode: 'gross' | 'net' | 'profit';
	selectedSources?: string[];
	selectedCountries?: string[];
}

/** Unified StorageAdapter interface for dual-engine support */
export interface AnalyticsStorageAdapter {
	/** Batch insert enriched events (called by queue consumer) */
	insertEventBatch(events: EnrichedEvent[]): Promise<void>;
	/** Upsert visitor first/last touch attribution */
	upsertVisitor(event: EnrichedEvent): Promise<void>;
	/** Upsert hourly rollup counters */
	upsertHourlyRollup(events: EnrichedEvent[]): Promise<void>;
	/** Insert or deduplicate a payment */
	upsertPayment(payment: PaymentRecord): Promise<boolean>;
	/** Check webhook dedup log */
	isWebhookProcessed(webhookEventId: string): Promise<boolean>;
	/** Claim a webhook event ID; false if it was already processed */
	markWebhookProcessed(webhookEventId: string, siteId: string): Promise<boolean>;
	/** Query channel stats for dashboard */
	queryChannelStats(
		siteId: string,
		startTime: number,
		endTime: number,
		model: AttributionModel,
	): Promise<ChannelStats[]>;
	/** Get buyer journey for a specific visitor */
	getBuyerJourney(siteId: string, visitorId: string): Promise<BuyerJourneyEvent[]>;
}

/** Payment record for upsert */
export interface PaymentRecord {
	paymentId: string;
	siteId: string;
	gateway: PaymentGateway;
	visitorId?: string;
	customerEmailHash?: string;
	customerEmailMasked?: string;
	planName?: string;
	grossAmountCents: number;
	feeAmountCents: number;
	netAmountCents: number;
	currency: string;
	status: PaymentStatus;
	isRenewal: boolean;
	firstTouchSource: string;
	lastTouchSource: string;
	country: string;
	city?: string;
	timeToConvertHours: number;
	buyerReadSec: number;
	buyerScrollPct: number;
}

/** Buyer journey event for the journey inspector */
export interface BuyerJourneyEvent {
	eventType: EventType;
	eventName: string;
	source: string;
	timestamp: number;
	durationSec: number;
	scrollDepth: number;
}

