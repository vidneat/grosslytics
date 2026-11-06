import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
	const siteId = params.siteId || 'demo';

	// In production, queries D1 for verified 30d net MRR or total verified net profit
	const verifiedAmount = '$18,420';

	const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="230" height="32" viewBox="0 0 230 32" fill="none">
  <rect width="230" height="32" rx="6" fill="#09090b" stroke="#27272a"/>
  <circle cx="16" cy="16" r="4" fill="#10b981"/>
  <text x="28" y="20" fill="#a1a1aa" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="500">Verified Net Profit</text>
  <rect x="135" y="6" width="88" height="20" rx="4" fill="#10b981" fill-opacity="0.1" stroke="#10b981" stroke-opacity="0.2"/>
  <text x="179" y="20" fill="#34d399" font-family="ui-monospace, monospace" font-size="11" font-weight="700" text-anchor="middle">${verifiedAmount}</text>
</svg>
`.trim();

	return new Response(svg, {
		status: 200,
		headers: {
			'Content-Type': 'image/svg+xml',
			'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400',
			'X-Grosslytics-Site': siteId,
		},
	});
};

