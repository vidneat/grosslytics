import * as v from 'valibot';

/** Beacon payload schema - validates tracker data at the edge in <0.3ms */
export const BeaconSchema = v.object({
	sid: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
	vid: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
	ses: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
	t: v.picklist(['pageview', 'leave', 'goal', 'ai_crawl']),
	n: v.pipe(v.string(), v.minLength(1), v.maxLength(2048)),
	src: v.pipe(v.string(), v.maxLength(512)),
	cat: v.pipe(v.string(), v.maxLength(128)),
	ref: v.pipe(v.string(), v.maxLength(2048)),
	sd: v.pipe(v.number(), v.minValue(0), v.maxValue(100), v.integer()),
	dur: v.pipe(v.number(), v.minValue(0), v.maxValue(86400), v.integer()),
	us: v.optional(v.pipe(v.string(), v.maxLength(256))),
	um: v.optional(v.pipe(v.string(), v.maxLength(256))),
	uc: v.optional(v.pipe(v.string(), v.maxLength(256))),
	meta: v.optional(v.pipe(v.string(), v.maxLength(4096))),
});

export type ValidatedBeacon = v.InferOutput<typeof BeaconSchema>;

/** Site configuration schema */
export const SiteConfigSchema = v.object({
	siteId: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
	domain: v.pipe(v.string(), v.minLength(1), v.maxLength(255)),
	name: v.pipe(v.string(), v.minLength(1), v.maxLength(255)),
	timezone: v.optional(v.string(), 'UTC'),
	currency: v.optional(v.pipe(v.string(), v.length(3)), 'USD'),
	publicShareEnabled: v.optional(v.boolean(), false),
	cnameProxyDomain: v.optional(v.pipe(v.string(), v.maxLength(255))),
});

/** Dashboard query params schema */
export const DashboardQuerySchema = v.object({
	siteId: v.pipe(v.string(), v.minLength(1)),
	range: v.optional(v.picklist(['24h', '7d', '30d', '90d', 'custom']), '30d'),
	start: v.optional(v.pipe(v.string(), v.isoTimestamp())),
	end: v.optional(v.pipe(v.string(), v.isoTimestamp())),
	model: v.optional(v.picklist(['first', 'last', 'linear']), 'first'),
	revenue: v.optional(v.picklist(['gross', 'net', 'profit']), 'net'),
});

/** Stripe webhook body schema (minimal fields we need) */
export const StripeWebhookEventSchema = v.object({
	id: v.pipe(v.string(), v.startsWith('evt_')),
	type: v.string(),
	data: v.object({
		object: v.record(v.string(), v.unknown()),
	}),
});

/** Payment upsert schema for webhook processing */
export const PaymentUpsertSchema = v.object({
	paymentId: v.pipe(v.string(), v.minLength(1)),
	siteId: v.pipe(v.string(), v.minLength(1)),
	gateway: v.picklist(['stripe', 'razorpay', 'polar', 'paddle', 'lemonsqueezy']),
	visitorId: v.optional(v.string()),
	customerEmailHash: v.optional(v.string()),
	customerEmailMasked: v.optional(v.string()),
	planName: v.optional(v.string()),
	grossAmountCents: v.pipe(v.number(), v.integer(), v.minValue(0)),
	feeAmountCents: v.pipe(v.number(), v.integer(), v.minValue(0)),
	netAmountCents: v.pipe(v.number(), v.integer()),
	currency: v.pipe(v.string(), v.length(3)),
	status: v.picklist(['succeeded', 'refunded']),
	isRenewal: v.boolean(),
});

/** Goal event schema for custom goal tracking */
export const GoalEventSchema = v.object({
	sid: v.pipe(v.string(), v.minLength(1)),
	vid: v.pipe(v.string(), v.minLength(1)),
	name: v.pipe(v.string(), v.minLength(1), v.maxLength(256)),
	value: v.optional(v.number()),
	meta: v.optional(v.record(v.string(), v.unknown())),
});
