import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
	const route = params.route || 'index';
	const title = route === 'index' ? 'Grosslytics' : route.replace(/-/g, ' ').toUpperCase();

	// Edge-generated dynamic OpenGraph SVG card
	const svg = `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#09090b"/>
  <circle cx="1100" cy="100" r="300" fill="#10b981" fill-opacity="0.08"/>
  <circle cx="100" cy="500" r="250" fill="#06b6d4" fill-opacity="0.06"/>
  <rect x="80" y="80" width="48" height="48" rx="12" fill="#10b981"/>
  <text x="104" y="112" fill="#000" font-family="system-ui, -apple-system, sans-serif" font-size="28" font-weight="900" text-anchor="middle">G</text>
  <text x="148" y="112" fill="#fff" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="700">Grosslytics</text>
  <text x="80" y="260" fill="#fff" font-family="system-ui, -apple-system, sans-serif" font-size="52" font-weight="900" letter-spacing="-1">${title}</text>
  <text x="80" y="330" fill="#34d399" font-family="system-ui, -apple-system, sans-serif" font-size="32" font-weight="700">True Net Profit & Multi-Touch Revenue Attribution</text>
  <text x="80" y="400" fill="#a1a1aa" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="400">Sub-10ms Global Edge Ingestion • 0KB Client JS Islands • Stripe & Razorpay Verified</text>
  <rect x="80" y="480" width="280" height="52" rx="8" fill="#18181b" stroke="#27272a"/>
  <text x="104" y="513" fill="#34d399" font-family="ui-monospace, monospace" font-size="16" font-weight="700">grosslytics.com</text>
</svg>
`.trim();

	return new Response(svg, {
		status: 200,
		headers: {
			'Content-Type': 'image/svg+xml',
			'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
		},
	});
};

