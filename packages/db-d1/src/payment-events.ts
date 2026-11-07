import type { PaymentGateway, PaymentRecord } from '@grosslytics/shared/types';

const PAYMENT_FIELDS = {
	payment_id: 'paymentId',
	site_id: 'siteId',
	gateway: 'gateway',
	visitor_id: 'visitorId',
	customer_email_hash: 'customerEmailHash',
	customer_email_masked: 'customerEmailMasked',
	plan_name: 'planName',
	gross_amount_cents: 'grossAmountCents',
	fee_amount_cents: 'feeAmountCents',
	net_amount_cents: 'netAmountCents',
	currency: 'currency',
	status: 'status',
	is_renewal: 'isRenewal',
	first_touch_source: 'firstTouchSource',
	last_touch_source: 'lastTouchSource',
	country: 'country',
	city: 'city',
	time_to_convert_hours: 'timeToConvertHours',
	buyer_read_sec: 'buyerReadSec',
	buyer_scroll_pct: 'buyerScrollPct',
	created_at: 'createdAt',
} as const satisfies Record<string, keyof PaymentRecord>;

/** A receipt is committed with the payment/refund, never before it. */
export async function applyPaymentEvent(
	db: D1Database,
	event: {
		id: string;
		siteId: string;
		gateway: PaymentGateway;
		references: string[];
		payment?: PaymentRecord;
		/** Reference-only events link modern Stripe invoices to their PaymentIntent. */
		paymentId?: string;
		refundedAt?: number;
	},
): Promise<{ processed: boolean; inserted: boolean; refunded: boolean }> {
	const receipt = `webhook:${event.siteId}:${event.gateway}:${event.id}`;
	const attempt = crypto.randomUUID();
	const payload = JSON.stringify({
		...event,
		payment: event.payment && { ...event.payment, isRenewal: Number(event.payment.isRenewal) },
	});
	const fresh =
		'EXISTS (SELECT 1 FROM processed_messages WHERE message_id = ?2 AND attempt_id = ?3)';
	const site = "json_extract(?1, '$.siteId')";
	const gateway = "json_extract(?1, '$.gateway')";
	const paymentId =
		"COALESCE(json_extract(?1, '$.payment.paymentId'), json_extract(?1, '$.paymentId'))";
	const statements = [
		`INSERT INTO processed_messages (message_id, attempt_id) SELECT ?2, ?3
		 WHERE NOT EXISTS (SELECT 1 FROM webhook_dedup_log WHERE webhook_event_id = json_extract(?1, '$.id') AND site_id = ${site}) ON CONFLICT DO NOTHING`,
		`SELECT ${fresh} AS processed, NOT EXISTS (SELECT 1 FROM payments WHERE payment_id = ${paymentId}) AS inserted`,
	];
	if (event.payment) {
		statements.push(
			`INSERT INTO payments (${Object.keys(PAYMENT_FIELDS).join(', ')})
			 SELECT ${Object.values(PAYMENT_FIELDS)
					.map((key) => key === 'createdAt' ? `COALESCE(json_extract(?1, '$.payment.createdAt'), unixepoch())` : `json_extract(?1, '$.payment.${key}')`)
					.join(', ')} WHERE ${fresh}
			 ON CONFLICT (payment_id) DO UPDATE SET
			 visitor_id = COALESCE(payments.visitor_id, excluded.visitor_id),
			 customer_email_hash = COALESCE(payments.customer_email_hash, excluded.customer_email_hash),
			 customer_email_masked = COALESCE(payments.customer_email_masked, excluded.customer_email_masked),
			 plan_name = CASE WHEN payments.plan_name IS NULL OR payments.plan_name IN ('Checkout', 'Subscription') THEN excluded.plan_name ELSE payments.plan_name END,
			 first_touch_source = CASE WHEN payments.first_touch_source = 'Unattributed' THEN excluded.first_touch_source ELSE payments.first_touch_source END,
			 last_touch_source = CASE WHEN payments.first_touch_source = 'Unattributed' THEN excluded.last_touch_source ELSE payments.last_touch_source END,
			 time_to_convert_hours = CASE WHEN payments.first_touch_source = 'Unattributed' THEN excluded.time_to_convert_hours ELSE payments.time_to_convert_hours END,
			 buyer_read_sec = MAX(payments.buyer_read_sec, excluded.buyer_read_sec), buyer_scroll_pct = MAX(payments.buyer_scroll_pct, excluded.buyer_scroll_pct),
			 country = CASE WHEN payments.country = 'XX' THEN excluded.country ELSE payments.country END,
			 city = COALESCE(payments.city, excluded.city)
			 WHERE payments.site_id = excluded.site_id AND payments.gateway = excluded.gateway`,
		);
	}
	if (event.payment || event.paymentId) {
		statements.push(`INSERT INTO payment_references (site_id, gateway, reference_id, payment_id)
		 SELECT ${site}, ${gateway}, value, ${paymentId} FROM json_each(?1, '$.references') WHERE ${fresh} ON CONFLICT DO NOTHING`);
	} else {
		statements.push(`INSERT INTO refund_references (site_id, gateway, reference_id, refunded_at)
		 SELECT ${site}, ${gateway}, value, json_extract(?1, '$.refundedAt') FROM json_each(?1, '$.references') WHERE ${fresh} ON CONFLICT DO NOTHING`);
	}
	statements.push(
		`INSERT INTO refunds (payment_id, site_id, refunded_at)
		 SELECT p.payment_id, p.site_id, MIN(f.refunded_at) FROM refund_references f
		 LEFT JOIN payment_references r ON r.site_id = f.site_id AND r.gateway = f.gateway AND r.reference_id = f.reference_id
		 JOIN payments p ON p.site_id = f.site_id AND p.gateway = f.gateway AND p.payment_id = COALESCE(r.payment_id, f.reference_id)
		 WHERE f.site_id = ${site} AND f.gateway = ${gateway} AND ${fresh}
		 AND (f.reference_id IN (SELECT value FROM json_each(?1, '$.references')) OR r.payment_id = ${paymentId})
		 GROUP BY p.payment_id, p.site_id ON CONFLICT DO NOTHING`,
		`UPDATE payments SET status = 'refunded' WHERE site_id = ${site} AND gateway = ${gateway} AND status != 'refunded' AND ${fresh}
		 AND payment_id IN (SELECT payment_id FROM refunds WHERE site_id = ${site})`,
		`SELECT EXISTS (SELECT 1 FROM refunds WHERE site_id = ${site} AND payment_id = ${paymentId}) AS refunded WHERE ${fresh}`,
	);
	const results = await db.batch<{ processed: number; inserted: number; refunded: number }>(
		statements.map((sql) => db.prepare(sql).bind(payload, receipt, attempt)),
	);
	return {
		processed: !!results[1]?.results[0]?.processed,
		inserted:
			!!event.payment && !!results[1]?.results[0]?.processed && !!results[1]?.results[0]?.inserted,
		refunded: !!results.at(-1)?.results[0]?.refunded,
	};
}
