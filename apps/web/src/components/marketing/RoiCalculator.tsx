import { useState, useId } from 'react';

export default function RoiCalculator() {
	const eventsId = useId();
	const gmvId = useId();
	const [monthlyEvents, setMonthlyEvents] = useState(100_000);
	const [monthlyGmv, setMonthlyGmv] = useState(10_000);

	// Competitor pricing models
	// DataFast: $29/mo base up to 50k, $49/mo up to 200k, $99/mo up to 500k, $199/mo up to 1M
	const datafastCostMonthly =
		monthlyEvents <= 50_000 ? 29 :
		monthlyEvents <= 200_000 ? 49 :
		monthlyEvents <= 500_000 ? 99 :
		monthlyEvents <= 1_000_000 ? 199 : 349;

	// DataBull: $25/mo base up to 50k, $59/mo up to 250k, $119/mo up to 1M
	const databullCostMonthly =
		monthlyEvents <= 50_000 ? 25 :
		monthlyEvents <= 250_000 ? 59 :
		monthlyEvents <= 1_000_000 ? 119 : 249;

	// Grosslytics: $0 on free tier (up to 100k events/mo on Cloudflare) or $5/mo on Indie Cloud
	const grosslyticsCostMonthly = monthlyEvents <= 100_000 ? 0 : 5;

	// Annual savings vs competitor average
	const annualCompetitorAvg = ((datafastCostMonthly + databullCostMonthly) / 2) * 12;
	const annualGrosslytics = grosslyticsCostMonthly * 12;
	const annualSavings = annualCompetitorAvg - annualGrosslytics;

	// Gateway fees lost if untracked (approx 2.9% + 30c)
	const estimatedLostFeeAccuracy = Math.round(monthlyGmv * 0.029 * 12);

	return (
		<div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 sm:p-8 backdrop-blur-sm max-w-2xl mx-auto shadow-2xl">
			<div className="flex items-center justify-between mb-6">
				<h3 className="text-xl font-bold text-white tracking-tight">SaaS Margin & Pricing Calculator</h3>
				<span className="text-xs uppercase tracking-wider bg-emerald-500/10 text-emerald-400 font-semibold px-2.5 py-1 rounded-full border border-emerald-500/20">
					E-E-A-T Verified
				</span>
			</div>

			<div className="space-y-6">
				{/* Events Slider */}
				<div>
					<div className="flex justify-between items-center mb-2">
						<label htmlFor={eventsId} className="text-sm font-medium text-zinc-300">
							Monthly Pageviews & Events
						</label>
						<span className="text-sm font-semibold text-emerald-400 font-mono">
							{monthlyEvents.toLocaleString()} / mo
						</span>
					</div>
					<input
						id={eventsId}
						type="range"
						min={10_000}
						max={2_000_000}
						step={10_000}
						value={monthlyEvents}
						onChange={(e) => setMonthlyEvents(Number(e.target.value))}
						className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
					/>
					<div className="flex justify-between text-xs text-zinc-500 mt-1 font-mono">
						<span>10k</span>
						<span>500k</span>
						<span>1M</span>
						<span>2M+</span>
					</div>
				</div>

				{/* GMV Slider */}
				<div>
					<div className="flex justify-between items-center mb-2">
						<label htmlFor={gmvId} className="text-sm font-medium text-zinc-300">
							Monthly Stripe GMV
						</label>
						<span className="text-sm font-semibold text-emerald-400 font-mono">
							${monthlyGmv.toLocaleString()} / mo
						</span>
					</div>
					<input
						id={gmvId}
						type="range"
						min={1_000}
						max={100_000}
						step={1_000}
						value={monthlyGmv}
						onChange={(e) => setMonthlyGmv(Number(e.target.value))}
						className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
					/>
					<div className="flex justify-between text-xs text-zinc-500 mt-1 font-mono">
						<span>$1k</span>
						<span>$25k</span>
						<span>$50k</span>
						<span>$100k</span>
					</div>
				</div>

				{/* Comparison Grid */}
				<div className="grid grid-cols-3 gap-3 pt-4 border-t border-zinc-800 text-center">
					<div className="bg-zinc-950/60 p-4 rounded-xl border border-zinc-800/80">
						<div className="text-xs text-zinc-400 mb-1">DataFast</div>
						<div className="text-lg font-bold text-zinc-300 font-mono">${datafastCostMonthly}/mo</div>
						<div className="text-xs text-zinc-500 mt-1">No net fees</div>
					</div>
					<div className="bg-zinc-950/60 p-4 rounded-xl border border-zinc-800/80">
						<div className="text-xs text-zinc-400 mb-1">DataBull</div>
						<div className="text-lg font-bold text-zinc-300 font-mono">${databullCostMonthly}/mo</div>
						<div className="text-xs text-zinc-500 mt-1">No Razorpay</div>
					</div>
					<div className="bg-emerald-950/30 p-4 rounded-xl border border-emerald-500/40 relative">
						<div className="text-xs text-emerald-400 font-semibold mb-1">Grosslytics</div>
						<div className="text-lg font-bold text-emerald-300 font-mono">${grosslyticsCostMonthly}/mo</div>
						<div className="text-xs text-emerald-500 mt-1">True Net Profit</div>
					</div>
				</div>

				{/* Savings Callout */}
				<div className="bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-transparent border-l-4 border-emerald-500 p-4 rounded-r-xl">
					<div className="text-xs uppercase tracking-wider text-emerald-400 font-bold mb-1">
						Estimated Annual Value
					</div>
					<div className="text-2xl font-black text-white font-mono">
						${annualSavings.toLocaleString()} saved / yr
					</div>
					<p className="text-xs text-zinc-400 mt-1">
						Plus unmasks <strong className="text-zinc-200">${estimatedLostFeeAccuracy.toLocaleString()}</strong> in payment processor fees and ad spend otherwise misattributed to gross revenue.
					</p>
				</div>
			</div>
		</div>
	);
}

