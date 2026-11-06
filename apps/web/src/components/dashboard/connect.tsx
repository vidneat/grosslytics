import { useState } from 'react';
import { Copy, KeyRound, Plug } from 'lucide-react';
import { apiFetch, DEFAULT_API, type Connection, type SiteInfo } from './api';

/** First run on /app: point the dashboard at your edge API, then pick or add a site. */
export function Connect({ onConnect, initialError }: { onConnect: (c: Connection) => void; initialError?: string }) {
	const [api, setApi] = useState(() => DEFAULT_API || location.origin);
	const [token, setToken] = useState('');
	const [sites, setSites] = useState<SiteInfo[] | null>(null);
	const [domain, setDomain] = useState('');
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
	const loadSites = () => run(async () => setSites((await apiFetch<{ sites: SiteInfo[] }>({ api, token }, '/api/stats/sites')).sites));
	const addSite = () =>
		run(async () => {
			const s = await apiFetch<{ id: string; domain: string }>({ api, token }, '/api/stats/sites', { method: 'POST', body: JSON.stringify({ domain }) });
			onConnect({ api, token, siteId: s.id });
		});

	const field = 'w-full rounded-xl bg-band px-3.5 py-2.5 text-[15px] ring-1 ring-line outline-none focus:ring-2 focus:ring-accent';
	return (
		<div className="mx-auto max-w-[460px] rounded-[22px] bg-card p-7 ring-1 ring-line">
			<div className="mb-5 flex items-center gap-3">
				<span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent"><Plug size={20} aria-hidden="true" /></span>
				<div>
					<h2 className="text-[19px] font-semibold tracking-[-0.02em]">Connect your API</h2>
					<p className="text-[13px] text-ink-2">Your data stays in your own Cloudflare account.</p>
				</div>
			</div>

			{!sites ? (
				<form
					className="space-y-3"
					onSubmit={(e) => {
						e.preventDefault();
						loadSites();
					}}
				>
					<label className="block text-[13px] font-medium">
						API URL
						<input className={`${field} mt-1`} value={api} onChange={(e) => setApi(e.target.value.trim())} inputMode="url" required />
					</label>
					<label className="block text-[13px] font-medium">
						API token
						<input className={`${field} mt-1`} value={token} onChange={(e) => setToken(e.target.value.trim().replace(/^API_TOKEN=/, '').replace(/^["']|["']$/g, ''))} type="password" autoComplete="off" required />
						<span className="mt-1 flex items-center gap-1 text-[12px] font-normal text-ink-3"><KeyRound size={12} aria-hidden="true" />API_TOKEN from .dev.vars locally, or `wrangler secret put API_TOKEN`</span>
					</label>
					<button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</button>
				</form>
			) : (
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
						className="flex gap-2"
						onSubmit={(e) => {
							e.preventDefault();
							addSite();
						}}
					>
						<input className={field} placeholder="yourstartup.com" value={domain} onChange={(e) => setDomain(e.target.value.trim())} aria-label="Domain of the site to add" required />
						<button className="btn btn-primary shrink-0" disabled={busy}>Add site</button>
					</form>
				</div>
			)}
			{error && <p className="mt-3 text-[13px] text-down" role="alert">{error}</p>}
		</div>
	);
}

/** Shown on an empty site: the one line to paste into the site's <head>. */
export function InstallSnippet({ siteId, api }: { siteId: string; api: string }) {
	const origin = typeof location === 'undefined' ? '' : location.origin;
	const snippet = `<script defer src="${origin}/g.js" data-site-id="${siteId}" data-api="${api.replace(/\/$/, '')}/api/collect"></script>`;
	const [copied, setCopied] = useState(false);
	return (
		<section className="rounded-[22px] bg-card p-6 ring-1 ring-line" aria-label="Install the tracker">
			<h2 className="text-[17px] font-semibold">No visits yet. Add this to your site's &lt;head&gt;:</h2>
			<div className="mt-3 flex items-start gap-2 rounded-xl bg-band p-3">
				<code className="min-w-0 flex-1 break-all font-mono text-[12.5px] text-ink-2">{snippet}</code>
				<button
					type="button"
					className="btn btn-quiet shrink-0 !px-2 !py-1 !text-[13px]"
					onClick={() => navigator.clipboard.writeText(snippet).then(() => setCopied(true))}
				>
					<Copy size={13} aria-hidden="true" />
					{copied ? 'Copied' : 'Copy'}
				</button>
			</div>
			<p className="mt-3 text-[13px] text-ink-2">
				Then point your payment webhooks at <code className="font-mono text-[12.5px]">{api.replace(/\/$/, '')}/api/webhooks/stripe?siteId={siteId}</code> (or razorpay, paddle, polar, lemonsqueezy).
			</p>
		</section>
	);
}
