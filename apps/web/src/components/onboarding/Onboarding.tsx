import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, Check, Copy, Loader2 } from 'lucide-react';
import { apiFetch, DEFAULT_API, loadConnection, saveConnection, useLiveSocket, useRemoteDashboard, type Connection, type SiteInfo } from '../dashboard/api';
import { Connect, FooterGate, FOOTER_SNIPPET } from '../dashboard/connect';
import { copyText } from '../../lib/clipboard';
import { CHECKOUT_LIFETIME, CLOUD_PRICE } from '../../lib/checkout';

type Plan = 'self' | 'cloud' | 'lifetime';

const PLANS: Array<{ id: Plan; name: string; price: string; unit: string; note: string }> = [
	{ id: 'self', name: 'Self-host', price: '$0', unit: 'forever', note: 'Open source (AGPL), on your own Cloudflare.' },
	{ id: 'cloud', name: 'Indie Cloud', price: CLOUD_PRICE, unit: 'per month', note: 'We run it. You just add the script.' },
	{ id: 'lifetime', name: 'Lifetime', price: '$29', unit: 'one time', note: 'One-command install, priority support, commercial license.' },
];

// Lifetime: the Dodo checkout link. Cloud is open when this API runs Hosted Cloud (CLOUD=1):
// people sign up in /app first and pay from there, so the payment is tied to their account.
const CHECKOUT: Record<Exclude<Plan, 'self'>, string | undefined> = {
	cloud: undefined,
	lifetime: CHECKOUT_LIFETIME,
};
const REPO = (import.meta.env.PUBLIC_REPO_URL as string | undefined) || 'https://github.com/vidneat/grosslytics';

export default function Onboarding() {
	const [plan, setPlan] = useState<Plan>('self');
	useEffect(() => {
		const p = new URLSearchParams(location.search).get('plan');
		if (p === 'cloud' || p === 'lifetime' || p === 'self') setPlan(p);
	}, []);
	const choose = (p: Plan) => {
		setPlan(p);
		history.replaceState(null, '', `?plan=${p}`);
	};

	return (
		<div className="space-y-10">
			<div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Plan">
				{PLANS.map((p) => (
					<button
						key={p.id}
						type="button"
						role="radio"
						aria-checked={plan === p.id}
						onClick={() => choose(p.id)}
						className={`rounded-[22px] p-5 text-left transition-shadow ${plan === p.id ? 'bg-card ring-2 ring-accent' : 'bg-band ring-1 ring-line hover:ring-ink-3'}`}
					>
						<span className="block text-[15px] font-semibold">{p.name}</span>
						<span className="mt-1 block"><span className="font-display text-[28px] font-semibold tracking-[-0.02em]">{p.price}</span> <span className="text-[13px] text-ink-2">{p.unit}</span></span>
						<span className="mt-1 block text-[13px] text-ink-2">{p.note}</span>
					</button>
				))}
			</div>
			{plan === 'self' ? <SelfHost /> : <Paid plan={plan} />}
		</div>
	);
}

function Paid({ plan }: { plan: Exclude<Plan, 'self'> }) {
	const url = CHECKOUT[plan];
	const [email, setEmail] = useState('');
	const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
	const name = PLANS.find((p) => p.id === plan)!.name;
	const [cloudOpen, setCloudOpen] = useState(false);
	useEffect(() => {
		if (plan !== 'cloud') return;
		fetch(`${DEFAULT_API || location.origin}/api/auth/status`, { cache: 'no-store' })
			.then((r) => (r.ok ? r.json() : null))
			.then((s: { cloud?: boolean } | null) => setCloudOpen(!!s?.cloud), () => {});
	}, [plan]);

	if (plan === 'cloud' && cloudOpen)
		return (
			<div className="rounded-[22px] bg-card p-7 text-center ring-1 ring-line">
				<p className="text-ink-2">Create your account, add one script tag, and you have 14 days free. No card needed. Then {CLOUD_PRICE}/month for up to 100,000 events.</p>
				<a className="btn btn-primary mt-5" href="/app?signup">Start free trial <ArrowRight size={15} aria-hidden="true" /></a>
			</div>
		);

	if (url)
		return (
			<div className="rounded-[22px] bg-card p-7 text-center ring-1 ring-line">
				<p className="text-ink-2">{plan === 'lifetime' ? 'Pay once. You get a license key, then run npx grosslytics install: it signs in to your Cloudflare, creates everything and deploys it, with no git or Bun. The same command updates it later. Lifetime also includes priority email support and a commercial license (no AGPL obligations).' : 'Pay, then add one script tag. We host everything else.'}</p>
				<a className="btn btn-primary mt-5" href={url}>Continue to checkout <ArrowRight size={15} aria-hidden="true" /></a>
			</div>
		);

	return (
		<div className="rounded-[22px] bg-card p-7 ring-1 ring-line">
			<h2 className="text-[19px] font-semibold tracking-[-0.02em]">{name} isn't open yet.</h2>
			<p className="mt-1 text-ink-2">
				Leave your email and we'll write once, when it opens. Want it running today? <a className="text-accent hover:underline" href="?plan=self">Self-host is free</a> and has every feature.
			</p>
			{state === 'done' ? (
				<p className="mt-5 flex items-center gap-2 font-medium text-up" role="status"><Check size={16} aria-hidden="true" />You're on the list.</p>
			) : (
				<form
					className="mt-5 flex flex-col gap-2 sm:flex-row"
					onSubmit={async (e) => {
						e.preventDefault();
						setState('busy');
						try {
							const res = await fetch(`${DEFAULT_API}/api/waitlist`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, plan, website: (e.currentTarget.elements.namedItem('website') as HTMLInputElement | null)?.value }) });
							setState(res.ok ? 'done' : 'error');
						} catch {
							setState('error');
						}
					}}
				>
					<input
						type="email"
						required
						autoComplete="email"
						placeholder="you@startup.com"
						aria-label="Email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						className="w-full rounded-xl bg-band px-3.5 py-2.5 text-[15px] ring-1 ring-line outline-none focus:ring-2 focus:ring-accent"
					/>
					{/* Honeypot: hidden from people and screen readers; bots that fill every field are ignored */}
					<input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
					<button className="btn btn-primary shrink-0" disabled={state === 'busy'}>{state === 'busy' ? 'Joining…' : 'Join the waitlist'}</button>
				</form>
			)}
			{state !== 'done' && <p className="mt-2 text-[12px] text-ink-3">We use your email only to tell you when it opens. <a className="hover:underline" href="/privacy/">Privacy policy</a></p>}
			{state === 'error' && <p className="mt-2 text-[13px] text-down" role="alert">That didn't go through. Check the email, wait a minute, and try again.</p>}
		</div>
	);
}

function CopyBlock({ code, label }: { code: string; label?: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<div className="group relative mt-2 rounded-xl bg-band ring-1 ring-line">
			{label && <div className="px-3.5 pt-2.5 text-[11px] text-ink-3">{label}</div>}
			<pre className="overflow-x-auto px-3.5 py-2.5 pr-20 font-mono text-[12.5px] leading-relaxed text-ink"><code>{code}</code></pre>
			<button
				type="button"
				onClick={() => copyText(code).then(setCopied)}
				className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md bg-card px-2 py-1 text-[12px] text-ink-2 ring-1 ring-line hover:text-ink"
				aria-label={`Copy ${label ?? 'command'}`}
			>
				{copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
				{copied ? 'Copied' : 'Copy'}
			</button>
		</div>
	);
}

type Status = 'done' | 'current' | 'waiting' | 'todo';

function Step(props: { n: number; title: string; status: Status; summary?: ReactNode; children: ReactNode; open: boolean; onToggle: () => void }) {
	const { status } = props;
	return (
		<li className="relative pl-12">
			<span
				className={`absolute top-0 left-0 flex h-8 w-8 items-center justify-center rounded-full text-[14px] font-semibold ${
					status === 'done' ? 'bg-up text-white' : status === 'todo' ? 'bg-band text-ink-3 ring-1 ring-line' : 'bg-accent text-white'
				}`}
				aria-hidden="true"
			>
				{status === 'done' ? <Check size={16} strokeWidth={3} /> : props.n}
			</span>
			<button type="button" onClick={props.onToggle} className="flex w-full items-center justify-between gap-3 text-left" aria-expanded={props.open}>
				<span className="text-[17px] font-semibold tracking-[-0.01em]">{props.title}</span>
				<span className="text-[13px] text-ink-3">
					{status === 'done' ? 'Done' : status === 'waiting' ? (
						<span className="inline-flex items-center gap-1.5 text-accent"><Loader2 size={13} className="animate-spin" aria-hidden="true" />Waiting</span>
					) : null}
				</span>
			</button>
			{!props.open && props.summary && <div className="mt-1 text-[13px] text-ink-2">{props.summary}</div>}
			{props.open && <div className="mt-3 space-y-3 text-[15px] text-ink-2">{props.children}</div>}
		</li>
	);
}

const GATEWAYS = {
	stripe: {
		label: 'Stripe',
		where: 'Dashboard → Developers → Webhooks → Add endpoint',
		events: 'checkout.session.completed, invoice.paid, invoice_payment.paid, charge.refunded',
		secret: 'STRIPE_WEBHOOK_SECRET',
		link: 'Checkout and Payment Links on your site get client_reference_id added automatically. For Checkout Sessions created on your server, pass client_reference_id: the visitor id from localStorage.gl_vid.',
	},
	paddle: {
		label: 'Paddle',
		where: 'Developer tools → Notifications → New destination',
		events: 'transaction.completed, adjustment.created, adjustment.updated',
		secret: 'PADDLE_WEBHOOK_SECRET',
		link: 'Pass customData: { visitor_id: localStorage.gl_vid } when you open Paddle Checkout.',
	},
	lemonsqueezy: {
		label: 'Lemon Squeezy',
		where: 'Settings → Webhooks → +',
		events: 'order_created, subscription_payment_success',
		secret: 'LEMONSQUEEZY_WEBHOOK_SECRET',
		link: 'Checkout links on your site get checkout[custom][visitor_id] added automatically.',
	},
	polar: {
		label: 'Polar',
		where: 'Settings → Webhooks → Add endpoint (format: Raw)',
		events: 'order.paid',
		secret: 'POLAR_WEBHOOK_SECRET',
		link: 'Set metadata.visitor_id to localStorage.gl_vid when you create the checkout.',
	},
	razorpay: {
		label: 'Razorpay',
		where: 'Account & Settings → Webhooks → Add new webhook',
		events: 'payment.captured',
		secret: 'RAZORPAY_WEBHOOK_SECRET',
		link: 'Pass notes: { visitor_id: localStorage.gl_vid } in your Razorpay order or checkout options.',
	},
} as const;
type Gateway = keyof typeof GATEWAYS;

function SelfHost() {
	const [conn, setConn] = useState<Connection | null>(null);
	const [site, setSite] = useState<SiteInfo | null>(null);
	const [siteError, setSiteError] = useState('');
	const [siteRetry, setSiteRetry] = useState(0);
	const [deployed, setDeployed] = useState(false);
	const [where, setWhere] = useState<'cloudflare' | 'local'>('cloudflare');
	const [gateway, setGateway] = useState<Gateway>('stripe');
	const [open, setOpen] = useState<number | null>(null);
	const [tick, setTick] = useState(0);

	useEffect(() => {
		const c = loadConnection();
		if (c) {
			setConn(c);
			setDeployed(true);
		}
	}, []);

	useEffect(() => {
		if (!conn) return;
		const ctl = new AbortController();
		apiFetch<{ sites: SiteInfo[] }>(conn, '/api/stats/sites', { signal: ctl.signal })
			.then(({ sites }) => {
				const selected = sites.find((s) => s.id === conn.siteId);
				if (!selected) throw new Error('This site is no longer available. Choose another site.');
				if (!ctl.signal.aborted) setSite(selected);
			})
			.catch((error: Error) => {
				if (!ctl.signal.aborted) setSiteError(error.message);
			});
		return () => ctl.abort();
	}, [conn, siteRetry]);

	const changeSite = (connection: Connection | null) => {
		saveConnection(connection);
		setConn(connection);
		setSite(null);
		setSiteError('');
		setOpen(null);
	};

	const canReadStats = !!site && !site.locked;
	// Real checks: poll the site's own data until a visit and a sale have arrived
	const { data, footer } = useRemoteDashboard(conn && canReadStats ? { conn } : null, { range: '30d', model: 'first', mode: 'gross', filters: [] }, tick);
	useEffect(() => {
		// The first stats request can recheck an expired verification and lock the site again.
		if (footer && site && !site.locked) {
			setSite({ ...site, locked: true });
			setOpen(null);
		}
	}, [footer, site]);
	const ready = canReadStats && !footer;
	const live = useLiveSocket(ready ? conn : null);
	const hasVisit = ready && ((data?.totals.visitors ?? 0) > 0 || (live.online ?? 0) > 0);
	const hasSale = ready && ((data?.sales.length ?? 0) > 0 || (data?.ltv.length ?? 0) > 0 || live.entries.some((e) => e.sale));
	const waiting = ready && (!hasVisit || !hasSale);
	useEffect(() => {
		if (!waiting) return;
		const t = setInterval(() => setTick((x) => x + 1), 5000);
		return () => clearInterval(t);
	}, [waiting]);

	const statuses: Status[] = [
		deployed ? 'done' : 'current',
		conn ? 'done' : deployed ? 'current' : 'todo',
		!conn ? 'todo' : ready ? 'done' : site || siteError ? 'current' : 'waiting',
		!ready ? 'todo' : hasVisit ? 'done' : 'waiting',
		!ready ? 'todo' : hasSale ? 'done' : 'waiting',
	];
	const firstOpen = statuses.findIndex((s) => s !== 'done');
	const isOpen = (i: number) => (open === null ? i === firstOpen : open === i);
	const toggle = (i: number) => () => setOpen(isOpen(i) ? -1 : i);

	const api = (conn?.api || DEFAULT_API || (typeof location === 'undefined' ? '' : location.origin)).replace(/\/$/, '');
	const origin = typeof location === 'undefined' ? '' : location.origin;
	const siteId = conn?.siteId ?? 'YOUR_SITE_ID';
	const g = GATEWAYS[gateway];
	const allDone = statuses.every((s) => s === 'done');

	return (
		<div>
			<ol className="space-y-8">
				<Step n={1} title="Deploy the API to your Cloudflare account" status={statuses[0]!} open={isOpen(0)} onToggle={toggle(0)} summary={deployed && 'Your API is running.'}>
					<div className="seg" role="group" aria-label="Where to run it">
						<button type="button" aria-pressed={where === 'cloudflare'} onClick={() => setWhere('cloudflare')}>Cloudflare</button>
						<button type="button" aria-pressed={where === 'local'} onClick={() => setWhere('local')}>Try it locally</button>
					</div>
					{where === 'cloudflare' ? (
						<>
							<p>Needs <a className="text-accent hover:underline" href="https://bun.sh">Bun</a>, <a className="text-accent hover:underline" href="https://nodejs.org">Node.js</a> 18 or newer, a free Cloudflare account, and a domain on that account. About five minutes.</p>
							<CopyBlock label="1. Get the code" code={`git clone ${REPO}.git\ncd grosslytics && bun install`} />
							<CopyBlock label="2. Set up and deploy" code="bun run setup" />
							<p className="text-[13px]">It asks for a hostname (such as analytics.yourstartup.com) and a dashboard password, then opens Cloudflare: click <strong>Allow</strong>. It creates the database and queues, deploys, and prints your dashboard address and API_TOKEN. Run it again later to update.</p>
							<p className="text-[13px]">Brand-new Cloudflare account? Open <a className="text-accent hover:underline" href="https://dash.cloudflare.com/?to=/:account/workers-and-pages">Workers &amp; Pages</a> once first, so Cloudflare creates your workers.dev subdomain. If your hostname already has DNS records, delete them first.</p>
						</>
					) : (
						<>
							<p>Runs the whole stack on your machine with 180 days of sample data, so you can explore before deploying.</p>
							<CopyBlock label="In the repo" code={`printf 'API_TOKEN=%s\\n' "$(openssl rand -hex 16)" > .dev.vars\nbun run db:seed:local\nbun run dev:api`} />
							<p className="text-[13px]">Your token is in <code className="font-mono">.dev.vars</code>. The API listens on <code className="font-mono">http://localhost:8787</code>.</p>
						</>
					)}
					<button type="button" className="btn btn-primary" onClick={() => (setDeployed(true), setOpen(1))}>It's running</button>
				</Step>

				<Step n={2} title="Connect this dashboard and add your site" status={statuses[1]!} open={isOpen(1)} onToggle={toggle(1)} summary={conn && <>Connected to <code className="font-mono text-[12px]">{conn.api}</code>, site <code className="font-mono text-[12px]">{conn.siteId}</code>. <button type="button" className="text-accent hover:underline" onClick={() => changeSite(null)}>Change</button></>}>
					<p>Open your own dashboard at <code className="font-mono text-[13px]">https://your-hostname/app</code> and sign in with the password you chose. It shows your tracker snippet and payment webhooks. Or connect it here with your API URL and the API_TOKEN that setup printed, and follow the next steps on this page.</p>
					<div className="-mx-2">
						<Connect remote onConnect={changeSite} />
					</div>
				</Step>

				<Step n={3} title="Verify your footer link" status={statuses[2]!} open={isOpen(2)} onToggle={toggle(2)} summary={ready ? 'Your site is ready to continue.' : 'Free self-hosting requires a “Powered by Grosslytics” link on your homepage.'}>
					{!conn ? (
						<>
							<p>Add this link to your homepage footer for free self-hosting. Connect your site in step 2 to verify it.</p>
							<CopyBlock label="Footer link" code={FOOTER_SNIPPET} />
						</>
					) : siteError ? (
						<>
							<p className="text-down" role="alert">{siteError}</p>
							<button type="button" className="btn btn-primary" onClick={() => {
								setSiteError('');
								setSiteRetry((n) => n + 1);
							}}>Retry</button>
						</>
					) : !site ? (
						<p role="status">Checking your site's footer status…</p>
					) : site.locked ? (
						<FooterGate key={site.id} conn={conn} site={site} onVerified={() => {
							setSite({ ...site, locked: false });
							setOpen(null);
						}} onSwitch={() => changeSite(null)} />
					) : (
						<p>Your site is ready to continue.</p>
					)}
				</Step>

				<Step n={4} title="Add the tracker to your site" status={statuses[3]!} open={isOpen(3)} onToggle={toggle(3)} summary={hasVisit && 'Visits are arriving.'}>
					<p>Paste this into the <code className="font-mono text-[13px]">&lt;head&gt;</code> of every page. It's about 1.5 KB compressed and sets no cookies.</p>
					<CopyBlock label="HTML" code={`<script defer src="${origin}/g.js" data-site-id="${siteId}" data-api="${api}/api/event"></script>`} />
					<p className="text-[13px]">Then open your site in a new tab. This step turns green as soon as the visit arrives.</p>
					<p className="text-[13px]">Still waiting? If your site sends a Content-Security-Policy header, add <code className="font-mono">{api || origin}</code> to its <code className="font-mono">script-src</code> and <code className="font-mono">connect-src</code>. Otherwise the browser blocks the tracker and only says so in the console.</p>
				</Step>

				<Step n={5} title="Connect payments" status={statuses[4]!} open={isOpen(4)} onToggle={toggle(4)} summary={hasSale && 'Sales are being attributed.'}>
					<div className="flex flex-wrap gap-1.5" role="group" aria-label="Payment provider">
						{(Object.keys(GATEWAYS) as Gateway[]).map((k) => (
							<button
								key={k}
								type="button"
								aria-pressed={gateway === k}
								onClick={() => setGateway(k)}
								className={`rounded-full px-3 py-1 text-[13px] ring-1 ${gateway === k ? 'bg-accent text-white ring-accent' : 'ring-line hover:ring-ink-3'}`}
							>
								{GATEWAYS[k].label}
							</button>
						))}
					</div>
					<p>In {g.label}: <span className="text-ink">{g.where}</span>. Use this URL and subscribe to <span className="font-mono text-[13px] text-ink">{g.events}</span>:</p>
					<CopyBlock label="Webhook URL" code={`${api}/api/webhooks/${gateway}?siteId=${siteId}`} />
					<p>Copy the signing secret {g.label} shows you, then store it on your API:</p>
					<CopyBlock label="In the repo" code={`bunx wrangler secret put ${g.secret}`} />
					<p className="text-[13px]">{g.link} Unsigned or wrongly signed webhooks are rejected, and retries are never counted twice.</p>
					<p className="text-[13px]">This step turns green when the first payment arrives. A test-mode payment works.</p>
				</Step>
			</ol>

			<div className={`mt-10 flex flex-col items-center gap-2 rounded-[22px] p-7 text-center ${allDone ? 'bg-card ring-2 ring-up' : 'bg-band'}`}>
				<p className="text-[17px] font-semibold">{allDone ? "You're live. Every sale now shows where it came from." : 'You can open the dashboard at any point.'}</p>
				<a className="btn btn-primary mt-2" href="/app/">Open the dashboard <ArrowRight size={15} aria-hidden="true" /></a>
			</div>
		</div>
	);
}
