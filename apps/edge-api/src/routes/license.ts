import { Hono } from 'hono';
import type { Bindings } from '../env.js';
import { hashToken } from '../auth.js';

/**
 * Lifetime licenses, served by the operator's deployment (grosslytics.com), not by customers' installs.
 * Stripe's Payment Link sends the buyer to /license?session_id=…; the billing webhook has recorded that session, so the
 * page can show the key. `npx grosslytics install` then downloads the release bundle with the key.
 */
export const licenseRoute = new Hono<{ Bindings: Bindings }>();

export const LICENSE_PREFIX = 'gl_lic_';

/** Same session, same key: the key never needs storing, only its hash. */
export async function licenseKey(secret: string, sessionId: string): Promise<string> {
	const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(sessionId)));
	return LICENSE_PREFIX + Array.from(mac.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Called by the billing webhook for a paid one-time checkout. Idempotent: Stripe retries are harmless. */
export async function mintLicense(env: Bindings, sessionId: string, email: string | null): Promise<boolean> {
	if (!env.LICENSE_SECRET) return false;
	const key = await licenseKey(env.LICENSE_SECRET, sessionId);
	await env.DB.prepare('INSERT INTO licenses (key_hash, session_id, email) VALUES (?, ?, ?) ON CONFLICT (session_id) DO NOTHING').bind(await hashToken(key), sessionId, email).run();
	return true;
}

// GET /api/license/claim?session_id=cs_… - the key for a paid checkout. 404 until Stripe's webhook arrives, so the page polls.
// The checkout session ID is long, random and only shown to the buyer by Stripe's redirect.
licenseRoute.get('/claim', async (c) => {
	const sessionId = c.req.query('session_id') ?? '';
	if (!c.env.LICENSE_SECRET) return c.json({ error: 'Lifetime licenses are not set up on this server.' }, 503);
	if (!/^cs_[A-Za-z0-9_]{10,255}$/.test(sessionId)) return c.json({ error: 'Missing or invalid checkout session.' }, 400);
	const row = await c.env.DB.prepare('SELECT email FROM licenses WHERE session_id = ?').bind(sessionId).first<{ email: string | null }>();
	if (!row) return c.json({ error: 'Payment not confirmed yet.' }, 404, { 'Cache-Control': 'no-store' });
	return c.json({ key: await licenseKey(c.env.LICENSE_SECRET, sessionId), email: row.email }, 200, { 'Cache-Control': 'no-store' });
});

// GET /api/license/download (Authorization: Bearer gl_lic_…) - the latest release bundle for the installer
licenseRoute.get('/download', async (c) => {
	const key = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
	if (!key.startsWith(LICENSE_PREFIX)) return c.json({ error: 'A license key (gl_lic_…) is required.' }, 401);
	const hash = await hashToken(key);
	const row = await c.env.DB.prepare('SELECT session_id FROM licenses WHERE key_hash = ?').bind(hash).first();
	if (!row) return c.json({ error: 'That license key is not valid.' }, 401);
	const obj = await c.env.RELEASES?.get('latest.tgz');
	if (!obj) return c.json({ error: 'No release has been published yet.' }, 503);
	await c.env.DB.prepare('UPDATE licenses SET last_download_at = unixepoch() WHERE key_hash = ?').bind(hash).run();
	return new Response(obj.body, { headers: { 'content-type': 'application/gzip', 'cache-control': 'no-store' } });
});
