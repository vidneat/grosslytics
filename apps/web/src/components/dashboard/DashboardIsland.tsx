import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '@nanostores/react';
import {
	Bot,
	ChartColumn,
	FileText,
	Filter as FilterIcon,
	Gauge,
	Globe,
	Hourglass,
	Lightbulb,
	Monitor,
	Radio,
	Receipt,
	Route,
	Share2,
	Trophy,
	Users,
	X,
	CalendarDays,
	BookOpen,
	ArrowRight,
} from 'lucide-react';
import { $dashboardFilters, setAttributionModel, setDateRange, setRevenueMode } from '../../stores/filterStore.js';
import { ANNOTATIONS_30D, buildDemo, type Dimension, type Filter, type Metric, type Mode, type Model, type Range, SALES, flag } from './demo';
import { Funnel, Heatmap, MainChart, MiniBars, ProfitBridge, type Point } from './charts';
import { JourneyDrawer, LiveFeed } from './live';
import { BarList, Delta, Panel, SourceIcon, Sparkline, compact, num, usd } from './ui';

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

function pointLabel(range: Range, i: number, n: number): string {
	const back = n - 1 - i;
	if (range === '24h') return back === 0 ? 'Now' : `${back}h ago`;
	return new Date(Date.UTC(2026, 2, 31) - back * 86_400_000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function annotationAt(range: Range, i: number, n: number): string | undefined {
	if (range === '24h') return undefined;
	const offset = 30 - n; // index i in this range == day (offset + i) of the 30-day baseline
	const day = range === '90d' ? i - 60 : offset + i;
	return ANNOTATIONS_30D.find((a) => a.at === day)?.label;
}

export default function DashboardIsland({ site = 'acme.io', variant = 'full' }: { site?: string; variant?: 'full' | 'preview' }) {
	const f = useStore($dashboardFilters);
	const range = (f.dateRange === 'custom' ? '30d' : f.dateRange) as Range;
	const model = f.attributionModel as Model;
	const mode = f.revenueMode as Mode;

	const [metric, setMetric] = useState<Metric>('revenue');
	const [compare, setCompare] = useState(true);
	const [filters, setFilters] = useState<Filter[]>([]);
	const [tabs, setTabs] = useState({ sources: 'referrers', pages: 'top', geo: 'countries', tech: 'devices' });
	const [sorts, setSorts] = useState<Record<string, 'visitors' | 'revenue'>>({});
	const [sale, setSale] = useState<(typeof SALES)[number] | null>(null);
	const [online, setOnline] = useState(27);

	useEffect(() => {
		// Demo only: random walk standing in for the SiteLiveHub presence count
		const t = setInterval(() => setOnline((n) => Math.max(14, Math.min(48, n + (Math.random() > 0.5 ? 1 : -1)))), 4000);
		return () => clearInterval(t);
	}, []);

	const d = useMemo(() => buildDemo(range, model, mode, filters), [range, model, mode, filters]);
	const closeSale = useCallback(() => setSale(null), []);

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
	const t = d.totals;
	const conv = t.visitors ? t.sales / t.visitors : 0;
	const prevConv = d.prev.visitors ? d.prev.sales / d.prev.visitors : 0;
	const s = d.series;
	const kpis: Array<{ id: Metric; label: string; value: string; now: number; before: number; spark: number[]; icon: typeof Users }> = [
		{ id: 'visitors', label: 'Visitors', value: compact(t.visitors), now: t.visitors, before: d.prev.visitors, spark: s.visitors, icon: Users },
		{ id: 'revenue', label: MODE_LABEL[mode], value: usd(t.revenue), now: t.revenue, before: d.prev.revenue, spark: s.revenue, icon: Receipt },
		{ id: 'rpv', label: 'Revenue per visitor', value: usd(t.revenue / Math.max(1, t.visitors), 2), now: t.revenue / Math.max(1, t.visitors), before: d.prev.revenue / Math.max(1, d.prev.visitors), spark: s.revenue.map((r, i) => r / Math.max(1, s.visitors[i]!)), icon: Gauge },
		{ id: 'conversion', label: 'Conversion', value: `${(conv * 100).toFixed(2)}%`, now: conv, before: prevConv, spark: s.sales.map((x, i) => x / Math.max(1, s.visitors[i]!)), icon: ChartColumn },
	];

	const points: Point[] = Array.from({ length: s.n }, (_, i) => {
		const label = pointLabel(range, i, s.n);
		const note = annotationAt(range, i, s.n);
		const v = s.visitors[i]!;
		const pv = s.prevVisitors[i]!;
		const by: Record<Metric, [number, number]> = {
			visitors: [v, pv],
			revenue: [s.revenue[i]!, s.prevRevenue[i]!],
			rpv: [s.revenue[i]! / Math.max(1, v), s.prevRevenue[i]! / Math.max(1, pv)],
			conversion: [(s.sales[i]! / Math.max(1, v)) * 100, (s.prevSales[i]! / Math.max(1, pv)) * 100],
		};
		return { label, note, value: by[metric][0], prev: by[metric][1] };
	});
	const format: Record<Metric, (v: number) => string> = {
		visitors: (v) => compact(v),
		revenue: (v) => usd(v),
		rpv: (v) => usd(v, 2),
		conversion: (v) => `${v.toFixed(2)}%`,
	};

	// Insights, computed from the same data
	const bySrc = d.allSources.filter((x) => x.visitors > 0);
	const best = [...bySrc].sort((a, b) => b.revenue / b.visitors - a.revenue / a.visitors)[0]!;
	const biggest = [...bySrc].sort((a, b) => b.visitors - a.visitors)[0]!;
	const ai = bySrc.filter((x) => x.cat === 'AI search');
	const aiVisitShare = ai.reduce((a, x) => a + x.visitors, 0) / bySrc.reduce((a, x) => a + x.visitors, 0);
	const aiRevShare = ai.reduce((a, x) => a + x.revenue, 0) / Math.max(1, bySrc.reduce((a, x) => a + x.revenue, 0));
	const insights = [
		{
			text: (
				<>
					Visitors from <b>{best.key.replace(/ \(.*\)$/, '')}</b> are worth {((best.revenue / best.visitors) / Math.max(0.01, biggest.revenue / biggest.visitors)).toFixed(1)}× those from <b>{biggest.key.replace(/ \(.*\)$/, '')}</b>, your biggest source.
				</>
			),
			action: () => pick('source')(best.key),
			cta: `Filter to ${best.key.replace(/ \(.*\)$/, '')}`,
		},
		{
			text: (
				<>
					AI search brings <b>{Math.round(aiVisitShare * 100)}%</b> of visitors but <b>{Math.round(aiRevShare * 100)}%</b> of {MODE_SHORT[mode].toLowerCase()} revenue.
				</>
			),
			action: () => setTab('sources')('channels'),
			cta: 'See channels',
		},
		{
			text: (
				<>
					<b>94%</b> of buyers read /pricing before paying; only 17% of other visitors do.
				</>
			),
			action: () => pick('page')('/pricing'),
			cta: 'Filter to /pricing',
		},
	];

	const revenueLabel = MODE_SHORT[mode];
	const sourceRows = tabs.sources === 'channels' ? d.groups : tabs.sources === 'campaigns' ? d.campaigns : d.sources.map((x) => ({ ...x, note: x.cat }));
	const pageRows = tabs.pages === 'entry' ? d.entry : tabs.pages === 'exit' ? d.exit : d.pages;
	const geoRows = tabs.geo === 'cities' ? d.cities : d.countries;
	const techRows = tabs.tech === 'browsers' ? d.browsers : tabs.tech === 'os' ? d.oses : d.devices;
	const full = variant === 'full';

	return (
		<div className="space-y-4 text-ink">
			{/* Toolbar */}
			<div className="flex flex-col gap-3 rounded-[22px] bg-card px-4 py-3 ring-1 ring-line xl:flex-row xl:items-center xl:justify-between">
				<div className="flex flex-wrap items-center gap-3">
					<span className="flex items-center gap-2 text-[15px] font-semibold">
						<span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-[12px] font-bold text-white" aria-hidden="true">{site[0]?.toUpperCase()}</span>
						{site}
					</span>
					<span className="inline-flex items-center gap-1.5 rounded-full bg-band px-2.5 py-1 text-[12px] text-ink-2" aria-live="polite">
						<span className="relative flex h-2 w-2">
							<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-up opacity-60" />
							<span className="relative inline-flex h-2 w-2 rounded-full bg-up" />
						</span>
						<span className="tnum font-medium text-ink">{online}</span> online
					</span>
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
				</div>
				<div className="flex flex-wrap gap-2">
					<Segmented label="Attribution model" value={model} options={MODELS} onChange={setAttributionModel} />
					<Segmented label="Revenue" value={mode} options={MODES} onChange={setRevenueMode} />
					<Segmented label="Date range" value={range} options={RANGES} onChange={setDateRange} />
				</div>
			</div>

			{/* KPIs + chart + live */}
			<div className="grid gap-4 lg:grid-cols-12">
				<section className="rounded-[22px] bg-card ring-1 ring-line lg:col-span-8" aria-label="Overview">
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
									className={`relative px-5 py-4 text-left transition-colors hover:bg-band/60 ${i ? 'border-l border-line' : ''} ${i === 2 ? 'max-md:border-l-0 max-md:border-t' : ''} ${i === 3 ? 'max-md:border-t' : ''} ${i === 0 ? 'rounded-tl-[22px]' : ''} ${i === 3 ? 'md:rounded-tr-[22px]' : ''}`}
								>
									{on && <span className="absolute inset-x-5 top-0 h-[2px] rounded-full bg-accent" aria-hidden="true" />}
									<span className="flex items-center gap-1.5 text-[12px] text-ink-2">
										<k.icon size={13} aria-hidden="true" />
										{k.label}
									</span>
									<span className="tnum mt-1 block font-display text-[24px] font-semibold tracking-[-0.02em]">{k.value}</span>
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
								<span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-ink-2" />Note</span>
							</span>
							<label className="inline-flex cursor-pointer items-center gap-2">
								<input type="checkbox" className="accent-[var(--accent)]" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
								Compare to previous
							</label>
						</div>
						<MainChart points={points} kind={metric === 'revenue' ? 'bars' : 'line'} format={format[metric]} showPrev={compare} stacked={false} />
					</div>
				</section>

				<Panel title="Live" icon={<Radio size={15} />} className="lg:col-span-4" action={<span className="tnum text-[12px] text-ink-3">{online} on site now</span>}>
					<LiveFeed />
				</Panel>
			</div>

			{/* Insights */}
			<section className="grid gap-4 md:grid-cols-3" aria-label="Insights">
				{insights.map((ins, i) => (
					<div key={i} className="flex flex-col justify-between gap-3 rounded-[22px] bg-card p-5 ring-1 ring-line">
						<p className="flex gap-3 text-[14px] leading-snug text-ink-2 [&_b]:font-semibold [&_b]:text-ink">
							<Lightbulb size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
							<span>{ins.text}</span>
						</p>
						<button type="button" onClick={ins.action} className="inline-flex items-center gap-1 self-start text-[13px] font-medium text-accent hover:underline">
							{ins.cta} <ArrowRight size={13} aria-hidden="true" />
						</button>
					</div>
				))}
			</section>

			{/* Sources + pages */}
			<div className="grid gap-4 lg:grid-cols-2">
				<Panel
					title="Sources"
					icon={<Share2 size={15} />}
					tabs={[{ id: 'channels', label: 'Channels' }, { id: 'referrers', label: 'Referrers' }, { id: 'campaigns', label: 'Campaigns' }]}
					tab={tabs.sources}
					onTab={setTab('sources')}
				>
					<BarList
						rows={sourceRows}
						revenueLabel={revenueLabel}
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
					<BarList rows={pageRows} revenueLabel={revenueLabel} sortBy={sortOf('pages')} onSort={setSort('pages')} onPick={tabs.pages === 'top' ? pick('page') : undefined} active={activeOf('page')} showIcons={false} />
				</Panel>
			</div>

			{!full && (
				<div className="flex justify-center pt-2">
					<a href="/app/" className="btn btn-primary">
						Open the full dashboard
						<ArrowRight size={15} aria-hidden="true" />
					</a>
				</div>
			)}

			{full && (
				<>
					<div className="grid gap-4 lg:grid-cols-3">
						<Panel title="Locations" icon={<Globe size={15} />} tabs={[{ id: 'countries', label: 'Countries' }, { id: 'cities', label: 'Cities' }]} tab={tabs.geo} onTab={setTab('geo')}>
							<BarList rows={geoRows} revenueLabel={revenueLabel} sortBy={sortOf('geo')} onSort={setSort('geo')} onPick={tabs.geo === 'countries' ? pick('country') : undefined} active={activeOf('country')} limit={7} />
						</Panel>
						<Panel title="Technology" icon={<Monitor size={15} />} tabs={[{ id: 'devices', label: 'Devices' }, { id: 'browsers', label: 'Browsers' }, { id: 'os', label: 'OS' }]} tab={tabs.tech} onTab={setTab('tech')}>
							<BarList rows={techRows} revenueLabel={revenueLabel} sortBy={sortOf('tech')} onSort={setSort('tech')} onPick={tabs.tech === 'devices' ? pick('device') : undefined} active={activeOf('device')} limit={7} />
						</Panel>
						<Panel title="Readable Direct" icon={<Bot size={15} />}>
							<p className="px-3 pb-3 text-[13px] text-ink-2">What other tools would have called “Direct”.</p>
							<ul className="space-y-2 px-3">
								{d.direct.map((r) => (
									<li key={r.key} className="grid grid-cols-[1fr_5rem_2.5rem] items-center gap-3 text-[13px]">
										<span className="flex min-w-0 items-center gap-2"><SourceIcon icon={r.icon} label={r.key} /><span className="truncate">{r.key}</span></span>
										<span className="h-2 overflow-hidden rounded-full bg-band"><span className="block h-full rounded-full bg-accent" style={{ width: `${(r.share / 0.34) * 100}%` }} /></span>
										<span className="tnum text-right">{Math.round(r.share * 100)}%</span>
									</li>
								))}
							</ul>
						</Panel>
					</div>

					<div className="grid gap-4 lg:grid-cols-12">
						<Panel title="Recent sales" icon={<Receipt size={15} />} className="lg:col-span-7" action={<span className="text-[12px] text-ink-3">Click a sale to see its journey</span>}>
							<ul className="tnum">
								{SALES.map((x) => (
									<li key={x.id}>
										<button type="button" onClick={() => setSale(x)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] hover:bg-band">
											<span className="text-[16px] leading-none" aria-hidden="true">{flag(x.country)}</span>
											<span className="min-w-0 flex-1">
												<span className="block truncate font-medium">{x.email}</span>
												<span className="block truncate text-[12px] text-ink-3">{x.plan} · {x.gateway} · {x.ago}</span>
											</span>
											<span className="hidden items-center gap-1 text-ink-3 sm:flex" title={`${x.first} → ${x.last}`}>
												<SourceIcon icon={x.firstIcon} label={x.first} size={14} />
												<ArrowRight size={12} aria-hidden="true" />
												<SourceIcon icon={x.lastIcon} label={x.last} size={14} />
												<span className="sr-only">First touch {x.first}, last touch {x.last}</span>
											</span>
											<span className="w-20 text-right font-semibold">{usd(x.gross)}</span>
										</button>
									</li>
								))}
							</ul>
						</Panel>
						<div className="grid gap-4 lg:col-span-5">
							<Panel title="Where the money goes" icon={<Receipt size={15} />}>
								<ProfitBridge gross={t.gross} fee={t.fee} ad={t.ad} />
							</Panel>
							<Panel title="Time to convert" icon={<Hourglass size={15} />}>
								<MiniBars rows={d.timeToConvert} />
							</Panel>
						</div>
					</div>

					<div className="grid gap-4 lg:grid-cols-12">
						<Panel title="When buyers buy" icon={<CalendarDays size={15} />} className="lg:col-span-7">
							<Heatmap grid={d.heat} total={t.sales} />
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

					<div className="grid gap-4 lg:grid-cols-2">
						<Panel title="Path to purchase" icon={<Route size={15} />}>
							<Funnel steps={d.funnel} />
						</Panel>
						<Panel title="Lifetime value by first source" icon={<Trophy size={15} />}>
							<ul className="tnum px-1">
								{d.ltv.map((r) => (
									<li key={r.key} className="flex items-center gap-2 rounded-lg px-2 py-[7px] text-[14px]">
										<SourceIcon icon={r.icon} label={r.key} />
										<span className="min-w-0 flex-1 truncate">{r.key}</span>
										<span className="w-24 text-right text-[12px] text-ink-3">{num(r.customers)} customers</span>
										<span className="w-20 text-right font-semibold">{usd(r.ltv)}</span>
									</li>
								))}
							</ul>
							<p className="px-3 pt-2 text-[12px] text-ink-3">Average revenue per customer, renewals included.</p>
						</Panel>
					</div>
				</>
			)}

			<JourneyDrawer sale={sale} onClose={closeSale} />
		</div>
	);
}
