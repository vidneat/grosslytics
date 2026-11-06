import { Hono } from 'hono';
import { calculateNetRevenue, maskEmail } from '@grosslytics/shared/fees';
import { D1StorageAdapter } from '@grosslytics/db-d1';
import type { LiveSaleUpdate, PaymentGateway, PaymentRecord } from '@grosslytics/shared/types';
import type { Bindings } from '../env.js';

export const webhooksRoute = new Hono<{ Bindings: Bindings }>();

// Helper to notify Durable Object of sale
async function notifyLiveSale(env: Bindings, siteId: string, sale: LiveSaleUpdate): Promise<void> {
	if (!env.SITE_LIVE_HUB) return;
	try {
		const doId = env.SITE_LIVE_HUB.idFromName(siteId);
		const stub = env.SITE_LIVE_HUB.get(doId);
		await stub.fetch('http://do/internal/sale', {
			method: 'POST',
			body: JSON.stringify(sale),
		});
	} catch {
		// Non-fatal if DO broadcast fails
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Stripe Webhook
// ─────────────────────────────────────────────────────────────────────────────
webhooksRoute.post('/stripe', async (c) => {
	const siteId = c.req.query('siteId') || 'gl_live_default';
	let event: any;
	try {
		event = await c.req.json();
	} catch {
		return c.text('Invalid JSON', 400);
	}

	const eventId = event.id;
	if (!eventId) return c.text('Missing event id', 400);

	const adapter = new D1StorageAdapter(c.env.DB);

	// Dedup check
	if (await adapter.isWebhookProcessed(eventId)) {
		return c.json({ received: true, deduplicated: true });
	}

	const eventType = event.type;
	if (eventType === 'checkout.session.completed' || eventType === 'invoice.payment_succeeded') {
		const obj = event.data.object;
		const paymentId = obj.id;
		const grossCents = obj.amount_total ?? obj.amount_paid ?? 0;
		const currency = (obj.currency || 'usd').toLowerCase();
		const customerEmail = obj.customer_details?.email || obj.customer_email || '';
		const vid = obj.client_reference_id || obj.metadata?.visitor_id || undefined;
		const planName = obj.metadata?.plan_name || obj.lines?.data?.[0]?.description || 'Subscription';
		const isRenewal = eventType === 'invoice.payment_succeeded' && obj.billing_reason === 'subscription_cycle';

		const { grossCents: gross, feeCents, netCents } = calculateNetRevenue('stripe', grossCents);

		const paymentRecord: PaymentRecord = {
			paymentId,
			siteId,
			gateway: 'stripe',
			visitorId: vid,
			customerEmailHash: customerEmail ? await hashEmail(customerEmail) : undefined,
			customerEmailMasked: customerEmail ? maskEmail(customerEmail) : undefined,
			planName,
			grossAmountCents: gross,
			feeAmountCents: feeCents,
			netAmountCents: netCents,
			currency,
			status: 'succeeded',
			isRenewal,
			firstTouchSource: 'Unattributed',
			lastTouchSource: 'Unattributed',
			country: obj.customer_details?.address?.country || 'XX',
			city: obj.customer_details?.address?.city,
			timeToConvertHours: 0,
			buyerReadSec: 0,
			buyerScrollPct: 0,
		};

		await adapter.upsertPayment(paymentRecord);
		await adapter.markWebhookProcessed(eventId, siteId);

		// Broadcast live sale down DO WebSockets
		await notifyLiveSale(c.env, siteId, {
			type: 'sale',
			gateway: 'stripe',
			grossAmountCents: gross,
			netAmountCents: netCents,
			currency,
			customerEmailMasked: paymentRecord.customerEmailMasked || 'customer@***',
			planName,
			firstTouchSource: 'Direct',
			lastTouchSource: 'Direct',
			country: paymentRecord.country,
			isRenewal,
			timestamp: Date.now(),
		});
	}

	return c.json({ received: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Razorpay Webhook
// ─────────────────────────────────────────────────────────────────────────────
webhooksRoute.post('/razorpay', async (c) => {
	const siteId = c.req.query('siteId') || 'gl_live_default';
	let event: any;
	try {
		event = await c.req.json();
	} catch {
		return c.text('Invalid JSON', 400);
	}

	const eventId = event.event_id || event.payload?.payment?.entity?.id;
	if (!eventId) return c.text('Missing event id', 400);

	const adapter = new D1StorageAdapter(c.env.DB);
	if (await adapter.isWebhookProcessed(eventId)) {
		return c.json({ received: true, deduplicated: true });
	}

	if (event.event === 'payment.captured' || event.event === 'order.paid') {
		const p = event.payload?.payment?.entity;
		if (p) {
			const paymentId = p.id;
			const grossCents = p.amount; // Razorpay amounts are in paise/cents
			const currency = (p.currency || 'inr').toLowerCase();
			const email = p.email || '';
			const vid = p.notes?.visitor_id || undefined;
			const { grossCents: gross, feeCents, netCents } = calculateNetRevenue('razorpay', grossCents);

			const paymentRecord: PaymentRecord = {
				paymentId,
				siteId,
				gateway: 'razorpay',
				visitorId: vid,
				customerEmailHash: email ? await hashEmail(email) : undefined,
				customerEmailMasked: email ? maskEmail(email) : undefined,
				planName: p.description || 'Razorpay Order',
				grossAmountCents: gross,
				feeAmountCents: feeCents,
				netAmountCents: netCents,
				currency,
				status: 'succeeded',
				isRenewal: false,
				firstTouchSource: 'Unattributed',
				lastTouchSource: 'Unattributed',
				country: 'IN',
				timeToConvertHours: 0,
				buyerReadSec: 0,
				buyerScrollPct: 0,
			};

			await adapter.upsertPayment(paymentRecord);
			await adapter.markWebhookProcessed(eventId, siteId);

			await notifyLiveSale(c.env, siteId, {
				type: 'sale',
				gateway: 'razorpay',
				grossAmountCents: gross,
				netAmountCents: netCents,
				currency,
				customerEmailMasked: paymentRecord.customerEmailMasked || 'customer@***',
				planName: paymentRecord.planName || '',
				firstTouchSource: 'Direct',
				lastTouchSource: 'Direct',
				country: 'IN',
				isRenewal: false,
				timestamp: Date.now(),
			});
		}
	}

	return c.json({ received: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Polar & Paddle Webhooks
// ─────────────────────────────────────────────────────────────────────────────
webhooksRoute.post('/:gateway', async (c) => {
	const gateway = c.req.param('gateway') as PaymentGateway;
	if (gateway !== 'polar' && gateway !== 'paddle' && gateway !== 'lemonsqueezy') {
		return c.text('Unknown gateway', 404);
	}

	const siteId = c.req.query('siteId') || 'gl_live_default';
	let event: any;
	try {
		event = await c.req.json();
	} catch {
		return c.text('Invalid JSON', 400);
	}

	const eventId = event.id || event.event_id || event.data?.id;
	if (!eventId) return c.text('Missing event id', 400);

	const adapter = new D1StorageAdapter(c.env.DB);
	if (await adapter.isWebhookProcessed(eventId)) {
		return c.json({ received: true, deduplicated: true });
	}

	const obj = event.data || event;
	const paymentId = obj.id || `pay_${eventId}`;
	const grossCents = obj.amount || obj.total || 0;
	const currency = (obj.currency || 'usd').toLowerCase();
	const email = obj.customer?.email || obj.user?.email || '';
	const vid = obj.metadata?.visitor_id || obj.custom_data?.visitor_id || undefined;
	const { grossCents: gross, feeCents, netCents } = calculateNetRevenue(gateway, grossCents);

	const paymentRecord: PaymentRecord = {
		paymentId,
		siteId,
		gateway,
		visitorId: vid,
		customerEmailHash: email ? await hashEmail(email) : undefined,
		customerEmailMasked: email ? maskEmail(email) : undefined,
		planName: obj.product?.name || `${gateway} Payment`,
		grossAmountCents: gross,
		feeAmountCents: feeCents,
		netAmountCents: netCents,
		currency,
		status: 'succeeded',
		isRenewal: !!obj.subscription_id,
		firstTouchSource: 'Unattributed',
		lastTouchSource: 'Unattributed',
		country: 'XX',
		timeToConvertHours: 0,
		buyerReadSec: 0,
		buyerScrollPct: 0,
	};

	await adapter.upsertPayment(paymentRecord);
	await adapter.markWebhookProcessed(eventId, siteId);

	return c.json({ received: true });
});

async function hashEmail(email: string): Promise<string> {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()));
	return Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}
