import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import {
	toHourBucket,
	classifySourceCategory,
	calculateRPV,
	calculateTrueProfit,
} from '@grosslytics/shared/attribution';
import type {
	AnalyticsStorageAdapter,
	EnrichedEvent,
	PaymentRecord,
	ChannelStats,
	BuyerJourneyEvent,
	AttributionModel,
} from '@grosslytics/shared/types';
import * as schema from './schema.js';

/**
 * D1StorageAdapter — Cloudflare D1 (SQLite WAL) implementation of AnalyticsStorageAdapter.
 *
 * Optimized for the Write-Behind Batch Ingestion pattern:
 * - Uses `db.batch([...])` for single-transaction multi-statement writes
 * - Pre-aggregates into hourly_rollups for <5ms dashboard queries
 * - Implements idempotent payment upserts with webhook dedup
 */
export class D1StorageAdapter implements AnalyticsStorageAdapter {
	private db: DrizzleD1Database<typeof schema>;

	constructor(d1: D1Database) {
		this.db = drizzle(d1, { schema });
	}

	/**
	 * Batch insert enriched events from the queue consumer.
	 * Called with 100-500 events per batch for 99% write op reduction.
	 */
	async insertEventBatch(enrichedEvents: EnrichedEvent[]): Promise<void> {
		if (enrichedEvents.length === 0) return;

		const stmts = enrichedEvents.map((e) =>
			this.db.insert(schema.events).values({
				siteId: e.sid,
				visitorId: e.vid,
				sessionId: e.ses,
				eventType: e.t,
				eventName: e.n,
				source: e.src,
				referrer: e.ref || null,
				scrollDepth: e.sd,
				durationSec: e.dur,
				metaJson: e.meta ?? null,
				createdAt: e.createdAt,
			}),
		);

		// D1 batch: single round-trip, single transaction
		await this.db.batch(stmts as [typeof stmts[0], ...typeof stmts]);
	}

	/**
	 * Upsert visitor first/last touch attribution.
	 * First-touch fields are immutable (INSERT ... ON CONFLICT DO UPDATE preserves them).
	 * Last-touch fields are always overwritten.
	 */
	async upsertVisitor(event: EnrichedEvent): Promise<void> {
		const now = event.createdAt;
		const category = classifySourceCategory(event.src);

		await this.db
			.insert(schema.visitors)
			.values({
				siteId: event.sid,
				visitorId: event.vid,
				firstSeenAt: now,
				firstSource: event.src,
				firstCategory: category,
				firstUtmSource: event.us ?? null,
				firstUtmMedium: event.um ?? null,
				firstUtmCampaign: event.uc ?? null,
				firstLandingPage: event.n,
				lastSeenAt: now,
				lastSource: event.src,
				lastCategory: category,
				lastUtmSource: event.us ?? null,
				lastUtmCampaign: event.uc ?? null,
				country: event.country,
				city: event.city,
				deviceType: event.deviceType,
				os: event.os,
				browser: event.browser,
				totalSessions: 1,
				totalActiveReadSec: event.dur,
				maxScrollPct: event.sd,
			})
			.onConflictDoUpdate({
				target: [schema.visitors.siteId, schema.visitors.visitorId],
				set: {
					// Last-touch always updated
					lastSeenAt: now,
					lastSource: event.src,
					lastCategory: category,
					lastUtmSource: event.us ?? null,
					lastUtmCampaign: event.uc ?? null,
					// Accumulate engagement
					totalSessions: sql`total_sessions + 1`,
					totalActiveReadSec: sql`total_active_read_sec + ${event.dur}`,
					maxScrollPct: sql`MAX(max_scroll_pct, ${event.sd})`,
					// Keep latest geo
					country: event.country,
					city: event.city,
				},
			});
	}

	/**
	 * Upsert hourly rollup counters from a batch of events.
	 * Groups events by (site_id, hour_bucket, source, landing_page, country)
	 * and applies atomic counter increments.
	 */
	async upsertHourlyRollup(enrichedEvents: EnrichedEvent[]): Promise<void> {
		if (enrichedEvents.length === 0) return;

		// Group events by rollup key
		const groups = new Map<
			string,
			{
				siteId: string;
				hourBucket: number;
				source: string;
				category: string;
				landingPage: string;
				country: string;
				visitors: Set<string>;
				sessions: Set<string>;
				pageviews: number;
				readSecSum: number;
				scrollPctSum: number;
			}
		>();

		for (const e of enrichedEvents) {
			const hourBucket = toHourBucket(e.createdAt);
			const category = classifySourceCategory(e.src);
			const key = `${e.sid}:${hourBucket}:${e.src}:${e.n}:${e.country}`;

			let group = groups.get(key);
			if (!group) {
				group = {
					siteId: e.sid,
					hourBucket,
					source: e.src,
					category,
					landingPage: e.n,
					country: e.country,
					visitors: new Set(),
					sessions: new Set(),
					pageviews: 0,
					readSecSum: 0,
					scrollPctSum: 0,
				};
				groups.set(key, group);
			}

			group.visitors.add(e.vid);
			group.sessions.add(e.ses);
			group.pageviews += e.t === 'pageview' ? 1 : 0;
			group.readSecSum += e.dur;
			group.scrollPctSum += e.sd;
		}

		const stmts = Array.from(groups.values()).map((g) =>
			this.db
				.insert(schema.hourlyRollups)
				.values({
					siteId: g.siteId,
					hourBucket: g.hourBucket,
					source: g.source,
					category: g.category,
					landingPage: g.landingPage,
					country: g.country,
					visitorsCount: g.visitors.size,
					sessionsCount: g.sessions.size,
					pageviewsCount: g.pageviews,
					activeReadSecSum: g.readSecSum,
					scrollPctSum: g.scrollPctSum,
				})
				.onConflictDoUpdate({
					target: [
						schema.hourlyRollups.siteId,
						schema.hourlyRollups.hourBucket,
						schema.hourlyRollups.source,
						schema.hourlyRollups.landingPage,
						schema.hourlyRollups.country,
					],
					set: {
						visitorsCount: sql`visitors_count + ${g.visitors.size}`,
						sessionsCount: sql`sessions_count + ${g.sessions.size}`,
						pageviewsCount: sql`pageviews_count + ${g.pageviews}`,
						activeReadSecSum: sql`active_read_sec_sum + ${g.readSecSum}`,
						scrollPctSum: sql`scroll_pct_sum + ${g.scrollPctSum}`,
					},
				}),
		);

		if (stmts.length > 0) {
			await this.db.batch(stmts as [typeof stmts[0], ...typeof stmts]);
		}
	}

	/**
	 * Idempotent payment upsert with ON CONFLICT(payment_id) DO UPDATE.
	 * Returns true if a new payment was inserted, false if it was a duplicate update.
	 */
	async upsertPayment(payment: PaymentRecord): Promise<boolean> {
		const result = await this.db
			.insert(schema.payments)
			.values({
				paymentId: payment.paymentId,
				siteId: payment.siteId,
				gateway: payment.gateway,
				visitorId: payment.visitorId ?? null,
				customerEmailHash: payment.customerEmailHash ?? null,
				customerEmailMasked: payment.customerEmailMasked ?? null,
				planName: payment.planName ?? null,
				grossAmountCents: payment.grossAmountCents,
				feeAmountCents: payment.feeAmountCents,
				netAmountCents: payment.netAmountCents,
				currency: payment.currency,
				status: payment.status,
				isRenewal: payment.isRenewal ? 1 : 0,
				firstTouchSource: payment.firstTouchSource,
				lastTouchSource: payment.lastTouchSource,
				country: payment.country,
				city: payment.city ?? null,
				timeToConvertHours: payment.timeToConvertHours,
				buyerReadSec: payment.buyerReadSec,
				buyerScrollPct: payment.buyerScrollPct,
			})
			.onConflictDoUpdate({
				target: schema.payments.paymentId,
				set: {
					status: payment.status,
					netAmountCents: payment.netAmountCents,
				},
			})
			.returning({ paymentId: schema.payments.paymentId });

		return result.length > 0;
	}

	/**
	 * Check if a webhook event ID has already been processed (dedup).
	 */
	async isWebhookProcessed(webhookEventId: string): Promise<boolean> {
		const row = await this.db
			.select({ webhookEventId: schema.webhookDedupLog.webhookEventId })
			.from(schema.webhookDedupLog)
			.where(eq(schema.webhookDedupLog.webhookEventId, webhookEventId))
			.limit(1);
		return row.length > 0;
	}

	/**
	 * Atomically claims a webhook event ID. Returns false if it was already claimed,
	 * so concurrent gateway retries can never both process (or alert on) the same event.
	 */
	async markWebhookProcessed(webhookEventId: string, siteId: string): Promise<boolean> {
		const rows = await this.db
			.insert(schema.webhookDedupLog)
			.values({ webhookEventId, siteId })
			.onConflictDoNothing()
			.returning({ id: schema.webhookDedupLog.webhookEventId });
		return rows.length > 0;
	}

	/** Releases a claim when processing failed, so the gateway's retry is processed. */
	async unmarkWebhookProcessed(webhookEventId: string): Promise<void> {
		await this.db
			.delete(schema.webhookDedupLog)
			.where(eq(schema.webhookDedupLog.webhookEventId, webhookEventId));
	}

	/** Site row (per-site webhook secrets, share flag). */
	async getSite(siteId: string) {
		const rows = await this.db.select().from(schema.sites).where(eq(schema.sites.siteId, siteId)).limit(1);
		return rows[0];
	}

	/**
	 * Finds the buyer's visitor record by visitor ID, falling back to email hash (renewals).
	 * When matched by visitor ID, links the email hash so future renewals attribute too.
	 */
	async findBuyer(siteId: string, visitorId?: string, emailHash?: string) {
		const v = schema.visitors;
		if (visitorId) {
			const rows = await this.db
				.select()
				.from(v)
				.where(and(eq(v.siteId, siteId), eq(v.visitorId, visitorId)))
				.limit(1);
			if (rows[0]) {
				if (emailHash && rows[0].customerEmailHash !== emailHash) {
					await this.db
						.update(v)
						.set({ customerEmailHash: emailHash })
						.where(and(eq(v.siteId, siteId), eq(v.visitorId, visitorId)));
				}
				return rows[0];
			}
		}
		if (!emailHash) return undefined;
		const rows = await this.db
			.select()
			.from(v)
			.where(and(eq(v.siteId, siteId), eq(v.customerEmailHash, emailHash)))
			.orderBy(v.firstSeenAt)
			.limit(1);
		return rows[0];
	}

	/**
	 * Query channel stats for the dashboard.
	 * Uses pre-aggregated hourly_rollups for <5ms response times,
	 * then joins payment data for revenue attribution.
	 */
	async queryChannelStats(
		siteId: string,
		startTime: number,
		endTime: number,
		model: AttributionModel,
	): Promise<ChannelStats[]> {
		// 1. Traffic stats from hourly rollups
		const trafficRows = await this.db
			.select({
				source: schema.hourlyRollups.source,
				category: schema.hourlyRollups.category,
				visitors: sql<number>`SUM(visitors_count)`.as('visitors'),
				sessions: sql<number>`SUM(sessions_count)`.as('sessions'),
				pageviews: sql<number>`SUM(pageviews_count)`.as('pageviews'),
				totalReadSec: sql<number>`SUM(active_read_sec_sum)`.as('total_read_sec'),
				totalScrollPct: sql<number>`SUM(scroll_pct_sum)`.as('total_scroll_pct'),
			})
			.from(schema.hourlyRollups)
			.where(
				and(
					eq(schema.hourlyRollups.siteId, siteId),
					gte(schema.hourlyRollups.hourBucket, toHourBucket(startTime)),
					lte(schema.hourlyRollups.hourBucket, toHourBucket(endTime)),
				),
			)
			.groupBy(schema.hourlyRollups.source, schema.hourlyRollups.category);

		// 2. Revenue from payments, credited per attribution model.
		// first/last: 100% to that touch; linear: 50% to each (credit, gross, fee, net).
		const revenueBy = (
			col: typeof schema.payments.firstTouchSource | typeof schema.payments.lastTouchSource,
		) =>
			this.db
				.select({
					source: col,
					grossCents: sql<number>`SUM(gross_amount_cents)`.as('gross_cents'),
					feeCents: sql<number>`SUM(fee_amount_cents)`.as('fee_cents'),
					conversions: sql<number>`COUNT(*)`.as('conversions'),
				})
				.from(schema.payments)
				.where(
					and(
						eq(schema.payments.siteId, siteId),
						gte(schema.payments.createdAt, startTime),
						lte(schema.payments.createdAt, endTime),
						eq(schema.payments.status, 'succeeded'),
					),
				)
				.groupBy(col);

		const weighted: Array<[Awaited<ReturnType<typeof revenueBy>>, number]> =
			model === 'linear'
				? [
						[await revenueBy(schema.payments.firstTouchSource), 0.5],
						[await revenueBy(schema.payments.lastTouchSource), 0.5],
					]
				: [
						[
							await revenueBy(
								model === 'last' ? schema.payments.lastTouchSource : schema.payments.firstTouchSource,
							),
							1,
						],
					];

		const revenueMap = new Map<string, { gross: number; fee: number; conversions: number }>();
		for (const [rows, w] of weighted) {
			for (const r of rows) {
				const acc = revenueMap.get(r.source) ?? { gross: 0, fee: 0, conversions: 0 };
				acc.gross += (r.grossCents ?? 0) * w;
				acc.fee += (r.feeCents ?? 0) * w;
				acc.conversions += (r.conversions ?? 0) * w;
				revenueMap.set(r.source, acc);
			}
		}

		// 3. Ad spend
		const startDate = new Date(startTime * 1000).toISOString().slice(0, 10);
		const endDate = new Date(endTime * 1000).toISOString().slice(0, 10);

		const adSpendRows = await this.db
			.select({
				source: schema.adSpend.source,
				totalSpend: sql<number>`SUM(amount_cents)`.as('total_spend'),
			})
			.from(schema.adSpend)
			.where(
				and(
					eq(schema.adSpend.siteId, siteId),
					gte(schema.adSpend.spendDate, startDate),
					lte(schema.adSpend.spendDate, endDate),
				),
			)
			.groupBy(schema.adSpend.source);

		// 4. Merge traffic + revenue + ad spend. Sources with revenue or spend but no
		// tracked traffic (e.g. 'Unattributed') are still reported.
		const adSpendMap = new Map(adSpendRows.map((r) => [r.source, r.totalSpend ?? 0]));
		const trafficMap = new Map(trafficRows.map((t) => [t.source, t]));
		const sources = new Set([...trafficMap.keys(), ...revenueMap.keys(), ...adSpendMap.keys()]);

		return Array.from(sources, (source) => {
			const t = trafficMap.get(source);
			const rev = revenueMap.get(source);
			const adSpendCents = adSpendMap.get(source) ?? 0;
			const visitors = t?.visitors ?? 0;
			const pageviews = t?.pageviews ?? 0;
			const grossRevenueCents = Math.round(rev?.gross ?? 0);
			const feesCents = Math.round(rev?.fee ?? 0);
			const netRevenueCents = grossRevenueCents - feesCents;

			return {
				source,
				category: (t?.category ?? classifySourceCategory(source)) as ChannelStats['category'],
				visitors,
				sessions: t?.sessions ?? 0,
				pageviews,
				avgReadSec: pageviews > 0 ? Math.round((t?.totalReadSec ?? 0) / pageviews) : 0,
				avgScrollPct: pageviews > 0 ? Math.round((t?.totalScrollPct ?? 0) / pageviews) : 0,
				grossRevenueCents,
				feesCents,
				netRevenueCents,
				adSpendCents,
				trueProfitCents: calculateTrueProfit(netRevenueCents, adSpendCents),
				conversions: rev?.conversions ?? 0,
				rpvCents: calculateRPV(netRevenueCents, visitors),
			};
		});
	}

	/**
	 * Get buyer journey for a specific visitor — ordered event timeline.
	 */
	async getBuyerJourney(siteId: string, visitorId: string): Promise<BuyerJourneyEvent[]> {
		const rows = await this.db
			.select({
				eventType: schema.events.eventType,
				eventName: schema.events.eventName,
				source: schema.events.source,
				timestamp: schema.events.createdAt,
				durationSec: schema.events.durationSec,
				scrollDepth: schema.events.scrollDepth,
			})
			.from(schema.events)
			.where(and(eq(schema.events.siteId, siteId), eq(schema.events.visitorId, visitorId)))
			.orderBy(schema.events.createdAt);

		return rows.map((r) => ({
			eventType: r.eventType as BuyerJourneyEvent['eventType'],
			eventName: r.eventName,
			source: r.source,
			timestamp: r.timestamp ?? 0,
			durationSec: r.durationSec ?? 0,
			scrollDepth: r.scrollDepth ?? 0,
		}));
	}
}

