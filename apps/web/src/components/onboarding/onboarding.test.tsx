import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import Onboarding from './Onboarding';

test('free onboarding shows the footer requirement before the tracker step', () => {
	const html = renderToStaticMarkup(<Onboarding />);
	expect(html).toMatch(/Verify your footer link.*Powered by Grosslytics.*Add the tracker to your site/);
});
