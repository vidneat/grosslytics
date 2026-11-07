// Opt-in click map for pricing and checkout pages. Add it after g.js on the pages you want mapped:
// <script defer src="https://YOUR-HOST/c.js" data-site-id="gl_…"></script>
// Records what was clicked (a label, never typed text), clicks on things that do nothing ("dead"), and 3 fast clicks ("rage").
const w = window as any;
const d = document;
const s = d.currentScript as HTMLScriptElement | null;
const sid = s?.getAttribute('data-site-id');

if (sid && !w.__glc && !navigator.webdriver) {
	w.__glc = 1;
	const api = s!.getAttribute('data-api') || new URL(s!.src).origin + '/api/event';
	const get = (st: () => Storage, k: string) => {
		try {
			return st().getItem(k);
		} catch {
			return null;
		}
	};
	let last: Element | null = null;
	let n = 0;
	let t = 0;

	d.addEventListener('click', (e) => {
		const el = e.target as Element;
		const vid = get(() => localStorage, 'gl_vid');
		if (!el?.closest || !vid) return; // g.js not loaded: nothing to attach clicks to
		const hit = el.closest('a,button,input,select,textarea,label,summary,[role=button],[onclick],[data-gl-goal],[tabindex]');
		const tgt = hit || el;
		const now = Date.now();
		n = tgt === last && now - t < 700 ? n + 1 : 1;
		last = tgt;
		t = now;
		if (n !== 1 && n !== 3) return; // the first click, and once more when it turns into a rage click
		const field = /^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName);
		const a = (k: string) => tgt.getAttribute(k);
		const label = (a('aria-label') || a('data-gl-goal') || (field ? a('name') || a('placeholder') || a('type') : (tgt as HTMLElement).innerText) || tgt.id || tgt.tagName.toLowerCase())
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 60);
		const [src, cat] = (get(() => sessionStorage, 'gl_src') || 'Direct (Typed/Bookmark)|Direct').split('|');
		const meta = JSON.stringify({ el: label, dead: hit || getComputedStyle(el).cursor === 'pointer' ? 0 : 1, rage: n === 3 ? 1 : 0 });
		fetch(api, {
			method: 'POST',
			keepalive: true,
			mode: 'no-cors',
			body: JSON.stringify({ sid, vid, ses: get(() => sessionStorage, 'gl_ses') || vid, t: 'click', n: location.pathname, src, cat, ref: '', sd: 0, dur: 0, meta }),
		}).catch(() => {});
	}, { capture: true, passive: true });
}

export {};
