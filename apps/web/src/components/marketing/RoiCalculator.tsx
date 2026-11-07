import { useId, useState } from 'react';

// Entry-plan prices from each vendor's own website, checked 2026-11-06.
// Re-verify before editing: these are public claims about other companies.
const PLANS = [
	{ name: 'DataFast', detail: 'Starter, $9/mo, 10k events', firstYear: 9 * 12 },
	{ name: 'Plausible', detail: 'Starter, $9/mo, 10k pageviews', firstYear: 9 * 12 },
	{ name: 'DataBull', detail: 'Self-hosted, $49 once', firstYear: 49 },
	{ name: 'Grosslytics', detail: 'Self-hosted, $0', firstYear: 0, ours: true },
];
const STRIPE_PCT = 0.029;
const STRIPE_FIXED = 0.3;

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default function RoiCalculator() {
	const revenueId = useId();
	const priceId = useId();
	const [revenue, setRevenue] = useState(10_000);
	const [price, setPrice] = useState(29);

	const max = Math.max(...PLANS.map((p) => p.firstYear));
	const sales = revenue / price;
	const yearlyFees = (revenue * STRIPE_PCT + sales * STRIPE_FIXED) * 12;

	return (
		<div className="mx-auto max-w-[760px] rounded-[28px] bg-card p-8 ring-1 ring-line sm:p-10">
			<h3 className="text-[17px] font-semibold">First-year cost on the entry plan</h3>
			<ul className="tnum mt-6 space-y-4" aria-label="First-year cost on each entry plan">
				{PLANS.map((p) => (
					<li key={p.name} className="grid grid-cols-[9.5rem_1fr_3.5rem] items-center gap-4 text-[15px]">
						<span className={p.ours ? 'font-semibold' : 'text-ink-2'}>
							{p.name}
							<span className="block text-[12px] text-ink-3">{p.detail}</span>
						</span>
						<span className="h-2 overflow-hidden rounded-full bg-band">
							<span className={`block h-full rounded-full ${p.ours ? 'bg-accent' : 'bg-ink-3/50'}`} style={{ width: `${Math.max(2, (p.firstYear / max) * 100)}%` }} />
						</span>
						<span className={`text-right ${p.ours ? 'font-semibold' : ''}`}>{usd(p.firstYear)}</span>
					</li>
				))}
			</ul>
			<p className="mt-4 text-[12px] leading-relaxed text-ink-3">
				Published entry prices, checked Nov 6, 2026. Higher traffic tiers cost more on DataFast and Plausible. Hosted options: DataBull from $9/mo, Grosslytics $5.99/mo.
			</p>

			<div className="mt-10 border-t border-line pt-8">
				<h3 className="text-[17px] font-semibold">How much of your revenue is fees?</h3>
				<div className="mt-6 grid gap-8 sm:grid-cols-2">
					<div>
						<div className="mb-3 flex items-baseline justify-between">
							<label htmlFor={revenueId} className="text-[15px] text-ink-2">Monthly revenue</label>
							<span className="tnum text-[17px] font-semibold">{usd(revenue)}</span>
						</div>
						<input id={revenueId} type="range" min={1_000} max={100_000} step={1_000} value={revenue} onChange={(e) => setRevenue(Number(e.target.value))} className="w-full cursor-pointer accent-[var(--accent)]" />
					</div>
					<div>
						<div className="mb-3 flex items-baseline justify-between">
							<label htmlFor={priceId} className="text-[15px] text-ink-2">Average sale</label>
							<span className="tnum text-[17px] font-semibold">{usd(price)}</span>
						</div>
						<input id={priceId} type="range" min={5} max={500} step={1} value={price} onChange={(e) => setPrice(Number(e.target.value))} className="w-full cursor-pointer accent-[var(--accent)]" />
					</div>
				</div>
				<p className="tnum mt-8 font-display text-[40px] font-semibold tracking-[-0.03em]">
					{usd(yearlyFees)}<span className="text-[20px] text-ink-3"> / year</span>
				</p>
				<p className="text-[15px] text-ink-2">
					goes to Stripe at 2.9% + 30¢ per sale. Grosslytics shows each channel's revenue with this taken out.
				</p>
			</div>
		</div>
	);
}
