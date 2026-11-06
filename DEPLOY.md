# Deploying Grosslytics to Cloudflare

You deploy two Workers:

| Worker | Config | Serves |
|---|---|---|
| `grosslytics-edge-api` | `wrangler.toml` (repo root) | `/api/*`: collect, stats, webhooks, MCP, plus the queue consumer and Durable Object |
| `grosslytics-web` | `apps/web/wrangler.toml` | The Astro site, `g.js`, `robots.txt`, `llms.txt` |

Both must sit on **one domain**. The tracker sends beacons to `<origin of g.js>/api/collect`, so `/api/*` on the site's domain has to reach the edge API. The examples below use `grosslytics.com`. Replace it with your own domain.

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

The schema lives in `packages/db-d1/src/migrations.ts`. This writes it out as a `.sql` file and drops the two `PRAGMA` lines, because D1 runs in WAL mode already and doesn't allow changing it:

```bash
bun -e "import {MIGRATION_001_INIT as m} from './packages/db-d1/src/migrations.ts'; await Bun.write('migration_001.sql', m.replace(/^PRAGMA.*$/gm, ''))"
```

```bash
bunx wrangler d1 execute grosslytics-db --remote --file=migration_001.sql
```

```bash
rm migration_001.sql
```

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

If `g.js` is served from a different origin than the API, add `data-api="https://<api-host>/api/collect"`.

## 13. Check that it works

Send a test beacon. It should return `202`:

```bash
curl -i -X POST https://grosslytics.com/api/collect -d '{"sid":"gl_live_abc123","vid":"test","ses":"test","t":"pageview","n":"/","src":"Direct (Typed/Bookmark)","cat":"Direct","ref":"","sd":0,"dur":0}'
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

- **`/app` has no login.** It only shows demo data, and the real data APIs are token-protected, but don't link to it as a real product yet.
- **The dashboard, `/share/*`, badge and OG images show placeholder data.** The badge always shows `$18,420`, and OG images are SVG, not PNG.
- **One `API_TOKEN` covers every site.** That's fine for self-hosting one owner's sites. A hosted multi-tenant service needs a key per site.
- **No historical Stripe import, and no Telegram/Discord alerts.**
- **The Paddle, Polar and LemonSqueezy field mapping is untested against real payloads.** Send a real test event and check the `payments` row (amount, currency, `visitor_id`) before you rely on those numbers.
- **The tracker is 1.32KB Brotli**, against the spec's 1.2KB target.
