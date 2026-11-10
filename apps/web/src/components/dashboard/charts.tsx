import { useState } from 'react';
import { Delta, num, useMoney, useWidth } from './ui';

export interface Point {
	label: string;
	value: number;
	prev?: number;
	/** Extra tooltip lines: [label, formatted value] */
	rows?: Array<[string, string]>;
	note?: string;
	/** Sales in this bucket, drawn as a green marker above the bar; 0 or missing draws nothing */
	sales?: number;
}

const H = 260;
const PAD = { top: 26, right: 10, bottom: 26, left: 52 };
const TICKS = [0, 0.25, 0.5, 0.75, 1];

function niceCeil(v: number): number {
	if (v <= 0) return 1;
	const mag = 10 ** Math.floor(Math.log10(v));
	return [1, 2, 4, 5, 8, 10].map((m) => m * mag).find((x) => x >= v) ?? 10 * mag; // all divide cleanly into four steps
}

/**
 * Bar chart of one metric over time, one y-axis. The previous period is a faint wider bar behind each bar, so there are no lines to untangle.
 * Hover or touch shows a tooltip with every number for that bucket.
 */
export function MainChart(props: {
	points: Point[];
	color: string;
	format: (v: number) => string;
	showPrev: boolean;
	/** The last bucket is still filling up (today, or this hour) */
	partial?: boolean;
}) {
	const [ref, width] = useWidth<HTMLDivElement>();
	const [hover, setHover] = useState<number | null>(null);
	const pts = props.points;
	const n = pts.length;
	const innerW = Math.max(0, width - PAD.left - PAD.right);
	const innerH = H - PAD.top - PAD.bottom;
	const peak = Math.max(...pts.map((p) => p.value), ...(props.showPrev ? pts.map((p) => p.prev ?? 0) : [0]));
	const ceil = niceCeil(peak);
	const step = innerW / Math.max(1, n);
	const x = (i: number) => PAD.left + step * (i + 0.5);
	const y = (v: number) => PAD.top + innerH - (Math.max(0, v) / ceil) * innerH; // profit can dip below zero; the axis starts at 0
	const barW = Math.max(2, Math.min(26, step * 0.56));
	const ghostW = Math.min(step * 0.9, barW + Math.max(2, barW * 0.5));
	// rounded top, square foot, so bars sit on the baseline
	const bar = (i: number, v: number, w: number) => {
		const top = y(v);
		const base = y(0);
		const r = Math.min(5, w / 2, (base - top) / 2);
		return `M${x(i) - w / 2},${base} V${top + r} q0,${-r} ${r},${-r} h${w - 2 * r} q${r},0 ${r},${r} V${base} Z`;
	};
	let noteEnd = 0; // right edge of the last note label drawn
	const labelEvery = Math.ceil(n / Math.max(2, Math.floor(innerW / 80)));
	const h = hover;
	const at = h === null ? undefined : pts[h];
	const move = (e: React.PointerEvent<SVGSVGElement>) => {
		const i = Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left - PAD.left) / step);
		setHover(i >= 0 && i < n ? i : null);
	};

	return (
		<div ref={ref} className="relative w-full select-none" style={{ height: H }}>
			{width > 0 && (
				<svg width={width} height={H} role="img" aria-label="Chart of the selected metric over time" className="touch-pan-y" onPointerMove={move} onPointerDown={move} onPointerLeave={() => setHover(null)}>
					{TICKS.filter((t) => !t || peak > 0).map((t) => ( // an empty period gets the baseline only, not five zeros
						<g key={t}>
							<line x1={PAD.left} x2={width - PAD.right} y1={y(ceil * t)} y2={y(ceil * t)} stroke="var(--line)" strokeDasharray={t ? '3 4' : undefined} />
							<text x={PAD.left - 10} y={y(ceil * t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--ink-3)">{props.format(ceil * t)}</text>
						</g>
					))}

					{pts.map((p, i) =>
						i % labelEvery === 0 ? (
							<text key={`l${i}`} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--ink-3)">{p.label}</text>
						) : null,
					)}

					{/* Notes: dashed rule, marker and the note's text, on whichever side has room; a label that would run into the previous one is left to the tooltip */}
					{pts.map((p, i) => {
						if (!p.note) return null;
						const text = p.note.length > 26 ? `${p.note.slice(0, 25)}…` : p.note;
						const w = text.length * 6.2 + 10; // estimate at 11px
						const right = x(i) + 9 + w <= width - PAD.right;
						const from = right ? x(i) + 9 : x(i) - 9 - w;
						const show = from >= noteEnd && from >= PAD.left;
						if (show) noteEnd = from + w;
						return (
							<g key={`a${i}`}>
								<line x1={x(i)} x2={x(i)} y1={PAD.top - 9} y2={PAD.top + innerH} stroke="var(--ink-3)" strokeDasharray="2 3" opacity="0.6" />
								<circle cx={x(i)} cy={PAD.top - 13} r="4.5" fill="var(--card)" stroke="var(--ink-2)" strokeWidth="1.5" />
								{show && <text x={right ? x(i) + 9 : x(i) - 9} y={PAD.top - 13} dy="0.34em" textAnchor={right ? 'start' : 'end'} fontSize="11" fontWeight="500" fill="var(--ink-2)">{text}</text>}
							</g>
						);
					})}

					{props.showPrev && pts.map((p, i) => <path key={`p${i}`} d={bar(i, p.prev ?? 0, ghostW)} fill="var(--ink)" opacity="0.1" />)}
					{pts.map((p, i) => (
						<path key={i} d={bar(i, p.value, barW)} fill={props.color} opacity={(h !== null && h !== i ? 0.4 : 1) * (props.partial && i === n - 1 ? 0.55 : 1)} />
					))}

					{/* Sales: a green marker above the bar, with the count when there is more than one */}
					{pts.map((p, i) =>
						p.sales ? (
							<g key={`s${i}`} transform={`translate(${x(i)},${Math.max(PAD.top + 8, y(Math.max(p.value, props.showPrev ? p.prev ?? 0 : 0)) - 12)})`}>
								<circle r="7.5" fill="var(--up)" stroke="var(--card)" strokeWidth="2" />
								<text textAnchor="middle" dy="0.34em" fontSize="9" fontWeight="700" fill="#fff">{p.sales > 1 ? (p.sales > 99 ? '99+' : p.sales) : '$'}</text>
							</g>
						) : null,
					)}
				</svg>
			)}

			{at && (
				<div
					className="tnum pointer-events-none absolute top-0 z-10 w-52 rounded-xl bg-card px-3 py-2.5 text-[12px] shadow-lg ring-1 ring-line"
					// beside the hovered column, on whichever side has room, so it never covers the value it describes
					style={{ left: Math.max(0, x(h!) > width / 2 ? x(h!) - step / 2 - 216 : Math.min(width - 208, x(h!) + step / 2 + 8)) }}
					role="status"
				>
					<div className="flex items-baseline justify-between gap-2">
						<span className="font-semibold">{at.label}</span>
						{props.partial && h === n - 1 && <span className="text-ink-3">so far</span>}
					</div>
					{at.note && <div className="text-accent">{at.note}</div>}
					<div className="mt-1.5 flex items-center justify-between gap-3">
						<span className="flex items-center gap-1.5 text-ink-2"><span className="h-2 w-2 rounded-sm" style={{ background: props.color }} />This period</span>
						<span className="flex items-center gap-1.5 font-semibold">{props.format(at.value)}{props.showPrev && <Delta now={at.value} before={at.prev ?? 0} />}</span>
					</div>
					{props.showPrev && at.prev !== undefined && (
						<div className="flex justify-between gap-3"><span className="flex items-center gap-1.5 text-ink-2"><span className="h-2 w-2 rounded-sm bg-ink/15" />Previous</span><span>{props.format(at.prev)}</span></div>
					)}
					{at.rows && at.rows.length > 0 && (
						<dl className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-3 border-t border-line pt-1.5 text-ink-2">
							{at.rows.map(([k, v]) => (
								<div key={k} className="contents"><dt>{k}</dt><dd className="text-right text-ink">{v}</dd></div>
							))}
						</dl>
					)}
				</div>
			)}
		</div>
	);
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * 7×24 heatmap: green for sales, red for refunds (darker = more). An hour with both is green with a red dot.
 * The three busiest sales hours get an outline. Hours are in the site's timezone, the same as the API's buckets.
 */
export function Heatmap({ grid, refunds, total, timeZone = 'UTC' }: { grid: number[][]; refunds?: number[][]; total: number; timeZone?: string }) {
	const [hover, setHover] = useState<[number, number] | null>(null);
	const flat = grid.flat();
	const sum = flat.reduce((a, b) => a + b, 0) || 1;
	const max = Math.max(...flat, 0.0001);
	const maxR = Math.max(...(refunds?.flat() ?? []), 0.0001);
	// Only hours that had sales can be "busiest"; with one sale only that hour is outlined
	const top3 = [...flat].filter((v) => v > 0).sort((a, b) => b - a)[2] ?? Math.min(...flat.filter((v) => v > 0), Infinity);
	const sales = (v: number) => (v / sum) * total;
	const hourLabel = (hr: number) => `${hr % 12 || 12}${hr < 12 ? 'am' : 'pm'}`;
	const tint = (color: string, share: number) => `color-mix(in srgb, ${color} ${22 + share * 70}%, var(--band))`;
	const tip = (d: number, hr: number) => {
		const s = sales(grid[d]![hr]!);
		const r = refunds?.[d]?.[hr] ?? 0;
		const sTxt = `${Number.isInteger(s) ? s : s.toFixed(1)} ${s === 1 ? 'sale' : 'sales'}`;
		return `${DAYS[d]} ${hourLabel(hr)} ${timeZone}: ${sTxt}${r ? `, ${r} ${r === 1 ? 'refund' : 'refunds'}` : ''}`;
	};
	return (
		<div className="tnum px-3">
			<div className="grid grid-cols-[2.25rem_repeat(24,minmax(0,1fr))] gap-[3px]" onMouseLeave={() => setHover(null)}>
				{grid.map((row, d) => (
					<div key={d} className="contents">
						<span className="self-center text-[11px] text-ink-3">{DAYS[d]}</span>
						{row.map((v, hr) => {
							const r = refunds?.[d]?.[hr] ?? 0;
							const bg = v > 0 ? tint('var(--up)', v / max) : r > 0 ? tint('var(--down)', r / maxR) : 'var(--band)';
							return (
								<span
									key={hr}
									onMouseEnter={() => setHover([d, hr])}
									className={`relative aspect-square rounded-[4px] ${v > 0 && v >= top3 ? 'ring-2 ring-ink' : ''}`}
									style={{ background: bg }}
								>
									{v > 0 && r > 0 && <span className="absolute top-[2px] right-[2px] h-1.5 w-1.5 rounded-full bg-down" aria-hidden="true" />}
								</span>
							);
						})}
					</div>
				))}
				<span />
				{Array.from({ length: 24 }, (_, hr) => (
					<span key={hr} className="text-center text-[10px] text-ink-3">{hr % 6 === 0 ? hourLabel(hr) : ''}</span>
				))}
			</div>
			<p className="mt-2 flex h-4 flex-wrap items-center gap-x-3 text-[12px] text-ink-2" role="status">
				{hover ? (
					tip(hover[0], hover[1])
				) : (
					<>
						<span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-up" />Sales</span>
						<span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-down" />Refunds</span>
						<span>Outlined: busiest hours. Times in {timeZone}.</span>
					</>
				)}
			</p>
		</div>
	);
}

export function Milestones({ steps }: { steps: Array<{ label: string; count: number }> }) {
	const max = Math.max(1, ...steps.map((step) => step.count));
	return (
		<ol className="tnum space-y-3 px-3">
			{steps.map((s) => {
				return (
					<li key={s.label}>
						<div className="mb-1 flex items-baseline justify-between text-[13px]">
							<span>{s.label}</span>
							<span>
								<span className="font-semibold">{num(s.count)}</span>
							</span>
						</div>
						<div className="h-2.5 overflow-hidden rounded-full bg-band">
							<div className="h-full rounded-full bg-ink-2" style={{ width: `${(s.count / max) * 100}%` }} />
						</div>
					</li>
				);
			})}
		</ol>
	);
}

/** Gross → fees → ad spend → profit, as a bridge. */
export function ProfitBridge({ gross, fee, ad }: { gross: number; fee: number; ad: number }) {
	const money = useMoney();
	const profit = gross - fee - ad;
	const steps = [
		{ label: 'Gross revenue', from: 0, to: gross, tone: 'bg-ink-3/45', value: money(gross) },
		{ label: 'Payment fees', from: gross - fee, to: gross, tone: 'bg-fee', value: `−${money(fee)}` },
		{ label: 'Ad spend', from: gross - fee - ad, to: gross - fee, tone: 'bg-fee/60', value: `−${money(ad)}` },
		{ label: 'True profit', from: 0, to: profit, tone: 'bg-net', value: money(profit), bold: true },
	];
	return (
		<ul className="tnum space-y-3 px-3">
			{steps.map((s) => (
				<li key={s.label} className="grid grid-cols-[6.5rem_1fr_5rem] items-center gap-3 text-[13px]">
					<span className={s.bold ? 'font-semibold' : 'text-ink-2'}>{s.label}</span>
					<span className="relative h-5 rounded-md bg-band">
						<span className={`absolute inset-y-0 rounded-md ${s.tone}`} style={{ left: `${(s.from / gross) * 100}%`, width: `${Math.max(0.6, ((s.to - s.from) / gross) * 100)}%` }} />
					</span>
					<span className={`text-right ${s.bold ? 'font-semibold' : ''}`}>{s.value}</span>
				</li>
			))}
			<li className="pt-1 text-[12px] text-ink-3">
				You keep {((profit / gross) * 100).toFixed(1)}% of gross after fees and ads.
				{ad > 0 && <> MER {(gross / ad).toFixed(2)}× (revenue ÷ ad spend).</>} Sales tax is never counted as revenue.
			</li>
		</ul>
	);
}

export function MiniBars({ rows }: { rows: Array<{ label: string; share: number }> }) {
	const max = Math.max(0.0001, ...rows.map((r) => r.share)); // all-zero rows draw empty bars, not NaN-wide ones
	return (
		<ul className="tnum space-y-2 px-3">
			{rows.map((r) => (
				<li key={r.label} className="grid grid-cols-[5.5rem_1fr_2.75rem] items-center gap-3 text-[13px]">
					<span className="text-ink-2">{r.label}</span>
					<span className="h-2 overflow-hidden rounded-full bg-band"><span className="block h-full rounded-full bg-ink-2" style={{ width: `${(r.share / max) * 100}%` }} /></span>
					<span className="text-right">{Math.round(r.share * 100)}%</span>
				</li>
			))}
		</ul>
	);
}

