import type { PaymentGateway } from '@grosslytics/shared/types';

const enc = new TextEncoder();
const TOLERANCE_SEC = 300; // replay window for timestamped signatures

async function hmac(key: Uint8Array, msg: string): Promise<Uint8Array> {
	const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

export function safeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let r = 0;
	for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return r === 0;
}

/** Parses "k=v,k=v" (Stripe) or "k=v;k=v" (Paddle) signature headers; repeated keys are kept. */
function parsePairs(header: string, sep: string): Array<[string, string]> {
	return header.split(sep).map((p) => {
		const i = p.indexOf('=');
		return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as [string, string];
	});
}

/**
 * Verifies a payment gateway webhook signature against the raw request body.
 * Returns false on any missing header, stale timestamp, or mismatch.
 */
export async function verifyWebhook(
	gateway: PaymentGateway,
	secret: string,
	body: string,
	headers: Headers,
	now = Math.floor(Date.now() / 1000),
): Promise<boolean> {
	const key = enc.encode(secret);
	const fresh = (ts: number) => Number.isFinite(ts) && Math.abs(now - ts) <= TOLERANCE_SEC;

	if (gateway === 'stripe') {
		const pairs = parsePairs(headers.get('stripe-signature') || '', ',');
		const t = Number(pairs.find(([k]) => k === 't')?.[1]);
		if (!fresh(t)) return false;
		const expected = hex(await hmac(key, `${t}.${body}`));
		return pairs.some(([k, v]) => k === 'v1' && safeEqual(v, expected));
	}

	if (gateway === 'paddle') {
		const pairs = parsePairs(headers.get('paddle-signature') || '', ';');
		const ts = pairs.find(([k]) => k === 'ts')?.[1] || '';
		if (!fresh(Number(ts))) return false;
		const expected = hex(await hmac(key, `${ts}:${body}`));
		return pairs.some(([k, v]) => k === 'h1' && safeEqual(v, expected));
	}

	if (gateway === 'polar') {
		// Standard Webhooks spec; "whsec_" secrets are base64, others are raw bytes (Polar SDK behaviour)
		const id = headers.get('webhook-id') || '';
		const ts = headers.get('webhook-timestamp') || '';
		if (!id || !fresh(Number(ts))) return false;
		const polarKey = secret.startsWith('whsec_')
			? Uint8Array.from(atob(secret.slice(6)), (c) => c.charCodeAt(0))
			: key;
		const expected = b64(await hmac(polarKey, `${id}.${ts}.${body}`));
		return (headers.get('webhook-signature') || '')
			.split(' ')
			.some((s) => s.startsWith('v1,') && safeEqual(s.slice(3), expected));
	}

	if (gateway === 'cashfree') {
		// base64 HMAC-SHA256 of timestamp (ms) + raw body
		const ts = headers.get('x-webhook-timestamp') || '';
		if (!fresh(Math.floor(Number(ts) / 1000))) return false;
		return safeEqual(headers.get('x-webhook-signature') || '', b64(await hmac(key, ts + body)));
	}

	if (gateway === 'revenuecat') {
		// RevenueCat sends the Authorization header value you set on the webhook
		const auth = (headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
		return safeEqual(auth, secret.replace(/^Bearer\s+/i, ''));
	}

	if (gateway === 'paypal') return verifyPaypal(secret, body, headers);

	if (gateway === 'gumroad') return false; // checked by URL key in the route

	// Razorpay & LemonSqueezy: hex HMAC-SHA256 of the raw body
	const sig = headers.get(gateway === 'razorpay' ? 'x-razorpay-signature' : 'x-signature') || '';
	return safeEqual(sig, hex(await hmac(key, body)));
}

/**
 * PayPal signs with a certificate chain, so verification is PayPal's own verify-webhook-signature API.
 * The saved secret is "client_id:client_secret:webhook_id", with ":sandbox" appended for sandbox apps.
 */
async function verifyPaypal(secret: string, body: string, headers: Headers): Promise<boolean> {
	const [clientId, clientSecret, webhookId, mode] = secret.split(':');
	if (!clientId || !clientSecret || !webhookId) return false;
	const base = mode === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
	try {
		JSON.parse(body);
		const auth = await fetch(`${base}/v1/oauth2/token`, {
			method: 'POST',
			headers: { authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, 'content-type': 'application/x-www-form-urlencoded' },
			body: 'grant_type=client_credentials',
		}).then((r) => (r.ok ? (r.json() as Promise<{ access_token?: string }>) : null));
		if (!auth?.access_token) return false;
		const h = (k: string) => JSON.stringify(headers.get(k) || '');
		const res = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
			method: 'POST',
			headers: { authorization: `Bearer ${auth.access_token}`, 'content-type': 'application/json' },
			// webhook_event must be the exact bytes PayPal signed, so the raw body is spliced in, not re-serialized
			body: `{"auth_algo":${h('paypal-auth-algo')},"cert_url":${h('paypal-cert-url')},"transmission_id":${h('paypal-transmission-id')},"transmission_sig":${h('paypal-transmission-sig')},"transmission_time":${h('paypal-transmission-time')},"webhook_id":${JSON.stringify(webhookId)},"webhook_event":${body}}`,
		});
		return res.ok && ((await res.json()) as { verification_status?: string }).verification_status === 'SUCCESS';
	} catch {
		return false;
	}
}
