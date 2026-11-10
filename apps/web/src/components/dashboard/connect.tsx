import { useEffect, useState } from 'react';
import { Copy, KeyRound, LockKeyhole, Plug } from 'lucide-react';
import { apiFetch, DEFAULT_API, logout, type Connection, type SiteInfo } from './api';
import { REPORTING_CURRENCIES } from '@grosslytics/shared/money';
import { copyText } from '../../lib/clipboard';
import { CHECKOUT_CLOUD, CLOUD_PRICE } from '../../lib/checkout';

// Password login needs the API on this site's own domain (the default deploy), so the session cookie is first-party.
const SAME_ORIGIN_API = !import.meta.env?.PUBLIC_API_URL;
type Mode = 'probe' | 'setup' | 'reset' | 'login' | 'signup' | 'remote';
const TITLES: Record<Mode, [string, string]> = {
	probe: ['Sign in', ''],
	login: ['Sign in', 'Your dashboard password.'],
	signup: ['Start your free trial', '14 days of Indie Cloud. No card needed.'],
	setup: ['Set up your dashboard', 'Choose the password you’ll sign in with.'],
	reset: ['Set a new password', 'This signs out every other session.'],
	remote: ['Connect your API', 'For an API on another address than this dashboard.'],
};

/**
 * /app sign-in, like Traks and DataBull: on first visit the owner sets a password (proved with API_TOKEN), then signs in.
 * "remote" keeps the old API URL + token form for an API on another domain. With `start` it opens on the site list.
 */
export function Connect({ onConnect, initialError, start, onCancel, onSignOut, remote }: {
	onConnect: (c: Connection) => void;
	initialError?: string;
	start?: Pick<Connection, 'api' | 'token'>;
	onCancel?: () => void;
	onSignOut?: () => void;
	/** Only the API URL + token form: for connecting someone's own API from another site (/start) */
	remote?: boolean;
}) {
	const [mode, setMode] = useState<Mode>(start ? (start.token ? 'remote' : 'login') : SAME_ORIGIN_API && !remote ? 'probe' : 'remote');
	const [api, setApi] = useState(() => start?.api || DEFAULT_API || (remote ? '' : location.origin));
	const [token, setToken] = useState(start?.token ?? '');
	const [setupKey, setSetupKey] = useState('');
	const [password, setPassword] = useState('');
	const [email, setEmail] = useState('');
	// Hosted Cloud: customers sign up with an email instead of an owner password
	const [cloud, setCloud] = useState(false);
	const [sites, setSites] = useState<SiteInfo[] | null>(null);
	const [domain, setDomain] = useState('');
	const [currency, setCurrency] = useState('USD');
	const [error, setError] = useState(initialError ?? '');
	const [busy, setBusy] = useState(false);

	const run = async (fn: () => Promise<void>) => {
		setBusy(true);
		setError('');
		try {
			await fn();
		} catch (e) {
			setError(e instanceof TypeError ? `Can't reach ${api}. Is the API running? (bun run dev:api)` : (e as Error).message);
		} finally {
			setBusy(false);
		}
	};
	const loadSites = (a = api, t = token) =>
		run(async () => {
			const r = await apiFetch<{ sites: SiteInfo[] }>({ api: a, token: t }, '/api/stats/sites');
			setApi(a);
			setToken(t);
			setSites(r.sites);
		});
	// Ask this site's own API whether to show "set a password", "sign in", or the sites; no API here means the remote form
	const probe = () =>
		fetch(`${location.origin}/api/auth/status`, { cache: 'no-store' })
			.then((r) => (r.ok ? r.json() : Promise.reject()))
			.then((s: { passwordSet?: boolean; signedIn: boolean; cloud?: boolean }) => {
				setCloud(!!s.cloud);
				setMode(s.cloud ? (new URLSearchParams(location.search).has('signup') ? 'signup' : 'login') : s.passwordSet ? 'login' : 'setup');
				if (s.signedIn) loadSites(location.origin, '');
			}, () => setMode('remote'));
	useEffect(() => {
		if (start) loadSites();
		else if (mode === 'probe') probe();
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	const auth = (path: 'setup' | 'login' | 'signup', body: object) =>
		run(async () => {
			const res = await fetch(`${location.origin}/api/auth/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
			if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || `Request failed (${res.status}).`);
			setSetupKey('');
			setPassword('');
			const r = await apiFetch<{ sites: SiteInfo[] }>({ api: location.origin, token: '' }, '/api/stats/sites');
			setApi(location.origin);
			setToken('');
			setSites(r.sites);
		});
	const signOut = async () => {
		if (!token) await logout(api);
		setToken('');
		setSites(null);
		setError('');
		setMode(token || !SAME_ORIGIN_API ? 'remote' : 'login');
		onSignOut?.();
	};
	const addSite = () =>
		run(async () => {
			const s = await apiFetch<{ id: string; domain: string }>({ api, token }, '/api/stats/sites', { method: 'POST', body: JSON.stringify({ domain, currency, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
			onConnect({ api, token, siteId: s.id });
		});

	const field = 'w-full rounded-xl bg-band px-3.5 py-2.5 text-[15px] ring-1 ring-line outline-none focus:ring-2 focus:ring-accent';
	return (
		<div className="mx-auto max-w-[460px] rounded-xl bg-card p-7 ring-1 ring-line">
			<div className="mb-5 flex items-center gap-3">
				<span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
					{mode === 'remote' ? <Plug size={20} aria-hidden="true" /> : <LockKeyhole size={20} aria-hidden="true" />}
				</span>
				<div>
					<h2 className="text-[19px] font-semibold tracking-[-0.02em]">{sites ? 'Your sites' : TITLES[mode][0]}</h2>
					<p className="text-[13px] text-ink-2">{sites ? (cloud ? 'Hosted by Grosslytics.' : 'Your data stays in your own Cloudflare account.') : cloud && mode === 'login' ? 'Your Grosslytics account.' : TITLES[mode][1]}</p>
				</div>
			</div>

			{!sites && mode === 'probe' && <p className="text-[13px] text-ink-3" role="status">Checking your API…</p>}

			{!sites && (mode === 'setup' || mode === 'reset') && (
				<form
					className="space-y-3"
					onSubmit={(e) => {
						e.preventDefault();
						auth('setup', { setupKey, password });
					}}
				>
					<input type="text" name="username" autoComplete="username" value="owner" readOnly hidden />
					<label className="block text-[13px] font-medium">
						API token
						<input className={`${field} mt-1`} value={setupKey} onChange={(e) => setSetupKey(e.target.value.trim().replace(/^API_TOKEN=/, '').replace(/^["']|["']$/g, ''))} type="password" autoComplete="off" required />
						<span className="mt-1 flex items-start gap-1 text-[12px] font-normal text-ink-3">
							<KeyRound size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
							The API_TOKEN you set when deploying (`wrangler secret put API_TOKEN`, or .dev.vars locally). It proves this dashboard is yours; you won’t need it to sign in.
						</span>
					</label>
					<label className="block text-[13px] font-medium">
						{mode === 'reset' ? 'New password' : 'Password'}
						<input className={`${field} mt-1`} value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" minLength={10} required />
						<span className="mt-1 block text-[12px] font-normal text-ink-3">At least 10 characters.</span>
					</label>
					<button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Saving…' : mode === 'reset' ? 'Set new password' : 'Set password and continue'}</button>
					{mode === 'reset' && <button type="button" className="text-[13px] text-accent hover:underline" onClick={() => (setMode('login'), setError(''))}>‹ Back to sign in</button>}
				</form>
			)}

			{!sites && mode === 'login' && (
				<form
					className="space-y-3"
					onSubmit={(e) => {
						e.preventDefault();
						auth('login', cloud ? { email, password } : { password });
					}}
				>
					{cloud ? (
						<label className="block text-[13px] font-medium">
							Email
							<input className={`${field} mt-1`} value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="username" required autoFocus />
						</label>
					) : (
						<input type="text" name="username" autoComplete="username" value="owner" readOnly hidden />
					)}
					<label className="block text-[13px] font-medium">
						Password
						<input className={`${field} mt-1`} value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" required autoFocus={!cloud} />
					</label>
					<button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
					{cloud ? (
						<p className="text-[13px] text-ink-2">New here? <button type="button" className="text-accent hover:underline" onClick={() => (setMode('signup'), setError(''))}>Start a free trial</button></p>
					) : (
						<button type="button" className="text-[13px] text-accent hover:underline" onClick={() => (setMode('reset'), setError(''))}>Forgot password?</button>
					)}
				</form>
			)}

			{!sites && mode === 'signup' && (
				<form
					className="space-y-3"
					onSubmit={(e) => {
						e.preventDefault();
						auth('signup', { email, password });
					}}
				>
					<label className="block text-[13px] font-medium">
						Email
						<input className={`${field} mt-1`} value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="username" required autoFocus />
					</label>
					<label className="block text-[13px] font-medium">
						Password
						<input className={`${field} mt-1`} value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" minLength={10} required />
						<span className="mt-1 block text-[12px] font-normal text-ink-3">At least 10 characters.</span>
					</label>
					<button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Creating your account…' : 'Start free trial'}</button>
					<p className="text-[13px] text-ink-2">Have an account? <button type="button" className="text-accent hover:underline" onClick={() => (setMode('login'), setError(''))}>Sign in</button></p>
				</form>
			)}

			{!sites && !cloud && mode !== 'remote' && mode !== 'probe' && (
				<p className="mt-5 border-t border-line pt-3 text-[12px] text-ink-3">
					API on another address? <button type="button" className="text-accent hover:underline" onClick={() => (setMode('remote'), setError(''))}>Connect with its URL and token</button>
				</p>
			)}

			{!sites && mode === 'remote' && (
				<form
					className="space-y-3"
					onSubmit={(e) => {
						e.preventDefault();
						loadSites();
					}}
				>
					<label className="block text-[13px] font-medium">
						API URL
						<input className={`${field} mt-1`} value={api} onChange={(e) => setApi(e.target.value.trim())} inputMode="url" placeholder="https://analytics.yourstartup.com" required />
					</label>
					<label className="block text-[13px] font-medium">
						API token
						<input className={`${field} mt-1`} value={token} onChange={(e) => setToken(e.target.value.trim().replace(/^API_TOKEN=/, '').replace(/^["']|["']$/g, ''))} type="password" autoComplete="off" required />
						<span className="mt-1 flex items-center gap-1 text-[12px] font-normal text-ink-3"><KeyRound size={12} aria-hidden="true" />API_TOKEN from .dev.vars locally, or `wrangler secret put API_TOKEN`</span>
					</label>
					<button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</button>
					{SAME_ORIGIN_API && !start && !remote && <button type="button" className="text-[13px] text-accent hover:underline" onClick={() => (setMode('probe'), setError(''), probe())}>‹ Sign in with a password instead</button>}
				</form>
			)}

			{sites && (
				<div className="space-y-4">
					{sites.length > 0 && (
						<ul className="space-y-1.5">
							{sites.map((s) => (
								<li key={s.id}>
									<button type="button" onClick={() => onConnect({ api, token, siteId: s.id })} className="flex w-full items-center justify-between rounded-xl bg-band px-3.5 py-2.5 text-left text-[15px] hover:ring-1 hover:ring-accent">
										<span className="font-medium">{s.domain}</span>
										<span className="text-[12px] text-ink-3">{s.id}</span>
									</button>
								</li>
							))}
						</ul>
					)}
					<form
						className="flex flex-wrap gap-2"
						onSubmit={(e) => {
							e.preventDefault();
							addSite();
						}}
					>
						<input className={field} placeholder="yourstartup.com" value={domain} onChange={(e) => setDomain(e.target.value.trim())} aria-label="Domain of the site to add" required />
						<select className="rounded-xl bg-band px-3 py-2 text-[13px] ring-1 ring-line" value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Reporting currency">
							{REPORTING_CURRENCIES.map((code) => <option key={code}>{code}</option>)}
						</select>
						<button className="btn btn-primary shrink-0" disabled={busy}>Add site</button>
					</form>
					<div className="flex items-center justify-between border-t border-line pt-3 text-[13px]">
						{onCancel ? <button type="button" className="text-accent hover:underline" onClick={onCancel}>‹ Back to dashboard</button> : <span />}
						<button type="button" className="text-ink-2 hover:text-ink hover:underline" onClick={signOut}>Sign out</button>
					</div>
				</div>
			)}
			{error && <p className="mt-3 text-[13px] text-down" role="alert">{error}</p>}
		</div>
	);
}

const FOOTER_SNIPPET = '<a href="https://grosslytics.com">Powered by Grosslytics</a>';

/** Free self-hosted installs: the dashboard stays shut until the site's homepage carries the footer link (the API enforces it; see footer.ts). */
export function FooterGate({ conn, site, onVerified, onSwitch }: { conn: Connection; site: SiteInfo; onVerified: () => void; onSwitch: () => void }) {
	const [copied, setCopied] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const verify = () => {
		setBusy(true);
		setError('');
		apiFetch(conn, `/api/stats/sites/${site.id}/footer`, { method: 'POST', body: '{}' }).then(onVerified, (e: Error) => (setError(e.message), setBusy(false)));
	};
	return (
		<section className="mx-auto max-w-[520px] rounded-xl bg-card p-7 ring-1 ring-line" aria-label="Add the footer link">
			<div className="mb-4 flex items-center gap-3">
				<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"><LockKeyhole size={20} aria-hidden="true" /></span>
				<div className="min-w-0">
					<h2 className="text-[19px] font-semibold tracking-[-0.02em]">One step to open your dashboard</h2>
					<p className="break-all text-[13px] text-ink-2">{site.domain}</p>
				</div>
			</div>
			<p className="text-[14px] text-ink-2">
				The free plan is paid for with a link. Add this to the footer of <strong className="font-medium text-ink">{site.domain}</strong>, on the home page, as a normal link (no <code className="font-mono text-[12.5px]">rel="nofollow"</code>):
			</p>
			<div className="mt-3 flex items-start gap-2 rounded-xl bg-band p-3">
				<code className="min-w-0 flex-1 break-all font-mono text-[12.5px] text-ink-2">{FOOTER_SNIPPET}</code>
				<button type="button" className="btn btn-quiet shrink-0 !px-2 !py-1 !text-[13px]" onClick={() => copyText(FOOTER_SNIPPET).then(setCopied)}>
					<Copy size={13} aria-hidden="true" />{copied ? 'Copied' : 'Copy'}
				</button>
			</div>
			<p className="mt-3 text-[13px] text-ink-2">Visits and sales are still being recorded while you do this. The link is checked again each day, and removing it locks the dashboard.</p>
			<button type="button" className="btn btn-primary mt-4 w-full" onClick={verify} disabled={busy}>{busy ? 'Checking your site…' : 'I added it, verify'}</button>
			{error && <p className="mt-3 text-[13px] text-down" role="alert">{error}</p>}
			<div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-[13px]">
				<button type="button" className="text-accent hover:underline" onClick={onSwitch}>Choose another site</button>
				<a className="text-ink-2 hover:text-ink hover:underline" href="/start?plan=lifetime">Remove the link with Lifetime</a>
			</div>
		</section>
	);
}

/** Shown on an empty site: the one line to paste into the site's <head>. */
export function InstallSnippet({ siteId, api }: { siteId: string; api: string }) {
	const origin = typeof location === 'undefined' ? '' : location.origin;
	const snippet = `<script defer src="${origin}/g.js" data-site-id="${siteId}" data-api="${api.replace(/\/$/, '')}/api/event"></script>`;
	const [copied, setCopied] = useState(false);
	return (
		<section className="rounded-xl bg-card p-6 ring-1 ring-line" aria-label="Install the tracker">
			<h2 className="text-[17px] font-semibold">No visits yet. Add this to your site's &lt;head&gt;:</h2>
			<div className="mt-3 flex items-start gap-2 rounded-xl bg-band p-3">
				<code className="min-w-0 flex-1 break-all font-mono text-[12.5px] text-ink-2">{snippet}</code>
				<button
					type="button"
					className="btn btn-quiet shrink-0 !px-2 !py-1 !text-[13px]"
					onClick={() => copyText(snippet).then(setCopied)}
				>
					<Copy size={13} aria-hidden="true" />
					{copied ? 'Copied' : 'Copy'}
				</button>
			</div>
			<p className="mt-3 text-[13px] text-ink-2">
				Already added it? If your site sends a Content-Security-Policy header, add <code className="font-mono text-[12.5px]">{api.replace(/\/$/, '') || origin}</code> to its <code className="font-mono text-[12.5px]">script-src</code> and <code className="font-mono text-[12.5px]">connect-src</code>, or the browser blocks the tracker.
			</p>
			<p className="mt-3 text-[13px] text-ink-2">
				Then point your payment webhooks at <code className="font-mono text-[12.5px]">{api.replace(/\/$/, '')}/api/webhooks/stripe?siteId={siteId}</code> (or razorpay, paddle, polar, lemonsqueezy, dodo, and the rest under Settings → Payment webhooks).
			</p>
		</section>
	);
}

interface ApiToken { id: string; name: string; suffix: string; createdAt: number; lastUsedAt: number | null }
const day = (t: number | null) => (t ? new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never');

/** Read-only tokens for one site: for MCP clients, scripts or a teammate. Secrets are shown once. */
export function ApiTokens({ conn }: { conn: Connection }) {
	const [tokens, setTokens] = useState<ApiToken[] | null>(null);
	const [name, setName] = useState('');
	const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);
	const [copied, setCopied] = useState('');
	const [error, setError] = useState('');
	const api = conn.api.replace(/\/$/, '');
	const load = () =>
		apiFetch<{ tokens: ApiToken[] }>(conn, `/api/stats/tokens?siteId=${encodeURIComponent(conn.siteId)}`).then((r) => setTokens(r.tokens), (e: Error) => setError(e.message));
	useEffect(() => {
		load();
	}, []); // eslint-disable-line react-hooks/exhaustive-deps
	const act = (fn: () => Promise<unknown>) => {
		setError('');
		fn().then(load, (e: Error) => setError(e.message));
	};
	const copy = (text: string, what: string) => copyText(text).then((ok) => ok && setCopied(what));
	const mcpUrl = `${api}/api/mcp?site=${conn.siteId}`;

	return (
		<section className="mx-auto mt-6 max-w-[640px] rounded-xl bg-card p-5 ring-1 ring-line" aria-label="API tokens">
			<h2 className="flex items-center gap-2 text-[15px] font-semibold"><KeyRound size={15} aria-hidden="true" />API tokens</h2>
			<p className="mt-1 text-[13px] text-ink-2">Read-only access to this site’s numbers, for an AI agent over MCP, a script, or a teammate. Each token can be revoked on its own.</p>

			{fresh && (
				<div className="mt-4 rounded-xl bg-band p-3" role="status">
					<p className="text-[13px] font-medium">Copy “{fresh.name}” now. It won’t be shown again.</p>
					<div className="mt-2 flex items-start gap-2">
						<code className="min-w-0 flex-1 break-all font-mono text-[12.5px]">{fresh.token}</code>
						<button type="button" className="btn btn-quiet shrink-0 !px-2 !py-1 !text-[13px]" onClick={() => copy(fresh.token, 'token')}>
							<Copy size={13} aria-hidden="true" />{copied === 'token' ? 'Copied' : 'Copy'}
						</button>
					</div>
					<p className="mt-3 text-[12px] text-ink-2">MCP server URL, with the token as <code className="font-mono">Authorization: Bearer …</code>:</p>
					<div className="mt-1 flex items-start gap-2">
						<code className="min-w-0 flex-1 break-all font-mono text-[12.5px] text-ink-2">{mcpUrl}</code>
						<button type="button" className="btn btn-quiet shrink-0 !px-2 !py-1 !text-[13px]" onClick={() => copy(mcpUrl, 'url')}>
							<Copy size={13} aria-hidden="true" />{copied === 'url' ? 'Copied' : 'Copy'}
						</button>
					</div>
				</div>
			)}

			{tokens && tokens.length > 0 && (
				<ul className="mt-4 divide-y divide-line text-[13px]">
					{tokens.map((t) => (
						<li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
							<span className="font-medium">{t.name}</span>
							<code className="font-mono text-ink-3">gl_pat_…{t.suffix}</code>
							<span className="text-ink-3">Created {day(t.createdAt)} · Last used {day(t.lastUsedAt)}</span>
							<button
								type="button"
								className="ml-auto text-down hover:underline"
								onClick={() => confirm(`Revoke “${t.name}”? Anything using it stops working right away.`) && act(() => apiFetch(conn, `/api/stats/tokens/${t.id}/revoke`, { method: 'POST' }))}
							>
								Revoke
							</button>
						</li>
					))}
				</ul>
			)}

			<form
				className="mt-4 flex gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					act(async () => {
						const r = await apiFetch<{ name: string; token: string }>(conn, '/api/stats/tokens', { method: 'POST', body: JSON.stringify({ siteId: conn.siteId, name }) });
						setFresh(r);
						setCopied('');
						setName('');
					});
				}}
			>
				<input className="min-w-0 flex-1 rounded-xl bg-band px-3 py-2 text-[13px] ring-1 ring-line outline-none focus:ring-2 focus:ring-accent" placeholder="Name, e.g. Claude Code" value={name} onChange={(e) => setName(e.target.value)} aria-label="New token name" maxLength={80} required />
				<button className="btn btn-primary shrink-0 !py-2 !text-[13px]">Create token</button>
			</form>
			{error && <p className="mt-2 text-[13px] text-down" role="alert">{error}</p>}
		</section>
	);
}

interface CloudAccount { id: string; email: string; status: string; trialEndsAt: number; periodEnd: number | null; active: boolean; used: number; cap: number }
const BILLING_PORTAL = import.meta.env?.PUBLIC_STRIPE_PORTAL_URL as string | undefined;

/** Hosted Cloud only: trial or plan, this month's events against the cap, and the Stripe links to pay or manage billing. Renders nothing on self-host. */
export function CloudBilling() {
	const [a, setA] = useState<CloudAccount | null>(null);
	useEffect(() => {
		fetch(`${location.origin}/api/auth/status`, { cache: 'no-store' })
			.then((r) => (r.ok ? r.json() : null))
			.then((s: { cloud?: boolean; account?: CloudAccount } | null) => s?.cloud && s.account && setA(s.account), () => {});
	}, []);
	if (!a) return null;
	const now = Date.now() / 1000;
	const daysLeft = Math.max(0, Math.ceil((a.trialEndsAt - now) / 86400));
	const full = a.used >= a.cap;
	// Dodo links take `email` to prefill and `metadata_*` as custom data; the account id is how a payment finds its account
	const checkout = `${CHECKOUT_CLOUD}${CHECKOUT_CLOUD.includes('?') ? '&' : '?'}email=${encodeURIComponent(a.email)}&metadata_account_id=${encodeURIComponent(a.id)}`;
	const subscribed = a.status !== 'trial';
	const plan = !a.active
		? a.status === 'trial' ? 'Your free trial has ended. Tracking is paused until you subscribe.' : 'Your subscription has ended. Tracking is paused.'
		: a.status === 'trial' ? `Free trial: ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left.`
		: a.status === 'past_due' ? 'Your last payment failed. Update your card to keep tracking.'
		: `Indie Cloud${a.periodEnd ? `, renews ${new Date(a.periodEnd * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}.`;
	const warn = !a.active || full || a.status === 'past_due';
	return (
		<div className={`mx-5 mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-4 py-2.5 text-[13px] ring-1 ${warn ? 'bg-down/10 ring-down/30' : 'bg-card ring-line'}`} role={warn ? 'alert' : 'status'}>
			<span className="font-medium">{plan}</span>
			<span className="text-ink-2">
				{a.used.toLocaleString('en-US')} of {a.cap.toLocaleString('en-US')} events this month
				{full && ' (limit reached; tracking resumes on the 1st)'}
			</span>
			<span className="ml-auto flex gap-3">
				{(!subscribed || !a.active) && <a className="btn btn-primary !py-1.5 !text-[13px]" href={checkout}>Subscribe, {CLOUD_PRICE}/month</a>}
				{subscribed && BILLING_PORTAL && <a className="text-accent hover:underline" href={`${BILLING_PORTAL}${BILLING_PORTAL.includes('?') ? '&' : '?'}prefilled_email=${encodeURIComponent(a.email)}`}>Manage billing</a>}
			</span>
		</div>
	);
}

const GATEWAYS = [
	['stripe', 'Stripe', 'Developers → Webhooks → your endpoint → Signing secret (whsec_…)'],
	['lemonsqueezy', 'Lemon Squeezy', 'Settings → Webhooks → the signing secret you chose'],
	['polar', 'Polar', 'Settings → Webhooks → the endpoint’s secret'],
	['paddle', 'Paddle', 'Developer tools → Notifications → secret key'],
	['razorpay', 'Razorpay', 'Settings → Webhooks → the secret you set'],
	['cashfree', 'Cashfree', 'Developers → API keys → your client secret (Cashfree signs webhooks with it)'],
	['gumroad', 'Gumroad', 'make up a long random key; it goes at the end of the ping URL as &key=…'],
	['paypal', 'PayPal', 'client_id:client_secret:webhook_id from developer.paypal.com; add :sandbox for a sandbox app'],
	['dodo', 'Dodo Payments', 'Developer → Webhooks → your endpoint → Signing secret (whsec_…)'],
	['revenuecat', 'RevenueCat', 'Integrations → Webhooks → the Authorization header value you set'],
] as const;

/** Per-site payment webhook secrets. Write-only: a saved secret is never shown again, only "Connected". */
export function PaymentWebhooks({ conn, connected }: { conn: Connection; connected: string[] }) {
	const [saved, setSaved] = useState(connected);
	const [open, setOpen] = useState<string | null>(null);
	const [secret, setSecret] = useState('');
	const [error, setError] = useState('');
	const [copied, setCopied] = useState('');
	const api = (conn.api || (typeof location === 'undefined' ? '' : location.origin)).replace(/\/$/, '');
	const save = (gateway: string, value: string) =>
		apiFetch(conn, `/api/stats/sites/${conn.siteId}/secrets`, { method: 'POST', body: JSON.stringify({ gateway, secret: value }) }).then(
			() => {
				setSaved((list) => (value ? [...new Set([...list, gateway])] : list.filter((g) => g !== gateway)));
				setOpen(null);
				setSecret('');
				setError('');
			},
			(e: Error) => setError(e.message),
		);
	return (
		<section className="mx-auto mt-6 max-w-[640px] rounded-xl bg-card p-5 ring-1 ring-line" aria-label="Payment webhooks">
			<h2 className="flex items-center gap-2 text-[15px] font-semibold"><Plug size={15} aria-hidden="true" />Payments</h2>
			<p className="mt-1 text-[13px] text-ink-2">In your payment provider, add a webhook to the URL below, then paste its signing secret here so Grosslytics can trust each sale.</p>
			<ul className="mt-3 divide-y divide-line text-[13px]">
				{GATEWAYS.map(([id, label, where]) => {
					// Gumroad can't sign pings, so its key travels in the URL
					const url = `${api}/api/webhooks/${id}?siteId=${conn.siteId}${id === 'gumroad' ? `&key=${open === id && secret ? encodeURIComponent(secret) : 'YOUR_KEY'}` : ''}`;
					return (
						<li key={id} className="py-2.5">
							<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
								<span className="font-medium">{label}</span>
								{saved.includes(id) ? <span className="rounded-full bg-up/10 px-2 py-0.5 text-[12px] text-up">Connected</span> : <span className="text-ink-3">Not connected</span>}
								<span className="ml-auto flex gap-3">
									{saved.includes(id) && <button type="button" className="text-down hover:underline" onClick={() => confirm(`Remove the ${label} secret? Its webhooks will be rejected.`) && save(id, '')}>Remove</button>}
									<button type="button" className="text-accent hover:underline" onClick={() => (setOpen(open === id ? null : id), setSecret(''), setError(''))}>{saved.includes(id) ? 'Replace secret' : 'Connect'}</button>
								</span>
							</div>
							{open === id && (
								<form
									className="mt-2 space-y-2 rounded-xl bg-band p-3"
									onSubmit={(e) => {
										e.preventDefault();
										save(id, secret);
									}}
								>
									<div className="flex items-start gap-2">
										<code className="min-w-0 flex-1 break-all font-mono text-[12.5px] text-ink-2">{url}</code>
										<button type="button" className="btn btn-quiet shrink-0 !px-2 !py-1 !text-[13px]" onClick={() => copyText(url).then((ok) => ok && setCopied(id))}>
											<Copy size={13} aria-hidden="true" />{copied === id ? 'Copied' : 'Copy'}
										</button>
									</div>
									<label className="block text-[12px] text-ink-2">
										Signing secret ({where})
										<input className="mt-1 w-full rounded-lg bg-card px-3 py-2 font-mono text-[13px] ring-1 ring-line outline-none focus:ring-2 focus:ring-accent" value={secret} onChange={(e) => setSecret(e.target.value.trim())} type="password" autoComplete="off" required minLength={8} />
									</label>
									<button className="btn btn-primary !py-1.5 !text-[13px]">Save secret</button>
								</form>
							)}
						</li>
					);
				})}
			</ul>
			{error && <p className="mt-2 text-[13px] text-down" role="alert">{error}</p>}
		</section>
	);
}
