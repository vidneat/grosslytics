import { Hono } from 'hono';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { D1StorageAdapter, queryDashboard, siteRange } from '@grosslytics/db-d1';
import type { Bindings } from './env.js';

export const mcpRoute = new Hono<{ Bindings: Bindings }>();

const RANGES = ['24h', '7d', '30d', '90d'];

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
							range: { type: 'string', enum: ['24h', '7d', '30d', '90d'], default: '30d' },
						},
					},
				},
				{
					name: 'get_ai_search_citations',
					description: 'Get visits originating from AI search engines (ChatGPT, Perplexity, Claude, Gemini, Copilot)',
					inputSchema: {
						type: 'object',
						properties: {
							range: { type: 'string', enum: ['24h', '7d', '30d', '90d'], default: '30d' },
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
					description: 'Compare buyers with everyone else in the period: time on site, pages per visit, scroll depth and the share who read /pricing',
					inputSchema: {
						type: 'object',
						properties: {
							range: { type: 'string', enum: ['24h', '7d', '30d', '90d'], default: '30d' },
						},
					},
				},
			],
		};
	});

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name, arguments: args = {} } = request.params;
		const range = (args.range ?? '30d') as '24h' | '7d' | '30d' | '90d';
		// A tool-level error the assistant can read and correct, rather than a protocol failure
		const invalid = (text: string) => ({ isError: true, content: [{ type: 'text' as const, text }] });
		if (!RANGES.includes(range)) return invalid(`range must be one of ${RANGES.join(', ')}`);
		if (args.model != null && !['first', 'last', 'linear'].includes(args.model as string)) return invalid('model must be first, last or linear');
		const { start, end } = await siteRange(env.DB, siteId, range);

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
			// The same buyers-vs-everyone-else rows as the dashboard panel
			const d = await queryDashboard(env.DB, siteId, { range, model: 'first', mode: 'net', filters: [] });
			return {
				content: [{ type: 'text', text: JSON.stringify(d.behaviour, null, 2) }],
			};
		}

		throw new Error(`Tool not found: ${name}`);
	});

	return server;
}

// Streamable HTTP endpoint (stateless, JSON responses) — a fresh server+transport per request
mcpRoute.all('/', async (c) => {
	const siteId = c.req.query('site');
	if (!siteId) return c.text('site required', 400);
	const server = createMcpServer(c.env, siteId);
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});
	await server.connect(transport);
	return transport.handleRequest(c.req.raw);
});
