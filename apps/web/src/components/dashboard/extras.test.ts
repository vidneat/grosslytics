import { expect, test } from 'bun:test';
import { parseAdSpendCsv } from './extras';

test('ad spend CSV: header skipped, quotes, currency signs and semicolons handled, bad lines reported', () => {
	const r = parseAdSpendCsv('date,source,amount\n2026-11-01,twitter,42.50\n"2026-11-02";"google";"$1,200"\n\n2026-11-03,,5\nnope,x,1');
	expect(r.rows).toEqual([
		{ date: '2026-11-01', source: 'twitter', amountCents: 4250 },
		{ date: '2026-11-02', source: 'google', amountCents: 120000 },
	]);
	expect(r.errors).toEqual(['Line 5: expected YYYY-MM-DD, source, amount', 'Line 6: expected YYYY-MM-DD, source, amount']);
	const ok = parseAdSpendCsv('2026-11-02\tgoogle\t1200.10');
	expect(ok).toEqual({ rows: [{ date: '2026-11-02', source: 'google', amountCents: 120010 }], errors: [] });
});
