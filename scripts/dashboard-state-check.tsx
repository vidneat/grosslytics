/** @jsxImportSource ../apps/web/node_modules/react */
/** Browser regression harness: all HTTP/WebSocket data is synthetic and stays on an isolated localhost origin.
 * bun build scripts/dashboard-state-check.tsx --target=browser --define 'import.meta.env={"DEV":false}' --outfile=/tmp/gl-state/check.js
 * Serve /tmp/gl-state with an HTML page loading <script type="module" src="/check.js"></script>.
 * The page prints PASS or the failed assertion; no browser-testing dependency is required.
 */
import { createRoot } from '../apps/web/node_modules/react-dom/client';
import { act } from '../apps/web/node_modules/react';
import DashboardIsland from '../apps/web/src/components/dashboard/DashboardIsland';
import { useLiveSocket, useRemoteDashboard } from '../apps/web/src/components/dashboard/api';
import { buildDemo } from '../apps/web/src/components/dashboard/demo';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
	true;
const host = document.createElement('div');
document.body.append(host);
const root = createRoot(host);
const fixture = (name: string) => ({
	...buildDemo('30d', 'first', 'net', []),
	live: true,
	fixture: name,
});
const pending: Array<{ site: string; resolve: (value: Response) => void }> = [];
const sites = [
	{ id: 'a', domain: 'alpha.test' },
	{ id: 'b', domain: 'beta.test' },
];
globalThis.fetch = (url) => {
	const path = String(url);
	if (path.endsWith('/api/stats/sites')) return Promise.resolve(Response.json({ sites }));
	if (path.includes('/journey/')) return Promise.resolve(Response.json({ events: [] }));
	return new Promise<Response>((resolve) =>
		pending.push({ site: new URL(path).searchParams.get('siteId') ?? '', resolve }),
	);
};
class Socket {
	static all: Socket[] = [];
	onopen?: () => void;
	onclose?: () => void;
	onmessage?: (event: { data: string }) => void;
	constructor() {
		Socket.all.push(this);
	}
	close() {
		this.onclose?.();
	}
	sendPresence() {
		this.onmessage?.({
			data: JSON.stringify({
				type: 'presence',
				onlineVisitors: 9,
				recentVisitors: [
					{
						visitorId: 'a',
						timestamp: 1,
						page: '/alpha',
						source: 'alpha',
						country: 'US',
						city: 'Alpha',
					},
				],
			}),
		});
	}
}
globalThis.WebSocket = Socket as unknown as typeof WebSocket;
function check(condition: unknown, label: string): asserts condition {
	if (!condition) throw new Error(label);
}

const flush = async (work: () => void = () => {}) => {
	await act(async () => {
		work();
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
};
const settle = async (site: string, fail = false) =>
	flush(() => {
		const request = pending.findIndex((entry) => entry.site === site);
		check(request >= 0, `Missing request for ${site}`);
		const [entry] = pending.splice(request, 1);
		check(entry, 'Missing deferred response');
		entry.resolve(
			fail ? new Response('site unavailable', { status: 503 }) : Response.json(fixture(site)),
		);
	});
const conn = (siteId: string) => ({
	api: 'http://fixture.test',
	token: 'synthetic-test-token',
	siteId,
});
let snapshot: ReturnType<typeof useRemoteDashboard> = { data: null, error: null, loading: false };
let live: ReturnType<typeof useLiveSocket> = { online: null, entries: [] };
function Hooks({ site, refresh = 0 }: { site: string | null; refresh?: number }) {
	snapshot = useRemoteDashboard(
		site ? { conn: conn(site) } : null,
		{ range: '30d', model: 'first', mode: 'net', filters: [] },
		refresh,
	);
	live = useLiveSocket(site ? conn(site) : null);
	return (
		<output>
			{snapshot.data ? (snapshot.data as unknown as { fixture: string }).fixture : 'empty'}
		</output>
	);
}

try {
	await flush(() => root.render(<Hooks site="a" />));
	await settle('a');
	await flush(() => Socket.all.at(-1)?.sendPresence());
	check(snapshot.data && live.online === 9, 'Initial site did not load');
	await flush(() => root.render(<Hooks site="a" refresh={1} />));
	check(!!snapshot.data && snapshot.loading, 'Same-site refresh discarded the loaded data');
	const staleSocket = Socket.all.at(-1);
	check(staleSocket, 'Missing live socket');
	await flush(() => root.render(<Hooks site="b" />));
	check(
		!snapshot.data && live.online === null && !live.entries.length,
		'Site B retained site A data',
	);
	await settle('a'); // intentionally completes after abort; the mock ignores AbortSignal
	await flush(() => staleSocket.sendPresence());
	check(!snapshot.data && live.online === null, 'Stale completion crossed the site boundary');
	await settle('b', true);
	check(!snapshot.data && !!snapshot.error, 'Failed site B request exposed site A data');
	await flush(() => root.render(<Hooks site={null} />));
	check(
		!snapshot.data && !snapshot.loading && !live.entries.length,
		'Disconnect retained site data',
	);

	localStorage.setItem('gl_connection', JSON.stringify(conn('a')));
	await flush(() => root.render(<DashboardIsland source="api" />));
	await settle('a');
	await flush(() => {
		const sale = [...host.querySelectorAll('button')].find((button) =>
			button.textContent?.includes('m***@hey.com'),
		);
		check(sale, 'Recent sale missing');
		sale.click();
	});
	check(host.querySelector('[role=dialog]'), 'Journey drawer did not open');
	await flush(() => {
		const select = host.querySelector<HTMLSelectElement>('select[aria-label="Site"]');
		check(select, 'Site picker missing');
		select.value = 'b';
		select.dispatchEvent(new Event('change', { bubbles: true }));
	});
	check(
		!host.querySelector('[role=dialog]') && host.textContent?.includes('Loading beta.test'),
		'Workspace state survived the site switch',
	);
	await settle('b', true);
	check(
		!host.querySelector('[role=dialog]') && !host.textContent?.includes('$19,572'),
		'Failed site switch retained the previous workspace',
	);
	await flush(() => root.unmount());
	localStorage.removeItem('gl_connection');
	document.body.textContent =
		'PASS: stale success, failure, socket messages, disconnect and journey/site switching; same-site refresh preserves data.';
} catch (error) {
	document.body.textContent = `FAIL: ${String(error)}`;
	console.error(error);
}
