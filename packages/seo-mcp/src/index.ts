#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as cheerio from 'cheerio';
import { z } from 'zod';
import {
	seoGuidance,
	planInternalLinks,
	auditSeoContent,
	markdownCanonicalHeader,
	mdxProblems,
	site,
	writeCollectionArticle,
} from './seo.js';
import {
	auditVisuals,
	planArticleVisuals,
	productPageSchema,
	registerScreenshot,
	screenshotSchema,
	visualReviewSchema,
} from './visuals.js';

const webAppDir = path.resolve(
	process.env.GROSSLYTICS_WEB_DIR ?? fileURLToPath(new URL('../../../apps/web', import.meta.url)),
);

const server = new McpServer(
	{
		name: 'grosslytics-outrank-seo-engine',
		version: '2.2.0',
	},
	{
		instructions:
			'Read get_google_seo_guidance and call plan_internal_links before drafting. Google guidance takes priority over editorial heuristics: no link/word/image quotas, fabricated testing, self-serving rankings, keyword stuffing or ranking guarantees. Fact-check claims and disclose publisher interests. Ensure an incoming link from a useful page or collection index. Before creating an article, call plan_article_visuals. Where UI evidence helps, use the connected browser to inspect and capture real public home/demo/pricing/docs pages, then register_article_screenshot and embed its figureMarkdown near the relevant claim. Do not fabricate dashboards or use images to imply human authorship. Explain unnecessary or unavailable screenshots in visualReview. Audit the final body and verify the built page. This server imports captures; it does not control a browser or bypass login/challenges.',
	},
);

const USER_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Editorial heuristics, not verified research or a prediction of rankings.
function detectOutrankFormat(keyword: string) {
	const format = /\b(vs|versus|compare|comparison)\b/i.test(keyword)
		? 'comparison'
		: /\b(best|top|alternative|alternatives|tools|software)\b/i.test(keyword)
			? 'listicle'
			: /\b(how to|guide|step by step|setup|install|track|connect)\b/i.test(keyword)
				? 'how-to'
				: 'explainer';
	return {
		format,
		aiCitationRule:
			'Editorial suggestion only: answer the query directly, cite primary sources, and include original examples. No ranking or AI-citation guarantee.',
		templateSkeleton: [
			"H1: A specific title matching the reader's question",
			'Intro: Answer the question directly; explain prerequisites or tradeoffs',
			'Key takeaways: 3–5 supported points',
			'H2: Definition, steps, or a fair comparison appropriate to the query',
			'H2: Worked example with reproducible inputs and primary sources',
			'H2: Limitations and common mistakes',
			'H2: Frequently asked questions',
			'Next step: One concrete action',
		],
	};
}

async function fetchChecked(url: string, headers: Record<string, string> = {}) {
	const response = await fetch(url, {
		headers: { 'User-Agent': USER_AGENT, ...headers },
		signal: AbortSignal.timeout(8000),
	});
	if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
	return response;
}

async function fetchGoogleAutocomplete(query: string): Promise<string[]> {
	try {
		const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`;
		const res = await fetchChecked(url);
		const data = (await res.json()) as [string, string[]];
		return data[1] || [];
	} catch (error) {
		console.error('Autocomplete unavailable:', error);
		return [];
	}
}

async function fetchTopOrganicResults(keyword: string, limit = 5) {
	const htmlUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(keyword)}`;
	const res = await fetchChecked(htmlUrl, { Accept: 'text/html,application/xhtml+xml' });
	const html = await res.text();
	const $ = cheerio.load(html);

	const results: Array<{ title: string; url: string; snippet: string }> = [];
	if ($('.anomaly-modal, #challenge-form').length)
		throw new Error('DuckDuckGo blocked the search with a challenge; retry later.');
	$('.result').each((_, el) => {
		if (results.length >= limit) return;
		const title = $(el).find('.result__title').text().trim();
		const snippet = $(el).find('.result__snippet').text().trim();
		let rawUrl = $(el).find('.result__a').attr('href') || '';
		if (rawUrl.startsWith('//')) rawUrl = `https:${rawUrl}`;
		if (rawUrl.includes('uddg=')) {
			const match = rawUrl.match(/uddg=([^&]+)/);
			if (match?.[1]) rawUrl = decodeURIComponent(match[1]);
		}
		if (rawUrl.startsWith('http') && !rawUrl.includes('duckduckgo.com')) {
			results.push({ title, url: rawUrl, snippet });
		}
	});

	// Mine reader questions using Outrank's "mirror the searcher's words" rule
	const questionPrefixes = [
		`how to ${keyword}`,
		`what is ${keyword}`,
		`why does ${keyword}`,
		`${keyword} vs`,
		`how much does ${keyword}`,
	];
	const batches = await Promise.all(questionPrefixes.map((q) => fetchGoogleAutocomplete(q)));
	const peopleAlsoAsk = Array.from(new Set(batches.flat())).slice(0, 12);

	return { results, peopleAlsoAsk };
}

async function analyzeCompetitorUrl(targetUrl: string) {
	try {
		const res = await fetchChecked(targetUrl);
		const html = await res.text();
		const $ = cheerio.load(html);
		$('script, style, nav, footer, svg, noscript, iframe').remove();

		const headings: Array<{ tag: string; text: string }> = [];
		$('h1, h2, h3').each((_, el) => {
			const text = $(el).text().replace(/\s+/g, ' ').trim();
			if (text && text.length > 2) {
				headings.push({ tag: el.tagName.toUpperCase(), text });
			}
		});

		const bodyText = $('main, article, body').first().text().replace(/\s+/g, ' ').trim();
		const wordCount = bodyText.split(' ').filter(Boolean).length;

		return {
			url: targetUrl,
			metaTitle: $('title').text().trim(),
			wordCount,
			tableCount: $('table').length,
			listCount: $('ul, ol').length,
			codeBlockCount: $('pre, code').length,
			headings: headings.slice(0, 30),
		};
	} catch (err: unknown) {
		return {
			url: targetUrl,
			error: err instanceof Error ? err.message : String(err),
			wordCount: 0,
			headings: [],
		};
	}
}

server.registerTool(
	'get_google_seo_guidance',
	{
		description:
			'Read dated, source-linked Google Search guidance for article creation and publishing, including internal links, evidence, spam avoidance and limitations. Not Google certification.',
		inputSchema: {},
	},
	async () => ({ content: [{ type: 'text', text: JSON.stringify(seoGuidance, null, 2) }] }),
);
server.registerTool(
	'plan_internal_links',
	{
		description:
			'Suggest relevant existing articles and an incoming-link action. Suggestions are optional, not link quotas or SEO scores.',
		inputSchema: {
			keyword: z.string().min(1).max(300),
			articlePath: z
				.string()
				.regex(/^\/[a-z0-9/-]*$/)
				.optional(),
		},
	},
	async ({ keyword, articlePath }) => ({
		content: [
			{
				type: 'text',
				text: JSON.stringify(await planInternalLinks(webAppDir, keyword, articlePath), null, 2),
			},
		],
	}),
);

server.registerTool(
	'plan_article_visuals',
	{
		description:
			'Assess whether real screenshots help this article and plan connected-browser captures. Call before drafting or publishing. Select public product home/demo/pricing/docs views that explain a section; skip decorative filler with a stated reason. Does not itself operate a browser.',
		inputSchema: {
			keyword: z.string().min(1).max(300),
			format: z.enum(['how-to', 'listicle', 'comparison', 'explainer', 'case-study']).optional(),
			productPages: z.array(productPageSchema).max(12).default([]),
		},
	},
	async ({ keyword, format, productPages }) => ({
		content: [
			{
				type: 'text',
				text: JSON.stringify(
					planArticleVisuals(keyword, format ?? detectOutrankFormat(keyword).format, productPages),
					null,
					2,
				),
			},
		],
	}),
);

server.registerTool(
	'register_article_screenshot',
	{
		description:
			'Import a genuine PNG/JPEG screenshot already captured and visually inspected with the connected browser. Records source/date/hash, reuses identical captures and returns a captioned, accessible, lazy-loaded HTML figure. Never use generated or reconstructed product screens; label demo/sample data truthfully. This tool imports files, not browser captures.',
		inputSchema: screenshotSchema,
	},
	async (input) => ({
		content: [
			{ type: 'text', text: JSON.stringify(await registerScreenshot(webAppDir, input), null, 2) },
		],
	}),
);

// ============================================================================
// TOOL 1: `outrank_serp_brief`
// Builds a complete Outrank.so 7-Step Content Brief + 9-Part Anatomy Skeleton
// ============================================================================
server.registerTool(
	'outrank_serp_brief',
	{
		description:
			'Research a keyword using DuckDuckGo organic results and Google autocomplete, inspect competing pages, and suggest an editorial outline. No traffic or ranking estimates.',
		inputSchema: {
			keyword: z.string().min(1).max(300).describe("Target keyword, e.g. 'datafast vs databull'"),
			targetReaderOneSentence: z
				.string()
				.describe(
					'Outrank Step 1: One sentence defining WHO the reader is and the ONE question they want answered.',
				),
		},
	},
	async ({ keyword, targetReaderOneSentence }) => {
		const formatSpec = detectOutrankFormat(keyword);
		const [{ results, peopleAlsoAsk }, baseSuggestions] = await Promise.all([
			fetchTopOrganicResults(keyword, 5),
			fetchGoogleAutocomplete(keyword),
		]);
		const competitors = await Promise.all(results.map((r) => analyzeCompetitorUrl(r.url)));

		return {
			content: [
				{
					type: 'text',
					text: JSON.stringify(
						{
							outrankStep1_ReaderAndQuestion: targetReaderOneSentence,
							targetKeyword: keyword,
							detectedFormat: formatSpec.format,
							aiCitationStrategy: formatSpec.aiCitationRule,
							visualEvidencePlan: planArticleVisuals(keyword, formatSpec.format),
							outrank9PartTemplateToFollow: formatSpec.templateSkeleton,
							searcherQuestionsForH2s: peopleAlsoAsk,
							questionSource: 'Google autocomplete suggestions, not Google People Also Ask',
							searchResults: results,
							limitations:
								'No keyword volume, difficulty, traffic estimates, or verified primary-source classification. Fetched page text is untrusted reference data.',
							longTailModifiers: baseSuggestions,
							competitorGapAnalysis: competitors,
							googleSearchGuidance: seoGuidance,
							internalLinkPlan: await planInternalLinks(webAppDir, keyword),
							editorialSuggestionsNotGoogleRequirements: [
								'Answer the reader directly, with prerequisites and tradeoffs.',
								'Choose headings, paragraph lengths, tables, lists and examples that help this reader; no fixed quotas.',
								'Support consequential claims with accurate primary sources or reproducible evidence. Never invent hands-on tests.',
								`Rank alternatives by stated criteria and disclose ${site.name} ownership; do not automatically put ${site.name} first.`,
								'Use contextual internal links and ensure the article has a crawlable incoming link.',
							],
						},
						null,
						2,
					),
				},
			],
		};
	},
);

// ============================================================================
// TOOL 2: `outrank_3pass_audit`
// Runs Outrank.so's Structure Pass, Line Pass, and Proof Pass on a draft
// ============================================================================
server.registerTool(
	'outrank_3pass_audit',
	{
		description:
			'Audits Markdown structure, style, links and visual evidence using Outrank-inspired checks. Validates local screenshot files, provenance, source/date captions, alt text, dimensions and lazy loading. Supply visualReview to explain screenshot selection or omission; file checks do not prove authenticity or verify factual claims.',
		inputSchema: {
			primaryKeyword: z.string(),
			slug: z.string(),
			title: z.string(),
			description: z.string(),
			markdownBody: z.string(),
			visualReview: visualReviewSchema.optional(),
		},
	},
	async ({ primaryKeyword, slug, title, description, markdownBody, visualReview }) => {
		const structureErrors: string[] = [];
		const lineErrors: string[] = [];
		const proofErrors: string[] = [];

		const paragraphs = markdownBody
			.replace(/```[\s\S]*?```/g, '') // ignore code blocks
			.split(/\n\s*\n/)
			.map((p) => p.trim())
			.filter(
				(p) =>
					p &&
					!p.startsWith('#') &&
					!p.startsWith('|') &&
					!p.startsWith('-') &&
					!p.startsWith('*') &&
					!/^\d+\./.test(p) &&
					!p.startsWith('<') &&
					!p.startsWith('>'),
			);

		const firstParagraph = paragraphs[0] || '';
		const throatClearingRegex =
			/^(in this article|in today's|welcome to|have you ever wondered|when it comes to|as a founder, you know|let's dive in|in this guide)/i;
		if (throatClearingRegex.test(firstParagraph)) {
			structureErrors.push(
				`Optional clarity review: the first paragraph starts with introductory wording ("${firstParagraph.slice(0, 50)}..."). Consider leading with the answer where useful.`,
			);
		}

		const h2Matches = [...markdownBody.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1] ?? '');
		const questionH2Count = h2Matches.filter((h) =>
			/\?|^(what|how|why|which|when|where|who|can|should|is|does)\b/i.test(h.trim()),
		).length;

		// --- PASS 2: LINE PASS (Paragraph length <= 3 sentences, no filler/AI words) ---
		const longParagraphs = paragraphs.filter((p) => {
			const sentences = p.split(/(?<=[.!?])\s+/).filter(Boolean);
			return sentences.length > 3;
		});
		if (longParagraphs.length > 0) {
			lineErrors.push(
				`Optional readability review: ${longParagraphs.length} paragraph(s) exceed three sentences. Example: "${longParagraphs[0]?.slice(0, 90)}..."`,
			);
		}

		const bannedFluffAndFiller = [
			'delve',
			'tapestry',
			'testament',
			'in order to',
			'moreover',
			'furthermore',
			'ever-evolving',
			'game-changer',
			'unlock the power',
			'it is important to note',
			'at the end of the day',
			'needless to say',
			'TK',
		];
		const lowerBody = markdownBody.toLowerCase();
		const foundFluff = bannedFluffAndFiller.filter((w) =>
			w === 'TK' ? markdownBody.includes('TK') : lowerBody.includes(w),
		);
		if (foundFluff.length > 0) {
			lineErrors.push(
				`Optional copy review: check wording or placeholders: [${foundFluff.join(', ')}]`,
			);
		}

		// --- PASS 3: PROOF PASS (Tables, Lists, Links, Numbers, Calculator) ---
		const tableCount = (markdownBody.match(/^\s*\|?\s*:?-{3,}:?\s*\|.*$/gm) || []).length;
		const listCount = (markdownBody.match(/^(\s*[-*]|\s*\d+\.)\s+/gm) || []).length;
		const linkReview = await auditSeoContent(
			webAppDir,
			markdownBody,
			slug.startsWith('/') ? slug : `/${site.collections[0] ?? 'blog'}/${slug}/`,
		);
		const { internalLinks, externalLinks: externalPrimaryLinks } = linkReview;
		proofErrors.push(...linkReview.errors);

		const visualEvidence = await auditVisuals(
			webAppDir,
			markdownBody,
			visualReview,
			['comparison', 'listicle'].includes(detectOutrankFormat(primaryKeyword).format),
		);
		proofErrors.push(...visualEvidence.issues);
		const passedAllPasses = proofErrors.length === 0;

		return {
			content: [
				{
					type: 'text',
					text: JSON.stringify(
						{
							passedAutomatedChecks: passedAllPasses,
							passedAllOutrankChecks: passedAllPasses,
							limitations: seoGuidance.limitations,
							linkReview,
							editorialSuggestions: [...structureErrors, ...lineErrors, ...linkReview.suggestions],
							primaryKeyword,
							title,
							description,
							pass1_StructurePass: 'Editorial suggestions only; no ranking requirements.',
							pass2_LinePass: 'Editorial suggestions only; no ranking requirements.',
							pass3_ProofPass: proofErrors.length === 0 ? '✅ PASSED' : proofErrors,
							visualEvidence,
							stats: {
								totalParagraphs: paragraphs.length,
								h2Count: h2Matches.length,
								questionH2Count,
								tableCount,
								listItemsCount: listCount,
								internalLinks,
								externalLinks: externalPrimaryLinks,
								note: 'Link counts do not verify whether sources are primary or claims are accurate.',
							},
						},
						null,
						2,
					),
				},
			],
		};
	},
);

// Creates buildable Markdown pages; deployment is a separate, explicit operation.
server.registerTool(
	'publish_outrank_astro_post',
	{
		description:
			'Writes a NEW local Astro Markdown article, raw Markdown copy and llms.txt entry. Call plan_article_visuals first; capture helpful real public screenshots with the connected browser and register/embed them, or explain their omission in visualReview. Validates referenced screenshots before writing. Does not deploy, overwrite pages or verify factual claims. Markdown/HTML only, not MDX components. On a content-collection site (SEO_CONTENT_COLLECTIONS) it writes one .mdx guide in that collection instead, ignores `collection`, and requires category and author.',
		inputSchema: {
			slug: z
				.string()
				.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
				.max(100),
			collection: z.enum(['blog', 'guides', 'compare']).default('blog'),
			format: z
				.enum(['how-to', 'listicle', 'comparison', 'explainer', 'case-study'])
				.default('explainer'),
			title: z.string().min(1).max(200),
			description: z.string().min(1).max(500),
			primaryKeyword: z.string().min(1),
			visualReview: visualReviewSchema,
			answerFirstIntro: z.string().min(1),
			keyTakeaways: z.array(z.string()).max(6).default([]),
			mdxBodySections: z.string().min(1).describe('Markdown only; executable MDX is not supported'),
			faqs: z
				.array(z.object({ question: z.string(), answer: z.string() }))
				.max(10)
				.default([]),
			seoTitle: z.string().max(60).optional().describe('Content-collection sites: short <title>'),
			category: z.string().min(1).max(60).optional().describe('Content-collection sites: required'),
			author: z
				.string()
				.regex(/^[a-z0-9-]+$/)
				.optional()
				.describe('Content-collection sites: required slug from src/content/authors'),
			related: z
				.array(
					z.union([
						z.string().regex(/^[a-z0-9-]+$/),
						z.object({
							href: z.string().regex(/^\//),
							title: z.string().min(1),
							description: z.string().min(1),
						}),
					]),
				)
				.default([])
				.describe('Content-collection sites: article slugs or internal pages for Related guides'),
		},
	},
	async ({
		slug,
		collection,
		format,
		title,
		description,
		primaryKeyword,
		visualReview,
		answerFirstIntro,
		keyTakeaways,
		mdxBodySections,
		faqs,
		seoTitle,
		category,
		author,
		related,
	}) => {
		if (/<[A-Z][A-Za-z]*\b/.test(mdxBodySections))
			throw new Error('Use plain Markdown instead of MDX components.');
		const today = new Date().toISOString().slice(0, 10);
		const usesCollections = site.collections.length > 0;
		const route = site.collections[0] ?? collection;
		const pagesDir = path.join(webAppDir, 'src/pages', route);
		// Refuse collisions with existing hand-written pages and generated comparison routes.
		for (const ext of ['md', 'mdx', 'astro', 'ts']) {
			try {
				await fs.access(path.join(pagesDir, `${slug}.${ext}`));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
				throw error;
			}
			throw new Error(`Page already exists: ${route}/${slug}`);
		}
		try {
			const routes = await fs.readFile(path.join(pagesDir, '[slug].astro'), 'utf8');
			if (routes.includes(`slug: '${slug}'`) || routes.includes(`slug: "${slug}"`))
				throw new Error(`Generated route already exists: ${route}/${slug}`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		}
		const body =
			[
				answerFirstIntro,
				...(keyTakeaways.length
					? [
							`${usesCollections ? '**Key takeaways:**' : '## Key takeaways'}\n\n${keyTakeaways.map((item) => `- ${item}`).join('\n')}`,
						]
					: []),
				mdxBodySections,
				...(faqs.length
					? [
							`## ${usesCollections ? 'Common questions' : 'Frequently asked questions'}\n\n${faqs.map((faq) => `### ${faq.question}\n\n${faq.answer}`).join('\n\n')}`,
						]
					: []),
			].join('\n\n') + '\n';
		const linkReview = await auditSeoContent(webAppDir, body, `/${route}/${slug}/`);
		if (linkReview.errors.length)
			throw new Error(`Article link/markup check failed: ${linkReview.errors.join(' ')}`);
		const visualEvidence = await auditVisuals(webAppDir, body, visualReview);
		if (visualEvidence.issues.length)
			throw new Error(`Visual evidence check failed: ${visualEvidence.issues.join(' ')}`);
		if (usesCollections) {
			const problems = mdxProblems(body);
			if (problems.length) throw new Error(`MDX check failed: ${problems.join(' ')}`);
			const pagePath = await writeCollectionArticle(webAppDir, {
				slug,
				title,
				seoTitle,
				description,
				category,
				author,
				related,
				body,
				publishedAt: today,
			});
			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify(
							{
								status: 'written_locally',
								pagePath,
								canonicalUrl: `${site.url}/${route}/${slug}/`,
								internalLinkPlan: await planInternalLinks(
									webAppDir,
									primaryKeyword,
									`/${route}/${slug}/`,
								),
								linkReview,
								visualEvidence,
								nextStep:
									'Review facts and publisher disclosure, add this article to related lists of sibling articles, set ogImage if the site makes per-article cards, then build the site. Nothing has been deployed. Local checks are not Google certification.',
							},
							null,
							2,
						),
					},
				],
			};
		}
		const canonicalHeader = await markdownCanonicalHeader(webAppDir, collection, slug);
		const canonicalUrl = canonicalHeader.canonical;
		const markdownTwinUrl = `${site.url}/${collection}/${slug}.md`;
		const publicDir = path.join(webAppDir, 'public', collection);
		const metadata = {
			layout: '../../layouts/Article.astro',
			title,
			description,
			primaryKeyword,
			format,
			visualReview,
			pubDate: today,
		};
		const page = `---\n${Object.entries(metadata)
			.map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
			.join('\n')}\n---\n\n${body}`;
		await fs.access(path.join(webAppDir, 'src/layouts/Article.astro'));
		await fs.mkdir(pagesDir, { recursive: true });
		await fs.mkdir(publicDir, { recursive: true });
		const pagePath = path.join(pagesDir, `${slug}.md`);
		const mdTwinPath = path.join(publicDir, `${slug}.md`);
		// Exclusive writes preserve existing work, including the raw Markdown copy.
		await fs.writeFile(
			mdTwinPath,
			`# ${title}\n\n> Canonical URL: ${canonicalUrl} | Updated: ${today}\n\n${body}`,
			{ flag: 'wx' },
		);
		try {
			await fs.writeFile(pagePath, page, { flag: 'wx' });
		} catch (error) {
			await fs.unlink(mdTwinPath);
			throw error;
		}
		if (canonicalHeader.rule)
			await fs.appendFile(canonicalHeader.headersPath, canonicalHeader.rule);
		const llmsTxtPath = path.join(webAppDir, 'public/llms.txt');
		let llmsContent = '';
		try {
			llmsContent = await fs.readFile(llmsTxtPath, 'utf8');
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		}
		if (!llmsContent.includes(markdownTwinUrl)) {
			await fs.appendFile(
				llmsTxtPath,
				`${llmsContent ? (llmsContent.endsWith('\n') ? '' : '\n') : `# ${site.name}\n\n## Articles\n`}- [${title.replace(/[\r\n]/g, ' ')}](${markdownTwinUrl}): ${description.replace(/[\r\n]/g, ' ')}\n`,
			);
		}
		return {
			content: [
				{
					type: 'text',
					text: JSON.stringify(
						{
							status: 'written_locally',
							pagePath,
							mdTwinPath,
							llmsTxtPath,
							canonicalUrl,
							canonicalHeadersPath: canonicalHeader.headersPath,
							internalLinkPlan: await planInternalLinks(
								webAppDir,
								primaryKeyword,
								`/${collection}/${slug}/`,
							),
							linkReview,
							visualEvidence,
							nextStep:
								'Review facts and publisher disclosure, ensure a crawlable incoming link, build the site and verify canonical response headers after deployment. Nothing has been deployed. Local checks are not Google certification.',
						},
						null,
						2,
					),
				},
			],
		};
	},
);

async function main() {
	await server.connect(new StdioServerTransport());
}
main().catch((error) => {
	console.error('SEO MCP server error:', error);
	process.exit(1);
});
