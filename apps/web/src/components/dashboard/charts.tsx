import { useState } from 'react';
import { num, usd, useWidth } from './ui';

export interface Point {
	label: string;
	value: number;
	prev?: number;
	fee?: number; // stacked on top of value (gross mode)
	note?: string;
}

const H = 220;
const PAD = { top: 18, right: 8, bottom: 24, left: 52 };

function niceCeil(v: number): number {
	if (v <= 0) return 1;
	const mag = 10 ** Math.floor(Math.log10(v));
	return [1, 2, 2.5, 4, 5, 10].map((m) => m * mag).find((x) => x >= v) ?? 10 * mag;
}

/**
 * Single-metric time chart (one y-axis): bars for money, a line for counts and ratios.
 * Previous period is a dashed line of the same metric. Hover shows a crosshair and tooltip.
 */
export function MainChart(props: { points: Point[]; kind: 'bars' | 'line'; format: (v: number) => string; showPrev: boolean; stacked: boolean }) {
	const [ref, width] = useWidth<HTMLDivElement>();
	const [hover, setHover] = useState<number | null>(null);
	const pts = props.points;
	const n = pts.length;
	const innerW = Math.max(0, width - PAD.left - PAD.right);
	const innerH = H - PAD.top - PAD.bottom;
	const peak = Math.max(...pts.map((p) => p.value + (props.stacked ? p.fee ?? 0 : 0)), ...(props.showPrev ? pts.map((p) => p.prev ?? 0) : [0]));
	const ceil = niceCeil(peak);
	const step = innerW / Math.max(1, n);
	const x = (i: number) => PAD.left + step * (i + 0.5);
	const y = (v: number) => PAD.top + innerH - (v / ceil) * innerH;
	const barW = Math.max(2, Math.min(22, step * 0.62));
	const line = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
	const ticks = [0, 0.5, 1];
	const labelEvery = Math.ceil(n / 6);
	const h = hover;

	return (
		<div ref={ref} className="relative w-full select-none" style={{ height: H }}>
			{width > 0 && (
				<svg width={width} height={H} role="img" aria-label="Chart of the selected metric over time" onMouseLeave={() => setHover(null)}>
					{ticks.map((t) => (
						<g key={t}>
							<line x1={PAD.left} x2={width - PAD.right} y1={y(ceil * t)} y2={y(ceil * t)} stroke="var(--line)" />
							<text x={PAD.left - 8} y={y(ceil * t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--ink-3)">{props.format(ceil * t)}</text>
						</g>
					))}

					{pts.map((p, i) =>
						i % labelEvery === 0 || i === n - 1 ? (
							<text key={`l${i}`} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--ink-3)">{p.label}</text>
						) : null,
					)}

					{/* Annotations: dashed rule + marker */}
					{pts.map((p, i) =>
						p.note ? (
							<g key={`a${i}`}>
								<line x1={x(i)} x2={x(i)} y1={PAD.top - 6} y2={PAD.top + innerH} stroke="var(--ink-3)" strokeDasharray="2 3" opacity="0.6" />
								<circle cx={x(i)} cy={PAD.top - 8} r="4.5" fill="var(--card)" stroke="var(--ink-2)" strokeWidth="1.5" />
							</g>
						) : null,
					)}

					{props.kind === 'bars' ? (
						pts.map((p, i) => {
							const fee = props.stacked ? p.fee ?? 0 : 0;
							const top = y(p.value + fee);
							const mid = y(p.value);
							const base = y(0);
							const faded = h !== null && h !== i;
							return (
								<g key={i} opacity={faded ? 0.45 : 1}>
									{fee > 0 && <rect x={x(i) - barW / 2} y={top} width={barW} height={Math.max(0, mid - top - 2)} rx={Math.min(4, barW / 2)} fill="var(--fee)" />}
									<rect x={x(i) - barW / 2} y={mid} width={barW} height={Math.max(1, base - mid)} rx={fee > 0 ? 1 : Math.min(4, barW / 2)} fill="var(--net)" />
									{/* square off the bottom corners so bars sit on the baseline */}
									<rect x={x(i) - barW / 2} y={Math.max(mid, base - 4)} width={barW} height={Math.min(4, base - mid)} fill="var(--net)" />
								</g>
							);
						})
					) : (
						<>
							<path d={`${line(pts.map((p) => p.value))} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill="var(--accent)" opacity="0.08" />
							<path d={line(pts.map((p) => p.value))} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
						</>
					)}

					{props.showPrev && <path d={line(pts.map((p) => p.prev ?? 0))} fill="none" stroke="var(--ink-3)" strokeWidth="1.5" strokeDasharray="4 4" />}

					{h !== null && (
						<>
							<line x1={x(h)} x2={x(h)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--ink-3)" opacity="0.5" />
							{props.kind === 'line' && <circle cx={x(h)} cy={y(pts[h]!.value)} r="4.5" fill="var(--accent)" stroke="var(--card)" strokeWidth="2" />}
						</>
					)}

					{/* Hit targets wider than the marks */}
					{pts.map((_, i) => (
						<rect key={`h${i}`} x={PAD.left + step * i} y={0} width={step} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
					))}
				</svg>
			)}

			{h !== null && pts[h] && (
				<div
					className="tnum pointer-events-none absolute top-0 z-10 w-max min-w-36 rounded-xl bg-card px-3 py-2 text-[12px] shadow-lg ring-1 ring-line"
					style={{ left: Math.min(Math.max(x(h) - 72, 0), Math.max(0, width - 160)) }}
					role="status"
				>
					<div className="font-semibold">{pts[h].label}</div>
					{pts[h].note && <div className="text-accent">{pts[h].note}</div>}
					<div className="mt-1 flex justify-between gap-4"><span className="text-ink-2">This period</span><span>{props.format(pts[h].value)}</span></div>
					{props.stacked && pts[h].fee !== undefined && <div className="flex justify-between gap-4"><span className="text-ink-2">Fees</span><span>{props.format(pts[h].fee!)}</span></div>}
					{props.showPrev && pts[h].prev !== undefined && <div className="flex justify-between gap-4"><span className="text-ink-2">Previous</span><span>{props.format(pts[h].prev!)}</span></div>}
				</div>
			)}
		</div>
	);
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * 7×24 heatmap: green for sales, red for refunds (darker = more). An hour with both is green with a red dot.
 * The three busiest sales hours get an outline. Hours are UTC, the same as the API's buckets.
 */
export function Heatmap({ grid, refunds, total }: { grid: number[][]; refunds?: number[][]; total: number }) {
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
		return `${DAYS[d]} ${hourLabel(hr)} UTC: ${sTxt}${r ? `, ${r} ${r === 1 ? 'refund' : 'refunds'}` : ''}`;
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
						<span>Outlined: busiest hours. Times in UTC.</span>
					</>
				)}
			</p>
		</div>
	);
}

export function Funnel({ steps }: { steps: Array<{ label: string; count: number }> }) {
	const first = steps[0]?.count || 1;
	return (
		<ol className="tnum space-y-3 px-3">
			{steps.map((s, i) => {
				const prev = steps[i - 1]?.count;
				return (
					<li key={s.label}>
						<div className="mb-1 flex items-baseline justify-between text-[13px]">
							<span>{s.label}</span>
							<span>
								<span className="font-semibold">{num(s.count)}</span>
								<span className="ml-2 text-ink-3">{((s.count / first) * 100).toFixed(s.count / first < 0.1 ? 2 : 0)}%</span>
							</span>
						</div>
						<div className="h-2.5 overflow-hidden rounded-full bg-band">
							<div className="h-full rounded-full bg-ink-2" style={{ width: `${Math.max(1, (s.count / first) * 100)}%` }} />
						</div>
						{prev !== undefined && <div className="mt-1 text-[11px] text-ink-3">{((1 - s.count / prev) * 100).toFixed(0)}% drop from the step before</div>}
					</li>
				);
			})}
		</ol>
	);
}

/** Gross → fees → ad spend → profit, as a bridge. */
export function ProfitBridge({ gross, fee, ad }: { gross: number; fee: number; ad: number }) {
	const profit = gross - fee - ad;
	const steps = [
		{ label: 'Gross revenue', from: 0, to: gross, tone: 'bg-ink-3/45', value: usd(gross) },
		{ label: 'Payment fees', from: gross - fee, to: gross, tone: 'bg-fee', value: `−${usd(fee)}` },
		{ label: 'Ad spend', from: gross - fee - ad, to: gross - fee, tone: 'bg-fee/60', value: `−${usd(ad)}` },
		{ label: 'True profit', from: 0, to: profit, tone: 'bg-net', value: usd(profit), bold: true },
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
			<li className="pt-1 text-[12px] text-ink-3">You keep {((profit / gross) * 100).toFixed(1)}% of gross after fees and ads.</li>
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

