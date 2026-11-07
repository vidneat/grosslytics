import * as v from 'valibot';

/** Beacon payload schema - validates tracker data at the edge in <0.3ms */
export const BeaconSchema = v.object({
	sid: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
	vid: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
	ses: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
	t: v.picklist(['pageview', 'leave', 'goal', 'ai_crawl', 'click']),
	n: v.pipe(v.string(), v.minLength(1), v.maxLength(2048)),
	src: v.pipe(v.string(), v.maxLength(512)),
	/** Old snippets send the tracker's own channel guess; new ones leave it to the server */
	cat: v.optional(v.pipe(v.string(), v.maxLength(128)), ''),
	ref: v.pipe(v.string(), v.maxLength(2048)),
	sd: v.pipe(v.number(), v.minValue(0), v.maxValue(100), v.integer()),
	dur: v.pipe(v.number(), v.minValue(0), v.maxValue(86400), v.integer()),
	us: v.optional(v.pipe(v.string(), v.maxLength(256))),
	um: v.optional(v.pipe(v.string(), v.maxLength(256))),
	uc: v.optional(v.pipe(v.string(), v.maxLength(256))),
	meta: v.optional(v.pipe(v.string(), v.maxLength(4096))),
});

/** Channel API query (GET /api/stats) */
export const DashboardQuerySchema = v.object({
	siteId: v.pipe(v.string(), v.minLength(1)),
	range: v.optional(v.picklist(['24h', '7d', '30d', '90d']), '30d'),
	model: v.optional(v.picklist(['first', 'last', 'linear']), 'first'),
});
