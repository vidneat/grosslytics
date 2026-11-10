import { useEffect, useRef, useState } from 'react';
import type { DashboardData, DashFilter, DashMode, DashModel, DashRange, DashSale } from '@grosslytics/shared/dashboard';
import { formatMoney } from '@grosslytics/shared/money';
import { formatDuration } from '@grosslytics/shared/dashboard';
import type { JourneyStep } from './demo';

/** Where the edge API lives: PUBLIC_API_URL if set, else this site's own /api/* route (in development, astro.config proxies it to `wrangler dev`). */
export const DEFAULT_API = (import.meta.env?.PUBLIC_API_URL as string | undefined) || '';

export interface Connection {
	api: string;
	/** Empty when signed in with the dashboard password: the HttpOnly session cookie authenticates instead */
	token: string;
	siteId: string;
}

const KEY = 'gl_connection';
// Password sign-in stores no secret here. Only the fallback "API on another address" form keeps its token in localStorage.
export const loadConnection = (): Connection | null => {
	try {
		const c = JSON.parse(localStorage.getItem(KEY) || 'null');
		return c?.api && typeof c.token === 'string' && c?.siteId ? c : null;
	} catch {
		return null;
	}
};

/** Ends the password session (deletes it server-side and clears the cookie). */
export const logout = (api: string) => fetch(`${api.replace(/\/$/, '')}/api/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(() => undefined, () => undefined);
export const saveConnection = (c: Connection | null) => (c ? localStorage.setItem(KEY, JSON.stringify(c)) : localStorage.removeItem(KEY));

export async function apiFetch<T>(c: Pick<Connection, 'api' | 'token'>, path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${c.api.replace(/\/$/, '')}${path}`, {
		...init,
		headers: { authorization: `Bearer ${c.token}`, 'content-type': 'application/json', ...init?.headers },
	});
	if (!res.ok) {
		if (res.status === 401 && !c.token) {
			// Session expired or signed out elsewhere: forget the site choice and show the sign-in screen
			saveConnection(null);
			location.reload();
		}
		if (res.status === 401) throw new Error(c.token ? 'The API token was rejected.' : 'Your session has ended. Sign in again.');
		const text = await res.text().catch(() => '');
		let msg = text;
		try {
			msg = JSON.parse(text).error || text;
		} catch {}
		throw new Error(msg || `Request failed (${res.status}).`);
	}
	return res.json() as Promise<T>;
}

export interface SiteInfo {
	id: string;
	domain: string;
	name: string;
	shared: number;
	timezone?: string;
	/** Payment gateways with a webhook secret saved for this site */
	payments?: string[];
	/** Free self-hosted installs: true until the site's "Powered by Grosslytics" footer link is verified */
	locked?: boolean;
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
	const scope = target ? JSON.stringify(target) : '';
	const [state, setState] = useState<{ scope: string; data: DashboardData | null; error: string | null; loading: boolean }>({ scope, data: null, error: null, loading: !!target });
	const key = JSON.stringify([scope, q, refreshKey]);
	useEffect(() => {
		if (!target) {
			setState({ scope, data: null, error: null, loading: false });
			return;
		}
		const ctl = new AbortController();
		setState((s) => ({ scope, data: s.scope === scope ? s.data : null, error: null, loading: true }));
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
			(data) => !ctl.signal.aborted && setState({ scope, data, error: null, loading: false }),
			(e: Error) => !ctl.signal.aborted && e.name !== 'AbortError' && setState((s) => ({ scope, data: s.scope === scope ? s.data : null, error: e.message || 'Could not reach the API.', loading: false })),
		);
		return () => ctl.abort();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key]);
	return state.scope === scope ? state : { data: null, error: null, loading: !!target };
}

interface JourneyEvent {
	eventType: 'pageview' | 'leave' | 'goal' | 'ai_crawl' | 'click';
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
		.filter((e) => e.timestamp <= sale.at + 60 && e.eventType !== 'click')
		.map((e) => {
			const newSource = e.source !== lastSource;
			lastSource = e.source;
			const kind = e.eventType === 'leave' ? 'leave' : e.eventType === 'goal' ? 'goal' : 'visit';
			const what = kind === 'leave' ? `Left ${e.eventName}` : kind === 'goal' ? `Goal: ${e.eventName}` : `Viewed ${e.eventName}`;
			const detail = kind === 'leave' && e.durationSec ? `${formatDuration(e.durationSec)} read · ${e.scrollDepth}% scrolled` : '';
			return { t: stamp(e.timestamp), kind, what, src: kind === 'visit' && newSource ? e.source : '', detail };
		});
	const amount = formatMoney(sale.gross, sale.currency ?? 'USD', 2);
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
	const scope = conn ? JSON.stringify(conn) : '';
	// `sales` counts every sale message; `entries` keeps only the newest 8, so it can't be used to notice a new sale
	const [state, setState] = useState<{ scope: string; online: number | null; entries: LiveEntry[]; sales: number }>({ scope, online: null, entries: [], sales: 0 });
	const retry = useRef(0);
	useEffect(() => {
		setState({ scope, online: null, entries: [], sales: 0 });
		retry.current = 0;
		if (!conn) return;
		let ws: WebSocket | null = null;
		let timer: ReturnType<typeof setTimeout>;
		let closed = false;
		const open = () => {
			const url = `${conn.api.replace(/^http/, 'ws').replace(/\/$/, '')}/api/stats/live?siteId=${encodeURIComponent(conn.siteId)}&token=${encodeURIComponent(conn.token)}`;
			ws = new WebSocket(url);
			ws.onopen = () => (retry.current = 0);
			ws.onmessage = (m) => {
				if (closed) return;
				const msg = JSON.parse(String(m.data));
				if (msg.type === 'presence') {
					setState((current) => {
						const sales = current.entries.filter((e) => e.sale);
						const visits: LiveEntry[] = msg.recentVisitors.map((v: any) => ({ id: `${v.visitorId}-${v.timestamp}`, cc: v.country, city: v.city, page: v.page, src: v.source, at: v.timestamp / 1000 }));
						return { ...current, scope, online: msg.onlineVisitors, entries: [...sales, ...visits].sort((a, b) => b.at - a.at).slice(0, 8) };
					});
				} else if (msg.type === 'sale') {
					setState((current) => ({ ...current, sales: current.sales + 1, entries: [{ id: `sale-${msg.timestamp}`, cc: msg.country, city: '', page: msg.planName || '', src: msg.lastTouchSource, at: msg.timestamp / 1000, sale: msg.grossAmountCents }, ...current.entries].slice(0, 8) }));
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
	}, [scope]);
	return state.scope === scope ? state : { online: null, entries: [], sales: 0 };
}
