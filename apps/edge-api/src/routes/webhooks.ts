import { Hono } from 'hono';
import { calculateNetRevenue, maskEmail } from '@grosslytics/shared/fees';
import { timeToConvertHours } from '@grosslytics/shared/attribution';
import { applyPaymentEvent, D1StorageAdapter } from '@grosslytics/db-d1';
import type { PaymentGateway, PaymentRecord } from '@grosslytics/shared/types';
import { isCloud } from '../cloud.js';
import type { Bindings } from '../env.js';
import { safeEqual, verifyWebhook } from '../verify.js';
import { reportingCurrency } from '@grosslytics/shared/money';

export const webhooksRoute = new Hono<{ Bindings: Bindings }>();

/** Gateway-agnostic payment fields extracted from a verified webhook. */
interface ExtractedPayment {
	eventId: string;
	paymentId: string;
	references?: string[];
	grossCents: number;
	currency: string;
	email: string;
	visitorId?: string;
	planName: string;
	isRenewal: boolean;
	country?: string;
	city?: string;
	/** Sales tax inside grossCents: collected for the government, so it is not revenue */
	taxCents?: number;
	/** The gateway's real fee when the event states it (PayPal, RevenueCat); otherwise estimated from the price list */
	feeCents?: number;
	/** Unix seconds of the sale, for history imports */
	createdAt?: number;
}

type Extractor = (event: any, headers: Headers) => ExtractedPayment | null;

const objectId = (value: any): string => typeof value === 'string' ? value : value?.id || '';

const num = (x: unknown) => (Number.isFinite(Number(x)) ? Math.round(Number(x)) : 0);
/** "12.34" (major units) → 1234 cents */
const cents = (x: unknown) => num(Number(x) * 100);
// Visitor ID keys a DataFast or DataBull integration already sends, so switching needs no checkout code change
const vidOf = (m: any): string | undefined => m?.visitor_id || m?.datafast_visitor_id || m?.databull_visitor_id || undefined;

/** Returns null for events that are not a completed payment (they are acknowledged and ignored). */
const EXTRACTORS: Record<PaymentGateway, Extractor> = {
	stripe: (e) => {
		const o = e.data?.object ?? {};
		if (e.type === 'checkout.session.completed') {
			if (o.payment_status !== 'paid') return null;
			return {
				eventId: e.id,
				// Subscription checkouts share the invoice ID with invoice.paid, so the payment upserts once
				paymentId: objectId(o.invoice) || objectId(o.payment_intent) || o.id,
				references: [o.id, objectId(o.invoice), objectId(o.payment_intent)].filter(Boolean),
				grossCents: num(o.amount_total),
				currency: o.currency || 'usd',
				email: o.customer_details?.email || o.customer_email || '',
				visitorId: o.client_reference_id || vidOf(o.metadata),
				planName: o.metadata?.plan_name || 'Checkout',
				isRenewal: false,
				country: o.customer_details?.address?.country,
				city: o.customer_details?.address?.city,
				taxCents: num(o.total_details?.amount_tax),
				createdAt: o.created,
			};
		}
		if (e.type === 'invoice.paid' || e.type === 'invoice.payment_succeeded') {
			return {
				eventId: e.id,
				paymentId: o.id,
				references: [o.id, objectId(o.payment_intent), ...(o.payments?.data ?? []).map((p: any) => objectId(p.payment?.payment_intent))].filter(Boolean),
				grossCents: num(o.amount_paid),
				currency: o.currency || 'usd',
				email: o.customer_email || '',
				visitorId: vidOf(o.metadata) || vidOf(o.subscription_details?.metadata),
				planName: o.lines?.data?.[0]?.description || 'Subscription',
				isRenewal: o.billing_reason === 'subscription_cycle',
				country: o.customer_address?.country,
				city: o.customer_address?.city,
				taxCents: num(o.tax ?? (o.total_taxes ?? []).reduce((t: number, x: any) => t + num(x.amount), 0)),
				createdAt: o.status_transitions?.paid_at || o.created,
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
			visitorId: vidOf(o.metadata) || o.metadata?.reference_id || o.custom_field_data?.visitor_id,
			planName: o.product?.name || 'Polar Order',
			isRenewal: o.billing_reason === 'subscription_cycle',
			taxCents: num(o.tax_amount),
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
			visitorId: vidOf(o.custom_data),
			planName: o.items?.[0]?.price?.description || 'Paddle Transaction',
			isRenewal: o.origin === 'subscription_recurring',
			taxCents: num(o.details?.totals?.tax),
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
			visitorId: vidOf(e.meta?.custom_data),
			planName: a.first_order_item?.product_name || 'LemonSqueezy Order',
			isRenewal: name === 'subscription_payment_success',
			taxCents: num(a.tax),
		};
	},
	// Gumroad pings are form fields; link params like ?visitor_id= arrive as url_params[visitor_id]
	gumroad: (e) => {
		if (!e.sale_id || e.refunded === 'true') return null;
		return {
			eventId: `gumroad:${e.sale_id}`,
			paymentId: `gum_${e.sale_id}`,
			grossCents: num(e.price), // already cents
			currency: e.currency || 'usd',
			email: e.email || '',
			visitorId: e['url_params[visitor_id]'] || e['custom_fields[visitor_id]'],
			planName: e.product_name || 'Gumroad Sale',
			isRenewal: e.is_recurring_charge === 'true',
			country: typeof e.ip_country === 'string' && e.ip_country.length === 2 ? e.ip_country : undefined,
		};
	},
	// PayPal Orders v2: put the visitor ID in purchase_units[].custom_id when creating the order
	paypal: (e) => {
		const o = e.resource ?? {};
		if (e.event_type !== 'PAYMENT.CAPTURE.COMPLETED' || o.status !== 'COMPLETED') return null;
		const fee = o.seller_receivable_breakdown?.paypal_fee?.value;
		return {
			eventId: e.id,
			paymentId: `pp_${o.id}`,
			grossCents: cents(o.amount?.value),
			currency: o.amount?.currency_code || 'usd',
			email: '',
			visitorId: o.custom_id || undefined,
			planName: o.soft_descriptor || 'PayPal Payment',
			isRenewal: false,
			feeCents: fee == null ? undefined : cents(fee),
		};
	},
	// Cashfree PG: put the visitor ID in order_tags.visitor_id when creating the order
	cashfree: (e) => {
		const o = e.data?.order ?? {};
		const p = e.data?.payment ?? {};
		if (e.type !== 'PAYMENT_SUCCESS_WEBHOOK' || p.payment_status !== 'SUCCESS') return null;
		return {
			eventId: `cf:${p.cf_payment_id}`,
			paymentId: `cf_${o.order_id}`,
			grossCents: cents(p.payment_amount ?? o.order_amount),
			currency: p.payment_currency || o.order_currency || 'inr',
			email: e.data?.customer_details?.customer_email || '',
			visitorId: vidOf(o.order_tags),
			planName: 'Cashfree Order',
			isRenewal: false,
		};
	},
	// RevenueCat (app stores and web): the app sets the subscriber attribute `visitor_id` it got from the web visit
	revenuecat: (e) => {
		const o = e.event ?? {};
		if (!['INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE'].includes(o.type) || !(Number(o.price_in_purchased_currency) > 0)) return null;
		const gross = cents(o.price_in_purchased_currency);
		return {
			eventId: o.id,
			paymentId: `rc_${o.transaction_id || o.id}`,
			grossCents: gross,
			currency: o.currency || 'usd',
			email: o.subscriber_attributes?.$email?.value || '',
			visitorId: o.subscriber_attributes?.visitor_id?.value,
			planName: o.product_id || 'In-app purchase',
			isRenewal: o.type === 'RENEWAL',
			country: o.country_code,
			taxCents: num(gross * (Number(o.tax_percentage) || 0)),
			feeCents: num(gross * (Number(o.commission_percentage) || 0)),
		};
	},
};

export const extractPayment = (gateway: PaymentGateway, event: any, headers: Headers) => EXTRACTORS[gateway](event, headers);

/** Turns an extracted payment into a payment row; shared with the Stripe history import. */
export async function recordPayment(env: Bindings, siteId: string, gateway: PaymentGateway, p: ExtractedPayment, broadcast = true): Promise<'recorded' | 'duplicate'> {
	const adapter = new D1StorageAdapter(env.DB);
	const emailHash = p.email ? await hashEmail(p.email) : undefined;
	const buyer = await adapter.findBuyer(siteId, p.visitorId, emailHash);
	// Fees are charged on the whole amount; tax is passed on to the government, so revenue excludes it
	const grossCents = Math.max(0, p.grossCents - (p.taxCents ?? 0));
	const feeCents = Math.min(p.feeCents ?? calculateNetRevenue(gateway, p.grossCents).feeCents, grossCents);
	const netCents = grossCents - feeCents;
	const at = p.createdAt ?? Math.floor(Date.now() / 1000);
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
		timeToConvertHours: buyer ? timeToConvertHours(buyer.firstSeenAt, at) : 0,
		buyerReadSec: buyer?.totalActiveReadSec ?? 0,
		buyerScrollPct: buyer?.maxScrollPct ?? 0,
		createdAt: p.createdAt,
	};

	const result = await applyPaymentEvent(env.DB, { id: p.eventId, siteId, gateway, references: p.references ?? [p.paymentId], payment: record });
	if (!result.processed) return 'duplicate';

	if (broadcast && result.inserted && !result.refunded && env.SITE_LIVE_HUB) {
		const stub = env.SITE_LIVE_HUB.get(env.SITE_LIVE_HUB.idFromName(siteId));
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
	return 'recorded';
}

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

	const site = await new D1StorageAdapter(c.env.DB).getSite(siteId);
	if (!site) return c.text('Unknown site', 404);
	const saved = await c.env.DB.prepare('SELECT secret FROM site_secrets WHERE site_id = ? AND gateway = ?').bind(siteId, gateway).first<{ secret: string }>();
	// Hosted Cloud never falls back to the operator's env secrets: each customer signs with their own
	const secret = saved?.secret || (isCloud(c.env) ? '' :
		({
			stripe: c.env.STRIPE_WEBHOOK_SECRET,
			razorpay: c.env.RAZORPAY_WEBHOOK_SECRET,
			polar: c.env.POLAR_WEBHOOK_SECRET,
			paddle: c.env.PADDLE_WEBHOOK_SECRET,
			lemonsqueezy: c.env.LEMONSQUEEZY_WEBHOOK_SECRET,
		} as Partial<Record<PaymentGateway, string>>)[gateway]) || '';

	// Fail closed: unsigned or unconfigured webhooks are never trusted.
	// Gumroad pings carry no signature, so its secret is a key in the ping URL instead.
	const body = await c.req.text();
	const ok = !!secret && (gateway === 'gumroad' ? safeEqual(c.req.query('key') || '', secret) : await verifyWebhook(gateway, secret, body, c.req.raw.headers));
	if (!ok) return c.text('Invalid signature', 401);

	let event: any;
	try {
		event = gateway === 'gumroad' ? Object.fromEntries(new URLSearchParams(body)) : JSON.parse(body);
	} catch {
		return c.text('Invalid JSON', 400);
	}

	// Gumroad sends the sale again with refunded=true
	if (gateway === 'gumroad' && event.refunded === 'true' && event.sale_id) {
		const result = await applyPaymentEvent(c.env.DB, { id: `gumroad:refund:${event.sale_id}`, siteId, gateway, references: [`gum_${event.sale_id}`], refundedAt: Math.floor(Date.now() / 1000) });
		return c.json(result.processed ? { received: true, refunded: true } : { received: true, deduplicated: true });
	}

	// Modern Stripe invoices expose the PaymentIntent through invoice_payment.paid.
	if (gateway === 'stripe' && event.type === 'invoice_payment.paid') {
		const o = event.data?.object ?? {};
		const paymentId = objectId(o.invoice);
		const intent = objectId(o.payment?.payment_intent);
		if (!event.id || !paymentId || !intent) return c.text('Missing event or payment reference', 400);
		const result = await applyPaymentEvent(c.env.DB, { id: event.id, siteId, gateway, paymentId, references: [paymentId, intent] });
		return c.json(result.processed ? { received: true } : { received: true, deduplicated: true });
	}
	// ponytail: full refunds only; partial refunds need amount-based accounting.
	if (gateway === 'stripe' && event.type === 'charge.refunded') {
		const ch = event.data?.object ?? {};
		if (!ch.refunded) return c.json({ received: true, ignored: true });
		const references = [objectId(ch.payment_intent), objectId(ch.invoice)].filter(Boolean);
		if (!event.id || !references.length) return c.text('Missing event or payment reference', 400);
		const result = await applyPaymentEvent(c.env.DB, {
			id: event.id, siteId, gateway, references, refundedAt: event.created || Math.floor(Date.now() / 1000),
		});
		return c.json(result.processed ? { received: true, refunded: true } : { received: true, deduplicated: true });
	}

	const p = extract(event, c.req.raw.headers);
	if (!p) return c.json({ received: true, ignored: true });
	if (!p.eventId || !p.paymentId) return c.text('Missing event or payment id', 400);
	const currency = p.currency.toUpperCase();
	if (currency !== reportingCurrency(site.currency ?? 'USD')) {
		return c.json({ error: `This site reports ${site.currency}. Payment in ${currency} was not added. Use a separate site for that currency.` }, 422);
	}

	return c.json((await recordPayment(c.env, siteId, gateway, p)) === 'recorded' ? { received: true } : { received: true, deduplicated: true });
});
