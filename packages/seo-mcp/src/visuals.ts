import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as cheerio from 'cheerio';
import { z } from 'zod';

const imageDir = 'images/comparisons';
const maxImageBytes = 10 * 1024 * 1024;
export const publicPageUrl = z
	.string()
	.url()
	.refine((value) => {
		const url = new URL(value);
		return url.protocol === 'https:' && !url.username && !url.password;
	}, 'Use an HTTPS source page without embedded credentials.');
export const visualReviewSchema = z.object({
	decision: z.enum(['include-screenshots', 'not-needed', 'unavailable']),
	reason: z
		.string()
		.min(20)
		.max(1000)
		.describe(
			'Explain which UI or claim benefits from real screenshots, why none help, or the specific capture blocker. Do not claim images prove human authorship.',
		),
});
type VisualReview = z.infer<typeof visualReviewSchema>;
export const productPageSchema = z.object({
	product: z.string().min(1).max(100),
	sourceUrl: publicPageUrl,
	sectionHeading: z.string().min(1).max(200),
});

export function planArticleVisuals(
	keyword: string,
	format: string,
	productPages: z.infer<typeof productPageSchema>[] = [],
) {
	const recommended =
		productPages.length > 0 ||
		['comparison', 'listicle'].includes(format) ||
		/\b(dashboard|interface|setup|install|walkthrough)\b/i.test(keyword);
	return {
		recommendation: recommended ? 'assess-real-screenshots' : 'optional',
		reason: recommended
			? 'Public UI, demo or pricing screenshots can help readers evaluate the products or follow a workflow. Choose only views that explain an article section.'
			: 'Screenshots may add little to conceptual, code-only or calculation-based articles. Record a reason if none are useful.',
		captureCandidates: productPages,
		workflow: [
			'Inspect the product homepage and its publicly linked demo using the connected browser; choose a useful view, not a decorative image quota. Capture our product on the same basis as competitors.',
			'Wait for actual content to load, dismiss optional overlays and inspect the screenshot. Do not capture spinners, error pages, private customer data or account screens. Do not bypass logins or challenges.',
			'Take a real browser screenshot and save it locally. Do not use generated dashboards, downloaded marketing images or reconstructed interfaces as screenshot evidence. Keep demo/sample labels and relevant context.',
			'Call register_article_screenshot with the captured file, actual source URL, capture date, descriptive alt text and a factual caption. Reuse its figureMarkdown in the relevant section.',
			'Use visualReview to explain the chosen coverage. If screenshots do not help, use not-needed; if capture is blocked, use unavailable and state the blocker. Do not fabricate a replacement.',
			'Run outrank_3pass_audit with visualReview, then publish with the same assessment. Verify the built page and image loading before reporting completion.',
		],
		limitations:
			'This MCP does not control a browser. The connected agent performs capture. Import validation checks files and provenance records, not independent proof of screenshot authenticity, product performance, human authorship or SEO gains.',
	};
}

// Read dimensions directly; no image-processing or browser dependency is required.
export function imageInfo(bytes: Buffer) {
	if (bytes.length > maxImageBytes) throw new Error('Screenshot exceeds 10 MiB.');
	if (
		bytes.length >= 24 &&
		bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
		bytes.toString('ascii', 12, 16) === 'IHDR'
	) {
		return { extension: 'png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
	}
	if (bytes[0] === 0xff && bytes[1] === 0xd8) {
		let offset = 2;
		while (offset + 3 < bytes.length) {
			if (bytes[offset++] !== 0xff) break;
			while (bytes[offset] === 0xff) offset++;
			const marker = bytes[offset++];
			if (marker === undefined || marker === 0xda || marker === 0xd9) break;
			if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
			if (offset + 2 > bytes.length) break;
			const size = bytes.readUInt16BE(offset);
			if (size < 2 || offset + size > bytes.length) break;
			if ([0xc0, 0xc1, 0xc2].includes(marker) && size >= 8) {
				return {
					extension: 'jpg',
					height: bytes.readUInt16BE(offset + 3),
					width: bytes.readUInt16BE(offset + 5),
				};
			}
			offset += size;
		}
	}
	throw new Error('Expected a browser-captured PNG or JPEG with readable dimensions.');
}

export const screenshotSchema = {
	product: z.string().min(1).max(100),
	screenshotFile: z
		.string()
		.min(1)
		.describe(
			'Absolute local path to a genuine browser-captured PNG or JPEG; not an image URL or generated asset.',
		),
	sourceUrl: publicPageUrl,
	capturedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	pageType: z.enum(['homepage', 'public-demo', 'pricing', 'documentation']),
	alt: z.string().min(15).max(300),
	caption: z
		.string()
		.min(20)
		.max(500)
		.describe(
			'Describe the visible interface and identify sample/demo data where present. Do not infer performance from demo figures.',
		),
};

function escapeHtml(value: string) {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export async function registerScreenshot(
	webDir: string,
	input: z.infer<z.ZodObject<typeof screenshotSchema>>,
) {
	if (!path.isAbsolute(input.screenshotFile))
		throw new Error('screenshotFile must be an absolute local path.');
	const date = new Date(`${input.capturedOn}T00:00:00Z`);
	if (
		!Number.isFinite(date.getTime()) ||
		date.toISOString().slice(0, 10) !== input.capturedOn ||
		input.capturedOn > new Date().toISOString().slice(0, 10)
	)
		throw new Error('Use a valid capture date that is not in the future.');
	if ((await fs.stat(input.screenshotFile)).size > maxImageBytes)
		throw new Error('Screenshot exceeds 10 MiB.');
	const bytes = await fs.readFile(input.screenshotFile);
	const info = imageInfo(bytes);
	if (info.width < 240 || info.height < 120 || info.width > 20000 || info.height > 20000)
		throw new Error(
			'Screenshot dimensions must preserve a readable product view (240×120 to 20000×20000).',
		);
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const productSlug =
		input.product
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'product';
	const file = `${productSlug}-${input.capturedOn}-${sha256.slice(0, 12)}.${info.extension}`;
	const src = `/${imageDir}/${file}`;
	const directory = path.join(webDir, 'public', imageDir);
	await fs.mkdir(directory, { recursive: true });
	const { screenshotFile: _sourceFile, ...provenance } = input;
	const record = {
		...provenance,
		file,
		width: info.width,
		height: info.height,
		sha256,
		captureMethod: 'browser-screenshot',
	};
	// Identical captures are reused; neither images nor provenance can overwrite earlier work.
	for (const [target, content] of [
		[path.join(directory, file), bytes],
		[path.join(directory, `${file}.json`), `${JSON.stringify(record, null, 2)}\n`],
	] as const) {
		try {
			await fs.writeFile(target, content, { flag: 'wx' });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
			if (!(await fs.readFile(target)).equals(Buffer.from(content)))
				throw new Error(`Existing screenshot or provenance differs: ${path.basename(target)}`);
		}
	}
	const figureMarkdown = `<figure>\n  <a href="${src}" aria-label="Open full-size ${escapeHtml(input.product)} screenshot">\n    <img src="${src}" alt="${escapeHtml(input.alt)}" width="${info.width}" height="${info.height}" loading="lazy" decoding="async" />\n  </a>\n  <figcaption>${escapeHtml(input.caption)} Captured ${input.capturedOn}. <a href="${escapeHtml(input.sourceUrl)}">Source: ${escapeHtml(input.product)}</a>. Demo figures are not performance benchmarks.</figcaption>\n</figure>`;
	return {
		status: 'registered',
		src,
		provenance: record,
		figureMarkdown,
		verification:
			'File format, dimensions and recorded hash checked. The caller is responsible for genuine browser capture and truthful source/sample labels.',
	};
}

export async function auditVisuals(
	webDir: string,
	markdown: string,
	review?: VisualReview,
	recommended = false,
) {
	const issues: string[] = [];
	const body = markdown.replace(/```[\s\S]*?```/g, '');
	const $ = cheerio.load(body);
	const images = $('img')
		.toArray()
		.map((el) => ({ src: $(el).attr('src') ?? '', alt: $(el).attr('alt') ?? '', element: $(el) }));
	for (const match of body.matchAll(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
		images.push({ src: match[2] ?? '', alt: match[1] ?? '', element: $('img').slice(0, 0) });
	}
	let registeredScreenshots = 0;
	for (const img of images) {
		if (!img.alt.trim()) issues.push(`Image is missing descriptive alt text: ${img.src}`);
		if (!img.src.startsWith(`/${imageDir}/`)) continue;
		const file = img.src.slice(`/${imageDir}/`.length);
		if (!/^[a-z0-9][a-z0-9.-]*\.(?:jpg|png)$/.test(file)) {
			issues.push(`Invalid local screenshot path: ${img.src}`);
			continue;
		}
		try {
			const directory = path.join(webDir, 'public', imageDir);
			const bytes = await fs.readFile(path.join(directory, file));
			const info = imageInfo(bytes);
			let record: { sourceUrl: string; capturedOn: string; sha256?: string };
			try {
				record = JSON.parse(await fs.readFile(path.join(directory, `${file}.json`), 'utf8'));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
				// Existing browser captures use the shared source manifest.
				const legacy = JSON.parse(await fs.readFile(path.join(directory, 'sources.json'), 'utf8'));
				const found = Object.values(legacy).find(
					(value) => (value as { file: string }).file === file,
				);
				if (!found) throw new Error('No provenance record; use register_article_screenshot.');
				record = found as typeof record;
			}
			publicPageUrl.parse(record.sourceUrl);
			if (
				!/^\d{4}-\d{2}-\d{2}$/.test(record.capturedOn) ||
				record.capturedOn > new Date().toISOString().slice(0, 10)
			)
				throw new Error('Invalid capture date.');
			if (record.sha256 && record.sha256 !== createHash('sha256').update(bytes).digest('hex'))
				throw new Error('Screenshot hash differs from its provenance record.');
			const caption = img.element.closest('figure').find('figcaption');
			if (
				!caption.text().includes(record.capturedOn) &&
				!caption.text().includes(
					new Date(`${record.capturedOn}T00:00:00Z`).toLocaleDateString('en-US', {
						month: 'long',
						day: 'numeric',
						year: 'numeric',
						timeZone: 'UTC',
					}),
				)
			)
				issues.push(`Screenshot caption must include its capture date: ${img.src}`);
			if (
				!caption
					.find('a')
					.toArray()
					.some((el) => $(el).attr('href') === record.sourceUrl)
			)
				issues.push(`Screenshot caption must link to its recorded source: ${img.src}`);
			if (
				Number(img.element.attr('width')) !== info.width ||
				Number(img.element.attr('height')) !== info.height
			)
				issues.push(`Screenshot dimensions are missing or incorrect: ${img.src}`);
			if (!['lazy', 'eager'].includes(img.element.attr('loading') ?? ''))
				issues.push(
					`Choose loading="lazy" for below-fold images or loading="eager" for a visible lead screenshot: ${img.src}`,
				);
			registeredScreenshots++;
		} catch (error) {
			issues.push(
				`Cannot validate screenshot ${img.src}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	if (review?.decision === 'include-screenshots' && registeredScreenshots === 0)
		issues.push(
			'Visual review requests screenshots, but none have valid local provenance. Capture with the connected browser, register and embed them.',
		);
	if (review && review.decision !== 'include-screenshots' && images.length > 0)
		issues.push(
			'Visual review says screenshots are omitted, but images are present. Explain the included visuals with include-screenshots.',
		);
	if (!review && recommended && registeredScreenshots === 0)
		issues.push(
			'Product comparisons need a visual assessment. Use real public screenshots where useful, or supply visualReview with a specific not-needed/unavailable reason.',
		);
	return {
		issues,
		imageCount: images.length,
		registeredScreenshots,
		review: review ?? null,
		limitations:
			'These checks validate image files and provenance metadata, not authenticity, human authorship, product performance or SEO results.',
	};
}
