import { Hono } from 'hono';
import type { Bindings } from '../env.js';
import { verifyWebhook } from '../verify.js';
import { mintLicense } from './license.js';

/**
 * Grosslytics' own billing (not a customer's payments): Hosted Cloud subscriptions, and Lifetime licenses (see license.ts). Stripe sends these after someone pays the Indie Cloud
 * Payment Link, which the dashboard opens with `client_reference_id=<account id>`. No Stripe API key is needed:
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
