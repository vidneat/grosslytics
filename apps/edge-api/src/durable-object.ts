import { DurableObject } from 'cloudflare:workers';
import { PRESENCE_TTL_MS } from '@grosslytics/shared/constants';
import type { LivePresenceUpdate, LiveSaleUpdate, LiveUpdate } from '@grosslytics/shared/types';
import type { Bindings } from './env.js';

interface VisitorPresence {
	visitorId: string;
	page: string;
	source: string;
	country: string;
	city: string;
	timestamp: number;
}

export class SiteLiveHub extends DurableObject<Bindings> {
	private visitors = new Map<string, VisitorPresence>();

	constructor(ctx: DurableObjectState, env: Bindings) {
		super(ctx, env);
		// Restore active alarm if none scheduled
		this.ctx.blockConcurrencyWhile(async () => {
			const currentAlarm = await this.ctx.storage.getAlarm();
			if (currentAlarm === null) {
				await this.ctx.storage.setAlarm(Date.now() + 60_000);
			}
		});
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		// 1. WebSocket upgrade for founder dashboard islands
		if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
			const pair = new WebSocketPair();
			const [client, server] = [pair[0], pair[1]];

			// Cloudflare WebSocket Hibernation API: zero idle billing
			this.ctx.acceptWebSocket(server);

			// Send immediate initial presence snapshot
			server.send(JSON.stringify(this.buildPresenceMessage()));

			return new Response(null, { status: 101, webSocket: client });
		}

		// 2. Internal presence ping from POST /api/event
		if (url.pathname === '/internal/presence' && request.method === 'POST') {
			const data = (await request.json()) as VisitorPresence;
			this.visitors.set(data.visitorId, data);
			this.broadcastPresence();
			return new Response('OK', { status: 200 });
		}

		// 3. Internal sale notification from payment webhooks
		if (url.pathname === '/internal/sale' && request.method === 'POST') {
			const sale = (await request.json()) as LiveSaleUpdate;
			this.broadcast(sale);
			return new Response('OK', { status: 200 });
		}

		return new Response('Not found', { status: 404 });
	}

	/** Evicts stale visitors older than 5 minutes */
	async alarm(): Promise<void> {
		const cutoff = Date.now() - PRESENCE_TTL_MS;
		let changed = false;

		for (const [id, v] of this.visitors.entries()) {
			if (v.timestamp < cutoff) {
				this.visitors.delete(id);
				changed = true;
			}
		}

		if (changed) {
			this.broadcastPresence();
		}

		// Schedule next alarm check in 60s
		await this.ctx.storage.setAlarm(Date.now() + 60_000);
	}

	webSocketClose(ws: WebSocket): void {
		ws.close();
	}

	private buildPresenceMessage(): LivePresenceUpdate {
		const recent = Array.from(this.visitors.values())
			.sort((a, b) => b.timestamp - a.timestamp)
			.slice(0, 20);

		return {
			type: 'presence',
			onlineVisitors: this.visitors.size,
			recentVisitors: recent,
		};
	}

	private broadcastPresence(): void {
		this.broadcast(this.buildPresenceMessage());
	}

	private broadcast(msg: LiveUpdate): void {
		const payload = JSON.stringify(msg);
		const sockets = this.ctx.getWebSockets();
		for (let i = 0; i < sockets.length; i++) {
			try {
				sockets[i]!.send(payload);
			} catch {
				// Socket closed or dead
			}
		}
	}
}

