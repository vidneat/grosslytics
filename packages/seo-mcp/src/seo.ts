import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as cheerio from 'cheerio';

// Which site this server writes for. Unset means Grosslytics and articles under src/pages.
export const site = {
	url: (process.env.SEO_SITE_URL ?? 'https://grosslytics.com').replace(/\/$/, ''),
	name: process.env.SEO_SITE_NAME ?? 'Grosslytics',
	// Astro content collections holding the articles; new ones go in the first.
	collections: (process.env.SEO_CONTENT_COLLECTIONS ?? '')
		.split(',')
		.map((name) => name.trim())
		.filter(Boolean),
};

const googleDocs = 'https://developers.google.com/search/docs/';
export const seoGuidance = {
	reviewedOn: '2026-11-08',
	scope:
		'Google Search guidance applicable to this English-language SaaS marketing site, comparison articles and developer guides. This is not a claim to have reviewed every specialized page in the Search documentation.',
	principles: [
		"Write original, accurate content that solves the reader's problem. Do not create many near-duplicate pages or doorway pages to manipulate rankings. Consolidate overlapping intent where appropriate.",
		'Use crawlable links with descriptive, natural anchor text, in context. There is no ideal link count or keyword density. Link each important page from another useful page or a normal browseable index; a sitemap is not a substitute for navigation.',
		'Validate internal destinations, cite external sources where they support claims, and qualify paid links with sponsored (or nofollow) and user-submitted links with ugc (or nofollow). Do not buy links or add irrelevant exact-match anchors. Ordinary citations do not need blanket nofollow.',
		'Use clear, accurate titles and descriptions without keyword stuffing or unsupported promises. Character counts, question-heading ratios, three-sentence paragraphs, code snippets, tables, FAQs and article length are not Google ranking requirements.',
		'Identify the actual publisher/author and explain methods, conflicts, evidence and limitations. Do not invent credentials, tests, customer results or human authorship. For comparisons, distinguish documented facts and observed demo UI from hands-on performance tests.',
		'Use relevant images with useful alt text, nearby explanation, readable dimensions and crawlable img src. Do not keyword-stuff alt text or add screenshot quotas. Lazy-load below-the-fold images; prioritize a visible lead image when appropriate. Screenshots do not prove human authorship or rank improvements.',
		'Keep indexable pages accessible with successful responses and useful rendered text. Preserve intended robots/noindex restrictions on private, self-hosted or staging pages. Do not block an image or resource needed for rendering, and do not use robots.txt as a privacy control.',
		'Keep canonical annotations, sitemaps and internal links consistent with the preferred URL. A plain-text canonical label is not a canonical directive. Use an HTTP Link rel=canonical header for a non-HTML duplicate such as a Markdown copy, and verify headers on the deployed host.',
		'Structured data must describe visible, accurate content, including genuine authors and publication/modification dates. Do not fabricate ratings or dates or promise rich results. Add supported schema only where relevant, not FAQ markup as a ranking tactic.',
		'AI-assisted work still requires fact checking, original value and appropriate process disclosure. Do not disguise AI output as first-hand human testing. Google AI features use foundational SEO; no special AI text files, magic schemas or citation percentages are required.',
		'Keep pages usable, responsive and fast. Validate a production build, image loading, links, canonical/indexability and actual response headers. Use Search Console and appropriate performance/rich-result tools to assess live behavior; do not guarantee indexing, rankings or a risk-free outcome.',
	],
	sources: [
		['Search Essentials', 'essentials'],
		['Technical requirements', 'essentials/technical'],
		['Spam policies', 'essentials/spam-policies'],
		['SEO starter guide', 'fundamentals/seo-starter-guide'],
		['People-first content', 'fundamentals/creating-helpful-content'],
		['AI-generated content', 'fundamentals/using-gen-ai-content'],
		['Third-party SEO advice', 'fundamentals/third-party-seo'],
		['Google AI optimization', 'fundamentals/ai-optimization-guide'],
		['Internal and external links', 'crawling-indexing/links-crawlable'],
		['Review evidence', 'specialty/ecommerce/write-high-quality-reviews'],
		['Canonical URLs', 'crawling-indexing/consolidate-duplicate-urls'],
		['Robots directives', 'crawling-indexing/robots-meta-tag'],
		['Robots.txt', 'crawling-indexing/robots/intro'],
		['Sitemaps', 'crawling-indexing/sitemaps/build-sitemap'],
		['Titles', 'appearance/title-link'],
		['Descriptions', 'appearance/snippet'],
		['Image SEO', 'appearance/google-images'],
		['Lazy loading', 'crawling-indexing/javascript/lazy-loading'],
		['JavaScript SEO', 'crawling-indexing/javascript/javascript-seo-basics'],
		['Structured-data policies', 'appearance/structured-data/sd-policies'],
		['Article markup', 'appearance/structured-data/article'],
		['Page experience', 'appearance/page-experience'],
		['Search Console', 'monitor-debug/search-console-start'],
		['AI feature eligibility', 'appearance/ai-features'],
	].map(([title, route]) => ({ title, url: googleDocs + route })),
	limitations:
		'MCP checks are local diagnostics and editorial assistance, not Google approval, a factual/spam-policy certification or a ranking prediction. Recheck official guidance before consequential changes and report anything not verified.',
};

export async function articleInventory(webDir: string) {
	const pages: Array<{ url: string; title: string; description: string; primaryKeyword: string }> =
		[];
	const usesCollections = site.collections.length > 0;
	for (const collection of usesCollections ? site.collections : ['blog', 'guides', 'compare']) {
		const directory = path.join(webDir, usesCollections ? 'src/content' : 'src/pages', collection);
		const files = await fs.readdir(directory).catch((error: NodeJS.ErrnoException) => {
			if (error.code === 'ENOENT') return [];
			throw error;
		});
		for (const file of files.filter((file) => /^[a-z0-9-]+\.mdx?$/.test(file))) {
			const content = await fs.readFile(path.join(directory, file), 'utf8');
			const field = (name: string) => {
				const value = content.match(new RegExp(`^${name}: (.+)$`, 'm'))?.[1];
				if (!value) return '';
				try {
					return String(JSON.parse(value));
				} catch {
					return value.replace(/^['"]|['"]$/g, '');
				}
			};
			pages.push({
				url: `/${collection}/${file.replace(/\.mdx?$/, '')}/`,
				title: field('title'),
				description: field('description'),
				primaryKeyword: field('primaryKeyword'),
			});
		}
	}
	return pages;
}

export async function planInternalLinks(webDir: string, keyword: string, articlePath?: string) {
	const terms = new Set(keyword.toLowerCase().match(/[a-z0-9]+/g) ?? []);
	const pages = (await articleInventory(webDir)).filter(
		(p) => p.url.replace(/\/$/, '') !== articlePath?.replace(/\/$/, ''),
	);
	const ranked = pages
		.map((page) => ({
			...page,
			matchedTerms: [...terms].filter(
				(term) =>
					term.length > 2 && `${page.title} ${page.primaryKeyword}`.toLowerCase().includes(term),
			),
		}))
		.filter((page) => page.matchedTerms.length > 0)
		.sort((a, b) => b.matchedTerms.length - a.matchedTerms.length)
		.slice(0, 8);
	return {
		candidates: ranked,
		note: 'These are lexical suggestions from existing local articles, not a required count, SEO score or automatic relevance decision. Choose only links useful in context; the suggested natural anchor is the actual page title.',
		incomingLinkAction:
			'Ensure another relevant page or a browseable collection index links to the new article. Do not automatically insert reciprocal links or repeat exact-match keywords.',
		source: `${googleDocs}crawling-indexing/links-crawlable`,
	};
}

export function contentLinks(markdown: string) {
	const body = markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]+`/g, '');
	const $ = cheerio.load(body);
	const links = $('a[href]')
		.toArray()
		.map((el) => ({
			href: $(el).attr('href') ?? '',
			anchor:
				$(el).text().trim() || $(el).find('img').attr('alt') || $(el).attr('aria-label') || '',
		}));
	for (const match of body.matchAll(/(?<!!)\[([^\]]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g))
		links.push({ href: match[2] ?? '', anchor: match[1] ?? '' });
	return { links, $ };
}

async function destination(webDir: string, pathname: string) {
	const relative = pathname.replace(/^\/+|\/+$/g, '');
	const publicFile = path.join(webDir, 'public', relative);
	const page = path.join(webDir, 'src/pages', relative);
	const options = [
		publicFile,
		...['.md', '.astro', '.mdx', '.ts'].map((ext) => `${page}${ext}`),
		...['index.md', 'index.astro'].map((file) => path.join(page, file)),
		path.join(webDir, 'dist', relative, 'index.html'),
	];
	for (const file of options) {
		const stat = await fs.stat(file).catch((error: NodeJS.ErrnoException) => {
			if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
			throw error;
		});
		if (stat?.isFile()) return file;
	}
	const segments = relative.split('/');
	// A catch-all route would accept any slug, so check the collection entry itself.
	if (segments.length === 2 && site.collections.includes(segments[0] ?? '')) {
		for (const ext of ['md', 'mdx']) {
			const entry = path.join(webDir, 'src/content', `${relative}.${ext}`);
			if (await fs.stat(entry).catch(() => null)) return entry;
		}
		return null;
	}
	for (let depth = segments.length - 1; depth >= 0; depth--) {
		const directory = path.join(webDir, 'src/pages', ...segments.slice(0, depth));
		const files = await fs.readdir(directory).catch((error: NodeJS.ErrnoException) => {
			if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
			throw error;
		});
		const dynamic = files.find((file) =>
			depth === segments.length - 1
				? /^\[.+\]\.astro$/.test(file)
				: /^\[\.\.\..+\]\.astro$/.test(file),
		);
		if (dynamic) return `dynamic:${path.join(directory, dynamic)}`;
	}
	return null;
}

export async function auditSeoContent(webDir: string, markdown: string, articlePath = '/') {
	const errors: string[] = [],
		suggestions: string[] = [];
	const { links, $ } = contentLinks(markdown);
	let internalLinks = 0,
		externalLinks = 0;
	for (const link of links) {
		let url: URL;
		try {
			url = new URL(link.href, `${site.url}${articlePath}`);
		} catch {
			errors.push(`Invalid link URL: ${link.href}`);
			continue;
		}
		if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) {
			errors.push(`Use a crawlable URL rather than ${url.protocol} in ${link.href}`);
			continue;
		}
		if (!link.anchor.trim() || /^(click here|read more|here)$/i.test(link.anchor.trim()))
			suggestions.push(
				`Use descriptive anchor text where context does not explain this link: ${link.href}`,
			);
		if (url.origin !== site.url) {
			if (/^https?:$/.test(url.protocol)) externalLinks++;
			continue;
		}
		internalLinks++;
		if (url.pathname.replace(/\/$/, '') === articlePath.replace(/\/$/, '')) continue;
		let pathname: string;
		try {
			pathname = decodeURIComponent(url.pathname);
		} catch {
			errors.push(`Invalid internal URL encoding: ${link.href}`);
			continue;
		}
		if (pathname.includes('..') || pathname.includes('\\') || pathname.includes('\0')) {
			errors.push(`Invalid internal path: ${link.href}`);
			continue;
		}
		const resolved = await destination(webDir, pathname);
		if (!resolved) errors.push(`Internal link has no local page or asset: ${link.href}`);
		else if (resolved.startsWith('dynamic:'))
			suggestions.push(`Verify dynamic route and HTTP response manually: ${link.href}`);
	}
	if ($('script, meta[http-equiv], link[rel="canonical"], meta[name="robots"]').length)
		errors.push(
			'Keep scripts, redirect/indexing directives and canonical markup out of article bodies; manage them in the trusted site layout.',
		);
	return {
		errors: [...new Set(errors)],
		suggestions: [...new Set(suggestions)],
		internalLinks,
		externalLinks,
		limitations:
			'Only direct Markdown/HTML links and local destinations are checked. External availability, fragment IDs, dynamic routes, robots/CDN behavior, content truth and Google policy eligibility require separate review.',
	};
}

export async function markdownCanonicalHeader(webDir: string, collection: string, slug: string) {
	const headersPath = path.join(webDir, 'public/_headers');
	const route = `/${collection}/${slug}.md`;
	const canonical = `${site.url}/${collection}/${slug}/`;
	const rule = `${route}\n  Link: <${canonical}>; rel="canonical"\n`;
	const existing = await fs.readFile(headersPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
		if (error.code === 'ENOENT') return '';
		throw error;
	});
	if (existing.split('\n').includes(route)) {
		if (!existing.includes(rule))
			throw new Error(`Review conflicting canonical header rule for ${route}`);
		return { headersPath, rule: '', canonical };
	}
	return {
		headersPath,
		rule: `${existing.endsWith('\n') || !existing ? '' : '\n'}${rule}`,
		canonical,
	};
}

// In an .mdx file these either run as code at build time or stop the build.
export function mdxProblems(body: string) {
	const prose = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
	const problems: string[] = [];
	if (/^(import|export)\s/m.test(prose))
		problems.push('Remove import/export lines; add site components by editing the file afterwards.');
	if (/[{}]/.test(prose)) problems.push('Put { and } inside code formatting.');
	if (/<(?![a-zA-Z/])|<https?:/.test(prose))
		problems.push('Write a literal < as &lt;, use [text](url) links and no HTML comments.');
	return problems;
}

type RelatedLink = string | { href: string; title: string; description: string };

export async function writeCollectionArticle(
	webDir: string,
	article: {
		slug: string;
		title: string;
		seoTitle?: string;
		description: string;
		category?: string;
		author?: string;
		related: RelatedLink[];
		body: string;
		publishedAt: string;
	},
) {
	const collection = site.collections[0] ?? '';
	const directory = path.join(webDir, 'src/content', collection);
	if (!article.category) throw new Error('category is required for this site.');
	const authors = (await fs.readdir(path.join(webDir, 'src/content/authors'))).map((file) =>
		file.replace(/\.json$/, ''),
	);
	if (!article.author || !authors.includes(article.author))
		throw new Error(`author must be one of: ${authors.join(', ')}.`);
	const exists = (slug: string) =>
		Promise.all(
			['md', 'mdx'].map((ext) =>
				fs.stat(path.join(directory, `${slug}.${ext}`)).catch(() => null),
			),
		).then((found) => found.some(Boolean));
	if (await exists(article.slug)) throw new Error(`Page already exists: ${collection}/${article.slug}`);
	for (const item of article.related)
		if (typeof item === 'string' && !(await exists(item)))
			throw new Error(`Related article does not exist: ${item}`);
	const words = article.body.split(/\s+/).filter(Boolean).length;
	const metadata = {
		title: article.title,
		...(article.seoTitle ? { seoTitle: article.seoTitle } : {}),
		description: article.description,
		category: article.category,
		readTime: `${Math.max(1, Math.round(words / 275))} min read`,
		publishedAt: article.publishedAt,
		author: article.author,
		related: article.related,
	};
	const pagePath = path.join(directory, `${article.slug}.mdx`);
	await fs.writeFile(
		pagePath,
		`---\n${Object.entries(metadata)
			.map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
			.join('\n')}\n---\n\n${article.body}`,
		{ flag: 'wx' },
	);
	return pagePath;
}
