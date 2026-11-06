// Fill these two in, then run `bun run dev:test-site` and open http://localhost:3000
window.TEST_SITE = {
	// From /app → Add site (domain: localhost). Looks like gl_1a2b3c4d5e6f.
	siteId: 'gl_8b5e717a83ac',
	// A Stripe *test mode* Payment Link (Stripe → Payment Links → New). Starts with https://buy.stripe.com/test_
	paymentLink: 'https://buy.stripe.com/test_fZu3cvfGh7zbe3idbo8bS00',
	// Where `bun run dev:web` serves the tracker and `bun run dev:api` receives it
	trackerUrl: 'http://localhost:4321/g.js',
	apiUrl: 'http://localhost:8787',
};

(() => {
	const c = window.TEST_SITE;
	document.addEventListener('DOMContentLoaded', () => {
		// Set the checkout link before the tracker loads, so the tracker adds the visitor ID to it
		document.querySelectorAll('[data-buy]').forEach((a) => {
			if (c.paymentLink.startsWith('PASTE_')) a.addEventListener('click', (e) => (e.preventDefault(), alert('Set paymentLink in examples/test-site/config.js first.')));
			else a.href = c.paymentLink;
		});
		const todo = [c.siteId.startsWith('PASTE_') && 'the site ID (no visits are recorded until you do)', c.paymentLink.startsWith('PASTE_') && 'a Stripe test Payment Link (the Buy button does nothing until you do)'].filter(Boolean);
		const warn = document.getElementById('setup-warning');
		if (todo.length) (warn.hidden = false), (warn.textContent = `Set in examples/test-site/config.js: ${todo.join('; ')}.`);
		if (c.siteId.startsWith('PASTE_')) return;
		const s = document.createElement('script');
		s.defer = true;
		s.src = c.trackerUrl;
		s.dataset.siteId = c.siteId;
		s.dataset.api = `${c.apiUrl}/api/event`;
		document.head.appendChild(s);
	});
})();
