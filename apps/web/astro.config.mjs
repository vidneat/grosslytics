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
				!page.includes('/badge/'),
		}),
	],
	vite: {
		plugins: [tailwindcss()],
	},
});
