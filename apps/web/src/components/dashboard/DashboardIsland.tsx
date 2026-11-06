import { useState, useEffect } from 'react';
import { useStore } from '@nanostores/react';
import {
	$dashboardFilters,
	setDateRange,
	setAttributionModel,
	setRevenueMode,
} from '../../stores/filterStore.js';
import type { ChannelStats } from '@grosslytics/shared/types';

// Mock initial data for instant zero-latency render / demo island
const DEMO_CHANNELS: ChannelStats[] = [
	{
		source: 'x.com (in-app)',
		category: 'Social (Organic)',
		visitors: 4820,
		sessions: 6240,
		pageviews: 9410,
		avgReadSec: 64,
		avgScrollPct: 78,
		grossRevenueCents: 495000,
		feesCents: 14655,
		netRevenueCents: 480345,
		adSpendCents: 0,
		trueProfitCents: 480345,
		conversions: 45,
		rpvCents: 100,
	},
	{
		source: 'chatgpt.com (AI)',
		category: 'AI Search',
		visitors: 2450,
		sessions: 3120,
		pageviews: 5200,
		avgReadSec: 92,
		avgScrollPct: 88,
		grossRevenueCents: 385000,
		feesCents: 11465,
		netRevenueCents: 373535,
		adSpendCents: 0,
		trueProfitCents: 373535,
		conversions: 35,
		rpvCents: 152,
	},
	{
		source: 'perplexity.ai (AI)',
		category: 'AI Search',
		visitors: 1890,
		sessions: 2400,
		pageviews: 4100,
		avgReadSec: 85,
		avgScrollPct: 82,
		grossRevenueCents: 242000,
		feesCents: 7318,
		netRevenueCents: 234682,
		adSpendCents: 0,
		trueProfitCents: 234682,
		conversions: 22,
		rpvCents: 124,
	},
	{
		source: 'linkedin.com (in-app)',
		category: 'Social (Organic)',
		visitors: 3100,
		sessions: 3800,
		pageviews: 5900,
		avgReadSec: 72,
		avgScrollPct: 74,
		grossRevenueCents: 220000,
		feesCents: 6680,
		netRevenueCents: 213320,
		adSpendCents: 0,
		trueProfitCents: 213320,
		conversions: 20,
		rpvCents: 69,
	},
	{
		source: 'google.com',
		category: 'Organic Search',
		visitors: 6200,
		sessions: 7800,
		pageviews: 11200,
		avgReadSec: 48,
		avgScrollPct: 62,
		grossRevenueCents: 198000,
		feesCents: 6042,
		netRevenueCents: 191958,
		adSpendCents: 0,
		trueProfitCents: 191958,
		conversions: 18,
		rpvCents: 31,
	},
	{
		source: 'Direct (Shared Link)',
		category: 'Direct',
		visitors: 2840,
		sessions: 3410,
		pageviews: 4890,
		avgReadSec: 54,
		avgScrollPct: 65,
		grossRevenueCents: 165000,
		feesCents: 5085,
		netRevenueCents: 159915,
		adSpendCents: 0,
		trueProfitCents: 159915,
		conversions: 15,
		rpvCents: 56,
	},
];

export default function DashboardIsland() {
	const filters = useStore($dashboardFilters);
	const [channels] = useState<ChannelStats[]>(DEMO_CHANNELS);
	const [onlineCount, setOnlineCount] = useState(24);

	// Periodic simulated live pulse
	useEffect(() => {
		const interval = setInterval(() => {
			setOnlineCount((prev) => Math.max(12, prev + (Math.random() > 0.5 ? 1 : -1)));
		}, 3000);
		return () => clearInterval(interval);
	}, []);

	// Metric calculation based on mode
	const totalVisitors = channels.reduce((sum, c) => sum + c.visitors, 0);
	const totalConversions = channels.reduce((sum, c) => sum + c.conversions, 0);
	const totalGrossCents = channels.reduce((sum, c) => sum + c.grossRevenueCents, 0);
	const totalFeesCents = channels.reduce((sum, c) => sum + c.feesCents, 0);
	const totalNetCents = channels.reduce((sum, c) => sum + c.netRevenueCents, 0);
	const displayedRevenueCents =
		filters.revenueMode === 'gross' ? totalGrossCents : totalNetCents;
	const overallRpv = totalVisitors > 0 ? (displayedRevenueCents / totalVisitors / 100).toFixed(2) : '0.00';

	return (
		<div className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl p-6 lg:p-8 shadow-2xl text-zinc-100">
			{/* Top Bar: Live Status & Controls */}
			<div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-zinc-800">
				<div className="flex items-center gap-3">
					<div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-full text-xs font-semibold text-emerald-400">
						<span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
						<span className="font-mono">{onlineCount}</span> Live Visitors
					</div>
					<span className="text-xs text-zinc-500 font-mono">Durable Object • &lt;30ms</span>
				</div>

				{/* Filter Controls */}
				<div className="flex flex-wrap items-center gap-2">
					{/* Attribution Model Picker */}
					<div className="flex bg-zinc-900 border border-zinc-800 rounded-lg p-1 text-xs font-medium">
						{(['first', 'last', 'linear'] as const).map((m) => (
							<button
								key={m}
								onClick={() => setAttributionModel(m)}
								className={`px-2.5 py-1 rounded capitalize transition-colors ${
									filters.attributionModel === m
										? 'bg-emerald-500/20 text-emerald-300 font-semibold'
										: 'text-zinc-400 hover:text-white'
								}`}
							>
								{m === 'linear' ? '50/50 Linear' : `${m} Touch`}
							</button>
						))}
					</div>

					{/* Revenue Mode Picker */}
					<div className="flex bg-zinc-900 border border-zinc-800 rounded-lg p-1 text-xs font-medium">
						<button
							onClick={() => setRevenueMode('net')}
							className={`px-2.5 py-1 rounded transition-colors ${
								filters.revenueMode === 'net'
									? 'bg-emerald-500/20 text-emerald-300 font-semibold'
									: 'text-zinc-400 hover:text-white'
							}`}
						>
							True Net
						</button>
						<button
							onClick={() => setRevenueMode('gross')}
							className={`px-2.5 py-1 rounded transition-colors ${
								filters.revenueMode === 'gross'
									? 'bg-emerald-500/20 text-emerald-300 font-semibold'
									: 'text-zinc-400 hover:text-white'
							}`}
						>
							Gross
						</button>
					</div>

					{/* Date Range */}
					<div className="flex bg-zinc-900 border border-zinc-800 rounded-lg p-1 text-xs font-medium font-mono">
						{(['24h', '7d', '30d', '90d'] as const).map((r) => (
							<button
								key={r}
								onClick={() => setDateRange(r)}
								className={`px-2 py-1 rounded uppercase transition-colors ${
									filters.dateRange === r
										? 'bg-zinc-800 text-white font-bold'
										: 'text-zinc-400 hover:text-white'
								}`}
							>
								{r}
							</button>
						))}
					</div>
				</div>
			</div>

			{/* KPI Summary Banner */}
			<div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-6 border-b border-zinc-800">
				<div>
					<div className="text-xs uppercase tracking-wider text-zinc-500 mb-1">
						{filters.revenueMode === 'net' ? 'True Net Revenue' : 'Gross Revenue'}
					</div>
					<div className="text-2xl lg:text-3xl font-extrabold font-mono text-white">
						${(displayedRevenueCents / 100).toLocaleString('en-US', { minimumFractionDigits: 0 })}
					</div>
					<div className="text-xs text-zinc-500 mt-1">
						Fees deducted: <span className="font-mono text-rose-400">-${(totalFeesCents / 100).toFixed(0)}</span>
					</div>
				</div>

				<div>
					<div className="text-xs uppercase tracking-wider text-zinc-500 mb-1">North Star RPV</div>
					<div className="text-2xl lg:text-3xl font-extrabold font-mono text-emerald-400">
						${overallRpv}
					</div>
					<div className="text-xs text-zinc-500 mt-1">Revenue per unique visitor</div>
				</div>

				<div>
					<div className="text-xs uppercase tracking-wider text-zinc-500 mb-1">Unique Visitors</div>
					<div className="text-2xl lg:text-3xl font-extrabold font-mono text-white">
						{totalVisitors.toLocaleString()}
					</div>
					<div className="text-xs text-zinc-500 mt-1">Zero-cookie edge hashed</div>
				</div>

				<div>
					<div className="text-xs uppercase tracking-wider text-zinc-500 mb-1">Paid Conversions</div>
					<div className="text-2xl lg:text-3xl font-extrabold font-mono text-white">
						{totalConversions.toLocaleString()}
					</div>
					<div className="text-xs text-zinc-500 mt-1">Stripe & Razorpay verified</div>
				</div>
			</div>

			{/* Channel Breakdown Table */}
			<div className="pt-6 overflow-x-auto">
				<table className="w-full text-left text-sm">
					<thead>
						<tr className="border-b border-zinc-800 text-xs text-zinc-400 uppercase tracking-wider">
							<th className="pb-3 font-semibold">Acquisition Channel</th>
							<th className="pb-3 font-semibold">Category</th>
							<th className="pb-3 font-semibold text-right">Visitors</th>
							<th className="pb-3 font-semibold text-right">Read Time</th>
							<th className="pb-3 font-semibold text-right">Scroll</th>
							<th className="pb-3 font-semibold text-right">
								{filters.revenueMode === 'net' ? 'Net Revenue' : 'Gross Revenue'}
							</th>
							<th className="pb-3 font-semibold text-right">Sales</th>
							<th className="pb-3 font-semibold text-right text-emerald-400">RPV</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-zinc-900 font-mono text-xs">
						{channels.map((c) => {
							const channelRevenueCents =
								filters.revenueMode === 'net' ? c.netRevenueCents : c.grossRevenueCents;
							const channelRpv = (channelRevenueCents / c.visitors / 100).toFixed(2);

							return (
								<tr key={c.source} className="hover:bg-zinc-900/50 transition-colors">
									<td className="py-3 font-sans font-medium text-white flex items-center gap-2">
										{c.source.includes('(AI)') && (
											<span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
										)}
										{c.source.includes('(in-app)') && (
											<span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
										)}
										{c.source}
									</td>
									<td className="py-3 font-sans">
										<span
											className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
												c.category === 'AI Search'
													? 'bg-violet-500/10 text-violet-300 border border-violet-500/20'
													: c.category.includes('Social')
													? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
													: 'bg-zinc-800 text-zinc-300'
											}`}
										>
											{c.category}
										</span>
									</td>
									<td className="py-3 text-right text-zinc-300">
										{c.visitors.toLocaleString()}
									</td>
									<td className="py-3 text-right text-zinc-400">{c.avgReadSec}s</td>
									<td className="py-3 text-right text-zinc-400">{c.avgScrollPct}%</td>
									<td className="py-3 text-right font-bold text-white">
										${(channelRevenueCents / 100).toLocaleString('en-US', { minimumFractionDigits: 0 })}
									</td>
									<td className="py-3 text-right text-zinc-300">{c.conversions}</td>
									<td className="py-3 text-right font-bold text-emerald-400">
										${channelRpv}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
}

