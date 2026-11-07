import { type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import {
	ArrowRight,
	BookOpen,
	Bot,
	CalendarDays,
	ChartColumn,
	FileText,
	Filter as FilterIcon,
	Gauge,
	Globe,
	Hourglass,
	Lightbulb,
	LogOut,
	Monitor,
	Radio,
	Receipt,
	Route,
	Share2,
	StickyNote,
	Trophy,
	Users,
	X,
} from 'lucide-react';
import type { DashboardData, DashSale } from '@grosslytics/shared/dashboard';
import { sourceIcon } from '@grosslytics/shared/dashboard';
import { $dashboardFilters, setAttributionModel, setDateRange, setRevenueMode } from '../../stores/filterStore.js';
import { apiFetch, fetchJourney, loadConnection, logout, saveConnection, useLiveSocket, useRemoteDashboard, type Connection, type SiteInfo } from './api';
import { Milestones, Heatmap, MainChart, MiniBars, ProfitBridge, type Point } from './charts';
import { ApiTokens, CloudBilling, Connect, InstallSnippet, PaymentWebhooks } from './connect';
import { buildDemo, DEMO_NOW, flag, journeyFor, type Dimension, type Filter, type Metric, type Mode, type Model, type Range } from './demo';
import { gatewayLabel, JourneyDrawer, LiveFeed } from './live';
import { AdSpendCsv, AiCrawlers, ClickMap, StripeImport, Waitlist } from './extras';
import { BarList, CurrencyContext, Delta, Panel, SourceIcon, Sparkline, compact, num, useMoney } from './ui';

const MODELS = [
	{ id: 'first', label: 'First touch' },
	{ id: 'last', label: 'Last touch' },
	{ id: 'linear', label: 'Linear' },
] as const;
const MODES = [
	{ id: 'gross', label: 'Gross' },
	{ id: 'net', label: 'Net' },
	{ id: 'profit', label: 'Profit' },
] as const;
const RANGES = (['24h', '7d', '30d', '90d'] as const).map((r) => ({ id: r, label: r.toUpperCase() }));
const MODE_LABEL: Record<Mode, string> = { gross: 'Gross revenue', net: 'Net revenue', profit: 'True profit' };
const MODE_SHORT: Record<Mode, string> = { gross: 'Gross', net: 'Net', profit: 'Profit' };
const DIM_LABEL: Record<Dimension, string> = { source: 'Source', page: 'Page', country: 'Country', device: 'Device' };

type Source = 'demo' | 'api' | 'share';

function Segmented<T extends string>(props: { label: string; value: T; options: ReadonlyArray<{ id: T; label: string }>; onChange: (v: T) => void }) {
	return (
		<div className="seg" role="group" aria-label={props.label}>
			{props.options.map((o) => (
				<button key={o.id} type="button" aria-pressed={props.value === o.id} onClick={() => props.onChange(o.id)}>
					{o.label}
				</button>
			))}
		</div>
	);
}

const bucketLabel = (t: number, step: number, timeZone: string) =>
	step < 86400
		? new Date(t * 1000).toLocaleTimeString('en-US', { hour: 'numeric', timeZone })
		: new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone });

/** Every IANA zone the browser knows, with UTC and the current choice always present. */
const timeZones = (current: string) => [...new Set(['UTC', current, ...Intl.supportedValuesOf('timeZone')])];

const agoText = (s: number) => (s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`);

/**
 * The dashboard. `source` picks the data: the marketing demo, the owner's API (/app), or a public share page.
 */
export default function DashboardIsland({ site = 'acme.io', variant = 'full', source = 'demo' }: { site?: string; variant?: 'full' | 'preview'; source?: Source }) {
	if (source === 'api') return <OwnerDashboard variant={variant} />;
	return <Workspace site={site} variant={variant} source={source} />;
}

/** /app: connect once (API URL + token + site), then the live workspace. */
const ADD_SITE = '__add_site';

function OwnerDashboard({ variant }: { variant: 'full' | 'preview' }) {
	const [conn, setConn] = useState<Connection | null | undefined>(undefined);
	const [sites, setSites] = useState<SiteInfo[]>([]);
	const [picking, setPicking] = useState(false);
	useEffect(() => setConn(loadConnection()), []);
	useEffect(() => {
		if (!conn) return;
		const controller = new AbortController();
		apiFetch<{ sites: SiteInfo[] }>(conn, '/api/stats/sites', { signal: controller.signal }).then((r) => { if (!controller.signal.aborted) setSites(r.sites); }, () => {});
		return () => controller.abort();
	}, [conn?.api, conn?.token, conn?.siteId]); // eslint-disable-line react-hooks/exhaustive-deps

	const connect = (c: Connection | null) => {
		saveConnection(c);
		if (c?.api !== conn?.api || c?.token !== conn?.token) setSites([]);
		setConn(c);
		setPicking(false);
	};
	if (conn === undefined) return null;
	if (!conn) return <div className="px-5 pt-10"><Connect onConnect={connect} /></div>;
	if (picking) return <div className="px-5 pt-10"><Connect start={conn} onConnect={connect} onCancel={() => setPicking(false)} onSignOut={() => connect(null)} /></div>;
	const current = sites.find((s) => s.id === conn.siteId);
	return (
		<>
		{!conn.token && <CloudBilling />}
		<Workspace
			key={JSON.stringify([conn.api, conn.token, conn.siteId, current?.timezone])}
			site={current?.domain ?? conn.siteId}
			variant={variant}
			source="api"
			conn={conn}
			sites={sites}
			onSite={(siteId) => (siteId === ADD_SITE ? setPicking(true) : connect({ ...conn, siteId }))}
			onDisconnect={async () => {
				if (!conn.token) await logout(conn.api);
				connect(null);
			}}
			shared={!!current?.shared}
			onShare={async (enabled) => {
				await apiFetch(conn, `/api/stats/sites/${conn.siteId}/share`, { method: 'POST', body: JSON.stringify({ enabled }) });
				setSites((list) => list.map((s) => (s.id === conn.siteId ? { ...s, shared: enabled ? 1 : 0 } : s)));
			}}
			timezone={current?.timezone}
			onTimezone={async (timezone) => {
				await apiFetch(conn, `/api/stats/sites/${conn.siteId}/timezone`, { method: 'POST', body: JSON.stringify({ timezone }) });
				setSites((list) => list.map((s) => (s.id === conn.siteId ? { ...s, timezone } : s)));
			}}
			payments={current?.payments}
		/>
		</>
	);
}

function Workspace(props: {
	site: string;
	variant: 'full' | 'preview';
	source: Source;
	conn?: Connection;
	sites?: SiteInfo[];
	onSite?: (id: string) => void;
	onDisconnect?: () => void;
	payments?: string[];
	shared?: boolean;
	onShare?: (enabled: boolean) => Promise<void>;
	timezone?: string;
	onTimezone?: (timezone: string) => Promise<void>;
}) {
	const { site, variant, source, conn } = props;
	// The /app page gets a full-width sticky toolbar; share pages and the homepage preview sit inside their own box
	const page = variant === 'full' && source !== 'share';
	const f = useStore($dashboardFilters);
	const range = (f.dateRange === 'custom' ? '30d' : f.dateRange) as Range;
	const model = f.attributionModel as Model;
	const mode = f.revenueMode as Mode;

	const [metric, setMetric] = useState<Metric>('revenue');
	const [compare, setCompare] = useState(true);
	const [filters, setFilters] = useState<Filter[]>([]);
	const [tabs, setTabs] = useState({ sources: 'referrers', pages: 'top', geo: 'countries', tech: 'devices' });
	const [sorts, setSorts] = useState<Record<string, 'visitors' | 'revenue'>>({});
	const [sale, setSale] = useState<DashSale | null>(null);
	const [refresh, setRefresh] = useState(0);
	const [demoOnline, setDemoOnline] = useState(27);

	// Data: demo is computed locally; owner and share pages come from the API.
	const q = { range, model, mode, filters };
	const demo = useMemo(() => (source === 'demo' ? buildDemo(range, model, mode, filters) : null), [source, range, model, mode, filters]);
	const remote = useRemoteDashboard(source === 'api' && conn ? { conn } : source === 'share' ? { shareDomain: site } : null, q, refresh);
	const d: DashboardData | null = demo ?? remote.data;
	const money = useMoney(d?.currency);

	// Live: the owner gets the real socket; the demo simulates; share pages have none (presence is private).
	const live = useLiveSocket(source === 'api' ? (conn ?? null) : null);
	useEffect(() => {
		if (source !== 'demo') return;
		const t = setInterval(() => setDemoOnline((n) => Math.max(14, Math.min(48, n + (Math.random() > 0.5 ? 1 : -1)))), 4000);
		return () => clearInterval(t);
	}, [source]);
	const online = source === 'demo' ? demoOnline : (live.online ?? 0);

	// Owner view refreshes every minute, and right away when a sale lands.
	const saleCount = live.entries.filter((e) => e.sale).length;
	const lastSales = useRef(saleCount);
	useEffect(() => {
		if (saleCount > lastSales.current) setRefresh((r) => r + 1);
		lastSales.current = saleCount;
	}, [saleCount]);
	useEffect(() => {
		if (source !== 'api') return;
		const t = setInterval(() => setRefresh((r) => r + 1), 60_000);
		return () => clearInterval(t);
	}, [source]);

	const closeSale = useCallback(() => setSale(null), []);
	const loadJourney = useCallback(async (s: DashSale) => (source === 'api' && conn ? fetchJourney(conn, s) : journeyFor(s.id)), [source, conn]);

	if (!d) {
		return (
			<div className={page ? 'mx-auto mt-6 max-w-7xl px-5' : ''}>
			<div className="rounded-xl bg-card p-10 text-center ring-1 ring-line">
				{remote.error ? (
					<>
						<p className="text-[15px] text-ink-2" role="alert">{remote.error}</p>
						<div className="mt-4 flex justify-center gap-2">
							<button type="button" className="btn btn-primary" onClick={() => setRefresh((r) => r + 1)}>Try again</button>
							{props.onDisconnect && <button type="button" className="btn btn-quiet" onClick={props.onDisconnect}>Change connection</button>}
						</div>
					</>
				) : (
					<p className="text-[15px] text-ink-3">Loading {site}…</p>
				)}
			</div>
			</div>
		);
	}

	const pick = (dim: Dimension) => (value: string) =>
		setFilters((list) => {
			const same = list.find((x) => x.dim === dim);
			const rest = list.filter((x) => x.dim !== dim);
			return same?.value === value ? rest : [...rest, { dim, value }];
		});
	const activeOf = (dim: Dimension) => filters.find((x) => x.dim === dim)?.value;
	const sortOf = (id: string) => sorts[id] ?? 'revenue';
	const setSort = (id: string) => (s: 'visitors' | 'revenue') => setSorts((m) => ({ ...m, [id]: s }));
	const setTab = (k: keyof typeof tabs) => (v: string) => setTabs((t) => ({ ...t, [k]: v }));

	// KPIs
	const shownMode = mode === 'profit' && !d.adSpendAvailable ? 'net' : mode;
	const t = d.totals;
	const s = d.series;
	const conv = t.visitors ? t.sales / t.visitors : 0;
	const prevConv = d.prev.visitors ? d.prev.sales / d.prev.visitors : 0;
	const kpis: Array<{ id: Metric; label: string; value: string; now: number; before: number; spark: number[]; icon: typeof Users }> = [
		{ id: 'visitors', label: 'Visitors', value: compact(t.visitors), now: t.visitors, before: d.prev.visitors, spark: s.visitors, icon: Users },
		{ id: 'revenue', label: MODE_LABEL[shownMode], value: money(t.revenue), now: t.revenue, before: d.prev.revenue, spark: s.revenue, icon: Receipt },
		{ id: 'rpv', label: 'Revenue per visitor', value: money(t.revenue / Math.max(1, t.visitors), 2), now: t.revenue / Math.max(1, t.visitors), before: d.prev.revenue / Math.max(1, d.prev.visitors), spark: s.revenue.map((r, i) => r / Math.max(1, s.visitors[i]!)), icon: Gauge },
		{ id: 'conversion', label: 'Conversion', value: `${(conv * 100).toFixed(2)}%`, now: conv, before: prevConv, spark: s.sales.map((x, i) => x / Math.max(1, s.visitors[i]!)), icon: ChartColumn },
	];

	const notes = new Map<number, string>();
	for (const a of d.annotations) {
		const i = Math.floor((a.at - s.start) / s.step);
		if (i >= 0 && i < s.n) notes.set(i, notes.has(i) ? `${notes.get(i)} · ${a.label}` : a.label);
	}
	const points: Point[] = Array.from({ length: s.n }, (_, i) => {
		const v = s.visitors[i]!;
		const pv = s.prevVisitors[i]!;
		const by: Record<Metric, [number, number]> = {
			visitors: [v, pv],
			revenue: [s.revenue[i]!, s.prevRevenue[i]!],
			rpv: [s.revenue[i]! / Math.max(1, v), s.prevRevenue[i]! / Math.max(1, pv)],
			conversion: [(s.sales[i]! / Math.max(1, v)) * 100, (s.prevSales[i]! / Math.max(1, pv)) * 100],
		};
		return { label: bucketLabel(s.start + i * s.step, s.step, d.timezone || 'UTC'), note: notes.get(i), value: by[metric][0], prev: by[metric][1] };
	});
	const format: Record<Metric, (v: number) => string> = {
		visitors: (v) => compact(v),
		revenue: (v) => money(v),
		rpv: (v) => money(v, 2),
		conversion: (v) => `${v.toFixed(2)}%`,
	};

	// Insights, computed from the same data; each is skipped when the data can't support it
	const short = (k: string) => k.replace(/ \(.*\)$/, '');
	const bySrc = d.sources.filter((x) => x.visitors >= 10);
	const best = [...bySrc].sort((a, b) => b.revenue / b.visitors - a.revenue / a.visitors)[0];
	const biggest = [...bySrc].sort((a, b) => b.visitors - a.visitors)[0];
	const ai = d.sources.filter((x) => x.cat === 'AI Search' || x.cat === 'AI search');
	const allVisits = d.sources.reduce((a, x) => a + x.visitors, 0);
	const allRevenue = d.sources.reduce((a, x) => a + Math.max(0, x.revenue), 0);
	const pricingRow = d.behaviour.find((b) => b.label === 'Read /pricing');
	const insights = [
		best && biggest && best.key !== biggest.key && biggest.revenue > 0 && {
			text: (
				<>
					Visitors from <b>{short(best.key)}</b> are worth {(best.revenue / best.visitors / (biggest.revenue / biggest.visitors)).toFixed(1)}× those from <b>{short(biggest.key)}</b>, your biggest source.
				</>
			),
			action: () => pick('source')(best.key),
			cta: `Filter to ${short(best.key)}`,
		},
		ai.length > 0 && allVisits > 0 && allRevenue > 0 && {
			text: (
				<>
					AI search brings <b>{Math.round((ai.reduce((a, x) => a + x.visitors, 0) / allVisits) * 100)}%</b> of visitors but <b>{Math.round((ai.reduce((a, x) => a + Math.max(0, x.revenue), 0) / allRevenue) * 100)}%</b> of {MODE_SHORT[shownMode].toLowerCase()} revenue.
				</>
			),
			action: () => setTab('sources')('channels'),
			cta: 'See channels',
		},
		pricingRow && pricingRow.buyers !== '–' && {
			text: (
				<>
					<b>{pricingRow.buyers}</b> of buyers read /pricing before paying; {pricingRow.others} of other visitors do.
				</>
			),
			action: () => pick('page')('/pricing'),
			cta: 'Filter to /pricing',
		},
	].filter(Boolean) as Array<{ text: ReactNode; action: () => void; cta: string }>;

	const revenueLabel = MODE_SHORT[shownMode];
	const detailRevenueLabel = shownMode === 'profit' ? 'Net' : revenueLabel;
	const sourceRows = tabs.sources === 'channels' ? d.groups : tabs.sources === 'campaigns' ? d.campaigns : d.sources;
	const pageRows = tabs.pages === 'entry' ? d.entry : tabs.pages === 'exit' ? d.exit : d.pages;
	const geoRows = tabs.geo === 'cities' ? d.cities : d.countries;
	const techRows = tabs.tech === 'browsers' ? d.browsers : tabs.tech === 'os' ? d.oses : d.devices;
	const full = variant === 'full';
	const isOwner = source === 'api';
	const showLive = source !== 'share';
	const now = d.live ? Date.now() / 1000 : DEMO_NOW;
	const empty = isOwner && t.visitors === 0 && d.sales.length === 0 && filters.length === 0;
	const directMax = Math.max(0.01, ...d.direct.map((r) => r.share));

	const addNote = async () => {
		const label = window.prompt('Add a note to the chart at the current time (e.g. "Launched on Product Hunt"):');
		if (!label?.trim() || !conn) return;
		await apiFetch(conn, '/api/stats/annotations', { method: 'POST', body: JSON.stringify({ siteId: conn.siteId, at: Math.floor(Date.now() / 1000), label: label.trim() }) });
		setRefresh((r) => r + 1);
	};

	return (
		<CurrencyContext.Provider value={d.currency}>
		<div className="text-ink">
			{/* Toolbar: sticks under the site header */}
			<div className={page ? 'sticky top-12 z-40 border-b border-line bg-canvas/85 backdrop-blur-xl backdrop-saturate-150' : ''}>
			<div className={`flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between ${page ? 'mx-auto max-w-7xl px-5 py-3' : 'rounded-xl bg-card px-4 py-3 ring-1 ring-line'}`}>
				<div className="flex flex-wrap items-center gap-3">
					<span className="flex items-center gap-2 text-[15px] font-semibold">
						<span className="flex h-6 w-6 items-center justify-center rounded-md bg-ink text-[12px] font-bold text-canvas" aria-hidden="true">{site[0]?.toUpperCase()}</span>
						{isOwner && props.sites?.length ? (
							<select className="cursor-pointer rounded-lg bg-transparent py-1 pr-1 font-semibold outline-none hover:bg-band" value={conn?.siteId} onChange={(e) => props.onSite?.(e.target.value)} aria-label="Site">
								{props.sites!.map((x) => <option key={x.id} value={x.id}>{x.domain}</option>)}
								<option value={ADD_SITE}>Add another site…</option>
							</select>
						) : (
							site
						)}
					</span>
					{showLive && (
						<span className="inline-flex items-center gap-1.5 rounded-full bg-band px-2.5 py-1 text-[12px] text-ink-2" aria-live="polite">
							<span className="relative flex h-2 w-2">
								{online > 0 && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-up opacity-60" />}
								<span className={`relative inline-flex h-2 w-2 rounded-full ${online > 0 ? 'bg-up' : 'bg-ink-3'}`} />
							</span>
							<span className="tnum font-medium text-ink">{online}</span> online
						</span>
					)}
					{source === 'share' && <span className="rounded-full bg-band px-2.5 py-1 text-[12px] text-ink-2">Verified from the payment provider</span>}
					{filters.map((x) => (
						<button
							key={x.dim}
							type="button"
							onClick={() => pick(x.dim)(x.value)}
							className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-[12px] text-accent hover:bg-accent/15"
							aria-label={`Remove filter ${DIM_LABEL[x.dim]} ${x.value}`}
						>
							<FilterIcon size={12} aria-hidden="true" />
							{DIM_LABEL[x.dim]}: <span className="font-semibold">{x.value}</span>
							<X size={12} aria-hidden="true" />
						</button>
					))}
					{filters.length > 1 && (
						<button type="button" className="text-[12px] text-ink-2 hover:text-ink" onClick={() => setFilters([])}>Clear all</button>
					)}
					{remote.loading && remote.data && <span className="text-[12px] text-ink-3">Updating…</span>}
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Segmented label="Attribution model" value={model} options={MODELS} onChange={setAttributionModel} />
					<Segmented label="Revenue" value={mode} options={MODES} onChange={setRevenueMode} />
					<Segmented label="Date range" value={range} options={RANGES} onChange={setDateRange} />
					{isOwner && (
						<button type="button" className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] text-ink-2 hover:bg-band hover:text-ink" onClick={props.onDisconnect}>
							<LogOut size={14} aria-hidden="true" />
							Sign out
						</button>
					)}
				</div>
			</div>

			</div>

			<div className={page ? 'mx-auto max-w-7xl space-y-5 px-5 pt-6' : 'space-y-5 pt-5'}>
			{remote.error && remote.data && <p className="px-2 text-[13px] text-down" role="alert">Showing the last loaded data: {remote.error}</p>}
			{d.excludedCurrencies.length > 0 && <p className="px-2 text-[13px] text-ink-2" role="status">Reporting in {d.currency}. Payments in {d.excludedCurrencies.join(', ')} are excluded; currencies are never added together.</p>}
			{mode === 'profit' && <p className="px-2 text-[13px] text-ink-2" role="status">{d.adSpendAvailable ? 'Profit includes ad spend in the overview and source breakdowns. Page, campaign, location and technology breakdowns show net revenue.' : 'Ad spend cannot be split by page, country or device. Showing net revenue for this filtered view.'}</p>}
			{empty && conn && <InstallSnippet siteId={conn.siteId} api={conn.api} />}

			{/* KPIs + chart + live */}
			<div className="grid gap-5 lg:grid-cols-12">
				<section className={`rounded-xl bg-card ring-1 ring-line ${showLive ? 'lg:col-span-8' : 'lg:col-span-12'}`} aria-label="Overview">
					<div className="grid grid-cols-2 border-b border-line md:grid-cols-4" role="tablist" aria-label="Chart metric">
						{kpis.map((k, i) => {
							const on = metric === k.id;
							return (
								<button
									key={k.id}
									type="button"
									role="tab"
									aria-selected={on}
									onClick={() => setMetric(k.id)}
									className={`relative px-5 py-5 text-left transition-colors ${on ? 'bg-band/70' : 'hover:bg-band/50'} ${i ? 'border-l border-line' : ''} ${i === 2 ? 'max-md:border-l-0 max-md:border-t' : ''} ${i === 3 ? 'max-md:border-t' : ''} ${i === 0 ? 'rounded-tl-xl' : ''} ${i === 3 ? 'md:rounded-tr-xl' : ''}`}
								>
									{on && <span className="absolute inset-x-0 bottom-[-1px] h-[2px] bg-ink" aria-hidden="true" />}
									<span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.04em] text-ink-3">
										<k.icon size={12} aria-hidden="true" />
										{k.label}
									</span>
									<span className="tnum mt-1.5 block font-display text-[30px] font-semibold leading-tight tracking-[-0.03em]">{k.value}</span>
									<span className="mt-1 flex items-end justify-between gap-2">
										<Delta now={k.now} before={k.before} />
										<Sparkline values={k.spark} active={on} />
									</span>
								</button>
							);
						})}
					</div>
					<div className="px-4 pt-4 pb-3">
						<div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[12px] text-ink-2">
							<span className="flex items-center gap-3">
								<span className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ${metric === 'revenue' ? 'bg-net' : 'bg-accent'}`} />This period</span>
								{compare && <span className="inline-flex items-center gap-1.5"><span className="h-0 w-3 border-t-2 border-dashed border-ink-3" />Previous period</span>}
								{notes.size > 0 && <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-ink-2" />Note</span>}
							</span>
							<span className="flex items-center gap-3">
								{isOwner && (
									<button type="button" className="inline-flex items-center gap-1 text-accent hover:underline" onClick={addNote}>
										<StickyNote size={12} aria-hidden="true" />
										Add note
									</button>
								)}
								<label className="inline-flex cursor-pointer items-center gap-2">
									<input type="checkbox" className="accent-[var(--accent)]" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
									Compare to previous
								</label>
							</span>
						</div>
						<MainChart points={points} kind={metric === 'revenue' ? 'bars' : 'line'} format={format[metric]} showPrev={compare} stacked={false} />
					</div>
				</section>

				{showLive && (
					<Panel title="Live" icon={<Radio size={15} />} className="lg:col-span-4" action={<span className="tnum text-[12px] text-ink-3">{online} on site now</span>}>
						<LiveFeed entries={isOwner ? live.entries : undefined} />
					</Panel>
				)}
			</div>

			{/* Insights */}
			{insights.length > 0 && (
				<section className={`grid divide-line rounded-xl bg-card ring-1 ring-line max-md:divide-y md:divide-x ${insights.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`} aria-label="Insights">
					{insights.map((ins, i) => (
						<div key={i} className="flex flex-col justify-between gap-3 p-5">
							<p className="flex gap-3 text-[14px] leading-snug text-ink-2 [&_b]:font-semibold [&_b]:text-ink">
								<Lightbulb size={16} className="mt-0.5 shrink-0 text-ink-3" aria-hidden="true" />
								<span>{ins.text}</span>
							</p>
							<button type="button" onClick={ins.action} className="inline-flex items-center gap-1 self-start text-[13px] font-medium text-accent hover:underline">
								{ins.cta} <ArrowRight size={13} aria-hidden="true" />
							</button>
						</div>
					))}
				</section>
			)}

			{/* Sources + pages */}
			<div className="grid gap-5 lg:grid-cols-2">
				<Panel
					title="Sources"
					icon={<Share2 size={15} />}
					tabs={[{ id: 'channels', label: 'Channels' }, { id: 'referrers', label: 'Referrers' }, { id: 'campaigns', label: 'Campaigns' }]}
					tab={tabs.sources}
					onTab={setTab('sources')}
				>
					<p className="px-3 pb-2 text-[12px] text-ink-3">{tabs.sources === 'campaigns' ? 'Campaigns with no recorded value appear as (not set).' : 'Visitors may return on other days or appear in another source/channel. Referrers show top rows; totals include every source.'}</p>
					<BarList
						rows={sourceRows}
						limit={tabs.sources === 'channels' ? sourceRows.length : 8}
						revenueLabel={tabs.sources === 'campaigns' ? detailRevenueLabel : revenueLabel}
						sortBy={sortOf('sources')}
						onSort={setSort('sources')}
						onPick={tabs.sources === 'referrers' ? pick('source') : undefined}
						active={activeOf('source')}
						showIcons={tabs.sources === 'referrers'}
					/>
				</Panel>
				<Panel
					title="Pages"
					icon={<FileText size={15} />}
					tabs={[{ id: 'top', label: 'Top' }, { id: 'entry', label: 'Entry' }, { id: 'exit', label: 'Exit' }]}
					tab={tabs.pages}
					onTab={setTab('pages')}
				>
					<p className="px-3 pb-2 text-[12px] text-ink-3">{tabs.pages === 'top' ? 'Revenue from buyers who viewed each page; pages overlap.' : tabs.pages === 'entry' ? 'First page per visitor in this period; includes untracked buyers.' : 'Last page per session; visitors can appear on more than one page.'}</p>
					<BarList rows={pageRows} revenueLabel={detailRevenueLabel} sortBy={sortOf('pages')} onSort={setSort('pages')} onPick={tabs.pages === 'top' ? pick('page') : undefined} active={activeOf('page')} showIcons={false} />
				</Panel>
			</div>

			{!full && (
				<div className="flex justify-center pt-2">
					<a href="/app/demo" className="btn btn-primary">
						Open the full dashboard
						<ArrowRight size={15} aria-hidden="true" />
					</a>
				</div>
			)}

			{full && (
				<>
					<div className="grid gap-4 lg:grid-cols-3">
						<Panel title="Locations" icon={<Globe size={15} />} tabs={[{ id: 'countries', label: 'Countries' }, { id: 'cities', label: 'Cities' }]} tab={tabs.geo} onTab={setTab('geo')}>
							<BarList rows={geoRows} revenueLabel={detailRevenueLabel} sortBy={sortOf('geo')} onSort={setSort('geo')} onPick={tabs.geo === 'countries' ? pick('country') : undefined} active={activeOf('country')} limit={7} />
						</Panel>
						<Panel title="Technology" icon={<Monitor size={15} />} tabs={[{ id: 'devices', label: 'Devices' }, { id: 'browsers', label: 'Browsers' }, { id: 'os', label: 'OS' }]} tab={tabs.tech} onTab={setTab('tech')}>
							<BarList rows={techRows} revenueLabel={detailRevenueLabel} sortBy={sortOf('tech')} onSort={setSort('tech')} onPick={tabs.tech === 'devices' ? pick('device') : undefined} active={activeOf('device')} limit={7} />
						</Panel>
						<Panel title="Readable Direct" icon={<Bot size={15} />}>
							<p className="px-3 pb-3 text-[13px] text-ink-2">What other tools would have called “Direct”.</p>
							{d.direct.length === 0 && <p className="px-3 text-[13px] text-ink-3">No direct or in-app traffic yet.</p>}
							<ul className="space-y-2 px-3">
								{d.direct.map((r) => (
									<li key={r.key} className="grid grid-cols-[1fr_5rem_2.5rem] items-center gap-3 text-[13px]">
										<span className="flex min-w-0 items-center gap-2"><SourceIcon icon={r.icon} label={r.key} /><span className="truncate">{r.key}</span></span>
										<span className="h-2 overflow-hidden rounded-full bg-band"><span className="block h-full rounded-full bg-ink-2" style={{ width: `${(r.share / directMax) * 100}%` }} /></span>
										<span className="tnum text-right">{Math.round(r.share * 100)}%</span>
									</li>
								))}
							</ul>
						</Panel>
					</div>

					<div className="grid gap-5 lg:grid-cols-12">
						{source !== 'share' && (
							<Panel title="Recent sales" icon={<Receipt size={15} />} className="lg:col-span-7" action={d.sales.length > 0 && <span className="text-[12px] text-ink-3">Click a sale to see its journey</span>}>
								{d.sales.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-ink-3">No sales in this period yet.</p>}
								<ul className="tnum">
									{d.sales.map((x) => (
										<li key={x.id}>
											<button type="button" onClick={() => setSale(x)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] hover:bg-band">
												<span className="w-[18px] text-[16px] leading-none" aria-hidden="true">{flag(x.country)}</span>
												<span className="min-w-0 flex-1">
													<span className="block truncate font-medium">{x.email}</span>
													<span className="block truncate text-[12px] text-ink-3">{[x.plan, gatewayLabel(x.gateway), agoText(now - x.at)].filter(Boolean).join(' · ')}</span>
												</span>
												<span className="hidden items-center gap-1 text-ink-3 sm:flex" title={`${x.first} → ${x.last}`}>
													<SourceIcon icon={sourceIcon(x.first)} label={x.first} size={14} />
													<ArrowRight size={12} aria-hidden="true" />
													<SourceIcon icon={sourceIcon(x.last)} label={x.last} size={14} />
													<span className="sr-only">First touch {x.first}, last touch {x.last}</span>
												</span>
												{x.refunded && <span className="rounded-full bg-down/10 px-2 py-0.5 text-[11px] font-medium text-down">Refunded</span>}
												<span className={`w-20 text-right font-semibold ${x.refunded ? 'text-ink-3 line-through' : ''}`}>{money(x.gross)}</span>
											</button>
										</li>
									))}
								</ul>
							</Panel>
						)}
						<div className={`grid gap-4 ${source === 'share' ? 'lg:col-span-12 lg:grid-cols-2' : 'lg:col-span-5'}`}>
							<Panel title="Where the money goes" icon={<Receipt size={15} />} action={isOwner && conn && <AdSpendButton conn={conn} sources={d.sources.map((x) => x.key)} onSaved={() => setRefresh((r) => r + 1)} />}>
								{t.gross > 0 ? <ProfitBridge gross={t.gross} fee={t.fee} ad={t.ad} /> : <p className="px-3 py-4 text-[13px] text-ink-3">Fees and ad spend are subtracted here once sales come in.</p>}
							</Panel>
							<Panel title="Time to convert" icon={<Hourglass size={15} />}>
								<MiniBars rows={d.timeToConvert} />
							</Panel>
						</div>
					</div>

					<div className="grid gap-5 lg:grid-cols-12">
						<Panel title="When buyers buy" icon={<CalendarDays size={15} />} className="lg:col-span-7">
							<Heatmap grid={d.heat} refunds={d.heatRefunds} total={t.sales} timeZone={d.timezone || 'UTC'} />
						</Panel>
						<Panel title="Buyers vs everyone else" icon={<BookOpen size={15} />} className="lg:col-span-5">
							<table className="tnum w-full text-[13px]">
								<thead>
									<tr className="text-[11px] text-ink-3">
										<th scope="col" className="px-3 pb-2 text-left font-medium"><span className="sr-only">Measure</span></th>
										<th scope="col" className="px-3 pb-2 text-right font-semibold text-ink-2">Buyers</th>
										<th scope="col" className="px-3 pb-2 text-right font-medium">Everyone else</th>
									</tr>
								</thead>
								<tbody>
									{d.behaviour.map((b) => (
										<tr key={b.label} className="border-t border-line">
											<th scope="row" className="px-3 py-2.5 text-left font-normal text-ink-2">{b.label}</th>
											<td className="px-3 py-2.5 text-right font-semibold">{b.buyers}</td>
											<td className="px-3 py-2.5 text-right text-ink-2">{b.others}</td>
										</tr>
									))}
								</tbody>
							</table>
						</Panel>
					</div>

					<div className="grid gap-5 lg:grid-cols-2">
						<Panel title="Purchase milestones" icon={<Route size={15} />}>
							<p className="px-3 pb-3 text-[12px] text-ink-3">Independent counts in this period, not a sequential funnel.</p>
							<Milestones steps={d.funnel} />
						</Panel>
						<Panel title="Lifetime value by first source" icon={<Trophy size={15} />}>
							{d.ltv.length === 0 && <p className="px-3 py-4 text-[13px] text-ink-3">Appears after your first sales.</p>}
							<ul className="tnum px-1">
								{d.ltv.map((r) => (
									<li key={r.key} className="flex items-center gap-2 rounded-lg px-2 py-[7px] text-[14px]">
										<SourceIcon icon={r.icon} label={r.key} />
										<span className="min-w-0 flex-1 truncate">{r.key}</span>
										<span className="w-24 text-right text-[12px] text-ink-3">{num(r.customers)} customer{r.customers === 1 ? '' : 's'}</span>
										<span className="w-20 text-right font-semibold">{money(r.ltv)}</span>
									</li>
								))}
							</ul>
							<p className="px-3 pt-2 text-[12px] text-ink-3">Net revenue per customer, all time, renewals included.</p>
						</Panel>
					</div>

					{isOwner && conn && (
						<div className="grid gap-5 lg:grid-cols-2">
							<AiCrawlers conn={conn} range={range} />
							<ClickMap conn={conn} range={range} />
						</div>
					)}

					{isOwner && props.onShare && (
						<label className="flex items-center justify-center gap-2 text-[13px] text-ink-2">
							<input type="checkbox" className="accent-[var(--accent)]" checked={!!props.shared} onChange={(e) => props.onShare!(e.target.checked)} />
							Public revenue page at <a className="text-accent hover:underline" href={`/share/${site}`}>/share/{site}</a> (no customer emails or journeys)
						</label>
					)}
					{isOwner && props.onTimezone && props.timezone && (
						<label className="mt-2 flex items-center justify-center gap-2 text-[13px] text-ink-2">
							Days and hours in
							<select className="rounded-lg bg-band px-2 py-1 text-[13px] ring-1 ring-line" value={props.timezone} onChange={(e) => props.onTimezone!(e.target.value)} aria-label="Site timezone">
								{timeZones(props.timezone).map((tz) => <option key={tz}>{tz}</option>)}
							</select>
						</label>
					)}
					{isOwner && conn && props.payments && <PaymentWebhooks key={conn.siteId} conn={conn} connected={props.payments} />}
					{isOwner && conn && <StripeImport conn={conn} onDone={() => setRefresh((r) => r + 1)} />}
					{isOwner && conn && <AdSpendCsv conn={conn} onSaved={() => setRefresh((r) => r + 1)} />}
					{isOwner && conn && <ApiTokens conn={conn} />}
					{isOwner && conn && <Waitlist conn={conn} />}
				</>
			)}
			</div>

			<JourneyDrawer sale={sale} onClose={closeSale} loadJourney={loadJourney} />
		</div>
		</CurrencyContext.Provider>
	);
}

/** Owner-only: record a day's ad spend for a source, so True profit subtracts it. */
function AdSpendButton({ conn, sources, onSaved }: { conn: Connection; sources: string[]; onSaved: () => void }) {
	const currency = useContext(CurrencyContext);
	const [open, setOpen] = useState(false);
	const [source, setSource] = useState(sources[0] ?? '');
	const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
	const [amount, setAmount] = useState('');
	const [error, setError] = useState('');
	if (!open)
		return (
			<button type="button" className="text-[12px] text-accent hover:underline" onClick={() => setOpen(true)}>
				Add ad spend
			</button>
		);
	const field = 'rounded-md bg-band px-2 py-1 text-[12px] ring-1 ring-line';
	return (
		<form
			className="flex flex-wrap items-center gap-1.5"
			onSubmit={async (e) => {
				e.preventDefault();
				try {
					await apiFetch(conn, '/api/stats/ad-spend', { method: 'POST', body: JSON.stringify({ siteId: conn.siteId, source, date, amountCents: Math.round(Number(amount) * 100) }) });
					setOpen(false);
					onSaved();
				} catch (err) {
					setError((err as Error).message);
				}
			}}
		>
			<input className={`${field} w-32`} list="gl-ad-sources" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source" required />
			<datalist id="gl-ad-sources">{sources.map((x) => <option key={x} value={x} />)}</datalist>
			<input className={field} type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" required />
			<input className={`${field} w-20`} type="number" min="0" step="0.01" placeholder={currency} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={`Amount in ${currency}`} required />
			<button className="text-[12px] font-medium text-accent">Save</button>
			{error && <span className="text-[12px] text-down">{error}</span>}
		</form>
	);
}
