import { useContext, useEffect, useState, type ReactNode } from 'react';
import { Bot, Download, FileSpreadsheet, History, MousePointerClick, Users } from 'lucide-react';
import { apiFetch, type Connection } from './api';
import { CurrencyContext, num, Panel } from './ui';

type Range = '24h' | '7d' | '30d' | '90d';
type Hit = { k: string; hits: number };
type ClickRow = { page: string; el: string | null; clicks: number; visitors: number; dead: number; rage: number; buyers: number };

const q = (conn: Connection, range: Range) => `siteId=${encodeURIComponent(conn.siteId)}&range=${range}`;
const apiBase = (conn: Connection) => (conn.api || (typeof location === 'undefined' ? '' : location.origin)).replace(/\/$/, '');

/** GET once per (path) change; errors show as a sentence. */
function useGet<T>(conn: Connection, path: string, refresh = 0) {
	const [data, setData] = useState<T | null>(null);
	const [error, setError] = useState('');
	useEffect(() => {
		let live = true;
		setError('');
		apiFetch<T>(conn, path).then((d) => live && setData(d), (e: Error) => live && setError(e.message));
		return () => {
			live = false;
		};
	}, [path, refresh]); // eslint-disable-line react-hooks/exhaustive-deps
	return { data, error };
}

function HitList({ rows, unit }: { rows: Hit[]; unit: string }) {
	const max = Math.max(1, ...rows.map((r) => r.hits));
	return (
		<ul className="tnum space-y-1.5 px-3 text-[13px]">
			{rows.slice(0, 8).map((r) => (
				<li key={r.k} className="grid grid-cols-[1fr_5rem_3.5rem] items-center gap-3">
					<span className="truncate" title={r.k}>{r.k}</span>
					<span className="h-2 overflow-hidden rounded-full bg-band"><span className="block h-full rounded-full bg-ink-2" style={{ width: `${(r.hits / max) * 100}%` }} /></span>
					<span className="text-right">{num(r.hits)}<span className="sr-only"> {unit}</span></span>
				</li>
			))}
		</ul>
	);
}

/** AI crawlers don't run JavaScript, so these hits come from a few lines of server code on the owner's site. */
export function AiCrawlers({ conn, range }: { conn: Connection; range: Range }) {
	const { data, error } = useGet<{ bots: Hit[]; pages: Hit[] }>(conn, `/api/stats/ai-crawls?${q(conn, range)}`);
	const empty = data && data.bots.length === 0;
	return (
		<Panel title="AI bots reading your pages" icon={<Bot size={15} />}>
			{error && <p className="px-3 text-[13px] text-down" role="alert">{error}</p>}
			{empty && (
				<p className="px-3 py-2 text-[13px] text-ink-2">
					GPTBot, ClaudeBot and PerplexityBot don’t run JavaScript, so no script can see them. Add the few lines of server code from <a className="text-accent hover:underline" href="/docs/#ai-crawlers">the docs</a> and their visits show up here. Revenue from people who arrive from AI answers is already in Sources under “AI Search”.
				</p>
			)}
			{data && !empty && (
				<div className="grid gap-4 sm:grid-cols-2">
					<div><p className="px-3 pb-2 text-[11px] font-medium text-ink-3">Bots · page requests</p><HitList rows={data.bots} unit="requests" /></div>
					<div><p className="px-3 pb-2 text-[11px] font-medium text-ink-3">Most-read pages</p><HitList rows={data.pages} unit="requests" /></div>
				</div>
			)}
		</Panel>
	);
}

/** Clicks from the opt-in c.js script, grouped by page and element. */
export function ClickMap({ conn, range }: { conn: Connection; range: Range }) {
	const { data, error } = useGet<{ clicks: ClickRow[] }>(conn, `/api/stats/clicks?${q(conn, range)}`);
	const snippet = `<script defer src="${apiBase(conn)}/c.js" data-site-id="${conn.siteId}"></script>`;
	return (
		<Panel title="What people click" icon={<MousePointerClick size={15} />}>
			{error && <p className="px-3 text-[13px] text-down" role="alert">{error}</p>}
			{data && data.clicks.length === 0 && (
				<div className="px-3 py-2 text-[13px] text-ink-2">
					<p>See which plan, FAQ or button people click on your pricing and checkout pages, which clicks do nothing, and where people click in frustration. Add this after the main script, only on the pages you want mapped:</p>
					<code className="mt-2 block break-all rounded-lg bg-band p-2 font-mono text-[12px]">{snippet}</code>
				</div>
			)}
			{data && data.clicks.length > 0 && (
				<div className="overflow-x-auto">
					<table className="tnum w-full text-[13px]">
						<thead>
							<tr className="text-[11px] text-ink-3">
								<th scope="col" className="px-3 pb-2 text-left font-medium">Page · element</th>
								<th scope="col" className="px-2 pb-2 text-right font-medium">Clicks</th>
								<th scope="col" className="px-2 pb-2 text-right font-medium" title="People who clicked it and later paid">Buyers</th>
								<th scope="col" className="px-2 pb-2 text-right font-medium" title="Clicks on something that isn't a link or button">Dead</th>
								<th scope="col" className="px-3 pb-2 text-right font-medium" title="Three fast clicks on the same thing">Rage</th>
							</tr>
						</thead>
						<tbody>
							{data.clicks.slice(0, 15).map((r) => (
								<tr key={`${r.page}|${r.el}`} className="border-t border-line">
									<td className="max-w-0 px-3 py-2"><span className="block truncate" title={`${r.page} · ${r.el}`}><span className="text-ink-3">{r.page}</span> · {r.el || '(no label)'}</span></td>
									<td className="px-2 py-2 text-right">{num(r.clicks)}</td>
									<td className="px-2 py-2 text-right font-semibold">{num(r.buyers)}</td>
									<td className={`px-2 py-2 text-right ${r.dead ? 'text-down' : 'text-ink-3'}`}>{num(r.dead)}</td>
									<td className={`px-3 py-2 text-right ${r.rage ? 'text-down' : 'text-ink-3'}`}>{num(r.rage)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</Panel>
	);
}

function Card({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
	return (
		<section className="mx-auto mt-6 max-w-[640px] rounded-xl bg-card p-5 ring-1 ring-line" aria-label={title}>
			<h2 className="flex items-center gap-2 text-[15px] font-semibold"><span aria-hidden="true">{icon}</span>{title}</h2>
			{children}
		</section>
	);
}

const input = 'w-full rounded-lg bg-band px-3 py-2 text-[13px] ring-1 ring-line outline-none focus:ring-2 focus:ring-accent';

/** Brings in past Stripe payments so the dashboard isn't empty on day one. The key is sent once and never stored. */
export function StripeImport({ conn, onDone }: { conn: Connection; onDone: () => void }) {
	const [key, setKey] = useState('');
	const [state, setState] = useState<{ busy: boolean; imported: number; skipped: number; error: string; done: boolean }>({ busy: false, imported: 0, skipped: 0, error: '', done: false });
	return (
		<Card title="Import past Stripe payments" icon={<History size={15} />}>
			<p className="mt-1 text-[13px] text-ink-2">
				Paste a Stripe <a className="text-accent hover:underline" href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noreferrer">restricted key</a> with read access to Checkout Sessions and Invoices. It is used for this import only and never saved. Past sales show as Unattributed unless their visitor was tracked; payments already recorded are skipped.
			</p>
			<form
				className="mt-3 flex flex-col gap-2 sm:flex-row"
				onSubmit={async (e) => {
					e.preventDefault();
					setState({ busy: true, imported: 0, skipped: 0, error: '', done: false });
					type Next = { kind: string; after?: string } | null;
					let next: Next = { kind: 'sessions' };
					let imported = 0;
					let skipped = 0;
					try {
						while (next) {
							const r: { imported: number; skipped: number; next: Next } = await apiFetch(conn, `/api/stats/sites/${conn.siteId}/import/stripe`, { method: 'POST', body: JSON.stringify({ key, ...next }) });
							imported += r.imported;
							skipped += r.skipped;
							next = r.next;
							setState({ busy: true, imported, skipped, error: '', done: false });
						}
						setKey('');
						setState({ busy: false, imported, skipped, error: '', done: true });
						onDone();
					} catch (err) {
						setState({ busy: false, imported, skipped, error: (err as Error).message, done: false });
					}
				}}
			>
				<input className={`${input} font-mono`} type="password" autoComplete="off" placeholder="rk_live_…" value={key} onChange={(e) => setKey(e.target.value.trim())} aria-label="Stripe restricted key" required />
				<button className="btn btn-primary shrink-0 !py-1.5 !text-[13px]" disabled={state.busy}>{state.busy ? 'Importing…' : 'Import'}</button>
			</form>
			{(state.busy || state.done) && <p className="mt-2 text-[13px] text-ink-2" role="status">{state.done ? 'Done. ' : ''}{num(state.imported)} imported, {num(state.skipped)} skipped (already recorded, unpaid, or another currency).</p>}
			{state.error && <p className="mt-2 text-[13px] text-down" role="alert">{state.error}</p>}
		</Card>
	);
}

/** Parses "date,source,amount" lines. Exported for its test. */
export function parseAdSpendCsv(text: string): { rows: Array<{ date: string; source: string; amountCents: number }>; errors: string[] } {
	const rows: Array<{ date: string; source: string; amountCents: number }> = [];
	const errors: string[] = [];
	text.split(/\r?\n/).forEach((line, i) => {
		if (!line.trim()) return;
		// Quoted cells may contain the separator ("$1,200"), so split outside quotes only
		const cells = [...line.matchAll(/\s*(?:"([^"]*)"|([^,;\t]*))\s*(?:[,;\t]|$)/g)].map((m) => (m[1] ?? m[2] ?? '').trim()).slice(0, 3);
		const [date = '', source = '', amount = ''] = cells;
		if (i === 0 && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return; // header row
		const value = Number(amount.replace(/[^0-9.-]/g, ''));
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !source || !amount || !Number.isFinite(value) || value < 0) errors.push(`Line ${i + 1}: expected YYYY-MM-DD, source, amount`);
		else rows.push({ date, source: source.slice(0, 512), amountCents: Math.round(value * 100) });
	});
	return { rows, errors };
}

/** Ad spend from an export of Meta, Google, X or LinkedIn Ads, reshaped to date,source,amount. */
export function AdSpendCsv({ conn, onSaved }: { conn: Connection; onSaved: () => void }) {
	const currency = useContext(CurrencyContext);
	const [text, setText] = useState('');
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	return (
		<Card title="Import ad spend (CSV)" icon={<FileSpreadsheet size={15} />}>
			<p className="mt-1 text-[13px] text-ink-2">
				One row per day and source: <code className="font-mono text-[12px]">date,source,amount</code> in {currency}, e.g. <code className="font-mono text-[12px]">2026-11-01,twitter,42.50</code>. Use the same source names as your Sources panel. Re-importing a day replaces it, so exports can be loaded again safely.
			</p>
			<form
				className="mt-3 space-y-2"
				onSubmit={async (e) => {
					e.preventDefault();
					const { rows, errors } = parseAdSpendCsv(text);
					if (errors.length) return setMsg({ ok: false, text: errors.slice(0, 3).join('. ') });
					if (!rows.length) return setMsg({ ok: false, text: 'No rows found.' });
					try {
						for (let i = 0; i < rows.length; i += 2000) await apiFetch(conn, '/api/stats/ad-spend/bulk', { method: 'POST', body: JSON.stringify({ siteId: conn.siteId, rows: rows.slice(i, i + 2000) }) });
						setMsg({ ok: true, text: `Saved ${num(rows.length)} day${rows.length === 1 ? '' : 's'} of spend.` });
						setText('');
						onSaved();
					} catch (err) {
						setMsg({ ok: false, text: (err as Error).message });
					}
				}}
			>
				<input type="file" accept=".csv,text/csv,text/plain" className="block text-[13px]" aria-label="CSV file" onChange={async (e) => setText((await e.target.files?.[0]?.text()) ?? '')} />
				<textarea className={`${input} h-24 font-mono`} placeholder={'date,source,amount\n2026-11-01,twitter,42.50'} value={text} onChange={(e) => setText(e.target.value)} aria-label="CSV rows" />
				<button className="btn btn-primary !py-1.5 !text-[13px]" disabled={!text.trim()}>Import</button>
			</form>
			{msg && <p className={`mt-2 text-[13px] ${msg.ok ? 'text-up' : 'text-down'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
		</Card>
	);
}

/** People who asked to hear when Cloud or Lifetime opens. Hidden where the API refuses it (Hosted Cloud customers). */
export function Waitlist({ conn }: { conn: Connection }) {
	const { data, error } = useGet<{ signups: Array<{ email: string; plan: string; createdAt: number }> }>(conn, '/api/stats/waitlist');
	if (error || !data) return null;
	const list = data.signups;
	const download = () => {
		const csv = ['email,plan,joined', ...list.map((s) => `${s.email},${s.plan},${new Date(s.createdAt * 1000).toISOString()}`)].join('\n');
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
		a.download = 'grosslytics-waitlist.csv';
		a.click();
		URL.revokeObjectURL(a.href);
	};
	return (
		<Card title={`Waitlist (${num(list.length)})`} icon={<Users size={15} />}>
			<p className="mt-1 text-[13px] text-ink-2">Emails from “Join the waitlist” on /start. Nothing is sent to them automatically: write to them yourself when the plan opens.</p>
			{list.length === 0 ? (
				<p className="mt-3 text-[13px] text-ink-3">No one yet.</p>
			) : (
				<>
					<ul className="mt-3 max-h-56 divide-y divide-line overflow-y-auto text-[13px]">
						{list.map((s) => (
							<li key={`${s.email}|${s.plan}`} className="flex gap-3 py-1.5">
								<span className="min-w-0 flex-1 truncate">{s.email}</span>
								<span className="text-ink-2">{s.plan === 'cloud' ? 'Indie Cloud' : 'Lifetime'}</span>
								<span className="tnum w-24 text-right text-ink-3">{new Date(s.createdAt * 1000).toLocaleDateString()}</span>
							</li>
						))}
					</ul>
					<button type="button" className="btn btn-quiet mt-3 !px-2.5 !py-1 !text-[13px]" onClick={download}><Download size={13} aria-hidden="true" />Download CSV</button>
				</>
			)}
		</Card>
	);
}
