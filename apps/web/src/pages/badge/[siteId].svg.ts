import type { APIRoute } from 'astro';
import { formatMoney } from '@grosslytics/shared/money';

export const prerender = false;

/** Last 30 days of net revenue from the site's public page; null when the site has none. */
async function verifiedNet(api: string, domain: string): Promise<string | null> {
	try {
		const res = await fetch(`${api}/api/share/${encodeURIComponent(domain)}?range=30d&mode=net`, { signal: AbortSignal.timeout(3000) });
		if (!res.ok) return null;
		const d = (await res.json()) as { currency: string; totals: { revenue: number } };
		return formatMoney(d.totals.revenue, d.currency);
	} catch {
		return null;
	}
}

export const GET: APIRoute = async ({ params, url }) => {
	const siteId = params.siteId || 'demo';
	const api = import.meta.env.PUBLIC_API_URL || (import.meta.env.DEV ? 'http://localhost:8787' : url.origin);
	const amount = await verifiedNet(api, siteId);
	const label = amount ? 'Verified net, 30 days' : 'Not verified yet';
	const verifiedAmount = amount ?? '—';

	const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="210" height="32" viewBox="0 0 210 32" role="img" aria-label="${label} ${verifiedAmount}">
  <rect x="0.5" y="0.5" width="209" height="31" rx="15.5" fill="#fff" stroke="#d2d2d7"/>
  <rect x="12" y="11" width="12" height="3.5" rx="1.75" fill="#1d1d1f" opacity="0.28"/>
  <rect x="12" y="17.5" width="8" height="3.5" rx="1.75" fill="#0071e3"/>
  <text x="32" y="20.5" fill="#6e6e73" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="12">${label}</text>
  <text x="196" y="20.5" fill="#1d1d1f" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="12" font-weight="600" text-anchor="end">${verifiedAmount}</text>
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

