# Grosslytics content and AI-search plan

Researched 2026-11-09. Written for the person running Grosslytics marketing.

## The short version

Do not try to win "Google Analytics alternative" first. More than 20 vendor roundups fight over it, and grosslytics.com is one day old as a content site.

Own one narrower question that few can answer well: **"Which traffic source, including AI chats, actually produced paying customers, after fees?"** Grosslytics has the payment data to answer it. Most privacy-analytics competitors do not.

Publish about one strong piece a week for 12 weeks, each with something a chatbot cannot already say: a real test, a measured number, or a calculator. Getting named on the third-party sites AI chats read matters as much as the articles.

## What this research can and cannot tell you

| Measured | Not measured |
|---|---|
| About 1,000 real Google autocomplete suggestions from about 120 seed phrases | **Monthly search volume and keyword difficulty.** No Ahrefs, Semrush or Keyword Planner access was available |
| Published page counts from 17 competitor sitemaps | Backlink counts and domain authority |
| Headings and length of ranking pages, sampled through DuckDuckGo | Actual Google rankings for these terms |
| Whether AI crawlers can fetch the live site (user-agent test) | **What ChatGPT, Claude, Gemini or Perplexity say about Grosslytics today.** They were not queried |

"Demand" below means how many real, relevant variations Google suggests. It is a signal, not a volume. Before writing a piece, check its head term in Google Keyword Planner (free) or Ahrefs' free keyword tool.

Most published AI-search numbers come from vendors selling AI-search tools, and they often contradict each other. The evidence table below marks how far each can be trusted.

## Where Grosslytics stands

- 19 indexable URLs: 5 blog posts, 5 comparison articles plus the GA4 page, and supporting pages.
- A web search for "grosslytics analytics" returned no Grosslytics pages. It returned **Growlytics** instead, so the name is being read as a misspelling. The site only got its content on 2026-11-08, so this is expected for now, but the name collision needs managing.
- GitHub shows 0 stars and 0 forks. Nothing external vouches for the product yet.
- All tested AI and search crawlers get a 200 with the full page. `robots.txt`, JSON-LD, Markdown copies and canonical headers are already in good shape, so no more technical AI work is needed there.
- The current blog targets phrases with **no autocomplete signal**: "stripe revenue attribution", "track stripe revenue", "stripe metadata utm". These are fine as high-intent pages but will not bring volume. "stripe utm tracking" and "stripe utm parameters" are the phrases people really use.
- The current comparison pages target small terms. "datafast alternative" and "databull" each return one suggestion.

## Fix these before publishing more

| # | Problem | Why it matters | Who |
|---|---|---|---|
| 1 | **grosslytics.com does not run its own tracker.** Code is ready (2026-11-09) but needs deploying with `PUBLIC_OWN_SITE_ID` | No way to see what the content brings, and the best proof asset is missing | You: add the site on `/app`, then deploy |
| 2 | **ChatGPT visits were filed as "Referral", not "AI Search".** Fixed in code 2026-11-09, not yet deployed | This is the product's headline claim for AI traffic | Deploy |
| 3 | `AI_CRAWLER_AGENTS` lacks `Claude-SearchBot`, `Claude-User` and `Perplexity-User` | The bots that fetch pages for live answers are the ones that matter most | Code |
| 4 | Google Search Console and Bing Webmaster Tools: no verification tag on the homepage (DNS verification would not show) | Without them there is no ranking, AI Overview or Copilot data | You |
| 5 | Indie Cloud is advertised but `CLOUD` is off, so nobody can sign up | Most article readers will want hosted, not self-hosted. Traffic has nowhere easy to convert | You decide |
| 6 | The author schema names David Mill and links `linkedin.com/in/david-mill/` and `x.com/handancorp` | Google says to identify the real author. Confirm those profiles are genuinely the author's, or remove them | You |
| 7 | `llms.txt` lists the demo as `/app/`; the demo is `/app/demo` | Small factual error in a file AI tools may read | Code |

## Keyword map

Fit means how directly Grosslytics answers the query. Priority weighs fit above demand.

| Cluster | Real queries seen in autocomplete | Demand | Fit | Priority | Who already covers it |
|---|---|---|---|---|---|
| **AI traffic to revenue** | track chatgpt traffic, chatgpt referral traffic, utm_source=chatgpt.com meaning, track ai traffic in ga4, how to track ai overview traffic | High | Very high | **1** | DataBull, Attrifast, Swetrix, Rybbit, Plausible, Clickport |
| **Getting into AI answers** | how to rank in chatgpt, how to get cited by chatgpt, get your product recommended by chatgpt, llms.txt what is it, gptbot vs chatgpt-user | Very high | Medium | **2**, data-led only | Crowded with AI-SEO vendors |
| **GA4 vs real money** | ga4 revenue tracking, ga4 revenue attribution, stripe ga4 integration, google analytics stripe | Medium | Very high | **1** | DataBull, Clickport |
| **Direct traffic** | why is direct traffic so high (in ga4), where does direct traffic come from, direct traffic vs organic search | High | Very high | **1** | Ruler, Clickport, agencies |
| **Payment provider choice** | stripe vs paddle fees, stripe vs paddle vs lemonsqueezy, lemon squeezy vs paddle, dodo payments vs stripe, polar.sh vs stripe, merchant of record platforms | High | High: the exact buyers | **1** | Provider blogs. Analytics vendors are absent from what was sampled |
| **Analytics inside AI tools** | google analytics mcp claude, is there a google analytics mcp for claude, analytics mcp server, mcp analytics posthog, rybbit mcp | High | Very high | **1** | Check the results before writing |
| **Metrics founders calculate** | how to calculate revenue per visitor, revenue per visitor calculator, mer vs roas, how to calculate roas, saas conversion rate benchmarks | High | High | **2** | Plausible has calculators |
| **Self-hosted / open source** | self hosted analytics, best self hosted analytics, self hosted google analytics alternative, open source web analytics, cloudflare web analytics vs plausible | High | High | **2** | Umami, Rybbit, Swetrix, Matomo |
| **Privacy tool comparisons** | umami vs plausible (vs matomo), plausible vs fathom, matomo vs google analytics, rybbit vs umami | High | Medium | **3** | Each vendor's own pages |
| **Broad alternatives** | google analytics alternatives (free, open source, reddit), ga4 alternatives, cookieless analytics tools | Very high | Medium | **3**, after authority builds | 20+ vendor roundups |
| **Compliance** | is google analytics gdpr compliant, do i need a cookie banner for google analytics | Medium | Medium | **3**, needs legal review | Many |

Skip for now: Mixpanel/Amplitude alternatives (product analytics, poor fit), Hotjar alternatives (the click map is not session replay), "web analytics" head terms, and "revenue analytics" (autocomplete is mostly job searches).

## What competitors do that is worth learning from

| Competitor | Pages | Worth copying | Not worth copying |
|---|---|---|---|
| DataFast | 532, mostly docs | A setup guide per builder and platform (Lovable, Bolt, v0, Kajabi, Podia). Cheap, specific, high intent | |
| DataBull | 58 | Single-purpose landing pages: `/track-chatgpt-traffic`, `/ga4-revenue-attribution`. This is the closest rival on the wedge | |
| Plausible | 167 | Free calculators; `/track-ai-traffic` page | |
| Umami | 116 | Compact compare section and guides | |
| Clickport | 234 | Tests it ran itself, such as a GA4 bot test on 1,000 sessions. Its direct-traffic piece leads with a measured number | |
| Rybbit | 500 | 140 free tools pages, which earn links | Copying the volume |
| Swetrix | 1,151 including translations | Glossary | 511 posts: too thin to match |
| Zenovay | 1,322 including translations | The idea of an AI crawler reference | One page per crawler per language |
| Cometly | 6,195 (5,790 posts) | | **Mass near-duplicates.** It ranks today, but Google's scaled-content policy names this pattern and a small site has no cushion |

Grosslytics' realistic advantage is not volume. It holds real payment data and is open source, so tests can be reproduced.

## How to write better than what ranks

Most ranking pages in the sample are 1,000–3,500 words, rarely have tables, and rarely show evidence. Userpilot, Cometly and Baremetrics are product-first lists. A page beats them by being checkable.

Every article must include:

1. **One original element**: a test, a measurement, a calculator, or a real failure. If there isn't one, don't publish. Google calls non-commodity content the most influential long-term factor and uses generic tips articles as its bad example.
2. **The answer in the first two sentences**, then the reasoning and limits.
3. **Dated facts with links to primary sources.** Vendor prices get a "checked on" date.
4. **Real screenshots or a repeatable method.** Code and test scripts go in the public repo so others can run them and cite them.
5. **Honest competitor treatment.** Say when Plausible's script is smaller (1.1 KB vs 1.5 KB) or when a rival fits better. Fair pages get cited more readily, and it is the only defensible stance for a vendor writing comparisons.
6. **A stated author, method and publisher interest.** Keep the existing disclosure style.
7. **A link from a useful page**, plus links to the setup docs. Link the blog from relevant homepage sections, not only the nav.

Never invent customer stories, testimonials, numbers or quotes. The sample dashboard must stay labelled as sample data.

## Original assets, in order of value

Each can be cited by other sites and AI chats. These are the reasons to link to Grosslytics.

1. **Ad-blocker test of analytics scripts.** Run Plausible, Umami, Fathom, DataFast, DataBull, GA4, Grosslytics and others against EasyPrivacy and uBlock lists. Publish rules matched, script used, and date. The project already found two EasyPrivacy rules that blocked its own endpoint, so the method exists.
2. **Tracker size benchmark.** Measure each script's Brotli size with a public script, re-run monthly. Report that Plausible wins if it does.
3. **True payment cost calculator.** What Stripe, Paddle, Polar, Lemon Squeezy, Dodo, Razorpay, Gumroad and PayPal leave you from a $29 sale, using `calculateGatewayFee` and dated source links. This is also the main link magnet for the payment cluster.
4. **Which bots actually read a new site.** Log every AI crawler hit on grosslytics.com from day one, including `llms.txt` requests. Few small sites publish first-party data on this.
5. **Open revenue page.** Once real sales exist, make Grosslytics' own traffic-to-revenue page public through `/share/`. Numbers only if real, even if small.

## 12-week calendar

| Week | Piece | Type | Target |
|---|---|---|---|
| 1 | Fixes 1–7, connect Search Console and Bing, begin bot logging | Setup | |
| 2 | How to track ChatGPT traffic through to real revenue (covers `utm_source=chatgpt.com`) | Tested how-to | AI traffic |
| 3 | Why GA4 revenue doesn't match Stripe | Reproducible test | GA4 vs money |
| 4 | Why is direct traffic so high? What's in it and what you can fix | Explainer with data | Direct |
| 5 | Stripe vs Paddle vs Lemon Squeezy vs Polar vs Dodo: what you really keep + calculator | Tool + comparison | Payments |
| 6 | Which analytics scripts do ad blockers block? | Original study | Backlink magnet |
| 7 | Google Analytics MCP for Claude: options, and what you can actually ask | Tested guide | MCP |
| 8 | Do you need llms.txt? What bots really requested on a new site | First-party data | AI answers |
| 9 | Revenue per visitor: formula, calculator, by channel. Merge MER vs ROAS if thin | Tool | Metrics |
| 10 | Best self-hosted web analytics, compared by running them | Tested roundup | Self-hosted |
| 11 | Cloudflare Web Analytics vs Plausible vs GA4 | Comparison | Self-hosted |
| 12 | Google Analytics alternatives, organised by the job you need done | Hub | Broad, linked from the above |

Alongside these:

- Week 2: retitle the Stripe guide around "Stripe UTM tracking" and replace "not exercised against a live merchant account" with the sandbox results already on record, stated as sandbox.
- Weeks 3–8: add `/compare/` pages for Umami, Matomo, Fathom, Simple Analytics and Rybbit, one per fortnight. Extend the DataFast page to answer "DataFast vs PostHog" and "DataFast vs Google Analytics".
- Weeks 6–12: add short setup guides for Lovable, Bolt and v0, the DataFast pattern.

## Getting cited by AI chats

### What the evidence supports

| Claim | Source | Trust |
|---|---|---|
| AI Overviews and AI Mode have no special requirements. Being indexed and snippet-eligible is the bar | [Google](https://developers.google.com/search/docs/appearance/ai-features) | Primary |
| Google Search does not use llms.txt, AI text files or special markup. Chunking and writing for AI are unnecessary | [Google](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) | Primary |
| Unique, first-hand content matters most long-term. Mass pages for fan-out queries can breach spam policy | [Google](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) | Primary |
| To appear in ChatGPT search, don't block OAI-SearchBot. ChatGPT tags clicks with `utm_source=chatgpt.com` | [OpenAI](https://help.openai.com/en/articles/12627856-publishers-and-developers-faq) | Primary |
| Adding quotations, statistics and cited sources lifted visibility about 30–40%. Keyword stuffing lowered it | [GEO paper, KDD 2024](https://arxiv.org/abs/2311.09735) | Peer-reviewed, but on a simulated engine using gpt-3.5 |
| Web mentions of a brand correlate with AI Overview presence far more than backlinks (reported 0.664 vs 0.218) | Ahrefs, 75,000 brands, [via secondary write-up](https://www.citeflow.io/blog/brand-mentions-vs-backlinks) | Correlation only. Original not read |
| Reddit, YouTube, LinkedIn and Wikipedia are among the most-cited domains | [Peec AI via Search Engine Land](https://searchengineland.com/ai-search-engines-cite-reddit-youtube-and-linkedin-most-study-473138) | Direction is solid. Percentages [conflict between studies](https://www.agenzy.lt/blog/which-sources-ai-engines-cite-2026) |
| Only about 11% of domains are cited by both ChatGPT and Perplexity | [Whitehat SEO](https://whitehat-seo.co.uk/blog/ai-engines-comparison-citations) | Vendor |
| Listicles are heavily cited, around a fifth of URLs in one dataset | [Peec AI](https://peec.ai/blog/citation-rate-benckmarks-from-over-1-million-citations) | Vendor |
| Recently updated pages are favoured, more so on Perplexity | [Various](https://www.demandlocal.com/blog/content-freshness-ai-rankings/) | Vendor. Direction only |
| AI referrals convert 4–5x better | [Several vendors](https://www.airops.com/blog/ai-referral-traffic-conversion-rates) | **Weak.** A [Seoworks benchmark](https://www.seoworks.co.uk/downloads/ai-referral-traffic-benchmark/) found 7.18% vs 6.08%, and organic sent 39x more traffic |

Set expectations from the last row: AI chats are a small but useful channel. Google organic remains the larger prize, and most of this plan serves both.

### Actions, most useful first

1. **Get named where AI chats read.** Since brand mentions and "best of" lists are heavily cited, third-party presence is the main lever and Grosslytics currently has none:
   - Directories seen in this research's results: [OpenAlternative](https://openalternative.co/alternatives/datafast), [SaaSHub](https://www.saashub.com/datafast), [Open Source Alternatives](https://www.opensourcealternatives.to/item/minilytics), [Tiny Startups](https://www.tinystartups.com/tools/datafast), Product Hunt, and AlternativeTo.
   - Developer lists: awesome-selfhosted and MCP server directories.
   - Ask authors of existing roundups to review it, e.g. [Peerlist's indie analytics list](https://peerlist.io/blog/engineering/best-website-analytics-tools-for-indie-hackers-and-developer) and [MakerStack](https://makerstack.co/reviews/datafast-review/). Offer the demo and facts, and never pay for undisclosed placement.
   - Launch on Show HN with the ad-blocker study or the open-source angle, which also addresses the 0 stars.
2. **Fix the name collision.** Use one description everywhere: "Grosslytics, open-source revenue analytics". Keep the name, logo and links identical on GitHub, npm, X, directories and the site.
3. **Take part in real conversations.** Answer questions on r/SaaS, r/selfhosted, r/indiehackers, and Indie Hackers. Disclose that you built it, lead with the answer, and link only when it helps. These communities ban self-promotion quickly, and a bad reputation there can be repeated by AI answers.
4. **Publish short YouTube walkthroughs.** A 2–3 minute real demo of each week's test. YouTube is among the top-cited domains, and it reuses work already done.
5. **Write extractable articles.** Answer-first openings, comparison tables, dated numbers, and links to sources. Real named quotes only. This follows the GEO results and also reads better for people.
6. **Match the phrasing of buying prompts** on comparison pages, for example "best analytics for Stripe SaaS", "open-source DataFast alternative", "analytics that shows revenue from ChatGPT".
7. **Refresh key pages every 2–3 months** with real changes to prices and facts, and update `updatedDate`. Do not change dates alone.
8. **Keep `llms.txt` and the Markdown copies** since they exist and cost nothing, but spend no more time on them.

### Tried and skipped

- FAQ schema as a citation tactic. Google says there is no special AI markup. Keep it only where the FAQ is visible and useful.
- Rewriting into tiny chunks, adding long-tail variations, or one page per fan-out query. Google advises against all three.
- Paid AI-visibility trackers. A free monthly check is enough at this size.

## How to measure

| Metric | Source | Check |
|---|---|---|
| Impressions and clicks per page | Search Console, including its generative AI report | Weekly |
| Copilot citations | Bing Webmaster AI Performance (a sample, not a full log) | Monthly |
| Visits and **paying customers** by AI source | Grosslytics on grosslytics.com, after fixes 1 and 2 | Weekly |
| Crawls per bot and per page | Grosslytics AI crawler panel | Monthly |
| Brand searches | Search Console, query contains "grosslytics" | Monthly |
| Third-party mentions | Manual log | Monthly |
| AI answer presence | Run these prompts in ChatGPT, Claude, Gemini and Perplexity. Log whether Grosslytics is named, its position, accuracy, and which URLs are cited | Monthly |

Prompts to log:

- best analytics tool that shows Stripe revenue by traffic source
- open source alternative to DataFast
- self-hosted web analytics on Cloudflare
- how do I see which marketing channel brought paying customers
- how do I track revenue from ChatGPT traffic
- what is the best analytics MCP for Claude
- Grosslytics vs Plausible
- is Grosslytics any good

Expect little in the first 8–12 weeks. A new domain needs time and external mentions, and no one can guarantee rankings or citations. Review at week 6 by which clusters earn impressions, then shift the remaining slots toward them.

## Sources

Keyword data was collected from Google autocomplete on 2026-11-09. Page counts come from each competitor's public sitemap, reading up to 25 child sitemaps. Ranking samples come from DuckDuckGo. Links in the tables above are the remaining sources.

Also used: [Bing AI Performance report overview](https://almcorp.com/blog/bing-ai-performance-webmaster-tools-complete-guide/), [Clickport on GA4 direct traffic](https://clickport.io/blog/ga4-direct-traffic-too-high), [Attrifast ChatGPT tracking](https://attrifast.com/track-chatgpt-traffic), and [Swetrix on AI traffic and revenue](https://swetrix.com/blog/attribute-ai-search-traffic-to-revenue).
