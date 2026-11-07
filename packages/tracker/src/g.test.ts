import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

/** Runs the built g.js against a minimal fake browser and records every beacon it sends. */
function load(search = '', referrer = '', anchors: Array<{ href: string }> = []) {
	const sent: any[] = [];
	const handlers: Record<string, () => void> = {};
	let clock = 0;
	const store = () => {
		const m = new Map<string, string>();
		return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
	};
	const doc: any = {
		currentScript: { getAttribute: (k: string) => ({ 'data-site-id': 's1', 'data-api': 'http://a/api/event' })[k] ?? null },
		referrer,
		visibilityState: 'visible',
		addEventListener: (e: string, f: () => void) => (handlers[e] = f),
		querySelectorAll: () => anchors,
		documentElement: {},
	};
	const g: any = {
		document: doc,
		navigator: { userAgent: 'Mozilla/5.0' },
		fetch: (_: string, o: { body: string }) => (sent.push(JSON.parse(o.body)), Promise.resolve()),
		location: { pathname: '/pricing', search, origin: 'https://acme.io' },
		localStorage: store(),
		sessionStorage: store(),
		performance: { now: () => clock },
		URL,
		URLSearchParams,
		addEventListener: (e: string, f: () => void) => (handlers[e] = f),
	};
	g.window = g;
	new Function(...Object.keys(g), readFileSync(new URL('../dist/g.js', import.meta.url), 'utf8'))(...Object.values(g));
	return {
		sent,
		wait: (sec: number) => (clock += sec * 1000),
		hide: () => ((doc.visibilityState = 'hidden'), handlers.visibilitychange!()),
		show: () => ((doc.visibilityState = 'visible'), handlers.visibilitychange!()),
		close: () => handlers.pagehide!(),
	};
}

const leaves = (sent: any[]) => sent.filter((b) => b.t === 'leave').map((b) => b.dur);

test('hide then close reports the read time once', () => {
	const p = load();
	p.wait(42.6);
	p.hide();
	p.close();
	expect(leaves(p.sent)).toEqual([42]);
});

test('coming back to the tab reports only the new reading time', () => {
	const p = load();
	p.wait(30.5);
	p.hide();
	p.wait(600); // hidden time never counts
	p.show();
	p.wait(20.7);
	p.close();
	expect(leaves(p.sent)).toEqual([30, 21]); // 51.2s in total, fractions carried over
});

test('a sub-second bounce still sends one leave', () => {
	const p = load();
	p.hide();
	p.close();
	expect(leaves(p.sent)).toEqual([0]);
});

test('tagged links name the source; own-site referrers keep the visit source', () => {
	expect(load('?utm_source=newsletter&utm_medium=email').sent[0]).toMatchObject({ src: 'newsletter', cat: 'Email' });
	expect(load('', 'https://news.ycombinator.com/item').sent[0]).toMatchObject({ src: 'news.ycombinator.com', cat: 'Referral' });
	expect(load('', 'https://acme.io/blog').sent[0]).toMatchObject({ src: 'Direct (Typed/Bookmark)', cat: 'Direct' });
});

test('checkout links use gateway-specific parameters and preserve an existing reference', () => {
	const links = [
		'https://buy.polar.sh/polar_cl_test',
		'https://buy.polar.sh/polar_cl_test?reference_id=existing',
		'https://buy.stripe.com/test_1',
		'https://shop.lemonsqueezy.com/checkout/buy/test',
		'https://pay.paddle.io/test',
		'https://rzp.io/test',
	].map((href) => ({ href }));
	const visitorId = load('', '', links).sent[0].vid;
	expect(new URL(links[0]!.href).searchParams.get('reference_id')).toBe(visitorId);
	expect(new URL(links[1]!.href).searchParams.get('reference_id')).toBe('existing');
	expect(new URL(links[2]!.href).searchParams.get('client_reference_id')).toBe(visitorId);
	expect(new URL(links[3]!.href).searchParams.get('checkout[custom][visitor_id]')).toBe(visitorId);
	expect(new URL(links[4]!.href).search).toBe('');
	expect(new URL(links[5]!.href).search).toBe('');
});
