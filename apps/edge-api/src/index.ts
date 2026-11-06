import { Hono } from 'hono';
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
