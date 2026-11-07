import { Hono } from 'hono';
import * as v from 'valibot';
import { BeaconSchema } from '@grosslytics/shared/schemas';
import { AI_CRAWLER_AGENTS } from '@grosslytics/shared/constants';
import { getDailySaltKey } from '@grosslytics/shared/attribution';
import type { DeviceType, EnrichedEvent } from '@grosslytics/shared/types';
import type { Bindings } from '../env.js';
import { accountActive, CLOUD_EVENT_CAP, isCloud, usageMonth } from '../cloud.js';

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

// Generic crawler tokens, headless browsers and HTTP libraries. An empty UA is a bot: real browsers always send one.
const BOT_UA = /bot|crawl|spider|slurp|headless|phantom|puppeteer|playwright|selenium|lighthouse|pingdom|uptime|curl|wget|python-|httpclient|okhttp|go-http|axios|node-fetch|java\//i;
// Cloud/hosting networks real Chrome scrapers run from. Consumer VPN networks and Microsoft (corporate/AVD) are deliberately left out.
const DATACENTER_ASNS = new Set([16509, 14618, 396982, 31898, 45102, 132203, 14061, 16276, 24940, 63949, 20473, 51167, 212238, 30058, 398781]);

export function isBotRequest(ua: string, cf: { asn?: number; verifiedBotCategory?: string }): boolean {
	return !ua || BOT_UA.test(ua) || !!cf.verifiedBotCategory || DATACENTER_ASNS.has(Number(cf.asn));
}

// The site ID is public (it sits in page source), so events are only accepted from the site's own domain, its subdomains, or local dev.
export function originAllowed(origin: string, domain: string): boolean {
	if (!origin) return true; // server-side senders have no Origin; browsers always send one on cross-origin POST
	let host: string;
	try {
		host = new URL(origin).hostname.toLowerCase();
	} catch {
		return false;
	}
	if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost')) return true;
	const site = domain.toLowerCase().replace(/^www\./, '');
	return host === site || host.endsWith(`.${site}`);
}

// shortcut: per-isolate cache, so a deleted site keeps accepting events for up to a minute, and a Cloud account can overshoot its cap by about a minute of traffic.
type SiteGate = { domain: string | null; open: boolean };
const siteCache = new Map<string, SiteGate & { expires: number }>();
/** The site's domain, and whether it may record events: always on self-host; on Cloud, while its account is active and under the monthly cap. */
async function siteGate(env: Bindings, siteId: string): Promise<SiteGate> {
	const hit = siteCache.get(siteId);
	if (hit && hit.expires > Date.now()) return hit;
	let gate: SiteGate;
	if (isCloud(env)) {
		const row = await env.DB.prepare(
			`SELECT s.domain, a.status, a.trial_ends_at, x.account_id, COALESCE(u.events, 0) AS used FROM sites s
			 LEFT JOIN account_sites x ON x.site_id = s.site_id LEFT JOIN accounts a ON a.id = x.account_id
			 LEFT JOIN account_usage u ON u.account_id = x.account_id AND u.month = ? WHERE s.site_id = ? LIMIT 1`,
		)
			.bind(usageMonth(), siteId)
			.first<{ domain: string; status: string | null; trial_ends_at: number | null; account_id: string | null; used: number }>();
		// A site with no account was made with API_TOKEN by the operator, so no cap
		const open = !!row && (!row.account_id || (!!row.status && accountActive({ status: row.status, trial_ends_at: row.trial_ends_at ?? 0 }) && row.used < CLOUD_EVENT_CAP));
		gate = { domain: row?.domain ?? null, open };
	} else {
		const row = await env.DB.prepare('SELECT domain FROM sites WHERE site_id = ? LIMIT 1').bind(siteId).first<{ domain: string }>();
		gate = { domain: row?.domain ?? null, open: true };
	}
	if (siteCache.size > 10_000) siteCache.clear();
	siteCache.set(siteId, { ...gate, expires: Date.now() + 60_000 });
	return gate;
}

const MAX_BODY_BYTES = 8 * 1024;

collectRoute.post('/', async (c) => {
	const startTime = Date.now();
	let rawBody: unknown;

	const text = await c.req.text().catch(() => '');
	if (!text || text.length > MAX_BODY_BYTES) return c.text('Bad Request', 400);
	try {
		rawBody = JSON.parse(text);
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

	const cf = (req as any).cf || {};
	const accepted = () => c.text('Accepted', 202, { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });

	// 1. AI Crawler detection, then drop every other bot so visitor counts and attribution stay human
	let eventType = beacon.t;
	if (AI_CRAWLER_AGENTS.some((agent) => ua.includes(agent))) {
		eventType = 'ai_crawl';
	} else if (isBotRequest(ua, cf)) {
		return accepted();
	}

	const { domain, open } = await siteGate(c.env, beacon.sid);
	if (!domain) return c.text('Unknown site', 404);
	if (!originAllowed(req.headers.get('origin') || '', domain)) return c.text('Forbidden', 403);
	// Trial over or plan cap reached: the visitor's page must not notice, so this answers like a recorded event
	if (!open) return accepted();

	// 2. Privacy-preserving visitor ID fallback if vid missing or empty
	let vid = beacon.vid;
	if (!vid) {
		const salt = getDailySaltKey();
		vid = await computeCookielessVisitorId(beacon.sid, clientIp, ua, salt);
	}

	// 3. Extract Cloudflare Edge Geolocation
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
