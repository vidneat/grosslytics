import { Hono } from 'hono';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { D1StorageAdapter } from '@grosslytics/db-d1';
import { dateRangeToTimestamps } from '@grosslytics/shared/attribution';
import type { Bindings } from './env.js';

export const mcpRoute = new Hono<{ Bindings: Bindings }>();

export function createMcpServer(env: Bindings, siteId: string) {
	const server = new Server(
		{ name: 'grosslytics-mcp', version: '0.1.0' },
		{ capabilities: { tools: {} } },
	);

	const adapter = new D1StorageAdapter(env.DB);

	server.setRequestHandler(ListToolsRequestSchema, async () => {
		return {
			tools: [
				{
					name: 'query_channel_roas',
					description: 'Query true net profit, ad spend, RPV, and revenue for all acquisition channels',
					inputSchema: {
						type: 'object',
						properties: {
							range: { type: 'string', enum: ['24h', '7d', '30d', '90d'], default: '30d' },
							model: { type: 'string', enum: ['first', 'last', 'linear'], default: 'first' },
						},
					},
				},
				{
					name: 'inspect_unmasked_direct',
					description: 'Inspect in-app WebView traffic (Instagram, TikTok, LinkedIn, etc.) unmasked from fake Direct',
					inputSchema: {
						type: 'object',
						properties: {
							range: { type: 'string', enum: ['7d', '30d', '90d'], default: '30d' },
						},
					},
				},
				{
					name: 'get_ai_search_citations',
					description: 'Get visits originating from AI search engines (ChatGPT, Perplexity, Claude, Gemini, Copilot)',
					inputSchema: {
						type: 'object',
						properties: {
							range: { type: 'string', enum: ['7d', '30d', '90d'], default: '30d' },
						},
					},
				},
				{
					name: 'get_buyer_journeys',
					description: 'Inspect the full touchpoint timeline and reading behavior of a specific converting visitor',
					inputSchema: {
						type: 'object',
						properties: {
							visitorId: { type: 'string', description: 'Visitor ID from payment record' },
						},
						required: ['visitorId'],
					},
				},
				{
					name: 'compare_buyer_reading_time',
					description: 'Compare active reading seconds and scroll depth of converting buyers vs non-converting visitors',
					inputSchema: {
						type: 'object',
						properties: {
							range: { type: 'string', enum: ['7d', '30d', '90d'], default: '30d' },
						},
					},
				},
			],
		};
	});

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name, arguments: args = {} } = request.params;
		const range = (args.range as '24h' | '7d' | '30d' | '90d') || '30d';
		const { start, end } = dateRangeToTimestamps(range);

		if (name === 'query_channel_roas') {
			const model = (args.model as 'first' | 'last' | 'linear') || 'first';
			const stats = await adapter.queryChannelStats(siteId, start, end, model);
			return {
				content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }],
			};
		}

		if (name === 'inspect_unmasked_direct') {
			const stats = await adapter.queryChannelStats(siteId, start, end, 'first');
			const unmasked = stats.filter((s) => s.source.includes('(in-app)'));
			return {
				content: [{ type: 'text', text: JSON.stringify(unmasked, null, 2) }],
			};
		}

		if (name === 'get_ai_search_citations') {
			const stats = await adapter.queryChannelStats(siteId, start, end, 'first');
			const ai = stats.filter((s) => s.category === 'AI Search' || s.source.includes('(AI)'));
			return {
				content: [{ type: 'text', text: JSON.stringify(ai, null, 2) }],
			};
		}

		if (name === 'get_buyer_journeys') {
			const vid = args.visitorId as string;
			const journey = await adapter.getBuyerJourney(siteId, vid);
			return {
				content: [{ type: 'text', text: JSON.stringify(journey, null, 2) }],
			};
		}

		if (name === 'compare_buyer_reading_time') {
			const stats = await adapter.queryChannelStats(siteId, start, end, 'first');
			const summary = stats.map((s) => ({
				channel: s.source,
				conversions: s.conversions,
				avgReadSec: s.avgReadSec,
				avgScrollPct: s.avgScrollPct,
				rpvCents: s.rpvCents,
			}));
			return {
				content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
			};
		}

		throw new Error(`Tool not found: ${name}`);
	});

	return server;
}

// Streamable HTTP endpoint for MCP clients
mcpRoute.all('/', async (c) => {
	const siteId = c.req.query('site') || 'gl_live_default';
	const server = createMcpServer(c.env, siteId);

	if (c.req.method === 'GET') {
		return c.json({
			name: 'grosslytics-mcp',
			version: '0.1.0',
			siteId,
			status: 'ready',
		});
	}

	try {
		const body = await c.req.json();
		// Dispatch JSON-RPC message
		const res = await (server as any).handleMessage(body);
		return c.json(res);
	} catch (err: any) {
		return c.json({ jsonrpc: '2.0', error: { code: -32603, message: err.message }, id: null }, 500);
	}
});
