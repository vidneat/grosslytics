import { reportingCurrency } from '@grosslytics/shared/money';
import type { ClickHouseClient } from '@clickhouse/client';
import {
	classifySourceCategory,
	linearSplitPayment,
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

export class ClickHouseStorageAdapter implements AnalyticsStorageAdapter {
	constructor(private readonly client: ClickHouseClient) {}

	async insertEventBatch(events: EnrichedEvent[]): Promise<void> {
		if (events.length === 0) return;
		await this.client.insert({
			table: 'events_raw',
			values: events.map((e) => ({
				site_id: e.sid,
				visitor_id: e.vid,
				session_id: e.ses,
				event_type: e.t,
				event_name: e.n,
				source: e.src,
				category: classifySourceCategory(e.src, e.um, e.cat),
				referrer: e.ref || '',
				country: e.country || 'XX',
				city: e.city || '',
				device_type: e.deviceType || 'desktop',
				os: e.os || '',
				browser: e.browser || '',
				scroll_depth: e.sd,
				duration_sec: e.dur,
				meta_json: e.meta || '',
				created_at: Math.floor(e.createdAt),
			})),
			format: 'JSONEachRow',
		});
	}

	async upsertVisitor(event: EnrichedEvent): Promise<void> {
		const category = classifySourceCategory(event.src, event.um, event.cat);
		const ts = Math.floor(event.createdAt);
		await this.client.insert({
			table: 'visitors',
			values: [
				{
					site_id: event.sid,
					visitor_id: event.vid,
					first_seen_at: ts,
					first_source: event.src,
					first_category: category,
					first_utm_source: event.us || '',
					first_utm_medium: event.um || '',
					first_utm_campaign: event.uc || '',
					first_landing_page: event.n,
					last_seen_at: ts,
					last_source: event.src,
					last_category: category,
					last_utm_source: event.us || '',
					last_utm_campaign: event.uc || '',
					country: event.country || 'XX',
					city: event.city || '',
					device_type: event.deviceType || 'desktop',
					os: event.os || '',
					browser: event.browser || '',
					total_sessions: 1,
					total_active_read_sec: event.dur,
					max_scroll_pct: event.sd,
				},
			],
			format: 'JSONEachRow',
		});
	}

	async upsertHourlyRollup(_events: EnrichedEvent[]): Promise<void> {
		// shortcut: ClickHouse materialized view mv_daily_channel_stats aggregates automatically from events_raw, add custom rollup table if hour-level clickhouse slicing needed
	}

	async upsertPayment(payment: PaymentRecord): Promise<boolean> {
		await this.client.insert({
			table: 'payments',
			values: [
				{
					payment_id: payment.paymentId,
					site_id: payment.siteId,
					gateway: payment.gateway,
					visitor_id: payment.visitorId || '',
					customer_email_hash: payment.customerEmailHash || '',
					customer_email_masked: payment.customerEmailMasked || '',
					plan_name: payment.planName || '',
					gross_amount_cents: payment.grossAmountCents,
					fee_amount_cents: payment.feeAmountCents,
					net_amount_cents: payment.netAmountCents,
					currency: payment.currency,
					status: payment.status,
					is_renewal: payment.isRenewal ? 1 : 0,
					first_touch_source: payment.firstTouchSource,
					last_touch_source: payment.lastTouchSource,
					country: payment.country || 'XX',
					city: payment.city || '',
					time_to_convert_hours: payment.timeToConvertHours,
					buyer_read_sec: payment.buyerReadSec,
					buyer_scroll_pct: payment.buyerScrollPct,
				},
			],
			format: 'JSONEachRow',
		});
		return true;
	}

	async isWebhookProcessed(webhookEventId: string): Promise<boolean> {
		const res = await this.client.query({
			query: 'SELECT 1 FROM webhook_dedup_log WHERE webhook_event_id = {id:String} LIMIT 1',
			query_params: { id: webhookEventId },
			format: 'JSONEachRow',
		});
		const rows = await res.json<{ 1: number }>();
		return rows.length > 0;
	}

	// shortcut: ClickHouse has no atomic insert-if-absent, so this is check-then-insert (racy under
	// concurrent retries); upgrade by deduping in Dragonfly/Redis with SET NX before writing.
	async markWebhookProcessed(webhookEventId: string, siteId: string): Promise<boolean> {
		if (await this.isWebhookProcessed(webhookEventId)) return false;
		await this.client.insert({
			table: 'webhook_dedup_log',
			values: [{ webhook_event_id: webhookEventId, site_id: siteId }],
			format: 'JSONEachRow',
		});
		return true;
	}

	async queryChannelStats(
		siteId: string,
		startTime: number,
		endTime: number,
		model: AttributionModel,
		reportCurrency = 'USD',
	): Promise<ChannelStats[]> {
		const currency = reportingCurrency(reportCurrency);
		const sourceCol = model === 'last' ? 'last_touch_source' : 'first_touch_source';

		const trafficQuery = `
			SELECT
				source,
				category,
				uniqMerge(unique_visitors) AS visitors,
				uniqMerge(unique_sessions) AS sessions,
				countMerge(total_pageviews) AS pageviews,
				sumMerge(total_read_sec) AS total_read_sec,
				avgMerge(avg_scroll_depth) AS avg_scroll_depth
			FROM mv_daily_channel_stats
			WHERE site_id = {siteId:String} AND day >= toDate({startTs:UInt32}) AND day <= toDate({endTs:UInt32})
			GROUP BY source, category
		`;

		const paymentsQuery = `
			SELECT
				${sourceCol} AS source,
				sum(gross_amount_cents) AS gross_cents,
				sum(fee_amount_cents) AS fee_cents,
				sum(net_amount_cents) AS net_cents,
				count() AS conversions
			FROM payments FINAL
			WHERE site_id = {siteId:String}
			  AND created_at >= toDateTime({startTs:UInt32})
			  AND created_at <= toDateTime({endTs:UInt32})
			  AND status = 'succeeded' AND upper(currency) = {currency:String}
			GROUP BY ${sourceCol}
		`;

		const [trafficRes, paymentsRes] = await Promise.all([
			this.client.query({
				query: trafficQuery,
				query_params: { siteId, startTs: startTime, endTs: endTime, currency },
				format: 'JSONEachRow',
			}),
			this.client.query({
				query: paymentsQuery,
				query_params: { siteId, startTs: startTime, endTs: endTime, currency },
				format: 'JSONEachRow',
			}),
		]);

		interface TrafficRow {
			source: string;
			category: string;
			visitors: number;
			sessions: number;
			pageviews: number;
			total_read_sec: number;
			avg_scroll_depth: number;
		}

		interface PaymentRow {
			source: string;
			gross_cents: string | number;
			fee_cents: string | number;
			net_cents: string | number;
			conversions: string | number;
		}

		const trafficRows = await trafficRes.json<TrafficRow>();
		const paymentsRows = await paymentsRes.json<PaymentRow>();

		const paymentMap = new Map(paymentsRows.map((p) => [p.source, p]));

		return trafficRows.map((t) => {
			const pay = paymentMap.get(t.source);
			let grossRevenueCents = pay ? Number(pay.gross_cents) : 0;
			let feesCents = pay ? Number(pay.fee_cents) : 0;
			let netRevenueCents = pay ? Number(pay.net_cents) : 0;
			const conversions = pay ? Number(pay.conversions) : 0;

			if (model === 'linear' && pay) {
				const split = linearSplitPayment(grossRevenueCents, feesCents);
				grossRevenueCents = Math.round(grossRevenueCents / 2);
				feesCents = Math.round(feesCents / 2);
				netRevenueCents = split.firstTouchShare;
			}

			const trueProfitCents = calculateTrueProfit(netRevenueCents, 0);
			const visitors = Number(t.visitors);
			const pageviews = Number(t.pageviews);

			return {
				source: t.source,
				currency,
				category: t.category as ChannelStats['category'],
				visitors,
				sessions: Number(t.sessions),
				pageviews,
				avgReadSec: pageviews > 0 ? Math.round(Number(t.total_read_sec) / pageviews) : 0,
				avgScrollPct: Math.round(Number(t.avg_scroll_depth)),
				grossRevenueCents,
				feesCents,
				netRevenueCents,
				adSpendCents: 0,
				trueProfitCents,
				conversions,
				rpvCents: calculateRPV(netRevenueCents, visitors),
			};
		});
	}

	async getBuyerJourney(siteId: string, visitorId: string): Promise<BuyerJourneyEvent[]> {
		const res = await this.client.query({
			query: `
				SELECT
					event_type,
					event_name,
					source,
					toUnixTimestamp(created_at) AS ts,
					duration_sec,
					scroll_depth
				FROM events_raw
				WHERE site_id = {siteId:String} AND visitor_id = {visitorId:String}
				ORDER BY created_at ASC
			`,
			query_params: { siteId, visitorId },
			format: 'JSONEachRow',
		});

		interface JourneyRow {
			event_type: BuyerJourneyEvent['eventType'];
			event_name: string;
			source: string;
			ts: number;
			duration_sec: number;
			scroll_depth: number;
		}

		const rows = await res.json<JourneyRow>();
		return rows.map((r) => ({
			eventType: r.event_type,
			eventName: r.event_name,
			source: r.source,
			timestamp: r.ts,
			durationSec: r.duration_sec,
			scrollDepth: r.scroll_depth,
		}));
	}
}

