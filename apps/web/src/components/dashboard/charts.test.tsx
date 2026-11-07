import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Milestones } from './charts';

test('independent purchase milestones handle empty and untracked-buyer counts without false drop-offs', () => {
	for (const counts of [
		[0, 0, 0, 0],
		[0, 0, 0, 3],
		[5, 2, 4, 3],
	]) {
		const html = renderToStaticMarkup(
			<Milestones
				steps={counts.map((count, i) => ({
					label: ['Visited', 'Pricing', 'Goal', 'Paid'][i] ?? '',
					count,
				}))}
			/>,
		);
		expect(html).not.toMatch(/NaN|Infinity|drop from|% drop/);
		expect(html).toContain('Paid');
		if (counts.every((value) => value === 0)) expect(html).not.toContain('width:1%');
	}
});
