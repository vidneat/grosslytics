import { Hono } from 'hono';
import { requireToken } from './auth.js';
import { cors } from 'hono/cors';
import { collectRoute } from './routes/collect.js';
import { statsRoute } from './routes/stats.js';
import { webhooksRoute } from './routes/webhooks.js';
import { shareRoute } from './routes/share.js';
import { waitlistRoute } from './routes/waitlist.js';
import { mcpRoute } from './mcp.js';
import { authRoute } from './routes/auth.js';
import { billingRoute } from './routes/billing.js';
import { licenseRoute } from './routes/license.js';
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
// The /app owner signs in with a password (session cookie); API_TOKEN is the master key; gl_pat_ tokens are read-only per site.
app.use('/api/stats/*', requireToken);
app.use('/api/mcp/*', requireToken);

// Mount routes
// /api/event: EasyPrivacy blocks URLs ending in /api/collect. The old path stays for snippets already installed.
app.route('/api/event', collectRoute);
app.route('/api/collect', collectRoute);
app.route('/api/stats', statsRoute);
app.route('/api/webhooks', webhooksRoute);
app.route('/api/share', shareRoute);
app.route('/api/waitlist', waitlistRoute);
app.route('/api/mcp', mcpRoute);
app.route('/api/auth', authRoute);
app.route('/api/billing', billingRoute);
app.route('/api/license', licenseRoute);

// Export worker handler with fetch and queue consumer
export default {
	fetch: app.fetch,
	async queue(batch: MessageBatch<EnrichedEvent>, env: Bindings): Promise<void> {
		await handleQueueBatch(batch, env);
	},
};
