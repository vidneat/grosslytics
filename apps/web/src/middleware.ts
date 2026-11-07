import { defineMiddleware } from 'astro:middleware';

// Pages rendered on request skip the installer's _headers file, so self-hosted copies mark them noindex here
export const onRequest = defineMiddleware(async (ctx, next) => {
	const res = await next();
	if (ctx.url.hostname === 'grosslytics.com') return res;
	try {
		res.headers.set('X-Robots-Tag', 'noindex, nofollow');
		return res;
	} catch {
		// Redirects and passed-through responses have read-only headers
		const copy = new Response(res.body, res);
		copy.headers.set('X-Robots-Tag', 'noindex, nofollow');
		return copy;
	}
});
