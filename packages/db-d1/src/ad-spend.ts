/** Daily budgets are spread uniformly over the site-local day (offsetSec ahead of UTC); cumulative rounding conserves every cent. */
export function allocateAdSpend(
	rows: Array<{ k: string; d: string; a: number }>,
	start: number,
	end: number,
	step: number,
	offsetSec = 0,
) {
	const bySource = new Map<string, number>();
	const byBucket = Array<number>(Math.ceil((end - start) / step)).fill(0);
	for (const row of rows) {
		const day = Date.parse(`${row.d}T00:00:00Z`) / 1000 - offsetSec;
		for (
			let b = Math.max(0, Math.floor((day - start) / step));
			b < byBucket.length && start + b * step < day + 86400;
			b++
		) {
			const from = Math.max(day, start + b * step);
			const to = Math.min(day + 86400, end, start + (b + 1) * step);
			if (to <= from) continue;
			const amount =
				Math.round((row.a * (to - day)) / 86400) - Math.round((row.a * (from - day)) / 86400);
			byBucket[b] = (byBucket[b] ?? 0) + amount;
			bySource.set(row.k, (bySource.get(row.k) ?? 0) + amount);
		}
	}
	return { bySource, byBucket, total: byBucket.reduce((sum, value) => sum + value, 0) };
}
