import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
// A synthetic PNG is only a parser-test fixture, never published as product evidence.
function fixturePng() {
	const chunk = (name, data) => {
		const payload = Buffer.concat([Buffer.from(name), data]);
		let crc = 0xffffffff;
		for (const byte of payload) {
			crc ^= byte;
			for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
		}
		const size = Buffer.alloc(4);
		size.writeUInt32BE(data.length);
		const checksum = Buffer.alloc(4);
		checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
		return Buffer.concat([size, payload, checksum]);
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(320);
	header.writeUInt32BE(180, 4);
	header[8] = 8;
	header[9] = 2;
	return Buffer.concat([
		Buffer.from('89504e470d0a1a0a', 'hex'),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(Buffer.alloc(180 * (1 + 320 * 3), 0))),
		chunk('IEND', Buffer.alloc(0)),
	]);
}
test('stdio tools research, audit and write articles without overwriting work', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'grosslytics-seo-'));
	const client = new Client({ name: 'seo-smoke-test', version: '1.0.0' });
	try {
		await mkdir(path.join(root, 'src/layouts'), { recursive: true });
		await mkdir(path.join(root, 'src/pages/compare'), { recursive: true });
		await writeFile(
			path.join(root, 'src/layouts/Article.astro'),
			'---\nconst { title } = Astro.props.frontmatter;\n---\n<h1>{title}</h1><slot/>',
		);
		await writeFile(
			path.join(root, 'src/pages/compare/[slug].astro'),
			"params: { slug: 'existing-comparison' }",
		);
		for (const page of ['index', 'docs', 'start'])
			await writeFile(path.join(root, `src/pages/${page}.astro`), '<p>Fixture destination</p>');
		const mock = path.join(root, 'mock.mjs');
		await writeFile(
			mock,
			`globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('suggestqueries.google.com')) return Response.json(['query', ['how to track payments']]);
      if (url.includes('duckduckgo.com')) return new Response('<div class="result"><h2 class="result__title">Payments guide</h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fguide">Result</a><p class="result__snippet">Track payments</p></div>');
      return new Response('<title>Example guide</title><main><h1>Track payments</h1><h2>Installation</h2><p>Three concrete steps.</p></main>');
    };`,
		);
		await client.connect(
			new StdioClientTransport({
				command: process.execPath,
				args: ['--import', mock, path.join(packageDir, 'dist/index.js')],
				env: { ...process.env, GROSSLYTICS_WEB_DIR: root },
				stderr: 'pipe',
			}),
		);
		const tools = await client.listTools();
		assert.equal(tools.tools.length, 7);
		const call = (name, args) => client.callTool({ name, arguments: args });
		const guidance = JSON.parse((await call('get_google_seo_guidance', {})).content[0].text);
		assert.ok(guidance.principles.some((p) => p.includes('no ideal link count')));
		const plan = JSON.parse(
			(
				await call('plan_article_visuals', {
					keyword: 'example vs other',
					productPages: [
						{
							product: 'Example',
							sourceUrl: 'https://example.com/demo',
							sectionHeading: 'Example dashboard',
						},
					],
				})
			).content[0].text,
		);
		assert.equal(plan.recommendation, 'assess-real-screenshots');
		assert.equal(plan.captureCandidates[0].product, 'Example');
		assert.match(plan.limitations, /does not control a browser/);
		assert.equal(
			JSON.parse(
				(
					await call('plan_article_visuals', {
						keyword: 'what is attribution',
						format: 'explainer',
					})
				).content[0].text,
			).recommendation,
			'optional',
		);
		const brief = await call('outrank_serp_brief', {
			keyword: 'how to track payments',
			targetReaderOneSentence: 'An indie founder who needs payment attribution.',
		});
		assert.equal(brief.isError, undefined);
		const research = JSON.parse(brief.content[0].text);
		assert.equal(research.detectedFormat, 'how-to');
		assert.equal(research.competitorGapAnalysis[0].metaTitle, 'Example guide');
		assert.equal(research.searchResults[0].url, 'https://example.com/guide');
		assert.match(research.questionSource, /not Google People Also Ask/);
		assert.ok(research.visualEvidencePlan.workflow.length);
		const screenshotFile = path.join(root, 'browser-capture.png');
		await writeFile(screenshotFile, fixturePng());
		const screenshotInput = {
			product: 'Example "app"',
			screenshotFile,
			sourceUrl: 'https://example.com/demo',
			capturedOn: '2026-01-01',
			pageType: 'public-demo',
			alt: 'Example dashboard with traffic and revenue charts.',
			caption: 'Public demo of Example with sample traffic and revenue figures.',
		};
		const registeredResult = await call('register_article_screenshot', screenshotInput);
		assert.equal(registeredResult.isError, undefined, JSON.stringify(registeredResult));
		const registered = JSON.parse(registeredResult.content[0].text);
		assert.equal(registered.provenance.width, 320);
		assert.match(registered.figureMarkdown, /Example &quot;app&quot;/);
		assert.match(registered.figureMarkdown, /loading="lazy"/);
		assert.equal((await call('register_article_screenshot', screenshotInput)).isError, undefined);
		assert.equal(
			(await call('register_article_screenshot', { ...screenshotInput, capturedOn: '2099-01-01' }))
				.isError,
			true,
		);
		assert.equal(
			(
				await call('register_article_screenshot', {
					...screenshotInput,
					sourceUrl: 'https://user:secret@example.com',
				})
			).isError,
			true,
		);
		const fake = path.join(root, 'not-an-image.png');
		await writeFile(fake, '<svg><script>not a screenshot</script></svg>');
		assert.equal(
			(await call('register_article_screenshot', { ...screenshotInput, screenshotFile: fake }))
				.isError,
			true,
		);
		const audit = await call('outrank_3pass_audit', {
			primaryKeyword: 'payments',
			slug: 'payment-tracking',
			title: 'Payment tracking',
			description: 'Tracking guide',
			markdownBody:
				'# Payment tracking\n\nTrack payments with a webhook.\n\n## How does it work?\n\n| Tool | Price |\n| --- | --- |\n| A | $0 |\n\n- One\n- Two\n- Three\n- Four\n- Five\n\n[Docs](/docs/) [Home](https://grosslytics.com/) [Start](/start) [Source](https://example.com/) [Docs](https://example.org/)\n\n```js\nconsole.log(1)\n```',
		});
		const report = JSON.parse(audit.content[0].text);
		assert.equal(report.stats.internalLinks, 3);
		assert.equal(report.stats.externalLinks, 2);
		assert.equal(report.stats.tableCount, 1);
		assert.equal(report.passedAutomatedChecks, true);
		const auditText = async (markdownBody) =>
			JSON.parse(
				(
					await call('outrank_3pass_audit', {
						primaryKeyword: 'payments',
						slug: '/guides/test/',
						title: 'Guide',
						description: 'Guide',
						markdownBody,
					})
				).content[0].text,
			);
		assert.equal(
			(await auditText('A short answer without links, code, tables or lists.'))
				.passedAutomatedChecks,
			true,
		);
		const htmlLinks = await auditText(
			'<a href="/docs/">Documentation</a> ![Asset](/not-a-link.png)',
		);
		assert.equal(htmlLinks.stats.internalLinks, 1);
		assert.equal((await auditText('[Missing](/missing-page/)')).passedAutomatedChecks, false);
		assert.equal(
			(await auditText('<a href="javascript:alert(1)">Run</a>')).passedAutomatedChecks,
			false,
		);
		assert.equal(
			(await auditText('<meta name="robots" content="noindex">')).passedAutomatedChecks,
			false,
		);
		const article = {
			slug: 'payment-tracking',
			collection: 'guides',
			title: 'Track payment revenue',
			description: 'A concrete guide.',
			primaryKeyword: 'payments',
			visualReview: {
				decision: 'not-needed',
				reason:
					'This code-only webhook guide uses a reproducible example rather than a UI walkthrough.',
			},
			answerFirstIntro: 'Use a webhook to track payments.',
			keyTakeaways: ['Verify signatures.', 'Link visits.', 'Check refunds.'],
			mdxBodySections: '## How does tracking work?\n\nConnect your provider.',
			faqs: ['What is tracking?', 'How does it work?', 'What about refunds?'].map((question) => ({
				question,
				answer: 'Check the documentation.',
			})),
		};
		const badLink = await call('publish_outrank_astro_post', {
			...article,
			slug: 'broken-links',
			mdxBodySections: '[Missing](/missing-page/)',
		});
		assert.equal(badLink.isError, true);
		await assert.rejects(readFile(path.join(root, 'src/pages/guides/broken-links.md')), {
			code: 'ENOENT',
		});
		const published = await call('publish_outrank_astro_post', article);
		assert.equal(published.isError, undefined);
		assert.equal(JSON.parse(published.content[0].text).status, 'written_locally');
		const headers = await readFile(path.join(root, 'public/_headers'), 'utf8');
		assert.match(
			headers,
			/Link: <https:\/\/grosslytics.com\/guides\/payment-tracking>; rel="canonical"/,
		);
		const linking = JSON.parse(
			(await call('plan_internal_links', { keyword: 'payment revenue' })).content[0].text,
		);
		assert.equal(linking.candidates[0].title, article.title);
		const visualReview = {
			decision: 'include-screenshots',
			reason:
				'The public demo screenshot explains the dashboard under comparison; figures are sample data.',
		};
		assert.equal(
			(await call('publish_outrank_astro_post', { ...article, slug: 'missing-shot', visualReview }))
				.isError,
			true,
		);
		const { visualReview: _omitted, ...withoutReview } = article;
		assert.equal(
			(await call('publish_outrank_astro_post', { ...withoutReview, slug: 'no-assessment' }))
				.isError,
			true,
		);
		const imageArticle = {
			...article,
			slug: 'with-screenshot',
			visualReview,
			mdxBodySections: `${article.mdxBodySections}\n\n${registered.figureMarkdown}`,
		};
		const withScreenshot = await call('publish_outrank_astro_post', imageArticle);
		assert.equal(withScreenshot.isError, undefined, JSON.stringify(withScreenshot));
		assert.equal(
			JSON.parse(withScreenshot.content[0].text).visualEvidence.registeredScreenshots,
			1,
		);
		assert.match(
			await readFile(path.join(root, 'src/pages/guides/with-screenshot.md'), 'utf8'),
			/<figcaption>/,
		);
		const visualAuditArgs = {
			primaryKeyword: 'example alternative',
			slug: 'example-alternative',
			title: 'Example',
			description: 'Example',
			markdownBody: registered.figureMarkdown,
			visualReview,
		};
		let visualAudit = JSON.parse(
			(await call('outrank_3pass_audit', visualAuditArgs)).content[0].text,
		).visualEvidence;
		assert.deepEqual(visualAudit.issues, []);
		visualAudit = JSON.parse(
			(
				await call('outrank_3pass_audit', {
					...visualAuditArgs,
					markdownBody: registered.figureMarkdown.replace(
						'alt="Example dashboard with traffic and revenue charts."',
						'alt=""',
					),
				})
			).content[0].text,
		).visualEvidence;
		assert.ok(visualAudit.issues.some((message) => message.includes('alt text')));
		const savedImage = path.join(root, 'public', registered.src.slice(1));
		const changedImage = fixturePng();
		changedImage[changedImage.length - 1] ^= 1;
		await writeFile(savedImage, changedImage);
		visualAudit = JSON.parse(
			(await call('outrank_3pass_audit', visualAuditArgs)).content[0].text,
		).visualEvidence;
		assert.ok(visualAudit.issues.some((message) => message.includes('hash differs')));
		const pagePath = path.join(root, 'src/pages/guides/payment-tracking.md');
		const page = await readFile(pagePath, 'utf8');
		assert.match(page, /layout: "\.\.\/\.\.\/layouts\/Article.astro"/);
		assert.match(page, /## Frequently asked questions/);
		assert.match(
			await readFile(path.join(root, 'public/llms.txt'), 'utf8'),
			/https:\/\/grosslytics.com\/guides\/payment-tracking.md/,
		);
		const duplicate = await call('publish_outrank_astro_post', article);
		assert.equal(duplicate.isError, true);
		assert.equal(await readFile(pagePath, 'utf8'), page);
		assert.equal(
			(await call('publish_outrank_astro_post', { ...article, slug: '../escape' })).isError,
			true,
		);
		assert.equal(
			(
				await call('publish_outrank_astro_post', {
					...article,
					collection: 'compare',
					slug: 'existing-comparison',
				})
			).isError,
			true,
		);
		assert.equal(
			(
				await call('publish_outrank_astro_post', {
					...article,
					slug: 'component',
					mdxBodySections: '<RoiCalculator />',
				})
			).isError,
			true,
		);
		if (process.env.SEO_BUILD_CHECK === '1') {
			const webDir = path.resolve(packageDir, '../../apps/web');
			const checkPage = path.join(webDir, 'src/pages/seo-mcp-build-check.md');
			// The real site's build verifies the generated Markdown and Article layout together.
			await writeFile(
				checkPage,
				page.replace('../../layouts/Article.astro', '../layouts/Article.astro'),
				{ flag: 'wx' },
			);
			try {
				const build = spawnSync('bun', ['run', 'build'], { cwd: webDir, encoding: 'utf8' });
				assert.equal(build.status, 0, build.stdout + build.stderr);
				const html = await readFile(
					path.join(webDir, 'dist/seo-mcp-build-check/index.html'),
					'utf8',
				);
				assert.match(html, /Track payment revenue/);
				assert.match(html, /Frequently asked questions/);
				assert.match(html, /application\/ld\+json/);
			} finally {
				await rm(checkPage, { force: true });
				await rm(path.join(webDir, 'dist/seo-mcp-build-check'), { recursive: true, force: true });
			}
		}
	} finally {
		await client.close();
		await rm(root, { recursive: true, force: true });
	}
});

test('content-collection sites get guides in their own format and domain', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'collection-seo-'));
	const client = new Client({ name: 'seo-collection-test', version: '1.0.0' });
	try {
		const guides = path.join(root, 'src/content/guides');
		await mkdir(guides, { recursive: true });
		await mkdir(path.join(root, 'src/content/authors'), { recursive: true });
		await mkdir(path.join(root, 'src/pages/guides'), { recursive: true });
		await writeFile(path.join(root, 'src/pages/guides/[...slug].astro'), '');
		await writeFile(path.join(root, 'src/content/authors/jane-doe.json'), '{}');
		await writeFile(
			path.join(guides, 'trim-video-mac.mdx'),
			'---\ntitle: "Trim video on a Mac"\n---\n',
		);
		await client.connect(
			new StdioClientTransport({
				command: process.execPath,
				args: [path.join(packageDir, 'dist/index.js')],
				env: {
					...process.env,
					GROSSLYTICS_WEB_DIR: root,
					SEO_SITE_URL: 'https://example.app/',
					SEO_SITE_NAME: 'Example',
					SEO_CONTENT_COLLECTIONS: 'guides,tools',
				},
				stderr: 'pipe',
			}),
		);
		const call = (name, args) => client.callTool({ name, arguments: args });
		const links = JSON.parse(
			(await call('plan_internal_links', { keyword: 'trim video' })).content[0].text,
		);
		assert.equal(links.candidates[0].url, '/guides/trim-video-mac/');
		const article = {
			slug: 'cut-audio-mac',
			title: 'Cut audio on a Mac',
			description: 'A short guide.',
			primaryKeyword: 'cut audio',
			category: 'How-to',
			author: 'jane-doe',
			related: ['trim-video-mac'],
			visualReview: {
				decision: 'not-needed',
				reason: 'This short text guide has no interface to show.',
			},
			answerFirstIntro: 'Use the [trim guide](https://example.app/guides/trim-video-mac/).',
			keyTakeaways: ['One fact.'],
			mdxBodySections: '## How?\n\nRun `a {b}` in code.',
			faqs: [{ question: 'Is it free?', answer: 'Yes.' }],
		};
		const refused = async (override) => {
			const result = await call('publish_outrank_astro_post', { ...article, ...override });
			assert.equal(result.isError, true, JSON.stringify(override));
		};
		await refused({ slug: 'a', answerFirstIntro: '[Gone](/guides/missing-guide/)' });
		await refused({ slug: 'b', author: 'nobody' });
		await refused({ slug: 'c', category: undefined });
		await refused({ slug: 'd', related: ['missing-guide'] });
		await refused({ slug: 'e', mdxBodySections: 'export const x = 1' });
		await refused({ slug: 'f', mdxBodySections: 'Costs {price}' });
		await refused({ slug: 'g', mdxBodySections: 'Use 2 < 3' });
		const published = await call('publish_outrank_astro_post', article);
		assert.equal(published.isError, undefined, JSON.stringify(published));
		const result = JSON.parse(published.content[0].text);
		assert.equal(result.canonicalUrl, 'https://example.app/guides/cut-audio-mac/');
		assert.equal(result.linkReview.internalLinks, 1);
		const page = await readFile(path.join(guides, 'cut-audio-mac.mdx'), 'utf8');
		assert.match(page, /^author: "jane-doe"$/m);
		assert.match(page, /^readTime: "1 min read"$/m);
		assert.match(page, /\*\*Key takeaways:\*\*/);
		assert.match(page, /## Common questions/);
		assert.doesNotMatch(page, /layout:/);
		await assert.rejects(readFile(path.join(root, 'public/llms.txt')), { code: 'ENOENT' });
		await assert.rejects(readFile(path.join(root, 'public/_headers')), { code: 'ENOENT' });
		await refused({});
		assert.equal(await readFile(path.join(guides, 'cut-audio-mac.mdx'), 'utf8'), page);
	} finally {
		await client.close();
		await rm(root, { recursive: true, force: true });
	}
});
