import { Hono } from 'hono';
import type { Bindings } from '../env.js';
import { verifyStandardWebhook, verifyWebhook } from '../verify.js';
import { mintLicense } from './license.js';

/**
 * Grosslytics' own billing (not a customer's payments): Hosted Cloud subscriptions, and Lifetime licenses (see license.ts). Dodo Payments (/dodo) is the live
 * gateway; /stripe stays for Stripe Payment Links opened with `client_reference_id=<account id>`. No Stripe API key is needed:
 * checkout and the customer portal are Stripe-hosted links, and this webhook turns accounts on and off.
 */
export const billingRoute = new Hono<{ Bindings: Bindings }>();

const id = (x: unknown) => (typeof x === 'string' ? x : typeof (x as { id?: unknown })?.id === 'string' ? (x as { id: string }).id : null);

/** Stripe subscription status → account status. Anything unknown (incomplete, paused…) stops ingest. */
export function accountStatus(stripeStatus: string): 'active' | 'past_due' | 'canceled' {
	if (stripeStatus === 'active' || stripeStatus === 'trialing') return 'active';
	if (stripeStatus === 'past_due') return 'past_due';
	return 'canceled';
}

// POST /api/billing/stripe
billingRoute.post('/stripe', async (c) => {
	const secret = c.env.STRIPE_BILLING_WEBHOOK_SECRET;
	const body = await c.req.text();
	if (!secret || !(await verifyWebhook('stripe', secret, body, c.req.raw.headers))) return c.text('Invalid signature', 401);
	let event: { type?: string; data?: { object?: Record<string, any> } };
	try {
		event = JSON.parse(body);
	} catch {
		return c.text('Invalid JSON', 400);
	}
	const o = event.data?.object ?? {};
	const db = c.env.DB;

	// Lifetime: a paid one-time checkout mints a license (the buyer collects it on /license)
	if (event.type === 'checkout.session.completed' && o.mode === 'payment') {
		if (o.payment_status !== 'paid' || typeof o.id !== 'string') return c.json({ received: true, ignored: true });
		if (c.env.LIFETIME_PAYMENT_LINK_ID && id(o.payment_link) !== c.env.LIFETIME_PAYMENT_LINK_ID) return c.json({ received: true, ignored: true });
		const minted = await mintLicense(c.env, o.id, o.customer_details?.email ?? null);
		return minted ? c.json({ received: true, license: true }) : c.text('LICENSE_SECRET is not set', 503);
	}

	if (event.type === 'checkout.session.completed') {
		const account = o.client_reference_id;
		const sub = id(o.subscription);
		if (typeof account !== 'string' || !sub) return c.json({ received: true, ignored: true });
		const res = await db
			.prepare("UPDATE accounts SET status = 'active', stripe_customer_id = ?, stripe_subscription_id = ? WHERE id = ?")
			.bind(id(o.customer), sub, account)
			.run();
		return c.json({ received: true, matched: res.meta.changes > 0 });
	}

	if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
		const status = event.type === 'customer.subscription.deleted' ? 'canceled' : accountStatus(String(o.status));
		// Newer API versions put the period on each item
		const periodEnd = Number(o.items?.data?.[0]?.current_period_end ?? o.current_period_end) || null;
		// shortcut: no event ordering, so a late "updated" can follow "deleted"; Stripe rarely reorders these, add event timestamps if it shows up.
		const res = await db.prepare('UPDATE accounts SET status = ?, current_period_end = ? WHERE stripe_subscription_id = ?').bind(status, periodEnd, o.id).run();
		return c.json({ received: true, matched: res.meta.changes > 0 });
	}
	return c.json({ received: true, ignored: true });
});

/** Dodo subscription event → account status. on_hold means a renewal failed and Dodo is retrying, so it keeps working like Stripe's past_due. */
const DODO_STATUS: Record<string, 'active' | 'past_due' | 'canceled'> = {
	'subscription.active': 'active',
	'subscription.renewed': 'active',
	'subscription.on_hold': 'past_due',
	'subscription.cancelled': 'canceled',
	'subscription.failed': 'canceled',
	'subscription.expired': 'canceled',
};

// POST /api/billing/dodo - Dodo Payments (Standard Webhooks). The checkout links carry `metadata_account_id` for Cloud.
billingRoute.post('/dodo', async (c) => {
	const secret = c.env.DODO_BILLING_WEBHOOK_SECRET;
	const body = await c.req.text();
	if (!secret || !(await verifyStandardWebhook(secret, body, c.req.raw.headers))) return c.text('Invalid signature', 401);
	let event: { type?: string; data?: Record<string, any> };
	try {
		event = JSON.parse(body);
	} catch {
		return c.text('Invalid JSON', 400);
	}
	const d = event.data ?? {};

	// Lifetime: a one-time payment mints a license; the buyer collects it on /license?payment_id=…
	if (event.type === 'payment.succeeded') {
		if (d.subscription_id || typeof d.payment_id !== 'string') return c.json({ received: true, ignored: true });
		const products: unknown[] = Array.isArray(d.product_cart) ? d.product_cart.map((p: { product_id?: unknown }) => p?.product_id) : [];
		if (c.env.LIFETIME_PRODUCT_ID && !products.includes(c.env.LIFETIME_PRODUCT_ID)) return c.json({ received: true, ignored: true });
		const minted = await mintLicense(c.env, d.payment_id, d.customer?.email ?? null);
		return minted ? c.json({ received: true, license: true }) : c.text('LICENSE_SECRET is not set', 503);
	}

	const status = DODO_STATUS[event.type ?? ''];
	if (status && typeof d.subscription_id === 'string') {
		const account = typeof d.metadata?.account_id === 'string' ? d.metadata.account_id : '';
		const periodEnd = Math.floor(Date.parse(d.next_billing_date) / 1000) || null;
		// Only "active" may claim the account named in metadata; the rest touch only the account's current subscription,
		// so an old subscription expiring after a re-subscribe can't switch the account off.
		// shortcut: no event ordering, so a retried "active" can land after "cancelled"; add the event timestamp to accounts if that shows up.
		const res = await (status === 'active'
			? c.env.DB.prepare(
					'UPDATE accounts SET status = ?, current_period_end = ?, stripe_subscription_id = ?, stripe_customer_id = COALESCE(?, stripe_customer_id) WHERE id = ? OR stripe_subscription_id = ?',
				).bind(status, periodEnd, d.subscription_id, d.customer?.customer_id ?? null, account, d.subscription_id)
			: c.env.DB.prepare('UPDATE accounts SET status = ?, current_period_end = ? WHERE stripe_subscription_id = ?').bind(status, periodEnd, d.subscription_id)
		).run();
		return c.json({ received: true, matched: res.meta.changes > 0 });
	}
	return c.json({ received: true, ignored: true });
});
