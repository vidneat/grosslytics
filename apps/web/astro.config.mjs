import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

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
			serialize: (item) => ({
				...item,
				url: new URL(item.url).pathname === '/' ? item.url : item.url.replace(/\/+$/, ''),
			}),
		}),
	],
	vite: {
		plugins: [tailwindcss()],
		// Dev mirrors production: /api/* on the site's own origin, so the dashboard's session cookie is first-party
		server: { proxy: { '/api': { target: 'http://localhost:8787', ws: true } } },
	},
});

