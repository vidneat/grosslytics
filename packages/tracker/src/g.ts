const w = window as any;
const d = document;
const n = navigator;
const l = location;
const on = (t: any, e: string, f: any, o?: any) => t.addEventListener(e, f, o);

if (!w.__gl && !n.webdriver) {
	w.__gl = 1;

	const s = d.currentScript as HTMLScriptElement || d.querySelector('[data-site-id]');
	const sid = s?.getAttribute('data-site-id') || s?.getAttribute('data-domain');

	if (sid) {
		const api = s?.getAttribute('data-api') || (s?.src ? new URL(s.src).origin : '') + '/api/collect';
		const id = () => Math.random().toString(36).slice(2) + (+new Date).toString(36);
		const get = (k: string, isSes?: boolean) => {
			const st = isSes ? sessionStorage : localStorage;
			try {
				let v = st.getItem(k);
				if (!v) st.setItem(k, v = id());
				return v;
			} catch { return id(); }
		};

		const vid = get('gl_vid');
		const ses = get('gl_ses', true);
		const ua = n.userAgent || '';
		const ref = d.referrer || '';
		const pth = l.pathname;
		let src = '';
		let cat = 'Direct';

		const m = /insta|fba|linked|byted|music|tele|twitt|x-cl/i.exec(ua);
		if (m) {
			const k = m[0].toLowerCase();
			const C = '.com (in-app)';
			src = k[0] === 'i' ? 'instagram' + C : k[0] === 'f' ? 'facebook' + C : k[0] === 'l' ? 'linkedin' + C : k[0] === 'b' || k[0] === 'm' ? 'tiktok' + C : k[1] === 'e' ? 'telegram.org (in-app)' : 'x' + C;
			cat = 'Social (Organic)';
		} else if (ref) {
			try {
				const h = new URL(ref).hostname.replace(/^www\./, '');
				const ai = /chatgpt|perplexity|claude|gemini|copilot/i.test(h);
				src = h + (ai ? ' (AI)' : '');
				cat = ai ? 'AI Search' : 'Referral';
			} catch {
				src = ref.slice(0, 50);
			}
		} else {
			src = 'Direct (' + (pth !== '/' || l.search ? 'Shared Link' : 'Typed/Bookmark') + ')';
		}

		const sp = new URLSearchParams(l.search);
		const [us, um, uc] = ['source', 'medium', 'campaign'].map((k) => sp.get('utm_' + k) || void 0);
		const now = () => performance.now();
		let dur = 0;
		let last = now();
		let vis = d.visibilityState === 'visible';
		let sd = 0;
		let lock = 0;

		const tick = () => {
			if (vis) {
				const cur = now();
				dur += ((cur - last) / 1000) | 0;
				last = cur;
			}
		};

		on(d, 'visibilitychange', () => {
			(vis = d.visibilityState === 'visible') ? last = now() : (tick(), send('leave', pth));
		});

		on(w, 'scroll', () => {
			if (!lock) {
				lock = 1;
				w.requestAnimationFrame(() => {
					const el = d.documentElement;
					const max = el.scrollHeight - el.clientHeight;
					if (max > 0) sd = Math.max(sd, Math.min(100, (el.scrollTop / max * 100) | 0));
					lock = 0;
				});
			}
		}, { passive: 1 });

		const send = (t: string, nme: string, meta?: string) => {
			tick();
			const body = JSON.stringify({
				sid, vid, ses, t,
				n: nme.slice(0, 100),
				src, cat,
				ref: ref.slice(0, 100),
				sd, dur,
				us, um, uc, meta,
			});
			n.sendBeacon ? n.sendBeacon(api, body) : fetch(api, { method: 'POST', body, keepalive: true, priority: 'low' } as any);
		};

		const decor = (a: HTMLAnchorElement) => {
			const h = a.href;
			if (h && h[0] !== '#' && !h.startsWith('jav')) try {
				const u = new URL(h);
				const s = u.hostname;
				const V = 'visitor_id';
				const p = s.includes('stripe') ? 'client_reference_id' :
					s.includes('polar') || s.includes('lemons') ? `checkout[custom][${V}]` :
					s.includes('paddle') || s.includes('razor') ? V : 0;
				if (p && !u.searchParams.has(p)) {
					u.searchParams.set(p, vid);
					a.href = u.href;
				}
			} catch {}
		};

		const scan = () => d.querySelectorAll('a[href]').forEach(decor as any);
		scan();

		if (w.MutationObserver) new MutationObserver(scan).observe(d.body || d.documentElement, { childList: true, subtree: true });

		on(d, 'click', (e: any) => {
			const el = e.target?.closest?.('[data-gl-goal],[data-fast-goal],[data-goal]');
			if (el) {
				const ds = el.dataset;
				send('goal', ds.glGoal || ds.fastGoal || ds.goal);
			}
		}, { passive: 1 });

		const fn = (ev: string, m?: any) => ev === 'pageview' ? send('pageview', pth) : send('goal', ev, m ? JSON.stringify(m) : undefined);
		w.grosslytics = w.datafast = w.databull = w.plausible = w.grosslytics || fn;

		send('pageview', pth);
		on(w, 'pagehide', () => send('leave', pth));
	}
}
