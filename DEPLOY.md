# Deploying Grosslytics to Cloudflare

You deploy two Workers:

| Worker | Config | Serves |
|---|---|---|
| `grosslytics-edge-api` | `wrangler.toml` (repo root) | `/api/*`: collect, stats, webhooks, MCP, plus the queue consumer and Durable Object |
| `grosslytics-web` | `apps/web/wrangler.toml` | The Astro site, `g.js`, `robots.txt`, `llms.txt` |

Both must sit on **one domain**. The tracker sends beacons to `<origin of g.js>/api/event`, so `/api/*` on the site's domain has to reach the edge API. The examples below use `grosslytics.com`. Replace it with your own domain.

---

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
   stripe listen --events checkout.session.completed --forward-to "localhost:8787/api/webhooks/stripe?siteId=gl_YOUR_SITE_ID"
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

## 3. Choose your Durable Object storage (do this before the first deploy)

The Workers **Free** plan only supports SQLite-backed Durable Objects. If you're on Free, change the migration in `wrangler.toml` before deploying:

```toml
[[migrations]]
tag = "v1"
new_sqlite_classes = ["SiteLiveHub"]   # instead of new_classes
```

You can't change this after the first deploy. On the Workers Paid plan either option works. Also check that your plan includes **Queues**.

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
| `PUBLIC_CHECKOUT_CLOUD_URL` | Stripe Payment Link for Indie Cloud. Unset, `/start?plan=cloud` shows a waitlist instead |
| `PUBLIC_CHECKOUT_LIFETIME_URL` | Same, for Lifetime |
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

## 11. Point your payment gateways at the API

Use `https://grosslytics.com/api/webhooks/<gateway>?siteId=<your site id>`. `siteId` is required.

| Gateway | URL suffix | Events to subscribe |
|---|---|---|
| Stripe | `/stripe` | `checkout.session.completed`, `invoice.paid` |
| Razorpay | `/razorpay` | `payment.captured` |
| Polar | `/polar` | `order.paid` |
| Paddle | `/paddle` | `transaction.completed` |
| LemonSqueezy | `/lemonsqueezy` | `order_created`, `subscription_payment_success` |

Copy each signing secret into step 8.

**How sales get linked to visitors:** the tracker adds the visitor ID to checkout **links** (`<a href>`) for Stripe, Polar, LemonSqueezy, Paddle and Razorpay. If you open checkout with JavaScript instead of a link, pass the visitor ID yourself:

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

## Not production-ready yet

- **`/app` signs in with the API token, which is stored in the browser's localStorage.** That's fine for one owner on their own device. A hosted multi-user product needs real accounts and sessions.
- **One `API_TOKEN` covers every site.** That's fine for self-hosting one owner's sites. A hosted multi-tenant service needs a key per site.
- **The dashboard queries raw events on every load.** The 90-day view of the sample data (19k visitors, 95k events) takes about 0.7s locally. Sites with millions of events a month will need the dashboard moved onto pre-aggregated rollups, or onto the ClickHouse adapter, which doesn't implement the dashboard query yet.
- **Ad spend is entered by hand** (the dashboard's "Add ad spend" button, or `POST /api/stats/ad-spend`). There's no Google or Meta Ads import.
- **No historical Stripe import, and no Telegram/Discord alerts.**
- **The Paddle, Polar and LemonSqueezy field mapping is untested against real payloads.** Send a real test event and check the `payments` row (amount, currency, `visitor_id`) before you rely on those numbers.
- **Indie Cloud doesn't exist yet.** `/start?plan=cloud` collects a waitlist until you set a checkout link, and taking payment still needs the hosted multi-tenant service behind it.
- **The repository is private**, so the clone command on `/start` only works for you until you make it public.
- **OG images are SVG, not PNG.**
- **The tracker is 1.46KB Brotli**, against the spec's 1.2KB target.
