import { useEffect, useRef, useState } from 'react';
import { CreditCard, CircleDollarSign, Eye, LogOut, MousePointerClick, X } from 'lucide-react';
import { calculateNetRevenue } from '@grosslytics/shared/fees';
import type { PaymentGateway } from '@grosslytics/shared/types';
import { flag, journeyFor, LIVE_POOL, SALES } from './demo';
import { SourceIcon, usd } from './ui';

type Entry = (typeof LIVE_POOL)[number] & { id: number; age: number; sale?: number };

const ago = (s: number) => (s < 5 ? 'now' : s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`);

/** Simulated live stream (demo). In production this is the SiteLiveHub WebSocket. */
export function LiveFeed() {
	const [entries, setEntries] = useState<Entry[]>(() =>
		[4, 19, 41, 72, 130, 205].map((age, i) => ({ ...LIVE_POOL[i]!, id: i, age, sale: i === 2 ? 99_00 : undefined })),
	);
	const next = useRef(6);
	useEffect(() => {
		const t = setInterval(() => {
			setEntries((list) => {
				const i = next.current++;
				const fresh: Entry = { ...LIVE_POOL[i % LIVE_POOL.length]!, id: i, age: 0, sale: i % 5 === 0 ? 99_00 : undefined };
				return [fresh, ...list.map((e) => ({ ...e, age: e.age + 4 }))].slice(0, 7);
			});
		}, 4000);
		return () => clearInterval(t);
	}, []);

	return (
		<ul className="space-y-0.5 px-1" aria-live="polite" aria-label="Live visitors and sales">
			{entries.map((e) => (
				<li key={e.id} className={`flex items-center gap-3 rounded-lg px-2 py-2 text-[13px] ${e.age === 0 ? 'animate-[fadein_0.6s_ease-out]' : ''}`}>
					<span className="text-[15px] leading-none" aria-hidden="true">{flag(e.cc)}</span>
					<span className="min-w-0 flex-1">
						{e.sale ? (
							<span className="flex items-center gap-1.5 font-medium">
								<CircleDollarSign size={14} className="text-up" aria-hidden="true" />
								{usd(e.sale)} sale from {e.city}
							</span>
						) : (
							<span className="block truncate">
								<span className="text-ink-2">{e.city} on</span> {e.page}
							</span>
						)}
						<span className="flex items-center gap-1.5 text-[12px] text-ink-3">
							<SourceIcon icon={e.src} label={e.label} size={12} />
							{e.label}
						</span>
					</span>
					<span className="tnum shrink-0 text-[12px] text-ink-3">{ago(e.age)}</span>
				</li>
			))}
		</ul>
	);
}

const GATEWAY_ID: Record<string, PaymentGateway> = { Stripe: 'stripe', Razorpay: 'razorpay', Paddle: 'paddle', Polar: 'polar', 'Lemon Squeezy': 'lemonsqueezy' };
const KIND_ICON = { visit: Eye, leave: LogOut, goal: MousePointerClick, pay: CreditCard } as const;

/** Slide-over showing how one buyer found you, what they read, and what you kept. */
export function JourneyDrawer({ sale, onClose }: { sale: (typeof SALES)[number] | null; onClose: () => void }) {
	const closeRef = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (!sale) return;
		const prev = document.activeElement as HTMLElement | null;
		closeRef.current?.focus();
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('keydown', onKey);
			prev?.focus();
		};
	}, [sale, onClose]);
	if (!sale) return null;

	const { feeCents, netCents } = calculateNetRevenue(GATEWAY_ID[sale.gateway] ?? 'stripe', sale.gross);
	return (
		<div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true" aria-labelledby="journey-title">
			<button type="button" className="absolute inset-0 cursor-default bg-black/30 backdrop-blur-[2px]" onClick={onClose} aria-label="Close journey" tabIndex={-1} />
			<aside className="relative flex h-full w-full max-w-[440px] flex-col overflow-y-auto bg-card shadow-2xl ring-1 ring-line">
				<header className="sticky top-0 flex items-start justify-between gap-4 border-b border-line bg-card/90 px-6 py-5 backdrop-blur">
					<div>
						<h2 id="journey-title" className="text-[19px] font-semibold tracking-[-0.02em]">{sale.email}</h2>
						<p className="mt-0.5 text-[13px] text-ink-2">
							{flag(sale.country)} {sale.city} · {sale.plan} · {sale.gateway}
						</p>
					</div>
					<button ref={closeRef} type="button" onClick={onClose} className="rounded-full p-1.5 text-ink-2 hover:bg-band" aria-label="Close">
						<X size={18} />
					</button>
				</header>

				<div className="space-y-7 px-6 py-6">
					<section className="grid grid-cols-2 gap-3 text-[13px]">
						{[
							{ k: 'First touch', v: sale.first, i: sale.firstIcon },
							{ k: 'Last touch', v: sale.last, i: sale.lastIcon },
						].map((t) => (
							<div key={t.k} className="rounded-xl bg-band px-3 py-2.5">
								<div className="text-[11px] text-ink-3">{t.k}</div>
								<div className="mt-1 flex items-center gap-1.5 font-medium">
									<SourceIcon icon={t.i} label={t.v} size={14} />
									<span className="truncate">{t.v}</span>
								</div>
							</div>
						))}
						<p className="col-span-2 text-[12px] text-ink-3">
							{sale.days === 0 ? 'Bought on the first day.' : `${sale.days} days from first visit to payment.`} Linear attribution credits each touch 50%.
						</p>
					</section>

					<section>
						<h3 className="mb-3 text-[13px] font-semibold">Journey</h3>
						<ol className="relative space-y-4 border-l border-line pl-5">
							{journeyFor(sale).map((step, i) => {
								const Icon = KIND_ICON[step.kind as keyof typeof KIND_ICON] ?? Eye;
								return (
									<li key={i} className="relative">
										<span className={`absolute top-0 -left-[31px] flex h-5 w-5 items-center justify-center rounded-full ring-4 ring-card ${step.kind === 'pay' ? 'bg-accent text-white' : 'bg-band text-ink-2'}`}>
											<Icon size={11} strokeWidth={2.25} aria-hidden="true" />
										</span>
										<div className="text-[11px] text-ink-3">{step.t}</div>
										<div className="text-[14px]">{step.what}</div>
										{(step.src || step.detail) && (
											<div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-2">
												{step.src && <span>via {step.src}</span>}
												{step.detail && <span>{step.detail}</span>}
											</div>
										)}
									</li>
								);
							})}
						</ol>
					</section>

					<section className="tnum rounded-xl bg-band px-4 py-3 text-[14px]">
						<div className="flex justify-between py-1"><span className="text-ink-2">Gross</span><span>{usd(sale.gross, 2)}</span></div>
						<div className="flex justify-between py-1"><span className="text-ink-2">{sale.gateway} fee (est.)</span><span className="text-ink-2">−{usd(feeCents, 2)}</span></div>
						<div className="mt-1 flex justify-between border-t border-line pt-2 font-semibold"><span>You kept</span><span>{usd(netCents, 2)}</span></div>
					</section>
				</div>
			</aside>
		</div>
	);
}
