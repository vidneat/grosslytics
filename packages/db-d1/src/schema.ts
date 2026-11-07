import { sql } from 'drizzle-orm';
import { integer, primaryKey, sqliteTable, text, index } from 'drizzle-orm/sqlite-core';

// ─────────────────────────────────────────────────────────────────────────────
// 1. SITES: one row per tracked website (webhook secrets live in site_secrets)
// ─────────────────────────────────────────────────────────────────────────────
export const sites = sqliteTable('sites', {
	siteId: text('site_id').primaryKey(),
	domain: text('domain').notNull(),
	name: text('name').notNull(),
	timezone: text('timezone').default('UTC'),
	currency: text('currency').default('USD'),
	publicShareEnabled: integer('public_share_enabled').default(0),
	createdAt: integer('created_at').default(sql`(unixepoch())`),
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. VISITORS: First-Touch & Last-Touch Identity Graph
// ─────────────────────────────────────────────────────────────────────────────
export const visitors = sqliteTable(
	'visitors',
	{
		siteId: text('site_id').notNull(),
		visitorId: text('visitor_id').notNull(),
		customerEmailHash: text('customer_email_hash'),

		// Immutable First-Touch Attribution (Discovery)
		firstSeenAt: integer('first_seen_at').notNull(),
		firstSource: text('first_source').notNull().default('Direct (Typed/Bookmark)'),
		firstCategory: text('first_category').notNull().default('Direct'),
		firstUtmSource: text('first_utm_source'),
		firstUtmMedium: text('first_utm_medium'),
		firstUtmCampaign: text('first_utm_campaign'),
		firstLandingPage: text('first_landing_page'),

		// Mutable Last-Touch Attribution (Closer)
		lastSeenAt: integer('last_seen_at').notNull(),
		lastSource: text('last_source').notNull().default('Direct (Typed/Bookmark)'),
		lastCategory: text('last_category').notNull().default('Direct'),
		lastUtmSource: text('last_utm_source'),
		lastUtmCampaign: text('last_utm_campaign'),

		// Edge Geo & Device Fingerprint
		country: text('country').default('XX'),
		city: text('city'),
		deviceType: text('device_type').default('desktop'),
		os: text('os'),
		browser: text('browser'),
		totalSessions: integer('total_sessions').default(1),
		totalActiveReadSec: integer('total_active_read_sec').default(0),
		maxScrollPct: integer('max_scroll_pct').default(0),
	},
	(table) => [
		primaryKey({ columns: [table.siteId, table.visitorId] }),
		index('idx_visitors_email').on(table.siteId, table.customerEmailHash),
		index('idx_visitors_first_seen').on(table.siteId, table.firstSeenAt, table.firstSource),
	],
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. HOURLY_ROLLUPS: Pre-aggregated time-series for <5ms dashboard queries
// ─────────────────────────────────────────────────────────────────────────────
export const hourlyRollups = sqliteTable(
	'hourly_rollups',
	{
		siteId: text('site_id').notNull(),
		hourBucket: integer('hour_bucket').notNull(),
		source: text('source').notNull(),
		category: text('category').notNull(),
		landingPage: text('landing_page').notNull(),
		country: text('country').notNull(),
		visitorsCount: integer('visitors_count').default(0),
		sessionsCount: integer('sessions_count').default(0),
		pageviewsCount: integer('pageviews_count').default(0),
		activeReadSecSum: integer('active_read_sec_sum').default(0),
		scrollPctSum: integer('scroll_pct_sum').default(0),
	},
	(table) => [
		primaryKey({
			columns: [table.siteId, table.hourBucket, table.source, table.landingPage, table.country],
		}),
	],
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. EVENTS: Granular events for Buyer Journey Inspector & AI Crawl Logs
// ─────────────────────────────────────────────────────────────────────────────
export const events = sqliteTable(
	'events',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		siteId: text('site_id').notNull(),
		visitorId: text('visitor_id').notNull(),
		sessionId: text('session_id').notNull(),
		eventType: text('event_type').notNull(),
		eventName: text('event_name').notNull(),
		source: text('source').notNull(),
		referrer: text('referrer'),
		scrollDepth: integer('scroll_depth').default(0),
		durationSec: integer('duration_sec').default(0),
		metaJson: text('meta_json'),
		createdAt: integer('created_at').default(sql`(unixepoch())`),
	},
	(table) => [
		index('idx_events_visitor_journey').on(table.siteId, table.visitorId, table.createdAt),
		index('idx_events_site_time').on(table.siteId, table.createdAt),
	],
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. PAYMENTS: Idempotent Multi-Touch Revenue & LTV Ledger
// ─────────────────────────────────────────────────────────────────────────────
export const payments = sqliteTable(
	'payments',
	{
		paymentId: text('payment_id').primaryKey(),
		siteId: text('site_id').notNull(),
		gateway: text('gateway').notNull(),
		visitorId: text('visitor_id'),
		customerEmailHash: text('customer_email_hash'),
		customerEmailMasked: text('customer_email_masked'),
		planName: text('plan_name'),

		grossAmountCents: integer('gross_amount_cents').notNull(),
		feeAmountCents: integer('fee_amount_cents').notNull().default(0),
		netAmountCents: integer('net_amount_cents').notNull(),
		currency: text('currency').notNull().default('usd'),

		status: text('status').notNull(),
		isRenewal: integer('is_renewal').notNull().default(0),

		// Denormalized Attribution Snapshot at Purchase Time
		firstTouchSource: text('first_touch_source').notNull().default('Unattributed'),
		lastTouchSource: text('last_touch_source').notNull().default('Unattributed'),
		country: text('country').default('🌍'),
		city: text('city'),
		timeToConvertHours: integer('time_to_convert_hours').default(0),
		buyerReadSec: integer('buyer_read_sec').default(0),
		buyerScrollPct: integer('buyer_scroll_pct').default(0),
		createdAt: integer('created_at').default(sql`(unixepoch())`),
	},
	(table) => [
		index('idx_payments_site_created').on(table.siteId, table.createdAt, table.status),
		index('idx_payments_ltv').on(table.siteId, table.firstTouchSource, table.createdAt),
	],
);

// ─────────────────────────────────────────────────────────────────────────────
// 6. AD_SPEND: Daily channel ad spend for True Net Profit
// ─────────────────────────────────────────────────────────────────────────────
export const adSpend = sqliteTable(
	'ad_spend',
	{
		siteId: text('site_id').notNull(),
		source: text('source').notNull(),
		spendDate: text('spend_date').notNull(),
		amountCents: integer('amount_cents').notNull(),
	},
	(table) => [primaryKey({ columns: [table.siteId, table.source, table.spendDate] })],
);

// ─────────────────────────────────────────────────────────────────────────────
// 7. WEBHOOK_DEDUP_LOG: Prevents double-counting on gateway retries
// ─────────────────────────────────────────────────────────────────────────────
export const webhookDedupLog = sqliteTable('webhook_dedup_log', {
	webhookEventId: text('webhook_event_id').primaryKey(),
	siteId: text('site_id').notNull(),
	processedAt: integer('processed_at').default(sql`(unixepoch())`),
});

