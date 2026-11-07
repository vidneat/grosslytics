import { useEffect, useState } from 'react';
import { Check, Copy, Loader2 } from 'lucide-react';
import { DEFAULT_API } from '../dashboard/api';

type State = { kind: 'waiting' } | { kind: 'ready'; key: string; email: string | null } | { kind: 'error'; message: string };

/** /license?session_id=… : Stripe's Lifetime checkout returns here. Waits for the payment webhook, then shows the key once it exists. */
export default function LicenseClaim() {
	const [state, setState] = useState<State>({ kind: 'waiting' });
	const [copied, setCopied] = useState('');

	useEffect(() => {
		const sessionId = new URLSearchParams(location.search).get('session_id');
		if (!sessionId) return setState({ kind: 'error', message: 'This page opens after you buy Lifetime. The link from Stripe includes your purchase.' });
		let tries = 0;
		let timer: ReturnType<typeof setTimeout>;
		const poll = async () => {
			try {
				const res = await fetch(`${DEFAULT_API || location.origin}/api/license/claim?session_id=${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
				const body = (await res.json().catch(() => ({}))) as { key?: string; email?: string | null; error?: string };
				if (res.ok && body.key) return setState({ kind: 'ready', key: body.key, email: body.email ?? null });
				if (res.status !== 404) return setState({ kind: 'error', message: body.error || `Something went wrong (${res.status}).` });
			} catch {}
			// Stripe usually confirms within seconds; give it two minutes
			if (++tries < 60) timer = setTimeout(poll, 2000);
			else setState({ kind: 'error', message: 'Your payment hasn’t been confirmed yet. Reload this page in a few minutes; the key will be here.' });
		};
		poll();
		return () => clearTimeout(timer);
	}, []);

	const copy = (value: string, what: string) => navigator.clipboard.writeText(value).then(() => setCopied(what));
	const command = 'npx grosslytics install';

	if (state.kind === 'waiting')
		return (
			<p className="flex items-center justify-center gap-2 text-ink-2" role="status">
				<Loader2 size={16} className="animate-spin" aria-hidden="true" />Confirming your payment…
			</p>
		);
	if (state.kind === 'error') return <p className="rounded-[22px] bg-card p-7 text-center text-ink-2 ring-1 ring-line" role="alert">{state.message}</p>;

	const row = (label: string, value: string, what: string) => (
		<div>
			<p className="text-[13px] font-medium text-ink-2">{label}</p>
			<div className="mt-1 flex items-start gap-2 rounded-xl bg-band p-3">
				<code className="min-w-0 flex-1 break-all font-mono text-[14px]">{value}</code>
				<button type="button" className="btn btn-quiet shrink-0 !px-2 !py-1 !text-[13px]" onClick={() => copy(value, what)}>
					{copied === what ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
					{copied === what ? 'Copied' : 'Copy'}
				</button>
			</div>
		</div>
	);

	return (
		<div className="space-y-6 rounded-[22px] bg-card p-7 ring-1 ring-line">
			<p className="flex items-center gap-2 font-medium text-up" role="status"><Check size={16} aria-hidden="true" />Payment confirmed{state.email ? ` for ${state.email}` : ''}. Thank you.</p>
			{row('Your license key. Keep it somewhere safe; it installs and updates Grosslytics.', state.key, 'key')}
			{row('Then run this in a terminal (needs Node.js 18 or newer):', command, 'cmd')}
			<ol className="list-decimal space-y-1.5 pl-5 text-[15px] text-ink-2">
				<li>Paste the license key, and pick a hostname such as analytics.yourstartup.com on a domain you have on Cloudflare.</li>
				<li>Choose your dashboard password.</li>
				<li>Click <strong className="text-ink">Allow</strong> when Cloudflare asks. The installer creates the database, queues and workers in your account.</li>
				<li>Open your dashboard, add a site, and paste its script tag.</li>
			</ol>
			<p className="text-[13px] text-ink-3">To update later, run the same command again in the same folder. This page keeps working with the link from Stripe if you need the key again.</p>
		</div>
	);
}
