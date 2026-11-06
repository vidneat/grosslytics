import { useEffect, useRef, useState } from 'react';
import { CreditCard, CircleDollarSign, Eye, LogOut, MousePointerClick, X } from 'lucide-react';
import type { DashSale } from '@grosslytics/shared/dashboard';
import { sourceIcon } from '@grosslytics/shared/dashboard';
import type { LiveEntry } from './api';
import { flag, LIVE_POOL, type JourneyStep } from './demo';
import { SourceIcon, usd } from './ui';

const ago = (s: number) => (s < 5 ? 'now' : s < 60 ? `${Math.floor(s)}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`);
const GATEWAY_LABEL: Record<string, string> = { stripe: 'Stripe', razorpay: 'Razorpay', paddle: 'Paddle', polar: 'Polar', lemonsqueezy: 'Lemon Squeezy' };
export const gatewayLabel = (g: string) => GATEWAY_LABEL[g] ?? g;

/** Simulated stream for the demo; the real one comes from useLiveSocket. */
function useDemoFeed(enabled: boolean): LiveEntry[] {
	const base = useRef(Date.now() / 1000);
	const [entries, setEntries] = useState<LiveEntry[]>(() =>
		[4, 19, 41, 72, 130, 205].map((age, i) => ({ ...LIVE_POOL[i]!, id: String(i), at: base.current - age, sale: i === 2 ? 99_00 : undefined })),
	);
	const next = useRef(6);
	useEffect(() => {
		if (!enabled) return;
		const t = setInterval(() => {
			const i = next.current++;
			const fresh: LiveEntry = { ...LIVE_POOL[i % LIVE_POOL.length]!, id: String(i), at: Date.now() / 1000, sale: i % 5 === 0 ? 99_00 : undefined };
			setEntries((list) => [fresh, ...list].slice(0, 7));
		}, 4000);
		return () => clearInterval(t);
	}, [enabled]);
	return entries;
}

export function LiveFeed({ entries: real }: { entries?: LiveEntry[] }) {
	const demo = useDemoFeed(!real);
	const entries = real ?? demo;
	const [now, setNow] = useState(() => Date.now() / 1000);
	useEffect(() => {
		const t = setInterval(() => setNow(Date.now() / 1000), 5000);
		return () => clearInterval(t);
	}, []);

	if (!entries.length)
		return <p className="px-3 py-6 text-center text-[13px] text-ink-3">Nobody on the site right now. Visits and sales appear here the moment they happen.</p>;
	return (
		<ul className="space-y-0.5 px-1" aria-live="polite" aria-label="Live visitors and sales">
			{entries.map((e) => {
				const label = sourceIcon(e.src) || e.src || 'Direct';
				return (
					<li key={e.id} className={`flex items-center gap-3 rounded-lg px-2 py-2 text-[13px] ${now - e.at < 5 ? 'animate-[fadein_0.6s_ease-out]' : ''}`}>
						<span className="w-[18px] text-[15px] leading-none" aria-hidden="true">{flag(e.cc)}</span>
						<span className="min-w-0 flex-1">
							{e.sale ? (
								<span className="flex items-center gap-1.5 font-medium">
									<CircleDollarSign size={14} className="text-up" aria-hidden="true" />
									{usd(e.sale)} sale{e.city ? ` from ${e.city}` : ''}
								</span>
							) : (
								<span className="block truncate">
									<span className="text-ink-2">{e.city || 'Someone'} on</span> {e.page}
								</span>
							)}
							<span className="flex items-center gap-1.5 text-[12px] text-ink-3">
								<SourceIcon icon={sourceIcon(e.src)} label={label} size={12} />
								{label}
							</span>
						</span>
						<span className="tnum shrink-0 text-[12px] text-ink-3">{ago(Math.max(0, now - e.at))}</span>
					</li>
				);
			})}
		</ul>
	);
}

const KIND_ICON = { visit: Eye, leave: LogOut, goal: MousePointerClick, pay: CreditCard } as const;

/** Slide-over showing how one buyer found you, what they read, and what you kept. */
export function JourneyDrawer({ sale, onClose, loadJourney }: { sale: DashSale | null; onClose: () => void; loadJourney: (s: DashSale) => Promise<JourneyStep[]> }) {
	const closeRef = useRef<HTMLButtonElement>(null);
	const [journey, setJourney] = useState<JourneyStep[] | null>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		if (!sale) return;
		let live = true;
		setJourney(null);
		setFailed(false);
		loadJourney(sale).then(
			(j) => live && setJourney(j),
			() => live && setFailed(true),
		);
		return () => {
			live = false;
		};
	}, [sale, loadJourney]);
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

	const days = Math.floor(sale.hours / 24);
	return (
		<div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true" aria-labelledby="journey-title">
			<button type="button" className="absolute inset-0 cursor-default bg-black/30 backdrop-blur-[2px]" onClick={onClose} aria-label="Close journey" tabIndex={-1} />
			<aside className="relative flex h-full w-full max-w-[440px] flex-col overflow-y-auto bg-card shadow-2xl ring-1 ring-line">
				<header className="sticky top-0 flex items-start justify-between gap-4 border-b border-line bg-card/90 px-6 py-5 backdrop-blur">
					<div>
						<h2 id="journey-title" className="text-[19px] font-semibold tracking-[-0.02em]">{sale.email}</h2>
						<p className="mt-0.5 text-[13px] text-ink-2">
							{flag(sale.country)} {[sale.city, sale.plan, gatewayLabel(sale.gateway)].filter(Boolean).join(' · ')}
						</p>
					</div>
					<button ref={closeRef} type="button" onClick={onClose} className="rounded-full p-1.5 text-ink-2 hover:bg-band" aria-label="Close">
						<X size={18} />
					</button>
				</header>

				<div className="space-y-7 px-6 py-6">
					<section className="grid grid-cols-2 gap-3 text-[13px]">
						{[
							{ k: 'First touch', v: sale.first, i: sourceIcon(sale.first) },
							{ k: 'Last touch', v: sale.last, i: sourceIcon(sale.last) },
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
							{sale.refunded && <span className="font-medium text-down">Refunded, so it no longer counts as revenue. </span>}
							{sale.renewal ? 'Renewal, credited to the original sources.' : days === 0 ? 'Bought on the first day.' : `${days} day${days === 1 ? '' : 's'} from first visit to payment.`} Linear attribution credits each touch 50%.
						</p>
					</section>

					<section>
						<h3 className="mb-3 text-[13px] font-semibold">Journey</h3>
						{!journey && <p className="text-[13px] text-ink-3">{failed ? 'Could not load this journey.' : 'Loading…'}</p>}
						{journey?.length === 0 && <p className="text-[13px] text-ink-3">No visits were linked to this payment (the buyer paid without a tracked visitor id).</p>}
						<ol className="relative space-y-4 border-l border-line pl-5">
							{(journey ?? []).map((step, i) => {
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
						<div className="flex justify-between py-1"><span className="text-ink-2">{gatewayLabel(sale.gateway)} fee</span><span className="text-ink-2">−{usd(sale.fee, 2)}</span></div>
						<div className="mt-1 flex justify-between border-t border-line pt-2 font-semibold"><span>You kept</span><span>{usd(sale.gross - sale.fee, 2)}</span></div>
					</section>
				</div>
			</aside>
		</div>
	);
}
