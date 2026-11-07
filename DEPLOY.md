# Deploying Grosslytics to Cloudflare

You deploy two Workers:

| Worker | Config | Serves |
|---|---|---|
| `grosslytics-edge-api` | `wrangler.toml` (repo root) | `/api/*`: collect, stats, webhooks, MCP, plus the queue consumer and Durable Object |
| `grosslytics-web` | `apps/web/wrangler.toml` | The Astro site, `g.js`, `robots.txt`, `llms.txt` |

Both must sit on **one domain**. The tracker sends beacons to `<origin of g.js>/api/event`, so `/api/*` on the site's domain has to reach the edge API. The examples below use `grosslytics.com`. Replace it with your own domain.

---

## Quick setup (recommended)

```bash
bun run setup
```

Needs Bun and Node.js 18+ (the installer prompts run on Node; Bun 1.4 drops typed input). One command does steps 2 to 10 below. It builds the code, signs in to Cloudflare (click **Allow**), creates the D1 database and both queues, runs every migration, deploys the API (`<host>/api/*`) and the website (custom domain `<host>`), and sets a random `API_TOKEN` plus your dashboard password. It prints the dashboard address and the `API_TOKEN` once, so save the token.

Before the first run:
- **New Cloudflare account:** open Workers & Pages in the dashboard once, so Cloudflare creates your workers.dev subdomain. Deploys are refused without it.
- **Your hostname must have no DNS records** (A, AAAA or CNAME). Cloudflare won't attach a custom domain over existing records.

It keeps its settings in `grosslytics-install/state.json`, which git ignores. Run it again in the same folder to update; that doesn't change your password or API_TOKEN. The manual steps below show what it does, for when you need to change one part.

## 0. Run everything locally first

Create `.dev.vars` in the repo root (it's gitignored). Use any long random strings:

```
API_TOKEN=<long random string>
STRIPE_WEBHOOK_SECRET=whsec_<anything>
```

Create the local tables and load 180 days of sample data for `acme.io` (site id `gl_local_acme`). This only touches the local database in `.wrangler/`:

```bash
bun run db:seed:local
```

Start the API (port 8787) and the website (port 4321) in two terminals:

```bash
bun run dev:api
```

```bash
bun run dev:web
```

Then:

- http://localhost:4321/app/ connects to your local API. Paste the `API_TOKEN` from `.dev.vars` and pick `acme.io`.
- http://localhost:4321/share/acme.io is the public revenue page. No token is needed, and it shows no customer emails.
- http://localhost:4321/app/demo is the sample workspace used on the homepage.

### Test the whole flow with a real browser and real Stripe test payments

`examples/test-site` is a three-page site (home, blog, pricing) that loads your local tracker. Its Buy button opens a Stripe test-mode checkout. Nothing is simulated: the visits come from your browser and the payment comes from Stripe, signed, with no real money.

You need a free Stripe account and the Stripe CLI (`brew install stripe/stripe-cli/stripe`).

1. In http://localhost:4321/app/ connect, then **Add site** with the domain `localhost`. Copy its site id (`gl_…`).
2. In Stripe, switch to **Test mode** and create a **Payment Link** for any product and price.
3. Put both values in `examples/test-site/config.js`.
4. Forward Stripe's test webhooks to your local API. Use your site id:
   ```bash
   stripe login
   ```
   ```bash
   stripe listen --events checkout.session.completed,invoice.paid,invoice_payment.paid,charge.refunded --forward-to "localhost:8787/api/webhooks/stripe?siteId=gl_YOUR_SITE_ID"
   ```
   It prints a signing secret (`whsec_…`). Set it as `STRIPE_WEBHOOK_SECRET` in `.dev.vars` and restart `bun run dev:api`.
5. Serve the test site:
   ```bash
   bun run dev:test-site
   ```
6. Open a private window at http://localhost:3000/index.html?utm_source=twitter. Read the blog, go to Pricing, click **Buy** and pay with `4242 4242 4242 4242`, any future date, any CVC.
7. The visit appears in the live panel straight away. The sale appears once `stripe listen` shows the webhook as `200`, credited to `twitter`. Click it to see the journey.

Each private window is a new visitor. Locally every country shows as Unknown, because only Cloudflare's edge adds geo data.

---

## 1. Check the code locally

```bash
bun install
```

```bash
bun test packages apps
```

```bash
bun run typecheck
```

All tests should pass. Then check that both Workers bundle without errors:

```bash
bunx wrangler deploy --dry-run --env=""
```

```bash
cd apps/web && bun run build && bunx wrangler deploy --dry-run
```

## 2. Log in to Cloudflare

```bash
bunx wrangler login
```

Your domain needs to be on Cloudflare (as a zone) before step 9.

## 3. Durable Object storage

`wrangler.toml` uses SQLite-backed Durable Objects (`new_sqlite_classes`), which work on both the Workers Free and Paid plans. Leave it that way: the storage type can't be changed after the first deploy.

## 4. Create the D1 database

```bash
bunx wrangler d1 create grosslytics-db
```

Copy the `database_id` it prints into `wrangler.toml`, replacing `database_id = ""`.

## 5. Create the database tables

```bash
bun run db:migrate:remote
```

This applies every migration in `packages/db-d1/src/migrations.ts` to your Cloudflare D1. It's safe to re-run after updates, because each table is created only if it doesn't already exist.

Existing installs must rerun `bun run db:migrate:remote` for migration 005 before deploying this version. It adds transactional delivery receipts and payment/refund references without rewriting existing events or payments. Previously duplicated visits and lost attribution are not reconstructed automatically.

## 6. Create the queues

`wrangler.toml` uses both an ingest queue and a dead-letter queue:

```bash
bunx wrangler queues create grosslytics-ingest
```

```bash
bunx wrangler queues create grosslytics-ingest-dlq
```

## 7. Register your site

Choose a site ID (for example `gl_live_abc123`) and add your site's row:

```bash
bunx wrangler d1 execute grosslytics-db --remote --command "INSERT INTO sites (site_id, domain, name, currency) VALUES ('gl_live_abc123', 'yourdomain.com', 'Your Startup', 'USD');"
```

Each site has one reporting currency: USD, EUR, GBP or INR. Choose it when adding a site in `/app`, or set the `currency` column in the insert above. New webhook payments in another currency return `422` without claiming the event. Historical payments in other currencies remain stored, but are excluded from totals and listed in a dashboard notice. No exchange-rate conversion is performed.

## 8. Set secrets

**API token (required).** `/api/stats` and `/api/mcp` refuse every request until this is set. Generate a random token, keep it in your password manager, and paste it when prompted:

```bash
openssl rand -hex 32
```

```bash
bunx wrangler secret put API_TOKEN
```

**Webhook signing secrets.** Set one for each gateway you use. Unsigned webhooks, or webhooks for a gateway with no secret, are rejected with `401`.

```bash
bunx wrangler secret put STRIPE_WEBHOOK_SECRET
```

```bash
bunx wrangler secret put RAZORPAY_WEBHOOK_SECRET
```

```bash
bunx wrangler secret put POLAR_WEBHOOK_SECRET
```

```bash
bunx wrangler secret put PADDLE_WEBHOOK_SECRET
```

```bash
bunx wrangler secret put LEMONSQUEEZY_WEBHOOK_SECRET
```

You get each value in step 11, when you create the webhook in that gateway's dashboard. Run the matching command then. For multiple sites, you can instead store a site's own secret in its `sites` row (`stripe_webhook_secret`, `razorpay_webhook_secret`, `polar_webhook_secret`, `paddle_webhook_secret`). A site's own secret is used before the env var.

## 9. Route `/api/*` to the edge API

Add this to the root `wrangler.toml`, with your domain:

```toml
routes = [
  { pattern = "grosslytics.com/api/*", zone_name = "grosslytics.com" }
]
```

Also set `TRACKER_ORIGIN` under `[vars]` to your domain.

The dashboard calls the API on its own origin (`/api/*`), so on one domain nothing else is needed. If the API lives on a different host, build the website with `PUBLIC_API_URL=https://api.yourdomain.com`.

Optional website build settings, set when running `bun run build` in `apps/web`:

| Variable | Effect |
|---|---|
| `PUBLIC_API_URL` | API on a different host than the website |
| `PUBLIC_CHECKOUT_CLOUD_URL` | Checkout link for the $5.99/month Indie Cloud subscription. Defaults to Grosslytics' Dodo Payments link (`apps/web/src/lib/checkout.ts`). Used only on Hosted Cloud, from the dashboard's Subscribe button, which adds `email` and `metadata_account_id` |
| `PUBLIC_STRIPE_PORTAL_URL` | Stripe customer portal login link, for the dashboard's "Manage billing" |
| `PUBLIC_CHECKOUT_LIFETIME_URL` | Checkout link for the $29 Lifetime license. Defaults to Grosslytics' Dodo Payments link (`apps/web/src/lib/checkout.ts`) |
| `PUBLIC_REPO_URL` | Repository that `/start` tells people to clone. Defaults to `https://github.com/vidneat/grosslytics` |

Waitlist signups are stored in the `waitlist` table: `bunx wrangler d1 execute grosslytics-db --remote --command "SELECT * FROM waitlist"`.

## 10. Deploy

The edge API (from the repo root):

```bash
bunx wrangler deploy --env=""
```

The website:

```bash
cd apps/web && bun run build && bunx wrangler deploy
```

Then go to Cloudflare dashboard → Workers → `grosslytics-web` → Settings → Domains & Routes and add `grosslytics.com` as a **custom domain**. The more specific `/api/*` route from step 9 takes priority over it.

> `apps/web/public/.assetsignore` stops the server bundle (`_worker.js`) from being uploaded as public files. Don't delete it.

Then open `https://grosslytics.com/app`. On the first visit it asks for your `API_TOKEN` once and a dashboard password; after that you sign in with the password only. The session is an HttpOnly cookie, so no secret is kept in the browser's storage. Forgot the password? Click **Forgot password?** and set a new one with `API_TOKEN`; that signs out every other session. Five wrong passwords lock sign-in for 15 minutes.

Password sign-in needs the dashboard and API on the same domain (the setup above). If the API lives elsewhere (`PUBLIC_API_URL`), `/app` shows the API URL + token form instead.

## 11. Point your payment gateways at the API

Use `https://grosslytics.com/api/webhooks/<gateway>?siteId=<your site id>`. `siteId` is required.

| Gateway | URL suffix | Events to subscribe |
|---|---|---|
| Stripe | `/stripe` | `checkout.session.completed`, `invoice.paid`, `invoice_payment.paid`, `charge.refunded` |
| Razorpay | `/razorpay` | `payment.captured` |
| Polar | `/polar` | `order.paid` |
| Paddle | `/paddle` | `transaction.completed` |
| LemonSqueezy | `/lemonsqueezy` | `order_created`, `subscription_payment_success` |

Copy each signing secret into step 8. `invoice_payment.paid` connects modern Stripe invoice IDs to their PaymentIntent IDs so refunds can arrive in either order. Full Stripe refunds are supported; partial refunds still need amount-based accounting.

**How sales get linked to visitors:** the tracker tags Stripe links with `client_reference_id`, Polar links with `reference_id`, and LemonSqueezy links with `checkout[custom][visitor_id]`. Paddle and Razorpay require their checkout SDK or server integration; adding a URL parameter alone does not attach metadata. For checkouts created in code, pass the visitor ID yourself:

- Stripe: `client_reference_id`
- Razorpay: `notes.visitor_id`
- Paddle: `custom_data.visitor_id`
- Polar: `metadata.visitor_id`

Read the ID with `localStorage.getItem('gl_vid')`. Renewals with no visitor ID are still attributed through the customer's email hash.

## 12. Add the tracker to your site

```html
<script defer src="https://grosslytics.com/g.js" data-site-id="gl_live_abc123"></script>
```

If `g.js` is served from a different origin than the API, add `data-api="https://<api-host>/api/event"`.

## 13. Check that it works

Send a test beacon. It should return `202`:

```bash
curl -i -X POST https://grosslytics.com/api/event -d '{"sid":"gl_live_abc123","vid":"test","ses":"test","t":"pageview","n":"/","src":"Direct (Typed/Bookmark)","cat":"Direct","ref":"","sd":0,"dur":0}'
```

Within a few seconds, the queue consumer should have written it:

```bash
bunx wrangler d1 execute grosslytics-db --remote --command "SELECT COUNT(*) FROM events;"
```

Stats need your token. Without it you get `401`:

```bash
curl -H "Authorization: Bearer $GROSSLYTICS_API_TOKEN" "https://grosslytics.com/api/stats?siteId=gl_live_abc123&model=linear"
```

For webhooks, send a test event from each gateway's dashboard and check the `payments` table. You can also watch the live logs:

```bash
bunx wrangler tail grosslytics-edge-api
```

Finally, delete the test rows (`DELETE FROM events WHERE visitor_id = 'test'`).

## 14. Connect an AI assistant (optional)

To add it to Claude Code over HTTP:

```bash
claude mcp add --transport http grosslytics "https://grosslytics.com/api/mcp?site=gl_live_abc123" --header "Authorization: Bearer $GROSSLYTICS_API_TOKEN"
```

For stdio-only clients, run `GROSSLYTICS_API_TOKEN=... npx grosslytics mcp --site gl_live_abc123`. This needs the `grosslytics` CLI package published to npm. Until then, build `packages/cli` and run `node packages/cli/dist/index.js mcp ...`.

---

## Running Hosted Cloud (Indie Cloud, $5.99/month)

This is only for you, the operator selling the hosted plan. Self-hosters skip it. It's the same code with one extra setting. Customers sign up on `/app` with an email and password, get 14 days free with no card, add sites, and can track up to 100,000 events a month. After the trial, or once a subscription ends, tracking pauses: visitors' pages don't notice anything, and the dashboard stays readable.

1. Deploy as in steps 1–10, with `CLOUD = "1"` under `[vars]` in `apps/edge-api/wrangler.toml` (or `--var CLOUD:1`). `API_TOKEN` stays your admin key; customers never see it.
2. In Dodo Payments (test mode first), create a $5.99/month subscription product and copy its checkout link. Build the website with `PUBLIC_CHECKOUT_CLOUD_URL=<that link>` (Grosslytics' own link is the default). The dashboard adds `metadata_account_id=<account id>` and the customer's email to it.
3. Optionally build with `PUBLIC_STRIPE_PORTAL_URL=<your billing portal link>` (any provider's customer portal; the name is historical) so customers can manage their subscription.
4. In Dodo, go to Developer → Webhooks and add `https://yourdomain.com/api/billing/dodo` with the events `payment.succeeded`, `subscription.active`, `subscription.renewed`, `subscription.on_hold`, `subscription.cancelled`, `subscription.failed` and `subscription.expired`. Then run `bunx wrangler secret put DODO_BILLING_WEBHOOK_SECRET` with its signing secret (`whsec_…`). Stripe still works instead: a webhook to `/api/billing/stripe` (`checkout.session.completed`, `customer.subscription.updated`, `.deleted`) with `STRIPE_BILLING_WEBHOOK_SECRET`, and a Payment Link the dashboard opens with `client_reference_id`.
5. Customers connect their own payment providers on `/app` → Payments. Each site stores its own webhook signing secret. On Cloud, your `STRIPE_WEBHOOK_SECRET` and the other env secrets are never used for customer sites.

Not built yet for Cloud: password reset by email (Grosslytics sends no email), a plan above 100,000 events, and account deletion. Usage is counted per calendar month (UTC).

## Selling Lifetime licenses ($29 once)

This is also only for you, the operator. A buyer pays, gets a license key on `/license`, and runs `npx grosslytics install`. That command downloads the release with the key, signs in to their Cloudflare (they click Allow), creates the database and queues, runs the migrations, deploys the API and dashboard to a hostname they choose, and sets their dashboard password. Running it again in the same folder updates them to your latest release.

1. Create the R2 bucket that holds releases, and add it to the root `wrangler.toml` of **your** deployment:
   ```bash
   bunx wrangler r2 bucket create grosslytics-releases
   ```
   ```toml
   [[r2_buckets]]
   binding = "RELEASES"
   bucket_name = "grosslytics-releases"
   ```
2. Set the key that license keys are derived from. It must never change, or old keys stop working: `openssl rand -hex 32`, then `bunx wrangler secret put LICENSE_SECRET`.
3. In Dodo Payments (test mode first), create a $29 one-time product. Its checkout link must redirect to `https://grosslytics.com/license` (add `&redirect_url=https://grosslytics.com%2Flicense`); Dodo appends `?payment_id=…`. Build the website with `PUBLIC_CHECKOUT_LIFETIME_URL=<that link>` (Grosslytics' own link is the default). Optionally set the var `LIFETIME_PRODUCT_ID=pdt_…` so that only this product creates licenses.
4. The Dodo webhook from the Hosted Cloud section (`/api/billing/dodo`, with `payment.succeeded`) creates licenses. Without Cloud, create that webhook with just this event and set `DODO_BILLING_WEBHOOK_SECRET`. (Stripe instead: a Payment Link redirecting to `/license?session_id={CHECKOUT_SESSION_ID}`, the `/api/billing/stripe` webhook with `checkout.session.completed`, and optionally `LIFETIME_PAYMENT_LINK_ID=plink_…`.)
5. Publish a release, and repeat this after every change you want buyers to get:
   ```bash
   bun scripts/release.ts --upload
   ```
   This builds the site without your `PUBLIC_*` settings, bundles the API, adds `migrate.sql`, and uploads `latest.tgz`.
6. Publish the CLI to npm as `grosslytics` (`cd packages/cli && bun run build && npm publish`). Until then, `npx grosslytics` doesn't exist, and buyers would have to run `node packages/cli/dist/index.js install`.

Limits: the installer runs on macOS and Linux (not Windows), and needs Node 18+. A refund does not revoke the key. A buyer's site also serves the Grosslytics homepage at `/`, with the dashboard at `/app`.

## Not production-ready yet

- **Self-hosted `/app` has one owner password, not user accounts.** Hosted Cloud (`CLOUD=1`) has email accounts, but no email password reset yet.
- **The dashboard and channel/MCP APIs query raw events on every load.** D1 no longer uses additive unique-visitor rollups, because those overcounted repeat visitors. At higher traffic volumes, measure query cost and use mergeable distinct-count aggregates (the old, never-finished ClickHouse backend was removed on 2026-11-07).
- **Ad spend is entered by hand** (the dashboard's "Add ad spend" button, or `POST /api/stats/ad-spend`). There's no Google or Meta Ads import.
- **No historical Stripe import, and no Telegram/Discord alerts.**
- **The Paddle, Polar and LemonSqueezy field mapping is untested against real payloads.** Send a real test event and check the `payments` row (amount, currency, `visitor_id`) before you rely on those numbers.
- **Indie Cloud is built but not deployed or tested against real Stripe.** Billing is covered by unit tests with locally signed events. Run a Stripe test-mode subscription through it before taking real money. Lifetime licenses and `npx grosslytics install` are built, but not run against a real Cloudflare account or Stripe.
- **The repository is private**, so the clone command on `/start` only works for you until you make it public.
- **OG images are SVG, not PNG.**
- **The tracker is 1.46KB Brotli**, against the spec's 1.2KB target.
