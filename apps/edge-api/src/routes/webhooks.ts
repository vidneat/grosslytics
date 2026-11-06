import { Hono } from 'hono';
import { calculateNetRevenue, maskEmail } from '@grosslytics/shared/fees';
import { timeToConvertHours } from '@grosslytics/shared/attribution';
import { D1StorageAdapter } from '@grosslytics/db-d1';
import type { PaymentGateway, PaymentRecord } from '@grosslytics/shared/types';
import type { Bindings } from '../env.js';
import { verifyWebhook } from '../verify.js';

export const webhooksRoute = new Hono<{ Bindings: Bindings }>();

/** Gateway-agnostic payment fields extracted from a verified webhook. */
interface ExtractedPayment {
	eventId: string;
	paymentId: string;
	grossCents: number;
	currency: string;
	email: string;
	visitorId?: string;
	planName: string;
	isRenewal: boolean;
	country?: string;
	city?: string;
}

type Extractor = (event: any, headers: Headers) => ExtractedPayment | null;

const num = (x: unknown) => (Number.isFinite(Number(x)) ? Math.round(Number(x)) : 0);

/** Returns null for events that are not a completed payment (they are acknowledged and ignored). */
const EXTRACTORS: Record<PaymentGateway, Extractor> = {
	stripe: (e) => {
		const o = e.data?.object ?? {};
		if (e.type === 'checkout.session.completed') {
			if (o.payment_status !== 'paid') return null;
			return {
				eventId: e.id,
				// Subscription checkouts share the invoice ID with invoice.paid, so the payment upserts once
				paymentId: o.invoice || o.payment_intent || o.id,
				grossCents: num(o.amount_total),
				currency: o.currency || 'usd',
				email: o.customer_details?.email || o.customer_email || '',
				visitorId: o.client_reference_id || o.metadata?.visitor_id,
				planName: o.metadata?.plan_name || 'Checkout',
				isRenewal: false,
				country: o.customer_details?.address?.country,
				city: o.customer_details?.address?.city,
			};
		}
		if (e.type === 'invoice.paid' || e.type === 'invoice.payment_succeeded') {
			return {
				eventId: e.id,
				paymentId: o.id,
				grossCents: num(o.amount_paid),
				currency: o.currency || 'usd',
				email: o.customer_email || '',
				visitorId: o.metadata?.visitor_id || o.subscription_details?.metadata?.visitor_id,
				planName: o.lines?.data?.[0]?.description || 'Subscription',
				isRenewal: o.billing_reason === 'subscription_cycle',
				country: o.customer_address?.country,
				city: o.customer_address?.city,
			};
		}
		return null;
	},
	razorpay: (e, h) => {
		const p = e.payload?.payment?.entity;
		if (e.event !== 'payment.captured' || !p) return null;
		return {
			eventId: h.get('x-razorpay-event-id') || `rzp:${p.id}`,
			paymentId: p.id,
			grossCents: num(p.amount), // paise
			currency: p.currency || 'inr',
			email: p.email || '',
			visitorId: p.notes?.visitor_id,
			planName: p.description || 'Razorpay Order',
			isRenewal: false,
		};
	},
	polar: (e) => {
		const o = e.data ?? {};
		if (e.type !== 'order.paid') return null;
		return {
			eventId: `polar:${e.type}:${o.id}`,
			paymentId: o.id,
			grossCents: num(o.total_amount ?? o.amount),
			currency: o.currency || 'usd',
			email: o.customer?.email || '',
			visitorId: o.metadata?.visitor_id || o.custom_field_data?.visitor_id,
			planName: o.product?.name || 'Polar Order',
			isRenewal: o.billing_reason === 'subscription_cycle',
		};
	},
	paddle: (e) => {
		const o = e.data ?? {};
		if (e.event_type !== 'transaction.completed') return null;
		return {
			eventId: e.event_id,
			paymentId: o.id,
			grossCents: num(o.details?.totals?.grand_total),
			currency: o.currency_code || 'usd',
			email: '',
			visitorId: o.custom_data?.visitor_id,
			planName: o.items?.[0]?.price?.description || 'Paddle Transaction',
			isRenewal: o.origin === 'subscription_recurring',
		};
	},
	lemonsqueezy: (e) => {
		const name = e.meta?.event_name;
		const a = e.data?.attributes ?? {};
		if (name !== 'order_created' && name !== 'subscription_payment_success') return null;
		return {
			eventId: `ls:${name}:${e.data?.id}`,
			paymentId: `ls_${e.data?.id}`,
			grossCents: num(a.total),
			currency: a.currency || 'usd',
			email: a.user_email || '',
			visitorId: e.meta?.custom_data?.visitor_id,
			planName: a.first_order_item?.product_name || 'LemonSqueezy Order',
			isRenewal: name === 'subscription_payment_success',
		};
	},
};

async function hashEmail(email: string): Promise<string> {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()));
	return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

// POST /api/webhooks/:gateway?siteId=...
webhooksRoute.post('/:gateway', async (c) => {
	const gateway = c.req.param('gateway') as PaymentGateway;
	const extract = EXTRACTORS[gateway];
	if (!extract) return c.text('Unknown gateway', 404);

	const siteId = c.req.query('siteId');
	if (!siteId) return c.text('siteId required', 400);

	const adapter = new D1StorageAdapter(c.env.DB);
	const site = await adapter.getSite(siteId);
	const secret =
		{
			stripe: site?.stripeWebhookSecret || c.env.STRIPE_WEBHOOK_SECRET,
			razorpay: site?.razorpayWebhookSecret || c.env.RAZORPAY_WEBHOOK_SECRET,
			polar: site?.polarWebhookSecret || c.env.POLAR_WEBHOOK_SECRET,
			paddle: site?.paddleWebhookSecret || c.env.PADDLE_WEBHOOK_SECRET,
			lemonsqueezy: c.env.LEMONSQUEEZY_WEBHOOK_SECRET,
		}[gateway] || '';

	// Fail closed: unsigned or unconfigured webhooks are never trusted
	const body = await c.req.text();
	if (!secret || !(await verifyWebhook(gateway, secret, body, c.req.raw.headers))) {
		return c.text('Invalid signature', 401);
	}

	let event: any;
	try {
		event = JSON.parse(body);
	} catch {
		return c.text('Invalid JSON', 400);
	}

	// Stripe full refund: the payment stops counting as revenue and shows as a refund on the dashboard.
	// shortcut: full Stripe refunds only, matched on payment_intent or invoice; partial refunds and other gateways' refund events are ignored until needed.
	if (gateway === 'stripe' && event.type === 'charge.refunded') {
		const ch = event.data?.object ?? {};
		if (!ch.refunded) return c.json({ received: true, ignored: true });
		if (!(await adapter.markWebhookProcessed(event.id, siteId))) return c.json({ received: true, deduplicated: true });
		const ids = [ch.payment_intent, ch.invoice].filter((x): x is string => typeof x === 'string');
		const now = Math.floor(Date.now() / 1000);
		const hits = await c.env.DB.batch(
			ids.flatMap((id) => [
				c.env.DB.prepare("INSERT INTO refunds (payment_id, site_id, refunded_at) SELECT payment_id, site_id, ? FROM payments WHERE site_id = ? AND payment_id = ? ON CONFLICT DO NOTHING").bind(now, siteId, id),
				c.env.DB.prepare("UPDATE payments SET status = 'refunded' WHERE site_id = ? AND payment_id = ?").bind(siteId, id),
			]),
		);
		return c.json({ received: true, refunded: hits.some((h) => (h.meta?.changes ?? 0) > 0) });
	}

	const p = extract(event, c.req.raw.headers);
	if (!p) return c.json({ received: true, ignored: true });
	if (!p.eventId || !p.paymentId) return c.text('Missing event or payment id', 400);

	// Atomic claim: a concurrent retry of the same event loses here and never double-alerts
	if (!(await adapter.markWebhookProcessed(p.eventId, siteId))) {
		return c.json({ received: true, deduplicated: true });
	}

	try {
		const emailHash = p.email ? await hashEmail(p.email) : undefined;
		const buyer = await adapter.findBuyer(siteId, p.visitorId, emailHash);
		const { grossCents, feeCents, netCents } = calculateNetRevenue(gateway, p.grossCents);
		const now = Math.floor(Date.now() / 1000);
		const firstTouchSource = buyer?.firstSource ?? 'Unattributed';
		const lastTouchSource = buyer?.lastSource ?? 'Unattributed';

		const record: PaymentRecord = {
			paymentId: p.paymentId,
			siteId,
			gateway,
			visitorId: buyer?.visitorId ?? p.visitorId,
			customerEmailHash: emailHash,
			customerEmailMasked: p.email ? maskEmail(p.email) : undefined,
			planName: p.planName,
			grossAmountCents: grossCents,
			feeAmountCents: feeCents,
			netAmountCents: netCents,
			currency: p.currency.toLowerCase(),
			status: 'succeeded',
			isRenewal: p.isRenewal,
			firstTouchSource,
			lastTouchSource,
			country: p.country || buyer?.country || 'XX',
			city: p.city || buyer?.city || undefined,
			timeToConvertHours: buyer ? timeToConvertHours(buyer.firstSeenAt, now) : 0,
			buyerReadSec: buyer?.totalActiveReadSec ?? 0,
			buyerScrollPct: buyer?.maxScrollPct ?? 0,
		};

		await adapter.upsertPayment(record);

		if (c.env.SITE_LIVE_HUB) {
			const stub = c.env.SITE_LIVE_HUB.get(c.env.SITE_LIVE_HUB.idFromName(siteId));
			await stub
				.fetch('http://do/internal/sale', {
					method: 'POST',
					body: JSON.stringify({
						type: 'sale',
						gateway,
						grossAmountCents: grossCents,
						netAmountCents: netCents,
						currency: record.currency,
						customerEmailMasked: record.customerEmailMasked || 'customer@***',
						planName: p.planName,
						firstTouchSource,
						lastTouchSource,
						country: record.country,
						isRenewal: p.isRenewal,
						timestamp: Date.now(),
					}),
				})
				.catch(() => {}); // live broadcast is best-effort
		}
	} catch (err) {
		// Release the claim so the gateway's retry is processed instead of silently dropped
		await adapter.unmarkWebhookProcessed(p.eventId);
		throw err;
	}

	return c.json({ received: true });
});
