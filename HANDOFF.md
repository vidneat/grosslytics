# Handoff

The current state of Grosslytics, kept up to date at the end of each work session. Read this first instead of replaying old conversations. Last updated: 2026-11-07.

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
- `packages/tracker`: source for `g.js`. Run `bun run build` in that folder, then copy `dist/g.js` to `apps/web/public/g.js`. The build fails above 1,500 bytes Brotli; it is currently 1,494 (1.46 KB, quoted on the site as 1.5 KB). It has tests in `src/g.test.ts`, which run the built file, so build before testing.
- `packages/db-d1`: `queryDashboard` (one batched set of SQL queries) and migrations 001–003.
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
- `bun test`: 15 tests pass (11 for the API, 4 for the tracker).
- `cd apps/web && bunx astro build`: passes.
- `bunx astro check` is slow (over 2 minutes), so it hasn't been relied on.

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
- Real deploy to Cloudflare.

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
- The collect endpoint doesn't check that a visit comes from the site's domain. Anyone with a site ID can send visits to it. Revenue is safe, because payments must be signed.
- `visitors.total_sessions` goes up on every event, not every session. Nothing reads it yet.

**Known gaps** (also listed in DEPLOY.md under "Not production-ready")
- The API token lives in localStorage.
- One `API_TOKEN` guards every site.
- No hosted cloud and no user accounts.
- The repo `vidneat/grosslytics` is private, so the clone command on `/start` only works for the owner.
- The waitlist has no rate limit.
- Ad spend is entered by hand.
- Country shows as Unknown locally, because geo data only comes from Cloudflare's edge.

## User preferences

- **Never fake anything:** no simulated payments or data passed off as real. If something needs a real website or account, say so plainly.
- Plain, non-technical explanations. The user tests in the browser.
- Commit only when asked. Nothing has been committed since `97d554c`; every change above is uncommitted in the working tree.
- Deploy later, when the user asks.

## Next steps

0. End-to-end with real pieces is done: browser → tracker (through a blocker) → API → Stripe sandbox checkout → webhook → attributed sale → refund → red heatmap cell.
1. The test site is configured: site `localhost` (`gl_8b5e717a83ac`) plus the sandbox Payment Link.
   - Stripe's test webhook secret is stored on that site's row (`sites.stripe_webhook_secret`), so `.dev.vars` doesn't need it.
   - Forwarding: `stripe listen --events checkout.session.completed,charge.refunded --forward-to "localhost:8787/api/webhooks/stripe?siteId=gl_8b5e717a83ac"`.
   - Serve the site with `bun run dev:test-site` (port 3000). Make a test purchase and confirm it is credited to its source, with its journey.
2. Commit, then deploy (DEPLOY.md steps 1–11).
