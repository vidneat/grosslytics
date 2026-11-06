import { Hono } from 'hono';
import * as v from 'valibot';
import type { Bindings } from '../env.js';

/** Public: interest in plans that aren't self-serve yet. Stores only email + plan; repeats are no-ops. */
export const waitlistRoute = new Hono<{ Bindings: Bindings }>();

const Body = v.object({
	email: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.maxLength(254), v.email()),
	plan: v.picklist(['cloud', 'lifetime']),
});

waitlistRoute.post('/', async (c) => {
	const parsed = v.safeParse(Body, await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: 'A valid email and plan are required' }, 400);
	const { email, plan } = parsed.output;
	// shortcut: no rate limit or CAPTCHA; add a Cloudflare rate-limiting rule on /api/waitlist before launch traffic.
	await c.env.DB.prepare('INSERT INTO waitlist (email, plan) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(email, plan).run();
	return c.json({ ok: true }, 201);
});
