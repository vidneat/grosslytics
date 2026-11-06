import { type ReactNode, useEffect, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Bookmark, CreditCard, Monitor, Share2, Smartphone, Tablet } from 'lucide-react';

const GLYPHS = { '@desktop': Monitor, '@mobile': Smartphone, '@tablet': Tablet } as const;

export const usd = (cents: number, digits = 0) =>
	(cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits, minimumFractionDigits: digits });
export const num = (n: number) => Math.round(n).toLocaleString('en-US');
export const compact = (n: number) => n.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/** Site favicon (or emoji flag / Direct glyph), falling back to a letter tile if the image fails. */
export function SourceIcon({ icon, label, size = 16 }: { icon?: string; label: string; size?: number }) {
	const [failed, setFailed] = useState(false);
	const box = { width: size, height: size };
	if (icon && /\p{Regional_Indicator}/u.test(icon)) return <span className="inline-block text-center leading-none" style={{ ...box, fontSize: size - 2 }} aria-hidden="true">{icon}</span>;
	if (icon && icon in GLYPHS) {
		const Glyph = GLYPHS[icon as keyof typeof GLYPHS];
		return <span className="inline-flex items-center justify-center text-ink-2" style={box} aria-hidden="true"><Glyph size={size - 2} strokeWidth={1.75} /></span>;
	}
	if (!icon) {
		const Glyph = /typed|bookmark/i.test(label) ? Bookmark : /checkout/i.test(label) ? CreditCard : Share2;
		return <span className="inline-flex items-center justify-center rounded-[4px] bg-band text-ink-2" style={box} aria-hidden="true"><Glyph size={size - 5} strokeWidth={2} /></span>;
	}
	if (failed) return <span className="inline-flex items-center justify-center rounded-[4px] bg-band text-[10px] font-semibold text-ink-2" style={box} aria-hidden="true">{label[0]?.toUpperCase()}</span>;
	// shortcut: favicons load from DuckDuckGo, which sees which domains a dashboard shows; proxy and cache them on the edge API before real customer data is displayed.
	return (
		<img
			src={`https://icons.duckduckgo.com/ip3/${icon}.ico`}
			alt=""
			width={size}
			height={size}
			loading="lazy"
			className="rounded-[4px]"
			onError={() => setFailed(true)}
		/>
	);
}

/** Percent change chip. `goodWhenUp` flips the colour for metrics where down is good. */
export function Delta({ now, before, goodWhenUp = true }: { now: number; before: number; goodWhenUp?: boolean }) {
	if (!before) return null;
	const pct = ((now - before) / before) * 100;
	const up = pct >= 0;
	const good = up === goodWhenUp;
	const Icon = up ? ArrowUpRight : ArrowDownRight;
	return (
		<span className={`tnum inline-flex items-center gap-0.5 text-[12px] font-medium ${good ? 'text-up' : 'text-down'}`}>
			<Icon size={13} strokeWidth={2.5} aria-hidden="true" />
			{Math.abs(pct).toFixed(1)}%
			<span className="sr-only">{up ? 'up' : 'down'} vs previous period</span>
		</span>
	);
}

export function Sparkline({ values, active }: { values: number[]; active?: boolean }) {
	const w = 80;
	const h = 24;
	const max = Math.max(...values, 1);
	const min = Math.min(...values);
	const flat = max - min < max * 0.02; // near-constant series: draw mid-height, not on the floor
	const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * w},${flat ? h / 2 : h - 2 - ((v - min) / (max - min)) * (h - 4)}`).join(' ');
	return (
		<svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="overflow-visible">
			<polyline points={pts} fill="none" stroke={active ? 'var(--accent)' : 'var(--ink-3)'} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
		</svg>
	);
}

export function Panel(props: {
	title: string;
	icon?: ReactNode;
	tabs?: ReadonlyArray<{ id: string; label: string }>;
	tab?: string;
	onTab?: (id: string) => void;
	action?: ReactNode;
	className?: string;
	children: ReactNode;
}) {
	return (
		<section className={`flex min-w-0 flex-col rounded-[22px] bg-card ring-1 ring-line ${props.className ?? ''}`} aria-label={props.title}>
			<header className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-3">
				<h3 className="flex items-center gap-2 text-[15px] font-semibold">
					{props.icon && <span className="text-ink-3" aria-hidden="true">{props.icon}</span>}
					{props.title}
				</h3>
				<div className="flex items-center gap-3">
					{props.tabs && (
						<div className="flex gap-3 text-[13px]" role="tablist" aria-label={`${props.title} view`}>
							{props.tabs.map((t) => (
								<button
									key={t.id}
									type="button"
									role="tab"
									aria-selected={props.tab === t.id}
									onClick={() => props.onTab?.(t.id)}
									className={`border-b-2 pb-0.5 transition-colors ${props.tab === t.id ? 'border-ink font-medium text-ink' : 'border-transparent text-ink-3 hover:text-ink-2'}`}
								>
									{t.label}
								</button>
							))}
						</div>
					)}
					{props.action}
				</div>
			</header>
			<div className="flex-1 px-2 pb-3">{props.children}</div>
		</section>
	);
}

export interface ListRow {
	key: string;
	label: string;
	icon?: string;
	visitors: number;
	revenue: number;
	note?: string;
}

/** Ranked list with a share bar behind each row. Clicking a row applies it as a filter. */
export function BarList(props: {
	rows: ListRow[];
	revenueLabel: string;
	sortBy: 'visitors' | 'revenue';
	onSort: (s: 'visitors' | 'revenue') => void;
	onPick?: (key: string) => void;
	active?: string;
	showIcons?: boolean;
	limit?: number;
}) {
	const rows = [...props.rows].sort((a, b) => b[props.sortBy] - a[props.sortBy]).slice(0, props.limit ?? 8);
	const max = Math.max(...rows.map((r) => r[props.sortBy]), 1);
	const head = (id: 'visitors' | 'revenue', label: string) => (
		<button type="button" onClick={() => props.onSort(id)} className={`w-[4.75rem] text-right ${props.sortBy === id ? 'font-semibold text-ink-2' : ''}`} aria-pressed={props.sortBy === id}>
			{label}
			{props.sortBy === id && <span aria-hidden="true"> ↓</span>}
		</button>
	);
	return (
		<div className="tnum text-[14px]">
			<div className="flex items-center justify-end gap-2 px-3 pb-1.5 text-[11px] text-ink-3">
				{head('visitors', 'Visitors')}
				{head('revenue', props.revenueLabel)}
				<span className="hidden w-[4.25rem] text-right sm:inline">Per visitor</span>
			</div>
			<ul>
				{rows.map((r) => {
					const isActive = props.active === r.key;
					const dim = props.active && !isActive;
					return (
						<li key={r.key}>
							<button
								type="button"
								onClick={() => props.onPick?.(r.key)}
								disabled={!props.onPick}
								title={props.onPick ? `Filter by ${r.label}` : undefined}
								className={`group relative flex w-full items-center gap-2 rounded-lg px-3 py-[7px] text-left transition-opacity enabled:hover:bg-band ${dim ? 'opacity-45' : ''}`}
							>
								<span className="absolute inset-y-1 left-1 rounded-md bg-accent/10" style={{ width: `calc(${(r[props.sortBy] / max) * 100}% * 0.62)` }} aria-hidden="true" />
								<span className="relative flex min-w-0 flex-1 items-center gap-2">
									{props.showIcons !== false && <SourceIcon icon={r.icon} label={r.label} />}
									<span className="truncate">{r.label}</span>
									{r.note && <span className="hidden shrink-0 truncate text-[12px] text-ink-3 lg:inline">{r.note}</span>}
								</span>
								<span className="relative w-[4.75rem] text-right text-ink-2">{compact(r.visitors)}</span>
								<span className="relative w-[4.75rem] text-right font-medium">{usd(r.revenue)}</span>
								<span className="relative hidden w-[4.25rem] text-right text-ink-2 sm:inline">{usd(r.revenue / Math.max(1, r.visitors), 2)}</span>
							</button>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

/** Width of an element, for SVG charts drawn in real pixels (keeps rounded corners undistorted). */
export function useWidth<T extends HTMLElement>() {
	const ref = useRef<T>(null);
	const [width, setWidth] = useState(0);
	useEffect(() => {
		if (!ref.current) return;
		const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width));
		ro.observe(ref.current);
		return () => ro.disconnect();
	}, []);
	return [ref, width] as const;
}
