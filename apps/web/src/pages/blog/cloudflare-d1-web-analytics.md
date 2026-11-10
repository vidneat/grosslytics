---
layout: "../../layouts/Article.astro"
title: "How to Self-Host Revenue Analytics on Cloudflare D1"
description: "Deploy Grosslytics on Cloudflare Workers and D1 in five steps. Understand free-tier limits, queue costs, source and licensed install paths, and verification."
primaryKeyword: "self hosted web analytics cloudflare d1"
format: "how-to"
visualReview: {"decision":"include-screenshots","reason":"Real Cloudflare D1 pricing documentation explains the database allowance; the real public Grosslytics demo illustrates the reporting interface with clearly identified sample data."}
updatedDate: "2026-11-10"
pubDate: "2026-11-08"
---

I recommend starting a self-hosted Grosslytics deployment by checking the whole Cloudflare stack, not just Worker requests. You can use the source-build setup or the licensed installer when a downloadable release is available; Workers, D1, Queues and Durable Objects all have allowances that affect the cost. I'll walk you through sizing, deployment and checking that visits and payments connect.

## Key takeaways

- A free-tier infrastructure bill is conditional on all service limits; it excludes domain, optional license and operating costs.
- The source route uses bun run setup; the packaged route uses npx grosslytics@latest install with a valid license and available release.
- Queues can become the first limit: 10,000 free operations/day allow about 3,333 normal small messages before retries and other usage.
- Validate browser events, queue persistence and signed test payments separately.

Cloudflare’s allowances below were checked on November 8, 2026. Check the current limits against your own workload before deploying.

## Step 1: Check whether your workload fits the free plan

A $0 Cloudflare infrastructure bill is possible only while the entire deployment stays inside the applicable free allowances. The current stack uses a tracker, two Workers, D1, Queues and a SQLite-backed Durable Object for live presence.

| Component | Free allowance relevant to this setup | What to measure |
| --- | --- | --- |
| Workers | 100,000 requests/day; 10 ms CPU time per invocation | API requests, dashboard execution and CPU usage across the account |
| D1 | 5 million rows read/day, 100,000 rows written/day, 5 GB total storage | Query scans, writes including indexes, and stored data |
| Queues | 10,000 standard operations/day | Each message’s write, read and delete operations, plus retries |
| Durable Objects | 100,000 requests/day and 13,000 GB-s/day of duration; separate storage allowances | Presence updates, WebSockets, alarms, duration and storage |

These are distinct meters, not interchangeable event allowances. Other applications on your account consume the same account-level budgets. Check the current [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/) and [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) before deployment.

D1 counts rows scanned, not just rows returned. Indexes can reduce reads but add writes. On the Free plan, reaching a daily D1 read or write limit causes query errors until allowance resets; it does not mean unlimited ingestion. A domain, optional license and your operating time are separate from Cloudflare usage.

<figure>
  <a href="/images/comparisons/cloudflare-d1-2026-11-08-d799dbdce4a1.jpg" aria-label="Open full-size Cloudflare D1 screenshot">
    <img src="/images/comparisons/cloudflare-d1-2026-11-08-d799dbdce4a1.jpg" alt="Cloudflare D1 billing table showing free daily reads, writes and total storage limits." width="1269" height="714" loading="lazy" decoding="async" />
  </a>
  <figcaption>Cloudflare’s public D1 pricing documentation shows the database allowance. This covers D1 only; the complete analytics stack also uses Workers, Queues and Durable Objects. Captured 2026-11-08. <a href="https://developers.cloudflare.com/d1/platform/pricing/#billing-metrics">Source: Cloudflare D1</a>.</figcaption>
</figure>

### Work through an event budget before counting pageviews

The collector sends one queue message per accepted analytics event when its queue binding is present. A normal message under 64 KB typically uses three operations: write, read and delete. Batching does not remove per-message operation charges.

For an illustrative 2,000 accepted events/day:

```text
Queue operations = 2,000 messages × 3 operations = 6,000/day
Remaining queue allowance = 10,000 − 6,000 = 4,000/day
Idealized queue ceiling = floor(10,000 ÷ 3) = 3,333 messages/day
```

This calculation excludes retries, dead-letter writes, larger messages and other queues. Use this as a starting estimate for sizing your workload. Pageviews, engagement updates and custom goals can each create events, so 2,000 events does not mean 2,000 visitors or pageviews. D1 writes and dashboard queries can reach their own limits first.

## Step 2: Prepare your account, hostname and install path

Use a Cloudflare account that owns your domain, an unused hostname such as `analytics.example.com`, and a current supported Node.js release. The CLI declares Node.js 18 as its minimum; the source build also needs Git and Bun. The current installer uses macOS/Linux commands; check compatibility before installing on Windows.

For a new Cloudflare account, open Workers & Pages once to initialize its workers.dev subdomain. Use a hostname with no existing A, AAAA or CNAME record; the custom-domain setup needs to attach that hostname. Choose the correct account when prompted.

Select one route:

- **Source build:** requires access to the Grosslytics repository and its build dependencies. The repository labels this the free self-host route.
- **Packaged installer:** requires an available downloadable release and a valid Grosslytics Lifetime license. The repository lists that license at $29 once; confirm current availability and terms on the [self-hosting page](/start?plan=lifetime).

The current public docs still label the packaged path as opening soon. Do not assume a purchase, npm package or source repository is accessible until you have checked. If access is unavailable, resolve that prerequisite before attempting deployment; there is no alternative download included here.

## Step 3: Deploy the API, dashboard and database together

From a source checkout you can access, use the documented build-and-install route:

```bash
git clone https://github.com/vidneat/grosslytics.git
cd grosslytics
bun install
bun run setup
```

If you already have a supported packaged release and license, the CLI route is instead:

```bash
npx grosslytics@latest install
```

The `install` subcommand matters: running only `npx grosslytics@latest` does not select the deployment action. The source setup builds a local release and passes it to the same installer without requiring the downloadable licensed bundle.

The installer asks for your hostname, Cloudflare zone and dashboard password, then authenticates with Cloudflare as needed. It creates `grosslytics-db`, the ingest and dead-letter queues, applies the schema, deploys the API and web Workers, and sets the API token and owner password. Allow time for downloads, builds, authorization and domain activation; no 90-second completion time is established here.

Keep both Workers on the analytics hostname: `analytics.example.com/api/*` must reach the API, while the web Worker serves the dashboard and tracker. The tracker normally sends events to the origin serving its script. Splitting those origins without configuring routing can produce a dashboard that loads but receives no visits. The [setup documentation](/docs/#self-host) covers the standard arrangement.

Save the printed API token in a password manager. Keep the generated `grosslytics-install` folder private: its state contains installation details, including the license when used, and re-running from that folder targets the same installation. Worker names are fixed; the current installer rejects a different hostname when it detects an existing Grosslytics deployment in that account.

## Step 4: Add your site and install the tracker

Open `https://analytics.example.com/app`, sign in with the owner password and add the domain you want to measure. Choose its reporting currency and copy the generated site ID and tracker snippet.

For the standard same-origin deployment, the tag looks like this:

```html
<script
  defer
  src="https://analytics.example.com/g.js"
  data-site-id="YOUR_SITE_ID"
></script>
```

Replace both placeholders with your real analytics hostname and site ID. Install the tag in the pages you want measured, then open a tagged URL such as `https://www.example.com/?utm_source=setup-check&utm_medium=referral` in an ordinary browser. The tracker skips WebDriver browsers, so an automated browser session alone is not proof that collection is broken.

Use the browser’s Network panel to check that `g.js` loads and that `/api/event` receives a successful response. If your site uses Content Security Policy, add the analytics origin to the relevant `script-src` and `connect-src` directives while preserving the rest of your policy. Follow the [tracker installation instructions](/docs/#install).

An accepted event response confirms collection, not persistence through the queue. Confirm that the visit later appears in the dashboard and inspect queue failures if it does not.

## Step 5: Connect a payment provider and verify the complete journey

Self-hosted web analytics becomes revenue attribution only after a payment is connected to the visitor who generated it. In the dashboard’s Payments settings, configure the provider and its webhook signing secret. The endpoint follows this pattern:

```text
https://analytics.example.com/api/webhooks/PROVIDER?siteId=YOUR_SITE_ID
```

Use your provider’s exact event names and metadata mapping. For Stripe Checkout and Payment Links, follow the [Stripe revenue attribution guide](/blog/stripe-revenue-attribution/); for another gateway, use the [Polar and Dodo setup](/blog/polar-dodo-payments-analytics/) or [Paddle transaction guide](/blog/paddle-revenue-attribution/). These explain identity propagation, renewal behavior and reporting limitations separately from hosting.

Run a provider-supported test purchase using a browser visit with a known UTM. Verify the signed webhook response, the stored payment amount and currency, and the attributed source. Test renewal and refund behavior you depend on rather than assuming support from a dashboard label. Each site has one reporting currency; the current implementation rejects new payments in another currency instead of converting them.

<figure>
  <a href="/images/comparisons/grosslytics-2026-11-08-4f4bddd90794.jpg" aria-label="Open full-size Grosslytics screenshot">
    <img src="/images/comparisons/grosslytics-2026-11-08-4f4bddd90794.jpg" alt="Grosslytics public demo with sample visitor, net revenue and traffic-source charts." width="1265" height="712" loading="lazy" decoding="async" />
  </a>
  <figcaption>The Grosslytics public demo shows the dashboard with sample data. Captured 2026-11-08. <a href="https://grosslytics.com/app/demo">Source: Grosslytics</a>.</figcaption>
</figure>

Before using the numbers for decisions, check:

1. A real browser visit reaches the live panel and the stored reports.
2. A signed test payment appears once and credits the expected source.
3. Reloading a report does not produce an unexpected D1 scan spike.
4. Queue processing succeeds and the dead-letter queue is monitored.
5. The private dashboard requires authentication and retains its noindex protections.

Use your own dashboard to confirm that the test payment arrived.

## What should you monitor after installation?

Monitor Worker requests and CPU, D1 reads/writes and storage, queue operations and failures, and Durable Object usage together. In Cloudflare’s D1 dashboard, inspect Metrics → Row Metrics; query metadata also exposes `rows_read` and `rows_written`.

Grosslytics currently queries raw events for dashboard reports, so repeated long-range reports can become expensive as data grows. Measure a representative traffic day and the reporting queries you actually use before projecting capacity. Keep backup/export and restore procedures for the database, and plan retention before storage becomes a blocker.

To update a source install, rerun the source setup from its existing checkout. For a packaged install, rerun `npx grosslytics@latest install` from the same working folder. Back up first and review release and migration changes. Self-hosting gives you control of the Cloudflare account and database, while Cloudflare remains the infrastructure provider; it is not a guarantee of exclusive physical storage, legal compliance or automatic recovery.

If the workload outgrows free allowances, evaluate the current paid plan and usage rates rather than treating $0 as a permanent ceiling. The Workers Paid plan starts at $5/month before additional usage. Start with the real event and query metrics from your own installation, then decide whether to optimize, upgrade, or use a [managed analytics option](/#pricing).


## Frequently asked questions

### Is Cloudflare D1 enough for self-hosted web analytics?

D1 provides the database. Grosslytics also uses Worker APIs, Queues and a SQLite-backed Durable Object, plus a dashboard and tracker. Plan and monitor the complete stack.

### Can this run with no monthly server bill?

It can have a $0 Cloudflare usage bill on the Free plan while every relevant allowance is respected. A domain and optional license are separate costs, and limits can stop operations. Your available capacity depends on how your site uses each service.

### Can I deploy by running only npx grosslytics@latest?

The current CLI requires the install subcommand. The packaged path also needs a valid license and an available release; source setup requires repository access and build tools.
