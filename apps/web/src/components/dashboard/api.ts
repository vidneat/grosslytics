import { useEffect, useRef, useState } from 'react';
import type { DashboardData, DashFilter, DashMode, DashModel, DashRange, DashSale } from '@grosslytics/shared/dashboard';
import { formatDuration } from '@grosslytics/shared/dashboard';
import type { JourneyStep } from './demo';

/** Where the edge API lives: PUBLIC_API_URL if set, else `wrangler dev` in development, else this site's own /api/* route. */
export const DEFAULT_API = (import.meta.env.PUBLIC_API_URL as string | undefined) || (import.meta.env.DEV ? 'http://localhost:8787' : '');

export interface Connection {
	api: string;
	token: string;
	siteId: string;
}

const KEY = 'gl_connection';
// shortcut: the API token lives in localStorage (owner's own browser, self-host); hosted multi-user needs real sessions.
export const loadConnection = (): Connection | null => {
	try {
		const c = JSON.parse(localStorage.getItem(KEY) || 'null');
		return c?.api && c?.token && c?.siteId ? c : null;
	} catch {
		return null;
	}
};
export const saveConnection = (c: Connection | null) => (c ? localStorage.setItem(KEY, JSON.stringify(c)) : localStorage.removeItem(KEY));

export async function apiFetch<T>(c: Pick<Connection, 'api' | 'token'>, path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${c.api.replace(/\/$/, '')}${path}`, {
		...init,
		headers: { authorization: `Bearer ${c.token}`, 'content-type': 'application/json', ...init?.headers },
	});
	if (!res.ok) throw new Error(res.status === 401 ? 'The API token was rejected.' : `${res.status} ${await res.text().catch(() => '')}`.trim());
	return res.json() as Promise<T>;
}

export interface SiteInfo {
	id: string;
	domain: string;
	name: string;
	shared: number;
}

const dashQuery = (q: { range: DashRange; model: DashModel; mode: DashMode; filters: DashFilter[] }) => {
	const p = new URLSearchParams({ range: q.range, model: q.model, mode: q.mode });
	for (const f of q.filters) p.set(f.dim, f.value);
	return p;
};

/**
 * Loads dashboard data from the owner API (`conn`) or a public share page (`shareDomain`).
 * Keeps the previous data on screen while a new filter loads, so the layout never jumps.
 */
export function useRemoteDashboard(
	target: { conn: Connection } | { shareDomain: string } | null,
	q: { range: DashRange; model: DashModel; mode: DashMode; filters: DashFilter[] },
	refreshKey = 0,
) {
	const [state, setState] = useState<{ data: DashboardData | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: !!target });
	const key = target ? JSON.stringify([target, q, refreshKey]) : '';
	useEffect(() => {
		if (!target) return;
		const ctl = new AbortController();
		setState((s) => ({ ...s, loading: true }));
		const params = dashQuery(q);
		const req =
			'conn' in target
				? (params.set('siteId', target.conn.siteId), apiFetch<DashboardData>(target.conn, `/api/stats/dashboard?${params}`, { signal: ctl.signal }))
				: fetch(`${DEFAULT_API}/api/share/${encodeURIComponent(target.shareDomain)}?${params}`, { signal: ctl.signal }).then((r) => {
						if (r.status === 404) throw new Error('This site has no public revenue page.');
						if (!r.ok) throw new Error(`${r.status}`);
						return r.json() as Promise<DashboardData>;
					});
		req.then(
			(data) => setState({ data, error: null, loading: false }),
			(e: Error) => e.name !== 'AbortError' && setState((s) => ({ data: s.data, error: e.message || 'Could not reach the API.', loading: false })),
		);
		return () => ctl.abort();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key]);
	return state;
}

interface JourneyEvent {
	eventType: 'pageview' | 'leave' | 'goal' | 'ai_crawl';
	eventName: string;
	source: string;
	timestamp: number;
	durationSec: number;
	scrollDepth: number;
}

const stamp = (t: number) =>
	new Date(t * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', ' ·');

/** The buyer's recorded events, as timeline steps ending in the payment. */
export async function fetchJourney(conn: Connection, sale: DashSale): Promise<JourneyStep[]> {
	if (!sale.visitorId) return [];
	const { events } = await apiFetch<{ events: JourneyEvent[] }>(conn, `/api/stats/journey/${encodeURIComponent(sale.visitorId)}?siteId=${encodeURIComponent(conn.siteId)}`);
	let lastSource = '';
	const steps: JourneyStep[] = events
		.filter((e) => e.timestamp <= sale.at + 60)
		.map((e) => {
			const newSource = e.source !== lastSource;
			lastSource = e.source;
			const kind = e.eventType === 'leave' ? 'leave' : e.eventType === 'goal' ? 'goal' : 'visit';
			const what = kind === 'leave' ? `Left ${e.eventName}` : kind === 'goal' ? `Goal: ${e.eventName}` : `Viewed ${e.eventName}`;
			const detail = kind === 'leave' && e.durationSec ? `${formatDuration(e.durationSec)} read · ${e.scrollDepth}% scrolled` : '';
			return { t: stamp(e.timestamp), kind, what, src: kind === 'visit' && newSource ? e.source : '', detail };
		});
	const amount = (sale.gross / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
	steps.push({ t: stamp(sale.at), kind: 'pay', what: `Paid ${amount} with ${sale.gateway}`, src: '', detail: sale.plan });
	return steps;
}

export interface LiveEntry {
	id: string;
	cc: string;
	city: string;
	page: string;
	src: string;
	at: number;
	sale?: number;
}

/** Owner live feed over the SiteLiveHub WebSocket: presence plus sales. Reconnects with backoff. */
export function useLiveSocket(conn: Connection | null) {
	const [online, setOnline] = useState<number | null>(null);
	const [entries, setEntries] = useState<LiveEntry[]>([]);
	const retry = useRef(0);
	useEffect(() => {
		if (!conn) return;
		let ws: WebSocket | null = null;
		let timer: ReturnType<typeof setTimeout>;
		let closed = false;
		const open = () => {
			const url = `${conn.api.replace(/^http/, 'ws').replace(/\/$/, '')}/api/stats/live?siteId=${encodeURIComponent(conn.siteId)}&token=${encodeURIComponent(conn.token)}`;
			ws = new WebSocket(url);
			ws.onopen = () => (retry.current = 0);
			ws.onmessage = (m) => {
				const msg = JSON.parse(String(m.data));
				if (msg.type === 'presence') {
					setOnline(msg.onlineVisitors);
					setEntries((list) => {
						const sales = list.filter((e) => e.sale);
						const visits: LiveEntry[] = msg.recentVisitors.map((v: any) => ({ id: `${v.visitorId}-${v.timestamp}`, cc: v.country, city: v.city, page: v.page, src: v.source, at: v.timestamp / 1000 }));
						return [...sales, ...visits].sort((a, b) => b.at - a.at).slice(0, 8);
					});
				} else if (msg.type === 'sale') {
					setEntries((list) => [{ id: `sale-${msg.timestamp}`, cc: msg.country, city: '', page: msg.planName || '', src: msg.lastTouchSource, at: msg.timestamp / 1000, sale: msg.grossAmountCents }, ...list].slice(0, 8));
				}
			};
			ws.onclose = () => {
				if (closed) return;
				timer = setTimeout(open, Math.min(30_000, 1000 * 2 ** retry.current++));
			};
		};
		open();
		return () => {
			closed = true;
			clearTimeout(timer);
			ws?.close();
		};
	}, [conn?.api, conn?.token, conn?.siteId]);
	return { online, entries };
}
