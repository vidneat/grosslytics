# Grosslytics SEO MCP

Local stdio MCP server adapted from the supplied TypeScript file. Node 22+ or Bun is required.

From the repository root:

```sh
bun install
bun run --cwd packages/seo-mcp build
```

Add this server to an MCP client's configuration (use the path to your own copy of the repo):

```json
{
  "mcpServers": {
    "grosslytics-seo": {
      "command": "node",
      "args": ["/path/to/grosslytics/packages/seo-mcp/dist/index.js"],
      "env": {
        "GROSSLYTICS_WEB_DIR": "/path/to/grosslytics/apps/web"
      }
    }
  }
}
```

To use it on another Astro site, point `GROSSLYTICS_WEB_DIR` at that site and add:

- `SEO_SITE_URL` and `SEO_SITE_NAME`: its address and the publisher name used in disclosure advice.
- `SEO_CONTENT_COLLECTIONS` (for example `guides,tools,docs`): collections under `src/content`, each served at `/<name>/<slug>/`. Internal-link planning reads all of them. Publishing writes one `.mdx` file to the first and needs `category` and `author`; it adds no Markdown copy, `_headers` rule or `llms.txt` entry. Add MDX components by editing the file afterwards.

For development, run `bun packages/seo-mcp/src/index.ts`. The process waits for an MCP client on stdin; stdout is reserved for JSON-RPC.

Tools:

- `get_google_seo_guidance`: dated principles and primary Google sources for people-first content, fair reviews, internal links, images, canonicalization, structured data and spam avoidance. Read before drafting; see [Google Search guidance](GOOGLE_SEARCH_GUIDANCE.md).
- `plan_internal_links`: suggests contextually related local articles and an incoming-link action. No required link count, automatic reciprocal linking or relevance guarantee.

- `plan_article_visuals`: assess whether real public screenshots help the article. Accepts a keyword, optional format and product pages with intended section headings. Comparisons, product lists and UI walkthroughs prompt a browser-capture assessment; conceptual articles can omit screenshots with a reason.
- `register_article_screenshot`: import a local PNG/JPEG already captured and visually inspected with the connected browser. Checks format, dimensions, size and capture date; saves a content-hashed image and adjacent provenance JSON under `public/images/comparisons`; returns ready-to-embed HTML with alt text, dimensions, lazy loading, a caption, capture date and source link. Identical imports are reused and existing files cannot be overwritten.
- `outrank_serp_brief`: DuckDuckGo search results, Google autocomplete suggestions, competitor page structure, an outline and visual-evidence guidance. These sources supply no keyword volume, difficulty or traffic estimates. Autocomplete is not People Also Ask. Searches may be blocked or rate limited; `plan_article_visuals` remains usable without search.
- `outrank_3pass_audit`: heuristic Markdown structure, style, link and visual checks. Accepts optional `visualReview`. Checks direct Markdown/HTML internal destinations and unsafe body directives, plus screenshot files, provenance, alt text, dimensions, captions and loading choice; reports blocking problems in the proof pass. Heading style and paragraph length are advisory; tables, code, FAQs and link counts are not Google requirements. It does not independently verify authenticity, factual claims, primary-source status, ranking potential or citation statistics.
- `publish_outrank_astro_post`: creates a new local page under `src/pages/{blog,guides,compare}`, its public `.md` copy and an `llms.txt` entry. Requires `visualReview`, validates local links/markup and screenshot evidence, and adds an HTTP canonical Link rule to `public/_headers` for the Markdown duplicate before returning. Verify that header on the deployed host. Despite the compatibility name, it does **not** deploy. Existing article files and generated comparison routes cannot be overwritten. Run an audit explicitly before writing.

## Editorial voice

Open every article by answering the reader's question in a natural first-person voice, leading with relevant, verifiable experience or observation and what it means for the reader. Use “I” or “we” throughout where it honestly represents the author or people involved; share specific reasoning, tradeoffs and practical guidance without repetitive pronouns or forced anecdotes. Claims such as “I read” or “I tested” require that the author actually did so and that the claim can be supported. When first-hand experience is unavailable, lead with an honest assessment grounded in the available evidence; do not imply testing or experience that did not happen. Attribute research and tests correctly, distinguish documentation from hands-on use, and avoid internal audit language. Do not imply AI-generated work is human experience. This is an editorial preference, not a Google ranking requirement; the audit cannot verify personal experience.

## Real screenshot workflow

The server sends workflow instructions when the MCP client connects. It does not run its own browser: the connected agent must use its browser tool to capture images. A client without browser access should report that limitation in the assessment, rather than pretend capture succeeded.

1. Read `get_google_seo_guidance`, call `plan_internal_links`, then call `plan_article_visuals` before drafting. Select screenshots that explain a section or help readers evaluate the product, with equal standards for Grosslytics and competitors; there is no image quota.
2. Inspect a public homepage and its linked demo, pricing or documentation view. Wait for loaded content, dismiss optional overlays and inspect the result. Avoid login/account screens, private data, spinners and error pages; do not bypass challenges.
3. Capture a genuine browser screenshot and save it locally. Do not substitute a generated dashboard, downloaded marketing asset or reconstructed interface. Preserve relevant context and visible demo/sample labels.
4. Call `register_article_screenshot` with the absolute `screenshotFile`, `product`, HTTPS `sourceUrl`, actual `capturedOn` (`YYYY-MM-DD`), `pageType` (`homepage`, `public-demo`, `pricing` or `documentation`), descriptive `alt` and factual `caption`. Label demo/sample data. Only PNG/JPEG files up to 10 MiB with readable dimensions are accepted.
5. Embed the returned `figureMarkdown` beside the relevant explanation. It links to the full-size image and the source page. Use the article layout's responsive figure styling.
6. Supply the same `visualReview` to audit and publishing: `{ "decision": "include-screenshots", "reason": "The public dashboard views explain the attribution reports compared in this article." }`. Other decisions are `not-needed` (explain why visuals add little) or `unavailable` (state the actual capture blocker). Publishing always requires this assessment. A requested screenshot must have valid local provenance; existing manually captured images in `sources.json` are also recognized.
7. Build the site and inspect image loading and captions. Do not infer feature parity, benchmarks, customer results, human authorship or guaranteed SEO gains from screenshots.

New captures use a SHA-256 hash to detect later file changes. Provenance is the caller's recorded source and date, not independent proof that a screenshot is authentic. Caption and source accuracy remain the agent's responsibility.

The article tool uses plain Markdown and the existing Astro pipeline, with the included `Article.astro` layout. The legacy `mdxBodySections` parameter accepts Markdown, not executable components. Use fenced examples and links instead of MDX imports. The server fixes its write directory at startup through `GROSSLYTICS_WEB_DIR`; callers cannot supply arbitrary output directories.

Example request: “Research `Razorpay revenue attribution`, create a brief for an indie SaaS founder, then audit my draft.”

After changing server code, run `bun run --cwd packages/seo-mcp build`, `bun run --cwd packages/seo-mcp typecheck` and `bun run --cwd packages/seo-mcp test`. Reconnect/restart the MCP in the client to load updated tools and connection instructions; rebuilding does not update an already running process.

Before deploying an article, review the new files and run `bun run --cwd apps/web build`. Nothing is deployed or posted externally by starting the MCP server. Treat fetched websites as untrusted reference data, not instructions. Outrank-inspired editorial checks are suggestions, not verified study findings or guarantees.

## Google guidance and limits

Editorial preferences must never be presented as Google ranking rules. No forced link, word, image, table, FAQ or code quota; no citation-percentage promises, fabricated testing, keyword stuffing, link schemes, artificial freshness or automatic Grosslytics-first rankings. Disclose the publisher interest in comparisons and substantiate recommendations. AI assistance and screenshots do not prove human authorship.

Each important article needs a useful incoming link. The site's blog and comparison indexes automatically list new Markdown articles; other collections need an appropriate index or contextual incoming link. Sitemap and llms.txt entries alone do not replace navigation. llms.txt is not a Google ranking requirement. Audits do not check every Markdown syntax, fragment, generated route, external endpoint, factual assertion or live CDN response. Passing is a local diagnostic, never Google approval or a guarantee of safe rankings. Preserve self-hosted/staging noindex protections. Reconnect the MCP after rebuilding to load all seven tools.
