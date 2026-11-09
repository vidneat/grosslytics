# Handoff

The current state of Grosslytics, kept up to date at the end of each work session. Read this first instead of replaying old conversations. Last updated: 2026-11-09.

## What this is

Grosslytics is revenue-first web analytics. A small tracker records visits, payment-gateway webhooks record sales, and the dashboard shows which traffic source brought each paying customer. The user self-hosts it on their own Cloudflare account. There is no hosted multi-user version yet.

Three connections, each pointing at the owner's own API (a Cloudflare Worker):

1. **Website → API:** a `<script>` tag (`g.js`) in the site's `<head>` sends visits to `/api/event` (`/api/collect` still works for old snippets).
2. **Payment gateway → API:** signed webhooks hit `/api/webhooks/<gateway>?siteId=…`. The tracker adds the visitor ID to checkout links, so each sale is matched to the visitor.
3. **Dashboard → API:** `/app` reads `/api/stats/*` using `API_TOKEN`.

## Layout

- `apps/edge-api`: the Worker. Hono, D1 (SQLite), a Queue, and the `SiteLiveHub` Durable Object (live WebSocket). Routes are in `src/routes/`. Tests are in `src/edge.test.ts`.
- `apps/web`: Astro 5 with React islands and Tailwind v4. Pages:
  - `/`: marketing page.
  - `/start`: onboarding.
  - `/app`: owner dashboard.
  - `/app/demo`: sample data, labelled as such.
  - `/share/<domain>`: public revenue page.
  - `/compare/<slug>`: comparison pages.
  - `/badge`, `/og`: badge and social-card images.
- `packages/tracker`: source for `g.js`. Run `bun run build` in that folder, then copy `dist/g.js` to `apps/web/public/g.js`. The build fails above 1,587 bytes Brotli (the most that rounds to the site's "1.5 KB"); it is currently 1,560. The same build makes the opt-in click script `dist/c.js`; copy both to `apps/web/public/`. It has tests in `src/g.test.ts`, which run the built file, so build before testing.
- `packages/db-d1`: `queryDashboard` (one batched set of SQL queries) and migrations 001–010.
- `packages/shared`: types and the dashboard contract (`dashboard.ts`).
- `scripts/db.ts`: local migrate and seed; also migrates the remote database.
- `examples/test-site`: a three-page local site for end-to-end testing (see below).
- `DEPLOY.md`: local setup, the end-to-end test, and the step-by-step Cloudflare deploy.

## Run locally

```bash
bun run db:seed:local   # sample site gl_local_acme / acme.io, 180 days of data
bun run dev:api         # port 8787
bun run dev:web         # port 4321
bun run dev:test-site   # port 3000, after filling examples/test-site/config.js
```

`.dev.vars` (gitignored) holds `API_TOKEN` and `STRIPE_WEBHOOK_SECRET`. **Never read or print it**; the user pastes the token into `/app` themselves.

Checks:
- `bun test packages apps`: 54 tests pass.
- `cd apps/web && bunx astro build`: passes.
- Direct `tsc --noEmit` passes for web, API, CLI and ClickHouse; the web production build passes. `astro check` is not a valid check yet: `@astrojs/check` is missing and Turbo cached its install prompt as success.

## Content and AI-search plan (2026-11-09, on `main`, pushed and deployed)

- `docs/content-and-aiseo-plan.md` holds the keyword map, competitor page counts, a 12-week calendar, and the AI-citation evidence and actions. The repo is public, so the plan is publicly readable.
- Measured: Google autocomplete, 17 competitor sitemaps, DuckDuckGo ranking samples, and live AI crawler access (all 200). Not measured: search volumes, keyword difficulty, backlinks, Google rankings, or actual answers from AI chats.
- Deployed 2026-11-09 as version `2026-11-09-eec6998`, from `chore/own-tracking-ai-sources`, since fast-forwarded into `main` and pushed. grosslytics.com is registered as site `gl_ee5c6c8cdca1`. The live dashboard password is still unset (`passwordSet:false`, though the local `state.json` says true); the user connected with `API_TOKEN`. Every deploy needs `PUBLIC_OWN_SITE_ID=gl_ee5c6c8cdca1 CLOUDFLARE_ACCOUNT_ID=f6883459148b86e04de194a74b9ad66d bun run setup`, or the tag disappears. Checked live: `/`, `/blog/`, `/docs/` carry the real ID; a browser visit to `/blog/` got a 202 from `/api/event` with no console errors, so the site's data includes one check visit from Claude (source "Direct (Shared Link)"). An earlier deploy the same day used the placeholder `gl_YOUR_ID`; that is replaced.
- Guard added (runs at build time): with `--keep-env`, `scripts/release.ts` exits before building if `PUBLIC_OWN_SITE_ID` is set but isn't `gl_` plus 12 lowercase hex characters, so `bun run setup` stops before deploying. Run against 3 bad IDs (exit 1), a valid-format ID (built, tag present) and a buyer build (placeholder ignored, no tag). It checks the format only, not that the site exists, and leaving the variable out still deploys without the tag, because self-hosters have no such ID. `bun run setup` itself was not run with a bad ID, to avoid any risk to production.
- Fixed:
  - AI classification: `AI_SOURCES` in `packages/shared/src/attribution.ts`, also used by the SQL fallback in `dashboard.ts`, so `utm_source=chatgpt.com` counts as AI Search. Events already stored as Referral keep that category, and a tagged visit is listed as `chatgpt.com`, a separate source row from `chatgpt.com (AI)`.
  - Own tracking: `Page.astro` adds `g.js` to non-dashboard pages when built with `PUBLIC_OWN_SITE_ID`. Releases for buyers strip `PUBLIC_*`, so they never get it.
  - To go live: add grosslytics.com as a site on `/app`, then deploy with `PUBLIC_OWN_SITE_ID=<its gl_ id> CLOUDFLARE_ACCOUNT_ID=f6883459148b86e04de194a74b9ad66d bun run setup`. Every later deploy needs the variable too, or the tag disappears.
  - Verified: 54 tests, web and db-d1 typecheck, builds with and without the variable (20 of 20 static pages vs 0). In a local browser, `/blog/?utm_source=chatgpt.com` got a 202 from `/api/event` and the event was stored as AI Search; `/app/demo` has no tag. The test visit was deleted. Not checked on the live site.
- Found, not fixed: `AI_CRAWLER_AGENTS` lacks `Claude-SearchBot`, `Claude-User`, `Perplexity-User`. `llms.txt` lists the demo as `/app/`.
- For the user: connect Search Console and Bing Webmaster, decide on turning `CLOUD` on, and confirm the David Mill LinkedIn and X links in the author schema are genuine.

## SEO MCP on VidNeatWeb (2026-11-08, on `main`, pushed)

- `packages/seo-mcp` now takes `SEO_SITE_URL`, `SEO_SITE_NAME` and `SEO_CONTENT_COLLECTIONS`. Unset, it behaves as before for Grosslytics. With collections set, link planning reads `src/content/<name>`, links to `/<collection>/<slug>/` are checked against real entries, and publishing writes one `.mdx` guide in the first collection (VidNeat's frontmatter, `**Key takeaways:**`, `## Common questions`, read time at 275 words a minute). It refuses unknown authors, missing `related` slugs, and text MDX would run or choke on. No Markdown copy, `_headers` or `llms.txt` changes.
- Installed as `vidneat-seo` in `~/Applications/VidNeatWeb/.mcp.json` (gitignored there, also uncommitted). It starts when a new Claude session opens in that folder. After changing the MCP, run `bun run --cwd packages/seo-mcp build`.
- Verified: 2 smoke tests, typecheck; a throwaway guide published through the real server into a disposable copy of VidNeatWeb, then `astro build` (69 pages), `astro check` (0 errors) and `check:links` passed, with title, canonical, author, figure, FAQ heading and related links in the built page. The real VidNeatWeb had no article written and was not deployed.
- Not done: MDX components (`DemoLoop`, `Screenshot`) are added by editing the guide after publishing. Link planning does not see `.astro` pages such as `/vs/*`. `ogImage` needs a card in VidNeat's `scripts/build-og.mjs`. VidNeat's house rules live in its `rank-ready-article` skill, not in the MCP.

## Git identity (2026-11-08)

- All history was rewritten so every commit's author and committer is `vidneat <344886770+vidneat@users.noreply.github.com>`. Claude `Co-Authored-By` lines were removed. `main` and `fix/live-csp-noindex` were force-pushed, and GitHub's contributor list now shows only vidneat (40 commits). The local branch `feat/dodo-billing` was rewritten too.
- This repo's local git config sets the vidneat identity. Do not add AI attribution lines to commits or PRs.
- Any other clone made before the rewrite has stale commit IDs: re-clone it or run `git reset --hard origin/main`.

## Deploy of 4f1dea7 to grosslytics.com (2026-11-08)

- Wrangler was signed in to ravi923615 (the vidneat account); the user switched it to ravi88927615 (`f6883459…`), and it stays signed in there. Deployed with `CLOUDFLARE_ACCOUNT_ID=f6883459148b86e04de194a74b9ad66d bun run setup` (version `2026-11-08-4f1dea7`). Since the last deploy, only website files had changed.
- Checked live: `/`, `/app/`, `/app/demo`, `/g.js`, `/api/auth/status`, `/blog/` and all 5 posts, `/authors/david-mill/`, `/compare/` and the comparison pages (including PostHog and DataFast vs DataBull), and `/sitemap-index.xml` all return 200. There is no `X-Robots-Tag`, and the header Star button is live. On the demo toolbar, `backdrop-filter` is `none`. The deploy log shows `TRACKER_ORIGIN` = https://grosslytics.com.
- README: the PostHog comparison link can be added back now that the page is live.

## Dashboard toolbar flicker (2026-11-08, deployed)

- The user saw the sticky dashboard toolbar (site, attribution, revenue, range) flicker in place. Likely cause: the always-pulsing green "online" dot (`animate-ping`) sits inside a translucent bar with `backdrop-blur-xl`, so the browser recomputes the blur every frame.
- Fix in `DashboardIsland.tsx`: the toolbar is solid `bg-canvas`, no backdrop blur. `astro build` passes. The user confirmed the flicker is gone.
- The local dev server started at 11:19 is broken ("Outdated Optimize Dep", islands fail to hydrate, blog routes 404). Restart `bun run dev:web`.

## Blog, comparison hub and SEO MCP (2026-11-08, pushed and deployed)

- Committed the previously uncommitted SEO work: `/blog/` with 5 articles, `/authors/david-mill/`, `/compare/` index plus the DataFast, DataBull, Plausible, PostHog and DataFast-vs-DataBull pages, `Article.astro`, schema/sitemap/llms.txt/robots.txt changes, `public/_headers`, comparison screenshots, and `packages/seo-mcp`.
- `.mcp.json` is now gitignored (it holds local paths). `packages/seo-mcp/README.md` uses `/path/to/grosslytics` instead of local paths.
- `astro build` passes and outputs every blog and compare page. Live on grosslytics.com since the 4f1dea7 deploy.
- The running local dev server (started 11:19) lost these routes when the files were stashed during the history rewrite; restart `bun run dev:web` to see them.

## README and GitHub star button (2026-11-08, pushed and deployed)

- `README.md` rewritten for GitHub: hero screenshot, badges, why, features, payment provider table, how it works, self-host, MCP, pricing, tech stack, compare links, contributing, star call-out. The README links were checked against the live site.
- `docs/screenshots/*.png` are real captures of grosslytics.com and `/app/demo`, taken with headless Chrome at 2x and downscaled to 1600px wide. The demo shows sample data, and the README says so. To refresh them, capture `/app/demo` at a 1440px-wide window and crop.
- `apps/web/src/layouts/Page.astro`: a GitHub "Star" pill in the header of the marketing pages (icon only on phones). There is no live star count. Checked on the local dev server at desktop and 375px widths; `astro build` not re-run.

## High-priority review fixes (2026-11-07)

- Queue receipts, raw events, visitor counters and delayed-payment attribution commit atomically in five SQL statements per batch. D1 rollups were retired from active reads/writes in the F07–F13 pass below. Retried message IDs do not increment counters again.
- Payment events and refunds commit with their receipts. Invoice-first delivery fills missing checkout attribution; different events for the same payment only announce one sale. Full refunds persist before payment arrival and later success events cannot revive them.
- Stripe must forward `invoice_payment.paid` as well as `checkout.session.completed`, `invoice.paid` and `charge.refunded`; this supplies the modern invoice-to-PaymentIntent mapping.
- Site creation offers USD, EUR, GBP or INR. Other-currency webhook payments return 422 without claiming the event. Historical foreign-currency rows are retained but excluded from dashboard/MCP totals, and the dashboard lists excluded currencies. Money labels use the selected currency.
- Polar checkout links now use `reference_id`, read back from order metadata. Paddle/Razorpay no longer receive a misleading generic visitor_id URL parameter; use their documented checkout metadata integration.
- Migration 005 is required before using this version. Run `bun run db:migrate:local` locally and `bun run db:migrate:remote` before a future remote deploy. No historical duplicates or lost records are rewritten by this migration.
- Verified: 24 regression tests, direct TypeScript checks, web production build, tracker build (1,479 bytes Brotli), local additive migration, and an isolated in-memory Cloudflare D1 smoke check covering migration reruns, 100-message redelivery, refund-first ordering and late attribution. The dashboard/onboarding hydrate without browser errors. No new real gateway purchase, commit or remote deployment was performed during the fix.

## Reconciliation fixes F07–F13 (2026-11-07)

- Dashboard, channel API and MCP now share raw-event distinct visitor/session counts, source credit and daily-spend allocation. Legacy hourly rollups are retained but no longer read or updated; summing per-hour/page/batch uniques was incorrect. Source/channel visitor counts and time-series visitor counts may overlap, while revenue credit sums to the overall total.
- Acquisition categories are normalized from source, UTM medium and the beacon category at ingestion. Each new event's `meta_json` contains `_grosslytics` (category and UTM fields) plus `custom` holding the original custom-metadata string. No consumer previously read `meta_json`. Historical events without these fields use source-based classification; missing historical UTM data is not invented. Category revenue uses the recorded touch before each payment, even if the visitor returns later.
- Profit charts start with each bucket's actual revenue/fees and subtract allocated spend once, including spend-only and break-even buckets. Current and previous series reconcile. Daily budgets are distributed uniformly over UTC time; cumulative rounding conserves cents and boundary dates are exclusive.
- Entry rows use the first page per visitor in the selected period. Repeat sessions do not repeat revenue. Untracked buyers have a `(not tracked)` entry row. Missing dimensions/campaigns remain represented as `(not set)`/Unknown. Top-page revenue intentionally overlaps and is labelled as such.
- Ad spend cannot be split by page/country/device. Such filtered views explicitly show net revenue; detail breakdowns also label their net amounts in Profit mode. Category profit lists the source-level spend as a separate expense row instead of guessing its category split.
- Purchase milestones are labelled independent counts, without invented sequential drop-offs or zero-denominator percentages.
- Site changes remount the workspace and isolate request/socket state. Old successes/errors/messages cannot cross connection/site boundaries; filters, drawers and ad-spend drafts reset. Same-site refreshes retain their last result.
- Verified: 30 tests; isolated D1 runtime checks for source/chart/category reconciliation; browser harness covering stale responses, stale sockets, disconnect, same-site refresh and an open journey during site switching. Harness: `scripts/dashboard-state-check.tsx` (bundle/serve instructions in its header). No schema migration, commit or deployment was required for this pass.

## Ingest hardening vs Traks (2026-11-07)

Competitor checked: github.com/shivamanupadi/traks (general cookieless analytics on Cloudflare, no revenue attribution). Closed its ingest lead in `apps/edge-api/src/routes/collect.ts`:
- Unknown site IDs return 404 (D1 lookup, 60s per-isolate cache).
- Cross-origin events from a domain other than the site's own (or its subdomains, or localhost) return 403.
- Bots are dropped before queueing: bot/crawler/headless/HTTP-library UAs, empty UA, Cloudflare verified bots, and 15 datacenter ASNs (AWS, GCP, Hetzner, OVH…). AI crawler UAs are still recorded as `ai_crawl`.
- Bodies over 8 KB are rejected.
- Test: `collect: drops bots…` in `edge.test.ts` (31 tests pass). Not deployed and not checked in a real browser.
- Traks is still ahead on: a one-click deploy wizard, per-user accounts/members/API tokens, a Bots panel (we drop bots instead of counting them), page flow, custom date ranges, and a live world map.

## Site timezones (2026-11-07)

- `sites.timezone` (already in migration 001, default `UTC`) now drives day/hour buckets, the heatmap hours, which ad-spend dates fall in a range, chart labels, and channel API/MCP ranges (`siteRange` in db-d1).
- New sites get the browser's zone automatically (unknown zones fall back to UTC). Owners change it with the "Days and hours in" picker under the public-page toggle on `/app` (`POST /api/stats/sites/:id/timezone`).
- `shortcut:` one fixed offset (the zone's offset at query time) for the whole range, so days before a DST change are an hour off.
- Existing sites stay UTC until changed. No migration needed.
- Verified: 32 tests (new timezone test uses Asia/Kolkata), web/API typecheck, demo dashboard renders with no console errors. Browser-checked on `/app` with the local acme.io sample: switching to Asia/Calcutta saved, remounted the dashboard, moved the 24h chart start to 06:30 UTC (12:00 IST) and relabelled the heatmap; then set back to UTC. Chrome lists the old name `Asia/Calcutta`, not `Asia/Kolkata`; both work.

## Homepage expansion (2026-11-07)

- `apps/web/src/pages/index.astro` gained, modelled on the section list of datafa.st and databull.app: "Live in three steps", "Everything in the dashboard" (18 features, each one a real panel or behaviour), install snippet + privacy cards, links to the four `/compare` pages, a 10-question FAQ (with FAQPage JSON-LD) and a closing CTA.
- Deliberately not copied: testimonials and user counts (we have none) and "ping when a post takes off" alerts (not built). Claims were narrowed to what's true: only Stripe/Polar checkout links get the visitor ID; refunds are Stripe full refunds; the ad-blocker answer cites the EasyPrivacy/uBO test.
- Also fixed: the homepage demo's sparklines caused a React hydration mismatch (float rounding differed server vs client); points are now rounded to 2 decimals in `ui.tsx`.
- Checked in the browser at desktop width (light and dark) and 375px (no horizontal overflow after adding `min-w-0` to the setup cards). Production build and 32 tests pass.

## Comparison pages rewritten for search (2026-11-07)

- `apps/web/src/pages/compare/[slug].astro` now gives each page its own keyword cluster (primary: "DataFast alternative", "DataBull alternative", "Plausible alternative", "GA4 alternative") and long-form sections modelled on currently ranking articles: answer-first intro, "What is X?", glance table, "Choose X if / Choose Grosslytics if", pricing, two topic sections, "How to switch", 5–6 page-specific FAQs (FAQPage JSON-LD), related comparisons. ~1,070–1,180 words each (was ~400).
- All competitor facts re-checked on their own sites on 2026-11-07 (VERIFIED). Notable additions: DataFast 14-day trial and 3y/5y retention; DataBull $49 once / hosted $9–19, Telegram alerts, cookie-mode choice; Plausible $9 Starter, $14 Growth, 30-day trial; GA4 user-level retention 2 or 14 months.
- Goals are only counted in aggregate ("Reached a goal"), not by name. The pages say so; a per-goal breakdown would strengthen the Plausible/GA4 switch story.
- No search-volume data was available; keyword clusters are from SERP research, not measured volumes.

## Password sign-in for /app (2026-11-07)

- Replaces the API URL + token screen, matching Traks and DataBull. First visit: `API_TOKEN` once + a password (min 10 chars) → `/api/auth/setup`. Then `/api/auth/login` with the password. "Forgot password?" re-runs setup with `API_TOKEN` and signs out every session. 5 wrong passwords → 15-minute lock.
- Migration 007: `owner_auth` (single row, PBKDF2-SHA256 100k iterations, the Workers maximum) and `sessions` (SHA-256 of the session ID, 30-day expiry). Local DB migrated; run `bun run db:migrate:remote` before the next remote deploy.
- Cookie `gl_session`: HttpOnly, SameSite=Strict, Path=/api, Secure on https. `requireToken` accepts it as full owner access; cookie-authenticated writes must send `content-type: application/json` (forces a CORS preflight, which never allows credentials) as CSRF protection.
- The saved connection in localStorage now holds `{api, token: '', siteId}` in session mode; a 401 clears it and reloads to the sign-in screen. The URL + token form stays for `PUBLIC_API_URL` (API on another host) behind "API on another address?".
- Dev now mirrors production: `astro.config.mjs` proxies `/api` (incl. WebSocket) from 4321 to 8787, and `DEFAULT_API` is `''` (same origin). `examples/test-site` still posts straight to 8787.
- Code: `apps/edge-api/src/routes/auth.ts`, `auth.ts`, `connect.tsx`. Verified: 34 tests (new `owner login:` test), web/API typecheck, setup screen renders on `/app` via the proxy, and share pages still load through it. Browser-checked locally after the user set a password: sign-in lands on the site list; the saved connection holds `token: ''`; the cookie is invisible to `document.cookie`; dashboard, tokens list, live WebSocket (through the dev proxy), token create and revoke all work on the session; a text/plain write is refused (401); toolbar Sign out deletes the session and returns to "Sign in"; a wrong password shows "Wrong password." Without a cookie (curl), stats and live return 401.

## Read-only site API tokens (2026-11-07)

- Migration 006 adds `api_tokens` (SHA-256 hash, last-4 suffix, name, site, created/last used). Run `bun run db:migrate:local` (done locally) and `bun run db:migrate:remote` before the next remote deploy.
- `API_TOKEN` stays the owner's master key. `gl_pat_…` tokens (160-bit) are created on `/app` (panel under the timezone picker), shown once, and can only: GET `/api/stats/*` with `siteId` = their site, or call `/api/mcp?site=` their site. Token management, `/sites` and every POST are master-only. Revoke deletes the row; it takes effect on the next request. `last_used_at` is written at most once a minute.
- Routes: `GET /api/stats/tokens?siteId=`, `POST /api/stats/tokens`, `POST /api/stats/tokens/:id/revoke`. Logic in `apps/edge-api/src/auth.ts`.
- Verified: 33 tests (new `api tokens:` test covers scoping, hashing, MCP, revoke). The `/app` panel compiles but has not been clicked in the browser yet.

## Hosted Cloud, Indie Cloud $5/mo (2026-11-07)

- The user chose: build Cloud first, then Lifetime (a license + `npx grosslytics` installer). Free means self-hosting only; Cloud gets a 14-day trial with no card.
- Off unless `CLOUD=1` (wrangler var). Self-host behavior is unchanged, and the owner-login tests still pass.
- Migration 008 creates new tables only, with no ALTERs:
  - `accounts`: email, PBKDF2 password, lockout, status, trial end, Stripe ids, period end;
  - `account_sessions`;
  - `account_sites`;
  - `account_usage`, keyed by account + UTC month;
  - `site_secrets`, for per-site payment webhook secrets, used on self-host too and checked before the env secrets.
- Auth (`routes/auth.ts`, `cloud.ts`):
  - `POST /api/auth/signup`; `/login` takes an email on Cloud; `/status` returns `{cloud, signedIn, account:{id,email,status,trialEndsAt,periodEnd,active,used,cap}}`. `/setup` returns 404 on Cloud.
  - `requireToken` checks site ownership centrally: through `?siteId`, `?site`, `/sites/:id/`, a revoked token's site, or the JSON body's `siteId`. A request that names no site returns 403. `/api/stats/sites` scopes itself.
- Ingest: `collect.ts` `siteGate` drops events silently (202) when the trial is over, the subscription has ended, or the month's usage reached 100k. The cache is 60s. The consumer adds counts to `account_usage` after each batch.
- Billing (`routes/billing.ts`) at `POST /api/billing/stripe`, signed with `STRIPE_BILLING_WEBHOOK_SECRET`. `checkout.session.completed` with `client_reference_id` turns an account active; `customer.subscription.updated` and `.deleted` change its status. There's no Stripe API key: checkout is a Payment Link (`PUBLIC_CHECKOUT_CLOUD_URL`) and the portal is a link (`PUBLIC_STRIPE_PORTAL_URL`).
- UI (`connect.tsx`):
  - a signup form; `/app?signup` opens on it;
  - `CloudBilling` bar showing trial days or plan, events used, Subscribe and Manage billing;
  - `PaymentWebhooks` panel with each gateway's webhook URL and a write-only secret input.
  - `/start?plan=cloud` shows "Start free trial" when the API reports cloud mode, and the waitlist otherwise. Homepage pricing and FAQ are updated.
- Verified:
  - 35 tests, including a new `cloud:` end-to-end test (isolation between two accounts, secrets, trial and cap stopping ingest, billing transitions);
  - API and web typecheck; web build;
  - in the browser with launch config `api-cloud`: signup → site list → add site → billing bar "14 days left, 0 of 100,000" → another account's site 403 → Stripe secret saved shows Connected → `/start?plan=cloud` links to `/app?signup`.
  - The local D1 now has a test account `cloudtest@example.test` from that check. The API is back in self-host mode (`api` config).
- Not done:
  - no real Stripe test-mode subscription has been run, which needs the user's Stripe Payment Link and webhook;
  - no email password reset;
  - no plan above 100k;
  - no account deletion;
  - shortcuts are noted in the code: usage by calendar month, a possible double count on queue redelivery, and no ordering of subscription events.

## Lifetime license + installer, $29 (2026-11-07)

- Purchase flow:
  - The buyer pays the Stripe Payment Link, which redirects to `/license?session_id={CHECKOUT_SESSION_ID}`.
  - The billing webhook (`checkout.session.completed` with `mode: payment` and `paid`, optionally only the `LIFETIME_PAYMENT_LINK_ID` link) mints a license.
  - The key is `gl_lic_` + HMAC(`LICENSE_SECRET`, session id), first 16 bytes. Only its SHA-256 is stored in `licenses` (migration 009).
  - `/license` polls `GET /api/license/claim`, then shows the key and `npx grosslytics install`.
- `GET /api/license/download` (Bearer key) streams R2 `RELEASES/latest.tgz`. `scripts/release.ts [--upload]` builds it: `api/index.js` (wrangler dry-run bundle), `web/dist` (built without `PUBLIC_*` vars), `migrate.sql`, `VERSION`.
- Installer (`packages/cli/src/install.ts` + `install` command, alias `init`; the old fake `init` is gone):
  - asks for the key, a hostname, the zone and a dashboard password;
  - downloads and unpacks; runs `wrangler login` if needed (the Cloudflare OAuth Allow);
  - creates D1 and both queues; runs migrations; writes both wrangler.toml files (API route `host/api/*`; web on a custom domain; SQLite Durable Objects so it works on the Free plan);
  - deploys both; sets a random `API_TOKEN` and the owner password (PBKDF2 hash written straight into `owner_auth`), and prints `API_TOKEN` once;
  - keeps its state in `./grosslytics-install/state.json`, so re-running it updates the install.
- Verified:
  - 36 tests, including the new `lifetime:` test (mint, idempotent retry, wrong link and unpaid ignored, claim, hash-only storage, download gating, the CLI password hash accepted by `verifyPassword`);
  - CLI build and typecheck; web build;
  - a real `scripts/release.ts` bundle (660 KB) downloaded through the installer's own `download()` from a local stand-in server, with a bad key refused;
  - `wrangler deploy --dry-run` passes for both generated configs;
  - `/license` renders the waiting, missing, not-set-up and success states in the browser (with a temporary local row, since deleted).
- Not done:
  - a real Cloudflare install;
  - a real Stripe purchase;
  - publishing the CLI to npm;
  - Windows support;
  - revoking a license on refund;
  - a buyer's instance still serves the marketing homepage at `/`.

## Production deploy (2026-11-07)

- Live at https://grosslytics.com on the Cloudflare account **ravi88927615@gmail.com** (account id `f6883459148b86e04de194a74b9ad66d`, Workers Free). Wrangler on this Mac is now signed in to that account, not ravi923615@gmail.com.
- What exists there:
  - D1 `grosslytics-db` (`339454ee-60ce-4bf1-9532-067b671d74db`), migrated through 009;
  - queues `grosslytics-ingest` and `grosslytics-ingest-dlq`;
  - workers.dev subdomain `grosslytics`, created only because Cloudflare requires one; both workers have `workers_dev = false`.
- Workers:
  - `grosslytics-edge-api` on route `grosslytics.com/api/*`, with SQLite Durable Objects (`new_sqlite_classes`, required on Free).
  - `grosslytics-web` on the custom domain grosslytics.com. Its compatibility_date is now 2025-09-01, because React 19 server rendering needs the `MessageChannel` global.
- The user deleted the old apex A/AAAA/CNAME records (they pointed at a dead server, error 522) so the custom domain could attach. MX = Cloudflare Email Routing, kept.
- Secrets set: only `API_TOKEN`. The value is in `.secrets/production-api-token.txt` (mode 600, gitignored); never print it. The user pastes it once on /app to set the dashboard password.
- Not set yet:
  - payment webhook secrets (customers set them per site on /app → Payments);
  - `CLOUD` is off, so customer sign-ups are disabled;
  - `LICENSE_SECRET`, the R2 bucket, Stripe links and the billing webhook.
- Checked live: `/`, `/app` (setup screen in the browser), `/g.js` and `/api/auth/status` return 200; `/api/stats/sites` returns 401 without a login.

## One-command self-host: `bun run setup` (2026-11-07)

- Why: the user followed /start's manual steps in a fresh clone (`/Users/raviair/grosslytics`). GitHub `main` is still `1ef1f15`, whose wrangler.toml has an empty KV binding, so every wrangler command failed. Local commits `b6bd620` and `0af6ae9` and today's work are **not pushed**. The manual steps also needed hand edits (database_id, DO storage) and would have crashed the website worker (compat date).
- `bun run setup` runs `scripts/release.ts --keep-env` (local bundle), then `packages/cli/src/index.ts install --bundle .release/grosslytics.tgz`. It's the same flow as the Lifetime installer, minus the license and download. State lives in `grosslytics-install/state.json` (gitignored); re-running updates without touching the password or API_TOKEN.
- `webToml` compat date is now 2025-09-01 (MessageChannel). The root `wrangler.toml` and `apps/web/wrangler.toml` are generic again (no database_id, no routes); production values live in the generated configs under `grosslytics-install/release/`. This Mac has a production `state.json` for grosslytics.com (`passwordSet: true`), so `bun run setup` here updates production.
- Ran `bun run setup` once against production: build, existing-database handling, queues, migrations and both deploys succeeded (deployments 08:54–08:55 UTC). The site and API were fine afterwards. The first-install-only parts (secret put, owner password insert) have not run live.
- /start step 1 is now `git clone` + `bun install` + `bun run setup`, with notes about the workers.dev subdomain and existing DNS records. Step 2 sends people to their own `/app`, or a `Connect remote` form (API URL + token). `/docs` self-hosting and DEPLOY.md "Quick setup" match.
- **Not live yet:** the auto-mode classifier blocked further production deploys, so these /start, /docs and copy changes are built locally but not deployed. Fresh clones still get the old broken code until it is committed and pushed.

## Live panel empty on analytics.vidneat.app (2026-11-07)

- Cause 1: vidneat.app's CSP (`~/Applications/VidNeatWeb/public/_headers`) blocked `https://analytics.vidneat.app/g.js`, so no events reached the API. Added the host to `script-src` and `connect-src`. Deployed 2026-11-07 from a clean worktree of VidNeatWeb HEAD `0149366` plus only `_headers` (version `335dad76`); the folder's other uncommitted work was not shipped. Verified: g.js loads and `/api/event` returns 202. `_headers` is still uncommitted in VidNeatWeb.
- Cause 2: `SiteLiveHub` kept online visitors only in memory, lost whenever the Durable Object hibernated. Presence is now stored under `v:<visitorId>` and reloaded in the constructor. 26 API tests and typecheck pass. Deployed to grosslytics.com in 5c4f419 (see below).
- CSP note added: /docs §1 (example header), /start step 3 and the /app "No visits yet" box name the host to add to `script-src` and `connect-src`. Web typecheck and build pass; /docs checked in the browser. Not deployed.

## Self-hosted copies are noindex (2026-11-07)

- Every host except grosslytics.com is kept out of search results, so buyers' copies of the marketing pages don't compete with grosslytics.com and private dashboards stay unlisted.
- The installer's `noindex(host, dist)` (`packages/cli/src/install.ts`, called before the web deploy) writes `dist/_headers` with `X-Robots-Tag: noindex, nofollow` for all static pages, and a robots.txt that allows crawling (so the header is seen) with no sitemap.
- `apps/web/src/middleware.ts` adds the same header to pages rendered on request (`/app`, `/share`, `/og`, `/badge`), since `_headers` only covers static assets.
- Verified: new `installer:` test (27 API tests pass), CLI/web typecheck, web build; dev server (localhost) sends the header on `/`, `/app`, `/share/acme.io`. Not deployed: analytics.vidneat.app gets it on its next `bun run setup` in `/Users/raviair/grosslytics`.
- `CLAUDE.md` now tells every session to read and update this file.

## Deploy of 5c4f419 to grosslytics.com (2026-11-07)

- Branch `fix/live-csp-noindex` (not merged to main, not pushed) holds the live-presence fix, the CSP note and noindex. Deployed to grosslytics.com with `CLOUDFLARE_ACCOUNT_ID=f6883459148b86e04de194a74b9ad66d bun run setup` (version `2026-11-07-5c4f419`).
- Checked live: `/`, `/app`, `/g.js`, `/api/auth/status` return 200; the /docs CSP note is up; grosslytics.com sends no `X-Robots-Tag` and keeps its sitemap (no `_headers` written for that host).
- analytics.vidneat.app (since removed, see below) was updated too: `/Users/raviair/grosslytics` fast-forwarded to `80e5fde` (from this repo's branch), then `CLOUDFLARE_ACCOUNT_ID=a54e52e1a0c582eafa8841eaba88a2fc bun run setup` there (version `2026-11-07-80e5fde`). Checked: every page sends `X-Robots-Tag: noindex, nofollow`, robots.txt has no sitemap, and an event from vidneat.app returns 202.
- Two Cloudflare accounts: grosslytics.com is **ravi88927615@gmail.com** (`f6883459…`); vidneat.app and analytics.vidneat.app are **ravi923615@gmail.com** (`a54e52e1…`). Wrangler is currently signed in to **ravi88927615** (since 2026-11-07). To switch: `npx wrangler logout`, sign the browser in to the other Cloudflare account, then `npx wrangler login`. Always pass `CLOUDFLARE_ACCOUNT_ID` to `bun run setup`.
- Not checked live: the live panel showing a visitor after hibernation (needs a signed-in dashboard).

## Where things stand

**Done and verified locally**
- Tracker → queue → D1. The live panel updates over the WebSocket.
- A signed Stripe webhook gets attributed and a repeat is deduplicated. Verified with a locally signed event, not a real Stripe account.
- Full dashboard:
  - attribution models: first, last, linear
  - revenue modes: gross, net, profit
  - filters, pages, funnel, heatmap, buyer journey, ad spend, chart notes
- Public share page and badge.
- `/start` onboarding:
  - Self-host: a four-step checklist. The tracker and payment steps check themselves against real data.
  - Paid plans: a checkout link if the `PUBLIC_CHECKOUT_*` variables are set, otherwise a waitlist (`POST /api/waitlist`).
- Test site: tested by clicking through it in the browser. Source carry-over, goals, scroll depth and the visitor ID on the Stripe link all worked.

**Tracker fixes this session**
- Tagged links (`?utm_source=`, `?ref=`, `?via=`) now set the source. Before, they showed as "Direct" when there was no referrer.
- Moving between the site's own pages keeps the visit's original source (stored in sessionStorage as `gl_src`). Before, the last touch became the site's own domain, which broke last-touch attribution.

**Not verified**
- A real payment from any gateway. The user now has a Stripe account; keep using test mode.
- Stripe CLI 1.55.8 is installed at `~/.local/bin/stripe` (checksum verified); Homebrew couldn't install it because Xcode 26.3 is too old.
- Stripe sandbox "Grosslytics test" (`acct_1UYrzeGX7aKuUifN`) exists, and the CLI is switched to it. Never use `--live`.
  - The sandbox has a $9 test product with a Payment Link (https://buy.stripe.com/test_fZu3cvfGh7zbe3idbo8bS00). After paying, the buyer is sent back to http://localhost:3000/index.html.
  - The link is already in `examples/test-site/config.js`. The site ID there is still a placeholder.
- Paddle, Polar, Lemon Squeezy and Razorpay mappings have never been run against real payloads.

- Read time is now correct:
  - Leaving a tab first counts the time just read; before, it was thrown away and leaves mostly reported 0 seconds.
  - Each leave carries only the new seconds since the previous one (`events.duration_sec` holds these increments).
  - Repeats with no new reading time are dropped.
  - The dashboard's per-page read time adds up the increments for each visit.
  - Verified in a real browser: about 6 seconds on a page recorded one leave of 9s, and the visitor total was 9.

- `/app` sign-in flow:
  - The site list now has **Sign out**, and **Back to dashboard** when opened from the dashboard.
  - The dashboard toolbar shows a labelled **Sign out** button.
  - The site picker always shows, with an **Add another site…** option.
  - Verified in the browser: Add another site, then Back.
  - Adding a site now accepts `localhost` and pasted URLs (`https://www.acme.io/x` is saved as `acme.io`). API errors show as plain sentences instead of raw JSON.

- Theme:
  - Light is the default. A moon/sun button in the header switches to dark; the choice is saved as `gl_theme` in localStorage and applied before the page draws.
  - Dark is `:root[data-theme='dark']` in `global.css`. It no longer follows the OS setting.
- Dashboard redesign (`/app`):
  - Flat white page; the controls sit in a full-width sticky bar under the header.
  - Panels have 12px corners and thin borders; headline numbers are 30px; the three tips sit in one strip.
  - The big "Overview" title and the "Workspace" label are gone.
  - Share pages and the homepage preview keep a boxed toolbar (`page` flag in `Workspace`).
  - Checked in light and dark at 1440px.
  - Colour: blue only for the revenue series (chart bars, legend) and links. Row bars, heatmap, funnel, time-to-convert, lifetime value, sparklines, the active-number underline and the site tile are neutral ink and grey (user asked for less blue).

- Refunds:
  - A Stripe `charge.refunded` webhook with `refunded: true` (a full refund) adds a row to the new `refunds` table (migration 004) and sets the payment's status to `refunded`, so it drops out of revenue.
  - Payments are matched on `payment_intent` or `invoice`. Partial refunds and other gateways' refund events are ignored (`shortcut:` comment).
  - `stripe listen` must forward `checkout.session.completed,charge.refunded`.
  - **Verified with a real sandbox refund (2026-11-07):** the $9 test sale `pi_3UYsCCGX7aKuUifN1wvWb75v` was refunded with `stripe refunds create`. The webhook arrived, the payment became `refunded`, a red cell appeared on Fri 19:00 UTC, and net revenue went to $0.
  - "Recent sales" lists refunded payments with a red Refunded label and a struck-through amount (`DashSale.refunded`). The journey panel says the sale no longer counts as revenue. Revenue totals still exclude them. Verified in the browser.
  - Also fixed: "Time to convert" drew full bars beside 0% when there were no sales (0/0 width).
- "When buyers buy" heatmap:
  - Green for sales and red for refunds (`heatRefunds`, at the refund hour). An hour with both is green with a red dot.
  - Only hours with sales can be outlined as busiest. The caption now correctly says UTC.

**Known issues, not fixed**
- **Ad-blocker fix (2026-11-07):** the first real Stripe test sale ($9.00, fee $0.56) arrived correctly but was **Unattributed**, because the user's Chrome blocker dropped every visit. Two EasyPrivacy rules were the cause, checked against the actual list:
  - `/api/collect|$ping,xmlhttprequest` blocked our endpoint by name.
  - `*$ping,third-party` blocks every beacon sent to another domain, which would hit any API on a separate domain.
  - Fix: the tracker now posts to `/api/event` with `fetch` (keepalive, no-cors) instead of `sendBeacon`. `/api/collect` is still served for old snippets.
  - Neither rule matches the new setup (checked against EasyPrivacy and uBO's privacy list).
  - **Confirmed in the user's Chrome with a blocker on (2026-11-07):** the second $9 sandbox sale `pi_3UYsSuGX7aKuUifN3fcUXlir` was credited to `twitter` for both first and last touch, with 11s of read time. The journey recorded index, then pricing twice. The first sale (refunded) stays Unattributed, because that is what really happened.
  - Small gap: Stripe's redirect back after payment arrives with no referrer, so it's logged as "Direct (Shared Link)" and becomes the visitor's last touch for later purchases. Possible fix: recognise the post-checkout landing, for example with a `?gl=paid` marker on the success URL.
  - The tracker is 1,494 bytes Brotli.
- `visitors.total_sessions` goes up on every event, not every session. Nothing reads it yet.

**Known gaps** (also listed in DEPLOY.md under "Not production-ready")
- `/app` has one owner password, not per-user accounts. Only the fallback "API on another address" form still keeps a token in localStorage.
- One master `API_TOKEN` guards every site; per-site read-only tokens exist for MCP/scripts, but there is still no per-user login.
- Hosted Cloud accounts and billing are built (`CLOUD=1`) but not deployed; Lifetime license + installer built but not run against real Cloudflare/Stripe, and the CLI isn't on npm yet.
- The repo `vidneat/grosslytics` is private, so the clone command on `/start` only works for the owner.
- The waitlist has no rate limit.
- Ad spend is entered by hand.
- Country shows as Unknown locally, because geo data only comes from Cloudflare's edge.

## User preferences

- **Never fake anything:** no simulated payments or data passed off as real. If something needs a real website or account, say so plainly.
- Plain, non-technical explanations. The user tests in the browser.
- Commit only when asked. `origin/main` is at `08125e5`; branch `fix/live-csp-noindex` is 4 commits ahead, not pushed.
- Deploy later, when the user asks.

## Gaps and features pass (2026-11-07, committed a845a05, not pushed or deployed)

**Waitlist.** The form posts to `/api/waitlist`, which stores `(email, plan, created_at)` in D1 `waitlist`. Now: owner-only `GET /api/stats/waitlist` and a "Waitlist (n)" card at the bottom of `/app` with CSV download; a hidden honeypot field (`website`); and a Workers Rate Limiting binding `WAITLIST_LIMITER` (5/min per IP) in `wrangler.toml` and the installer's `apiToml`. Nothing emails signers or the owner; the card says to write to them by hand. Production count on 2026-11-07: 0 signups (`339454ee…`); analytics.vidneat.app's copy (`7d4d7f88…`, other account) had one test row. Both databases are named `grosslytics-db`; check the id in wrangler's output.

**Legal.** `/privacy` and `/terms` (operator David Mill, support@grosslytics.com, as the user chose), linked in the footer and under the waitlist form. Drafts written from what the code does; the user should have them reviewed. No governing law or refund window is stated; support@grosslytics.com must exist (Cloudflare Email Routing).

**Features (the pasted list):**
- Switching: tracker reads `data-umami-event`, `umami.track()`, Plausible `plausible-event-name=` classes; Stripe metadata `datafast_visitor_id`/`databull_visitor_id`; "Import past Stripe payments" card (`POST /api/stats/sites/:id/import/stripe`, 10 per call because of the Free-plan 50-query limit, sessions then invoices, real dates via new optional `PaymentRecord.createdAt`, key never stored). DataFast's cookie can't be read (we set no cookies); /docs says to send `gl_vid` instead.
- AI crawlers: `POST /api/crawl {sid,path,ua}` from the owner's server (Next.js and Worker snippets in /docs#ai-crawlers), stored per day/bot/path in new table `ai_crawls` (migration 010). JS-running crawlers hitting `/api/event` now go there too instead of becoming visitors. Panel "AI bots reading your pages". Unauthenticated, like page views.
- Click map: opt-in `/c.js` (656 B Brotli, source `packages/tracker/src/c.ts`) sends `t:'click'` events with `{el, dead, rage}`; panel "What people click" with buyers per element. Clicks are hidden from buyer journeys and count toward Cloud's event cap.
- Ad spend: CSV import card (`POST /api/stats/ad-spend/bulk`, up to 2,000 rows, quoted "$1,200" handled) and MER in "Where the money goes". Meta/Google/X/LinkedIn OAuth not built: Google Ads needs an approved developer token and Meta an app review.
- Tax: Stripe, Paddle, Polar, Lemon Squeezy and RevenueCat tax is removed from gross; the fee is still computed on the full charge.
- Gateways: Cashfree (base64 HMAC of timestamp+body), Gumroad (form pings, `&key=` in the URL, refunds), PayPal (verified through PayPal's verify-webhook-signature API; secret `client_id:client_secret:webhook_id[:sandbox]`; real fee), RevenueCat (Authorization header; commission and tax from the event). Tracker tags Gumroad links with `visitor_id`. All four built from documentation only; **no real payload has been run**.
- The build limit is 1,587 B Brotli, the most that still rounds to the "1.5 KB" on the site.
- Homepage, /docs (switch, AI crawlers, click map sections; new endpoints), llms.txt updated.

**Verified:** 45 tests (6 new API tests, 1 tracker, 1 CSV parser), typecheck in every package, web build, `wrangler deploy --dry-run` shows the rate-limit binding, local migration applied. In the browser (local): waitlist join, Privacy/Terms/Docs render, no overflow at 375px, no console errors; c.js on the test site recorded dead and rage clicks; `/api/crawl` filled `ai_crawls`. Test rows were deleted afterwards.
**Not verified:** the new `/app` panels and cards while signed in (needs the user's local password); any real Cashfree/Gumroad/PayPal/RevenueCat/Stripe-import call.

**Still the user's to do (can't be done in code):**
1. Set the dashboard password on grosslytics.com/app (`passwordSet:false` live).
2. Make `vidneat/grosslytics` public, or publish the CLI to npm; `/start` and /docs tell visitors to clone a private repo.
3. Open a paid plan: `LICENSE_SECRET`, R2 bucket + release, Stripe Payment Link + billing webhook, `PUBLIC_CHECKOUT_LIFETIME_URL`.
4. Create support@grosslytics.com in Cloudflare Email Routing.
5. Push/merge, then deploy. Migration 010 (`ai_crawls`) is already applied to grosslytics.com’s database (339454ee…, 2026-11-07); analytics.vidneat.app’s gets it on its next `bun run setup`.

## Review fixes (2026-11-07, committed 624d478, deployed (now a92c30b))

A full review found the issues below; all "must" and "should" items are fixed. 50 tests pass (6 new); typecheck passes in web, API, CLI, db-d1 and shared; the web build passes; `wrangler deploy --dry-run` shows both rate limiters.
- **Cloud site takeover:** `requestSite` (`cloud.ts`) reads every place a site can be named (query, path, body, revoked token) and refuses when they disagree. Before, `POST /sites/<theirs>/secrets?siteId=<mine>` passed the ownership check.
- **Install-wide lists:** `gl_pat_` tokens can no longer read `/api/stats/waitlist` or `/api/stats/sites`, and Cloud sessions can't read the waitlist (`auth.ts`).
- **Lockout race:** each login claims a try in one `UPDATE … RETURNING` before the PBKDF2 check (`attempt()` in `routes/auth.ts`); 20 parallel wrong guesses check at most 5.
- **Share/badge cache:** `/api/share/*` is stored in the Cloudflare Cache API for 60s, without CORS headers (`routes/share.ts`). Turning a page off takes up to a minute to show.
- **Pruning:** daily cron `17 3 * * *` (root `wrangler.toml` and the installer's `apiToml`) deletes `processed_messages` older than 14 days and expired sessions (`cleanup()` in `consumer.ts`). `events` are kept: deleting user data needs a retention setting first.
- **Live hub:** the eviction alarm runs only while someone is online.
- **Devices:** iOS before macOS, Android before Linux; Edge (`Edg/`), Opera (`OPR/`), CriOS/FxiOS recognised (`parseDevice`).
- **SPA page views:** `g.js` wraps `history.pushState` and listens for `popstate`. A path change sends a leave for the old page and a pageview for the new one. To fit the size budget, the tracker no longer sends its own channel guess (`cat`); the server works it out (`classifySourceCategory` now treats any `utm_medium` containing "mail" or "newsletter" as Email). The session key changed from `gl_src` to `gl_s` (c.js too). 1,560 B Brotli. /docs updated.
- **Cloud sign-up limit:** new `SIGNUP_LIMITER` binding (5/min per IP), in both toml files.
- **Removed:** `packages/db-clickhouse`, `docker-compose.clickhouse.yml`, the `AnalyticsStorageAdapter` interface, `upsertPayment`, `calculateRPV`/`linearSplitPayment`/`calculateTrueProfit`, unused constants and schemas, and the never-built `custom` date range in the filter store.
- **Migration 011:** copies the old `sites.*_webhook_secret` values into `site_secrets` and empties the old columns; the API now reads only `site_secrets` (then env secrets on self-host). Applied to the local DB. **Run `bun run db:migrate:remote` (or `bun run setup`) before deploying**, or sites whose secret was only on the old column stop verifying webhooks.
- **Dashboard:** owner settings moved to a Settings view (toolbar button, `/app#settings`): public page, timezone, payment webhooks, Stripe import, ad-spend CSV, chart notes (new: delete, via `POST /api/stats/annotations/:id/delete` with `siteId`), API tokens, waitlist. Failed saves show the error. The empty dashboard points to Settings for payments. The one-minute refresh skips hidden tabs and catches up when shown.
- Browser-checked locally (port 4321, via a temporary read-only token, since deleted): dashboard loads, Settings opens at `#settings`, a refused save shows its message, notes list with Delete, no horizontal scroll at 375px. Not clicked with a full owner session (needs your password): timezone, webhooks and a real note delete.
- Nice-to-haves, also fixed: the dashboard refreshes on every live sale (it used to stop after 8, because it counted the capped live list; `useLiveSocket` now returns a `sales` counter). The MCP tool `compare_buyer_reading_time` now returns the real buyers-vs-everyone-else rows from the dashboard. MCP `range`/`model` are validated and a bad value comes back as an `isError` tool result. A stale size comment was removed from `packages/tracker/build.ts`. MCP covered by the `mcp:` test. The live-sale refresh was not checked with a real sale.
- Not done (competitor gaps): custom date ranges, goals by name, alerts/email reports, CSV export, team members, refunds outside Stripe.

## Dodo Payments checkout links, Cloud at $5.99 (2026-11-07, committed 624d478, deployed (now a92c30b))

- The user created two Dodo Payments products. Their links are the defaults in `apps/web/src/lib/checkout.ts` (overridable with `PUBLIC_CHECKOUT_LIFETIME_URL` / `PUBLIC_CHECKOUT_CLOUD_URL`):
  - Lifetime $29: `pdt_0NrRPjE8ZMtW2BNM0a6bm`, redirect `https://grosslytics.com/license`. `/start?plan=lifetime` now shows "Continue to checkout" instead of the waitlist.
  - Indie Cloud: `pdt_0NrRQDwasogpEvsc1LfyF`, redirect `/app`. The dashboard's Subscribe button adds `email` and `metadata_account_id` (Dodo's prefill and metadata parameters).
- Indie Cloud is now **$5.99/month** everywhere: homepage pricing and FAQ, /start, the dashboard button, the ROI calculator note, compare pages, Terms, llms.txt and DEPLOY.md. Cloudflare's own "$5/month Workers plan" mention is unchanged. `CLOUD_PRICE` in `checkout.ts` feeds the React views.
- Dodo fulfilment is built (see "Dodo billing webhook" below).
- Verified: web typecheck and build, 50 tests, `/start?plan=lifetime` links to the Dodo URL, homepage shows $5.99 with no overflow at 375px.

## Dodo billing webhook (2026-11-07, committed 624d478, deployed (now a92c30b))

- `POST /api/billing/dodo` (`routes/billing.ts`), signed with `DODO_BILLING_WEBHOOK_SECRET` (Standard Webhooks; the check is now shared with Polar as `verifyStandardWebhook` in `verify.ts`).
  - `payment.succeeded` with no `subscription_id` mints a Lifetime license keyed on the Dodo `payment_id` (optionally only if `product_cart` has `LIFETIME_PRODUCT_ID`).
  - `subscription.active`/`renewed` → account `active`, matched by `metadata.account_id` (the dashboard's `metadata_account_id`) or the stored subscription id; the Dodo subscription id goes in `stripe_subscription_id` (column name is historical). `on_hold` → `past_due` (still tracking); `cancelled`/`failed`/`expired` → `canceled`, and these only match the account's current subscription, so an old one expiring after a re-subscribe can't switch it off. `next_billing_date` → `current_period_end`.
  - No event ordering (marked `shortcut:`), no refund handling: a refunded Lifetime key keeps working.
- `/api/license/claim` takes `payment_id=pay_…` (or Stripe's `session_id=cs_…`); `/license` reads `payment_id` first, and its text no longer says Stripe. DEPLOY.md's Cloud and Lifetime steps now describe Dodo.
- Verified: 51 tests (new `dodo:` test with signed payloads), edge-api and web typecheck. Not browser-checked (dev servers weren't running).
- Deployed 2026-11-07: grosslytics.com as `2026-11-07-928f436`; R2 `latest.tgz` re-uploaded from 928f436, so Lifetime installs (including analytics.vidneat.app) get Dodo on their next `npx grosslytics install`. Checked live: pages and API 200, `/api/webhooks/dodo` is a known gateway ("Unknown site" for a bad siteId, while an unknown gateway says "Unknown gateway"), `/g.js` tags Dodo links, homepage lists Dodo. Wrangler is signed in to ravi88927615 again.
- Not verified: Dodo's real payload field names (`payment_id`, `subscription_id`, `product_cart`, `customer.email`, `customer.customer_id`, `metadata.account_id`, `next_billing_date`) come from Dodo's docs, not a live event. Before launch, use Dodo's test mode: send a test event or make a test purchase, and confirm `/license?payment_id=…` shows a key and a Cloud subscription turns the account active.
- Deployed 2026-11-07 to grosslytics.com from branch `feat/dodo-billing` (commit 624d478, not pushed, not merged) with `CLOUDFLARE_ACCOUNT_ID=f6883459148b86e04de194a74b9ad66d bun run setup`; version `2026-11-07-624d478`. Migration 011 ran on the live DB (it had no legacy secrets).
  - Live secrets on `grosslytics-edge-api`: `API_TOKEN`, `DODO_BILLING_WEBHOOK_SECRET`, `LIFETIME_PRODUCT_ID` (a secret, not a `[vars]` entry: production deploys use the generated `grosslytics-install/release/api/wrangler.toml`, whose `[vars]` come from `apiToml()` and would drop a root `wrangler.toml` var).
  - Checked live: `/`, `/app`, `/g.js`, `/api/auth/status` 200; homepage shows $5.99; unsigned `POST /api/billing/dodo` → 401.
  - `LICENSE_SECRET` set on the live API 2026-11-07; a copy is in `.secrets/production-license-secret.txt` (mode 600, never print it, never change it or every key stops working). Live `/api/license/claim` now answers 404 "not confirmed yet" for unknown payments instead of 503.
  - R2 enabled by the user 2026-11-07. Bucket `grosslytics-releases` created; `latest.tgz` (now release 7a45fa5, built without `PUBLIC_*`); `state.json` has `"releasesBucket": "grosslytics-releases"`, so `bun run setup` binds it as `RELEASES`. Redeployed as `2026-11-07-a92c30b` (latest live). Re-run `bun scripts/release.ts --upload` after every change buyers should get.
  - Checked live: `/`, `/app`, `/license/`, `/api/auth/status` 200; claim for an unknown payment → 404; download with a made-up key → 401. **Not verified end to end:** no real Dodo test purchase yet, so no real key has claimed or downloaded a release.
  - `CLOUD` is off, so no one can sign up for Indie Cloud and a subscription has no account to switch on.
  - The Dodo webhook endpoint in Dodo's dashboard: unknown whether the user has added it.

## Open source (AGPL) + Lifetime extras (2026-11-07, public, merged to main, deployed)

- Decision (user): option 2. Code becomes public under AGPL-3.0; self-host stays free with every feature. Lifetime ($29) = one-command installer/updates (no git or Bun) + priority email support (support@grosslytics.com) + a commercial license (modify and run it for yourself or clients without AGPL's publish-your-changes rule; no reselling or public hosted service), framed as backing the project.
- Added `LICENSE` (official AGPL-3.0 text from gnu.org), `README.md`, `"license": "AGPL-3.0-only"` in package.json. Copy updated: homepage pricing cards, hero/CTA lines, FAQ (new "Is it open source?" and "Why buy Lifetime?"), /start plan notes and Lifetime checkout text, compare pages (Grosslytics now "open source"), Terms (AGPL, Lifetime commercial license terms, Dodo as merchant of record instead of Stripe), llms.txt.
- Verified: web typecheck, build, 51 tests; pricing cards checked in the browser from the built pages at 1024px.
- Done 2026-11-07 (user approved all three): `feat/dodo-billing` fast-forwarded into `main` and pushed (origin/main = 56b0959); repo `vidneat/grosslytics` made **public** (anonymous `git ls-remote` works, GitHub page 200); grosslytics.com redeployed as `2026-11-07-56b0959`. Checked live: `/`, `/start/`, `/terms/`, compare pages, `/app`, API 200; new pricing/FAQ/Terms text is up; README is on GitHub.
- Still open: HANDOFF.md (public, with history) shows personal emails and Cloudflare account IDs (user was told, chose to go ahead). The commercial-license wording in Terms is not lawyer-reviewed. `grosslytics@0.1.0` is published on npm (2026-11-07, account `grosslytics`, 2FA on; publishing needs the user's browser approval). Checked from an empty folder: `npx grosslytics --version` → 0.1.0 and `install --help` works. Not checked: a full `npx grosslytics install` with a real license key (needs a real Dodo purchase). Next CLI release: bump `packages/cli/package.json` version, then `npm publish --access public` from `packages/cli`. The R2 release (`latest.tgz`) is 7a45fa5 (uploaded by the user 2026-11-07), matching the open-source copy. GitHub hadn't detected the license yet right after the switch (`licenseInfo` empty).

## Installer overwrote grosslytics.com's API (2026-11-08, fixed)

- The user ran `npx grosslytics install` for analytics.vidneat.app (folder `/Users/raviair/grosslytics-install`) while Wrangler was signed in to ravi88927615. Same worker names, so it deployed vidneat's API config over grosslytics.com's `grosslytics-edge-api` (version c0493f30, 2026-11-07 18:27 UTC): `TRACKER_ORIGIN` = analytics.vidneat.app and no `RELEASES` binding, so every license download answered "No release has been published yet". The website worker and data were not affected (no noindex header, sitemap intact, same D1).
- Fixed by redeploying grosslytics.com with `bun run setup` (version fcb6bd9b): `RELEASES` and `TRACKER_ORIGIN = https://grosslytics.com` are back; pages, API, tracker 200; no `X-Robots-Tag`.
- analytics.vidneat.app after the update (2026-11-08): working. Checked end to end: vidneat.app's tag (`gl_dcaf7971586a`) and CSP, `g.js` 200, `/api/event` 202 and a presence update (seen with `wrangler tail`), the visit stored in D1; the user's dashboard then showed 2 online, including their own tab. Their earlier visits never reached the API, most likely because the browser had cached the hostname as missing after the delete-and-recreate; the update replaced nothing (same D1, same site). Its data includes two visits from Claude's checks: visitor `deploycheck` (a synthetic POST) and `5lugzry8jwtmw6ax9zu` (a real browser visit).
- Guard added (CLI 0.1.1, not yet on npm): after picking the account, the installer reads the existing `grosslytics-edge-api`'s `TRACKER_ORIGIN` (`wrangler deployments list --json` → `versions view --json`) and refuses if it serves a different hostname. Checked live against the vidneat account (reads `analytics.vidneat.app`); unit test for the parsing. Publish: `cd packages/cli && npm publish --access public` (browser approval).

## Dodo Payments as a customer payment provider (2026-11-07, deployed)

- `dodo` is the 10th gateway (`PAYMENT_GATEWAYS`). `POST /api/webhooks/dodo?siteId=…`, secret saved per site in Settings → Payment webhooks (no env fallback), verified with the shared Standard Webhooks check.
  - `payment.succeeded` → a sale `dodo_<payment_id>`: `total_amount` and `tax` in cents (tax taken out of revenue), `metadata.visitor_id` for attribution, `billing.country/city`, fee estimated at 4% + 40¢.
  - `refund.succeeded` with `is_partial: false` marks it refunded; partial refunds, or a refund without `is_partial`, are ignored.
  - shortcut: every subscription payment counts as a new sale (Dodo doesn't flag renewals).
- Tracker tags `*dodo*` checkout links with `metadata_visitor_id` (1,580 bytes Brotli, budget 1,587; ~7 bytes left).
- Copy: homepage lists, FAQ, docs provider table, dashboard settings + live feed label, compare pages (DataBull no longer leads on Dodo; our provider list now names all 10), README, llms.txt.
- Verified: 52 tests (new `Dodo Payments:` API test with signed payloads, tracker link test), typecheck in all packages, web build.
- Not verified: Dodo's real payload field names (`total_amount`, `tax`, `billing`, `product_cart[].name`, refund `is_partial`) are from Dodo's docs, not a live event. First check: a test-mode purchase on vidneat.app with its webhook pointed at analytics.vidneat.app.

## analytics.vidneat.app removed (2026-11-07)

- The user removed the vidneat.app install from Cloudflare account ravi923615 (`a54e52e1…`): workers `grosslytics-web` (with the `analytics.vidneat.app` custom domain) and `grosslytics-edge-api`, queues `grosslytics-ingest` and `grosslytics-ingest-dlq`, and D1 `grosslytics-db` (`7d4d7f88…`, its data is gone). Checked: none listed any more; `analytics.vidneat.app` no longer resolves; grosslytics.com unaffected.
- Lesson: run wrangler for the vidneat account from outside this repo (`cd ~ && CLOUDFLARE_ACCOUNT_ID=a54e52e1… npx wrangler …`). Inside the repo, `node_modules/.cache/wrangler` pins the grosslytics.com account (`f6883459…`); several deletes went there and only failed because wrangler was signed in to the other account.
- Not done: vidneat.app still loads the tracker (`~/Applications/VidNeatWeb`: `src/layouts/BaseLayout.astro` script tag, `public/_headers` CSP, `src/pages/legal/privacy-policy.astro`). Wrangler was switched back to ravi88927615 afterwards.

## Brand icon files (2026-11-07)

- There was no icon file and no favicon; the mark only existed as inline SVG in `apps/web/src/components/site/Logo.astro`. `brand/` now holds `icon.svg` (white rounded tile), `mark.svg` (bare mark, transparent), `icon-1024.png` and `icon-512.png` (rendered with macOS Quick Look). Made for the Dodo Payments product image. Not wired in as the site favicon yet.

## Local test-site recipe

- Site `localhost` (`gl_8b5e717a83ac`) plus the sandbox Payment Link. Stripe's test webhook secret is in `site_secrets` for that site (moved there from `sites.stripe_webhook_secret` by migration 011).
- Forwarding: `stripe listen --events checkout.session.completed,invoice.paid,invoice_payment.paid,charge.refunded --forward-to "localhost:8787/api/webhooks/stripe?siteId=gl_8b5e717a83ac"`, then `bun run dev:test-site` (port 3000).
