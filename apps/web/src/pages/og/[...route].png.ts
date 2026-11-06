import type { APIRoute } from 'astro';

export const prerender = false;

const escapeXml = (s: string) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

export const GET: APIRoute = async ({ params }) => {
	const route = params.route || 'index';
	const title = escapeXml(route === 'index' ? 'Revenue analytics' : route.split('/').pop()!.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));

	// Edge-generated dynamic OpenGraph SVG card
	const svg = `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#f5f5f7"/>
  <rect x="80" y="84" width="40" height="11" rx="5.5" fill="#1d1d1f" opacity="0.28"/>
  <rect x="80" y="103" width="27" height="11" rx="5.5" fill="#0071e3"/>
  <text x="136" y="110" fill="#1d1d1f" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="28" font-weight="600">Grosslytics</text>
  <text x="80" y="300" fill="#1d1d1f" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="68" font-weight="600" letter-spacing="-2">${title}</text>
  <text x="80" y="380" fill="#86868b" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="40" font-weight="600" letter-spacing="-1">Gross is vanity. Net is what you keep.</text>
  <text x="80" y="550" fill="#6e6e73" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="22">grosslytics.com</text>
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

