import { Hono } from 'hono';
import * as v from 'valibot';
import { BeaconSchema } from '@grosslytics/shared/schemas';
import { AI_CRAWLER_AGENTS } from '@grosslytics/shared/constants';
import { getDailySaltKey } from '@grosslytics/shared/attribution';
import type { DeviceType, EnrichedEvent } from '@grosslytics/shared/types';
import type { Bindings } from '../env.js';

export const collectRoute = new Hono<{ Bindings: Bindings }>();

// Privacy-preserving hash helper using SubtleCrypto
async function computeCookielessVisitorId(
	siteId: string,
	ip: string,
	ua: string,
	salt: string,
): Promise<string> {
	const raw = `${siteId}|${ip}|${ua}|${salt}`;
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
	const hex = Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
	return hex.slice(0, 16);
}

function parseDevice(ua: string): { deviceType: DeviceType; os: string; browser: string } {
	let deviceType: DeviceType = 'desktop';
	if (/Mobi|Android/i.test(ua)) deviceType = 'mobile';
	else if (/Tablet|iPad/i.test(ua)) deviceType = 'tablet';

	let os = 'Unknown';
	if (/Mac OS/i.test(ua)) os = 'macOS';
	else if (/Windows/i.test(ua)) os = 'Windows';
	else if (/Android/i.test(ua)) os = 'Android';
	else if (/iPhone|iPad/i.test(ua)) os = 'iOS';
	else if (/Linux/i.test(ua)) os = 'Linux';

	let browser = 'Unknown';
	if (/Chrome/i.test(ua) && !/Edge|OPR/i.test(ua)) browser = 'Chrome';
	else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
	else if (/Firefox/i.test(ua)) browser = 'Firefox';
	else if (/Edge/i.test(ua)) browser = 'Edge';

	return { deviceType, os, browser };
}

collectRoute.post('/', async (c) => {
	const startTime = Date.now();
	let rawBody: unknown;

	try {
		rawBody = await c.req.json();
	} catch {
		return c.text('Invalid JSON', 400);
	}

	const parsed = v.safeParse(BeaconSchema, rawBody);
	if (!parsed.success) {
		return c.text('Bad Request', 400);
	}

	const beacon = parsed.output;
	const req = c.req.raw;
	const ua = req.headers.get('user-agent') || '';
	const clientIp = req.headers.get('cf-connecting-ip') || '127.0.0.1';

	// 1. AI Crawler detection
	let eventType = beacon.t;
	if (AI_CRAWLER_AGENTS.some((agent) => ua.includes(agent))) {
		eventType = 'ai_crawl';
	}

	// 2. Privacy-preserving visitor ID fallback if vid missing or empty
	let vid = beacon.vid;
	if (!vid) {
		const salt = getDailySaltKey();
		vid = await computeCookielessVisitorId(beacon.sid, clientIp, ua, salt);
	}

	// 3. Extract Cloudflare Edge Geolocation
	const cf = (req as any).cf || {};
	const country = (cf.country as string) || 'XX';
	const city = (cf.city as string) || '';
	const colo = (cf.colo as string) || 'DFW';
	const asOrganization = (cf.asOrganization as string) || '';

	const { deviceType, os, browser } = parseDevice(ua);

	const enriched: EnrichedEvent = {
		...beacon,
		vid,
		t: eventType,
		country,
		city,
		colo,
		asOrganization,
		deviceType,
		os,
		browser,
		createdAt: Math.floor(startTime / 1000),
	};

	// 4. Async queue push: never block on DB write
	c.executionCtx.waitUntil(
		(async () => {
			// Push to ingestion queue
			if (c.env.INGEST_QUEUE) {
				await c.env.INGEST_QUEUE.send(enriched);
			}

			// Notify Durable Object for real-time presence
			if (c.env.SITE_LIVE_HUB && eventType === 'pageview') {
				try {
					const doId = c.env.SITE_LIVE_HUB.idFromName(beacon.sid);
					const stub = c.env.SITE_LIVE_HUB.get(doId);
					await stub.fetch('http://do/internal/presence', {
						method: 'POST',
						body: JSON.stringify({
							visitorId: vid,
							page: beacon.n,
							source: beacon.src,
							country,
							city,
							timestamp: startTime,
						}),
					});
				} catch {
					// Presence broadcast failure should not affect beacon
				}
			}
		})(),
	);

	// Return 202 Accepted in <5ms
	return c.text('Accepted', 202, {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'POST, OPTIONS',
		'Cache-Control': 'no-store',
	});
});

// CORS preflight
collectRoute.options('/', (c) => {
	return c.body(null, 204, {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
	});
});
