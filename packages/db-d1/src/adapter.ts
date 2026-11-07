import { applyPaymentEvent } from './payment-events.js';
import { queryChannelStats } from './dashboard.js';
import { eq, and } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';

import type {
	AnalyticsStorageAdapter,
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
 * - Reads distinct events and payment attribution
 * - Implements idempotent payment upserts with webhook dedup
 */
export class D1StorageAdapter implements AnalyticsStorageAdapter {
	private db: DrizzleD1Database<typeof schema>;

	constructor(private readonly d1: D1Database) {
		this.db = drizzle(d1, { schema });
	}

	/**
	 * Idempotent payment upsert with ON CONFLICT(payment_id) DO UPDATE.
	 * Returns true if a new payment was inserted, false if it was a duplicate update.
	 */
	async upsertPayment(payment: PaymentRecord): Promise<boolean> {
		return (await applyPaymentEvent(this.d1, {
			id: crypto.randomUUID(), siteId: payment.siteId, gateway: payment.gateway, references: [payment.paymentId], payment,
		})).inserted;
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

	queryChannelStats(siteId: string, startTime: number, endTime: number, model: AttributionModel): Promise<ChannelStats[]> {
		return queryChannelStats(this.d1, siteId, startTime, endTime, model);
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

