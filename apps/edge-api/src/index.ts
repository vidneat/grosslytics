import { Hono } from 'hono';
import { requireToken } from './auth.js';
import { cors } from 'hono/cors';
import { collectRoute } from './routes/collect.js';
import { statsRoute } from './routes/stats.js';
import { webhooksRoute } from './routes/webhooks.js';
import { mcpRoute } from './mcp.js';
import { handleQueueBatch } from './consumer.js';
import type { EnrichedEvent } from '@grosslytics/shared/types';
import type { Bindings } from './env.js';

export { SiteLiveHub } from './durable-object.js';

const app = new Hono<{ Bindings: Bindings }>();

// Enable CORS for dashboard and tracker
app.use(
	'*',
	cors({
		origin: (origin) => origin || '*',
		allowMethods: ['GET', 'POST', 'OPTIONS'],
		allowHeaders: ['Content-Type', 'Authorization'],
	}),
);

// Health check
app.get('/', (c) => c.text('Grosslytics Edge API Online', 200));

// Owner-only APIs. Browsers can't set headers on WebSocket upgrades, so `?token=` is also accepted.
// shortcut: one API_TOKEN guards every site, fine for self-host; hosted multi-tenant needs per-site keys.
app.use('/api/stats/*', requireToken);
app.use('/api/mcp/*', requireToken);

// Mount routes
app.route('/api/collect', collectRoute);
app.route('/api/stats', statsRoute);
app.route('/api/webhooks', webhooksRoute);
app.route('/api/mcp', mcpRoute);

// Export worker handler with fetch and queue consumer
export default {
	fetch: app.fetch,
	async queue(batch: MessageBatch<EnrichedEvent>, env: Bindings): Promise<void> {
		await handleQueueBatch(batch, env);
	},
};
