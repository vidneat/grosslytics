import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const esc = (s) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
const FONT = "font-family=\"Helvetica Neue, Helvetica, Arial, sans-serif\"";

/** A 1200x630 PNG share card per built page, at /og/<path>.png (the homepage's is /og/index.png). X, LinkedIn and Facebook don't draw SVG cards. */
// shortcut: drawn with the build machine's own sans-serif font; bundle a font file if cards must look identical everywhere.
const ogCards = {
	name: 'og-cards',
	hooks: {
		'astro:build:done': ({ dir, pages }) => {
			for (const { pathname } of pages) {
				let html;
				try {
					html = readFileSync(new URL(`${pathname}index.html`, dir), 'utf8');
				} catch {
					continue; // not a page (404.html and the like)
				}
				const title = (html.match(/<title>(.*?)<\/title>/s)?.[1] ?? 'Grosslytics').replace(/&[a-z]+;|&#\d+;/g, ' ').replace(/\s*[—|-]\s*Grosslytics.*$/, '').replace(/^Grosslytics\s*[—|-]\s*/, '').trim();
				// SVG text doesn't wrap: break at about 30 characters, three lines at most
				const lines = title.split(' ').reduce((l, w) => ((l.at(-1) + ' ' + w).trim().length <= 30 ? (l[l.length - 1] = (l.at(-1) + ' ' + w).trim()) : l.push(w), l), ['']).slice(0, 3);
				const svg = `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
<rect width="1200" height="630" fill="#f5f5f7"/>
<rect x="80" y="84" width="40" height="11" rx="5.5" fill="#1d1d1f" opacity="0.28"/>
<rect x="80" y="103" width="27" height="11" rx="5.5" fill="#0071e3"/>
<text x="136" y="110" fill="#1d1d1f" ${FONT} font-size="28" font-weight="bold">Grosslytics</text>
${lines.map((t, i) => `<text x="80" y="${270 + i * 76}" fill="#1d1d1f" ${FONT} font-size="62" font-weight="bold">${esc(t)}</text>`).join('\n')}
<text x="80" y="550" fill="#6e6e73" ${FONT} font-size="24">grosslytics.com · Gross is vanity. Net is what you keep.</text>
</svg>`;
				const out = fileURLToPath(new URL(`og/${pathname.replace(/\/$/, '') || 'index'}.png`, dir));
				mkdirSync(dirname(out), { recursive: true });
				writeFileSync(out, new Resvg(svg).render().asPng());
			}
		},
	},
};

// https://astro.build/config
export default defineConfig({
	site: 'https://grosslytics.com',
	output: 'static',
	adapter: cloudflare({
		imageService: 'cloudflare',
		platformProxy: {
			enabled: true,
		},
	}),
	integrations: [
		react(),
		sitemap({
			filter: (page) =>
				!page.includes('/app/') &&
				!page.includes('/api/') &&
				!page.includes('/badge/') && !page.includes('/license'),
		}),
		ogCards,
	],
	vite: {
		plugins: [tailwindcss()],
		// Dev mirrors production: /api/* on the site's own origin, so the dashboard's session cookie is first-party
		server: { proxy: { '/api': { target: 'http://localhost:8787', ws: true } } },
	},
});

