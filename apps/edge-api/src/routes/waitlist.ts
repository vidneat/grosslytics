import { Hono } from 'hono';
import * as v from 'valibot';
import type { Bindings } from '../env.js';

/** Public: interest in plans that aren't self-serve yet. Stores only email + plan; repeats are no-ops. */
export const waitlistRoute = new Hono<{ Bindings: Bindings }>();

const Body = v.object({
	email: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.maxLength(254), v.email()),
	plan: v.picklist(['cloud', 'lifetime']),
	/** Honeypot: hidden from people, filled in by form bots */
	website: v.optional(v.string()),
});

waitlistRoute.post('/', async (c) => {
	const parsed = v.safeParse(Body, await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: 'A valid email and plan are required' }, 400);
	const { email, plan, website } = parsed.output;
	if (website) return c.json({ ok: true }, 201); // a bot: answer like success, store nothing
	// 5 sign-ups a minute per IP (WAITLIST_LIMITER in wrangler.toml); without the binding there is no limit
	const ip = c.req.header('cf-connecting-ip') || 'unknown';
	if (c.env.WAITLIST_LIMITER && !(await c.env.WAITLIST_LIMITER.limit({ key: ip })).success) return c.json({ error: 'Too many tries. Wait a minute and try again.' }, 429);
	await c.env.DB.prepare('INSERT INTO waitlist (email, plan) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(email, plan).run();
	return c.json({ ok: true }, 201);
});
