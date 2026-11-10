---
layout: "../../layouts/Article.astro"
title: "How to Track Paddle Revenue & Observed LTV by Source"
description: "Attribute Paddle Billing transactions to visitor sources with customData and signed webhooks. Learn the limits of fee estimates, recurring receipts and observed LTV."
primaryKeyword: "paddle revenue attribution analytics"
format: "how-to"
visualReview: {"decision":"include-screenshots","reason":"Real public provider documentation screenshots explain the checkout identity fields; demo views are labeled and do not imply a live payment test."}
pubDate: "2026-11-08"
---

To track Paddle Billing revenue by acquisition source, pass the tracked visitor ID as customData.visitor_id in Paddle.Checkout.open() and deliver signed transaction.completed events to Grosslytics. This supports payment attribution and observed all-time LTV by first source; it does not provide normalized MRR or a built-in 90-day cohort LTV report.

## Key takeaways

- Use customData in Paddle.js and inspect custom_data in the transaction event; the browser and webhook names differ.
- Paddle documents custom-data propagation to subscriptions and future transactions, but validate the actual recurring event you receive.
- Grosslytics removes the tax amount reported in the transaction and estimates the gateway fee; it does not read Paddle settlement earnings as exact net revenue.
- The current LTV view is historical and all-time, with identity limitations for Paddle; do not label it a 90-day cohort metric or forecast.

## What do you need before opening Paddle Checkout?

You need a Paddle Billing product and price, an initialized Paddle.js integration, and a tracked visit with a Grosslytics visitor ID.

This guide is published by the Grosslytics team. Provider documentation and the current Grosslytics implementation were checked on November 8, 2026; the examples were not exercised against a live merchant account, and no setup-time guarantee is made.

This guide covers Paddle Billing and transaction.completed, not legacy Paddle Classic events. Start with the [Grosslytics setup flow](/start/), install the tracker and choose a reporting currency that matches the charge currency.

1. Add the Grosslytics tracker to the acquisition and pricing pages.
2. Load and initialize Paddle.js with your client-side token.
3. Keep price selection and application access rules under your existing checkout controls.
4. Configure a test-mode webhook destination.
5. Plan to inspect both an initial and recurring transaction.

Use the [tracker guide](/docs#install) if you self-host or need Content Security Policy changes.

## Step 1: How do you pass the visitor ID into Paddle.js?

Read the tracked visitor ID after initialization and include it in the checkout's customData object.

```html
<script defer src="https://grosslytics.com/g.js"
  data-site-id="YOUR_SITE_ID"></script>
<script src="https://cdn.paddle.com/paddle/v2/paddle.js"></script>
```

In your existing client checkout code:

```js
// Browser: initialize once, then call openCheckout from your buy button.
Paddle.Environment.set('sandbox');
Paddle.Initialize({ token: 'test_YOUR_CLIENT_SIDE_TOKEN' });

function openCheckout() {
  let visitorId = null;
  try { visitorId = localStorage.getItem('gl_vid'); } catch {}
  Paddle.Checkout.open({
    items: [{ priceId: 'pri_YOUR_RECURRING_PRICE_ID', quantity: 1 }],
    ...(visitorId ? { customData: { visitor_id: visitorId } } : {})
  });
}
```

Use your real sandbox client-side token and price ID, and change environment/token appropriately for production. If tracking is unavailable, the example still opens checkout without claiming attribution. [Source: Paddle.Checkout.open parameters](https://developer.paddle.com/paddle-js/methods/paddle-checkout-open/).

Paddle documents that transaction custom data is copied to the created subscription, then to future subscription transactions. In a transaction webhook the field is custom_data, not the Paddle.js spelling customData. [Source: custom-data propagation](https://developer.paddle.com/build/transactions/custom-data/).

<figure>
  <a href="/images/comparisons/paddle-2026-11-08-a31e49cd3ad1.jpg" aria-label="Open full-size Paddle screenshot">
    <img src="/images/comparisons/paddle-2026-11-08-a31e49cd3ad1.jpg" alt="Paddle documentation showing customData in the Checkout open method instructions." width="1265" height="712" loading="lazy" decoding="async" />
  </a>
  <figcaption>Public Paddle documentation explaining customData on Paddle.Checkout.open; the code shown is a vendor example. Captured 2026-11-08. <a href="https://developer.paddle.com/build/transactions/custom-data/#pass-custom-data-to-checkout">Source: Paddle</a>. Demo figures are not performance benchmarks.</figcaption>
</figure>

The ID joins the payment to an existing visit; it is not an authentication credential. A source such as an SEO page or ad campaign still depends on the visit evidence and tags recorded before checkout.

## Step 2: Which Paddle webhook should Grosslytics receive?

Configure transaction.completed to reach the Paddle-specific endpoint and save the matching signing secret in Payments settings.

```text
https://YOUR_ANALYTICS_DOMAIN/api/webhooks/paddle?siteId=YOUR_SITE_ID
```

The current handler reads the completed transaction ID, currency, reported totals, custom_data.visitor_id and origin. It recognizes a recurring payment when origin is subscription_recurring. [Source: transaction.completed event](https://developer.paddle.com/webhooks/transactions/transaction-completed/).

| Field or control | Provider-side location | Current Grosslytics use |
| --- | --- | --- |
| Visitor ID | data.custom_data.visitor_id | Matches the stored visit |
| Paid amount | data.details.totals.grand_total | Starting amount before tax exclusion |
| Tax | data.details.totals.tax | Removed from revenue when supplied |
| Currency | data.currency_code | Must match the site's reporting currency |
| Recurring origin | data.origin | subscription_recurring marks a renewal |
| Signature | Paddle-Signature header | Checked against the raw body and destination secret |

Do not replace the raw payload with a reformatted JSON string before signature verification. Paddle describes its signature and timestamp checks in [webhook signature verification](https://developer.paddle.com/webhooks/about/signature-verification/).

The [payment integration reference](/docs#payments) describes the current Grosslytics settings. A delivered webhook must still be inspected for the correct visitor, amount and currency before you call the attribution complete.

## Step 3: How do you compare sources after a test purchase?

Open the source report and compare the matched payment under a consistent attribution model and reporting currency.

Start from a controlled campaign URL:

```text
https://your-site.example/pricing?utm_source=google&utm_medium=cpc&utm_campaign=paddle-test
```

Complete a sandbox checkout, confirm that its completed transaction carries the visitor ID, and inspect the resulting source. Repeat with a recurring transaction rather than assuming a successful initial purchase proves later matching.

<figure>
  <a href="/images/comparisons/grosslytics-public-demo-2026-11-08.jpg" aria-label="Open full-size Grosslytics screenshot">
    <img src="/images/comparisons/grosslytics-public-demo-2026-11-08.jpg" alt="Grosslytics public demo showing first-touch net revenue, a daily chart and source reports." width="1010" height="1209" loading="lazy" decoding="async" />
  </a>
  <figcaption>Grosslytics — public demo with sample data. Captured November 8, 2026. <a href="https://grosslytics.com/app/demo">View source page</a>. Displayed figures illustrate the interface and are not a benchmark.</figcaption>
</figure>

This screenshot shows a public sample dashboard, not the result of an executed Paddle test. The [dashboard definitions](/docs#dashboard) describe first-touch, last-touch and the first-last endpoint split, which can credit the same payment differently.

A page revenue report answers a different question from acquisition-source credit: visitors can read several pages before purchasing. Do not sum overlapping page rows as if each were an exclusive revenue allocation.

## How are Paddle tax and fees represented?

The current implementation removes reported tax, then subtracts its configured fee estimate from the payment amount.

Consider an illustrative USD 120 payment containing USD 20 in tax. With the current 5% plus USD 0.50 fee assumption applied to the full payment, estimated fees are USD 6.50 and the resulting revenue after tax and estimated fees is USD 93.50.

```text
paid = 12000 cents
tax = 2000 cents
estimated_fee = round(12000 * 500 / 10000) + 50 = 650 cents
revenue_after_tax_and_estimated_fee = 12000 - 2000 - 650 = 9350 cents
```

That calculation describes the application's default, not your negotiated Paddle fee or exact payout. The current Paddle extractor does not use actual totals.fee or earnings as the stored fee amount, and refunds are not automatically applied by this handler.

Mixed-currency payments are rejected rather than converted. Ad spend is a separate input, and subtracting fees and ad spend still excludes other business operating costs.

## Is observed LTV the same as 90-day cohort LTV or MRR?

No: observed LTV is accumulated historical value, a cohort fixes an acquisition group and observation window, and MRR normalizes recurring subscription value.

Grosslytics' current LTV report groups all-time successful net receipts by first-touch source and divides them by distinct customers using available identifiers. The Paddle extractor does not populate an email identity, so matching normally relies on visitor IDs; multiple browsers or cleared storage can affect the apparent customer count.

For an illustrative source with USD 300 in accumulated net receipts and two identified customers, observed LTV is USD 150. A 90-day figure might be different if some of those receipts occurred after the customer's first 90 days.

```text
observed_all_time_ltv = 300 / 2 = 150
normalized_monthly_value_of_annual_1200_plan = 1200 / 12 = 100
```

Selecting a 90-day traffic range does not turn the all-time LTV panel into a cohort report. A proper cohort analysis needs a stable subscriber identity, acquisition date, fixed observation cutoff and refund-adjusted payment history; use an appropriate export or reporting system for that requirement.

## What should you test before using the report for acquisition decisions?

Reconcile a complete payment lifecycle with the provider records and keep unsupported metrics out of the interpretation.

1. Confirm the visitor and transaction carry the same ID.
2. Validate signature verification and successful ingestion.
3. Check the currency and tax amount.
4. Reconcile the fee estimate with actual provider charges.
5. Test a recurring transaction and its source.
6. Inspect an unmatched buyer and avoid inventing its source.
7. Reconcile refunds separately because the current Paddle handler does not apply them.

Keep revenue attribution, recurring receipts and cohort metrics distinct. Next, validate one initial and one recurring Paddle transaction before using the source report to allocate spend.

## Frequently asked questions

### Does Grosslytics calculate Paddle MRR?

It records supported completed transactions and identifies subscription_recurring origin. That is not the same as normalizing active subscriptions into a dedicated MRR metric.

### Does choosing a 90-day range show 90-day cohort LTV?

No. The current LTV query is all-time by first source. Cohort LTV needs an acquisition group and a fixed observation period, not just a traffic date range.

### Why is customData spelled differently in the webhook?

Paddle.js accepts customData, while Paddle transaction objects and webhook payloads use custom_data. Grosslytics reads the webhook field.

### Does the net value equal my exact Paddle payout?

No. The current implementation excludes reported tax and subtracts a configured fee estimate. Settlement timing, actual fees, adjustments and refunds require separate reconciliation.
