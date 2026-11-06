import type { Context, Next } from 'hono';
import type { Bindings } from './env.js';

/** Bearer token (or `?token=`, for WebSocket upgrades) guard; fails closed when API_TOKEN is unset. */
export async function requireToken(
	c: Context<{ Bindings: Bindings }>,
	next: Next,
): Promise<Response | void> {
	const expected = c.env.API_TOKEN;
	const given = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') || c.req.query('token') || '';
	if (!expected) return c.text('API_TOKEN not configured', 503); // fail closed
	const [a, b] = await Promise.all([given, expected].map((x) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(x))));
	const x = new Uint8Array(a!);
	const y = new Uint8Array(b!);
	let diff = 0;
	for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
	if (diff !== 0) return c.text('Unauthorized', 401);
	await next();
}
