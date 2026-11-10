---
layout: "../../layouts/Article.astro"
title: "How to Track Polar & Dodo Payments Revenue by Channel"
description: "Connect Polar, Dodo Payments and Lemon Squeezy checkouts to visitor sources using provider-specific metadata and signed webhooks, with renewal and refund limits."
primaryKeyword: "dodo payments polar revenue analytics"
format: "how-to"
visualReview: {"decision":"include-screenshots","reason":"Real public provider documentation screenshots explain the checkout identity fields; demo views are labeled and do not imply a live payment test."}
updatedDate: "2026-11-10"
pubDate: "2026-11-08"
---

I recommend treating Polar, Dodo Payments and Lemon Squeezy as separate integrations when tracking revenue by channel. Each needs the visitor ID in its own checkout field and a verified payment event sent to the matching Grosslytics endpoint: reference_id for Polar links, metadata_visitor_id for supported Dodo links, and checkout[custom][visitor_id] for Lemon Squeezy links. I'll walk through each path so you can connect the sale to its source.

## Key takeaways

- Install the tracker on the page where the visitor arrives; a checkout link shared directly from a social post skips that site visit.
- Use provider-specific fields and webhook event types rather than one shared custom-data parameter.
- Webhooks deliver signed events that update the payment ledger; they are not read-only API connections.
- Grosslytics subtracts reported tax and estimated fees, but renewal classification and refund coverage differ by provider.

## What does channel attribution need from a Merchant of Record checkout?

It needs a recorded visit, an identifier that survives checkout and a verified payment event carrying that identifier.

The examples follow each provider’s documentation and the Grosslytics implementation. Before relying on them for live payments, run a test transaction and check the webhook payload you receive.

A Merchant of Record can handle tax collection and payment operations, but your analytics still needs a way to connect the transaction to a visit. It cannot discover the originating post or an exact AI search query if that source information was never supplied.

## Step 1: How do you record the source before checkout?

Add the Grosslytics tracker to the landing page and use a tagged URL for links you control.

```html
<script defer src="https://grosslytics.com/g.js"
  data-site-id="YOUR_SITE_ID"></script>
```

For a campaign link, send visitors to your own tracked page first:

```text
https://your-site.example/pricing?utm_source=x&utm_medium=social&utm_campaign=launch-post-1
```

Use a distinct campaign value for each post you want to distinguish. Linking straight from a social post to the provider's checkout does not create a Grosslytics visit on your website.

The [installation reference](/docs#install) covers self-hosted tracker domains and API routing. Read gl_vid after the tracker loads if your application creates checkout sessions programmatically.

## Step 2: Which identity field should each provider receive?

Use the field expected by both the provider and the current Grosslytics extractor.

| Provider | Supported anchor-link field | Programmatic checkout field | Grosslytics reads from the event |
| --- | --- | --- | --- |
| Polar | reference_id | metadata.visitor_id | data.metadata.visitor_id or data.metadata.reference_id |
| Dodo Payments | metadata_visitor_id | metadata.visitor_id | data.metadata.visitor_id |
| Lemon Squeezy | checkout[custom][visitor_id] | checkout_data.custom.visitor_id | meta.custom_data.visitor_id |

Grosslytics decorates supported anchor links if the relevant parameter is absent. JavaScript redirects and custom server-created sessions need explicit handling; an existing reference value is not overwritten.

### Polar checkout links and sessions

Polar documents reference_id as checkout-link metadata. Use the persistent Checkout Link rather than copying an expiring Checkout Session URL. [Source: Polar Checkout Links](https://polar.sh/docs/features/checkout/links).

<figure>
  <a href="/images/comparisons/polar-2026-11-08-fd34a928ab51.jpg" aria-label="Open full-size Polar screenshot">
    <img src="/images/comparisons/polar-2026-11-08-fd34a928ab51.jpg" alt="Polar checkout-link documentation showing reference_id and UTM metadata parameters." width="1265" height="712" loading="lazy" decoding="async" />
  </a>
  <figcaption>Public Polar documentation showing reference metadata carried by a checkout link. Captured 2026-11-08. <a href="https://polar.sh/docs/features/checkout/links#attribution-and-reference-metadata">Source: Polar</a>.</figcaption>
</figure>

If you already create sessions using the Polar server SDK, add a visitor metadata field to the validated checkout request:

```js
// Server: polar is your initialized SDK client; body is a validated request.
const visitorId = typeof body.visitorId === 'string'
  && /^[A-Za-z0-9_-]{1,200}$/.test(body.visitorId)
  ? body.visitorId : null;

const checkout = await polar.checkouts.create({
  products: [process.env.POLAR_PRODUCT_ID],
  successUrl: 'https://your-site.example/thanks',
  metadata: visitorId ? { visitor_id: visitorId } : {}
});
// Return checkout.url through your application's response handler.
```

Confirm the installed SDK's naming conventions and inspect the resulting order metadata. A successful checkout URL alone does not prove the order can be attributed.

### Dodo Payments checkout sessions

Dodo's Checkout Sessions API accepts a metadata object; add visitor_id to your existing server request. [Source: Dodo Checkout Sessions](https://docs.dodopayments.com/developer-resources/checkout-session).

<figure>
  <a href="/images/comparisons/dodo-payments-2026-11-08-a5625ca79e8a.jpg" aria-label="Open full-size Dodo Payments screenshot">
    <img src="/images/comparisons/dodo-payments-2026-11-08-a5625ca79e8a.jpg" alt="Dodo Payments checkout-session documentation defining the metadata object." width="1265" height="712" loading="lazy" decoding="async" />
  </a>
  <figcaption>Public Dodo Payments documentation showing the checkout metadata field; this is a documentation view, not a merchant account. Captured 2026-11-08. <a href="https://docs.dodopayments.com/developer-resources/checkout-session#param-metadata">Source: Dodo Payments</a>.</figcaption>
</figure>

```js
// Server: client is your initialized DodoPayments SDK client.
const visitorId = typeof body.visitorId === 'string'
  && /^[A-Za-z0-9_-]{1,200}$/.test(body.visitorId)
  ? body.visitorId : null;

const session = await client.checkoutSessions.create({
  product_cart: [{ product_id: process.env.DODO_PRODUCT_ID, quantity: 1 }],
  return_url: 'https://your-site.example/thanks',
  metadata: visitorId ? { visitor_id: visitorId } : {}
});
// Return session.checkout_url to your browser checkout handler.
```

The tracker has a separate metadata_visitor_id decoration path for supported Dodo anchor links. Verify the final payment metadata for the particular link or session flow you deploy; do not assume a field on a session automatically reached every later event.

### Lemon Squeezy checkout links

Lemon Squeezy accepts checkout[custom] URL parameters and returns custom data in webhook meta.custom_data. A browser example using an existing hosted link is:

```js
// Browser: run after the Grosslytics tracker has initialized.
let visitorId = null;
try { visitorId = localStorage.getItem('gl_vid'); } catch {}
const checkout = new URL('https://YOUR_STORE.lemonsqueezy.com/checkout/buy/YOUR_VARIANT');
if (visitorId) checkout.searchParams.set('checkout[custom][visitor_id]', visitorId);
window.location.assign(checkout.href);
```

<figure>
  <a href="/images/comparisons/lemon-squeezy-2026-11-08-8919f4f59270.jpg" aria-label="Open full-size Lemon Squeezy screenshot">
    <img src="/images/comparisons/lemon-squeezy-2026-11-08-8919f4f59270.jpg" alt="Lemon Squeezy documentation showing checkout custom-data URL parameters." width="1265" height="712" loading="lazy" decoding="async" />
  </a>
  <figcaption>Public Lemon Squeezy documentation illustrating how custom data is included in checkout links. Captured 2026-11-08. <a href="https://docs.lemonsqueezy.com/help/checkout/passing-custom-data#passing-custom-data-in-checkout-links">Source: Lemon Squeezy</a>.</figcaption>
</figure>

For an API-created link, put the value in checkout_data.custom.visitor_id. These are Lemon Squeezy-specific names, not the Polar or Dodo interface. [Source: passing custom data](https://docs.lemonsqueezy.com/help/checkout/passing-custom-data).

## Step 3: Which webhook events should reach Grosslytics?

Create a signed destination for each provider and save its signing secret in the matching Grosslytics Payments settings.

```text
https://YOUR_ANALYTICS_DOMAIN/api/webhooks/polar?siteId=YOUR_SITE_ID
https://YOUR_ANALYTICS_DOMAIN/api/webhooks/dodo?siteId=YOUR_SITE_ID
https://YOUR_ANALYTICS_DOMAIN/api/webhooks/lemonsqueezy?siteId=YOUR_SITE_ID
```

| Provider | Payment events read by the current handler | Current refund behavior | Signature path |
| --- | --- | --- | --- |
| Polar | order.paid | Refund events not handled | Standard Webhooks headers |
| Dodo Payments | payment.succeeded | refund.succeeded handles explicitly full refunds; partial refunds ignored | Standard Webhooks headers |
| Lemon Squeezy | order_created, subscription_payment_success | Refund events not handled | X-Signature HMAC |

These endpoints update the analytics ledger; describing them as read-only would be inaccurate. Use the [payment integration reference](/docs#payments) and each provider's current delivery configuration.

The signature must be checked against the unmodified request body. Lemon Squeezy documents its signature header in [Signing Requests](https://docs.lemonsqueezy.com/help/webhooks/signing-requests); a successful HTTP delivery is not by itself proof that the intended sale was attributed.

## How do renewals and tax deductions differ across providers?

Renewal classification depends on the extractor's recognized fields, while tax is removed only when the payment event supplies the expected tax amount.

The current Polar extractor marks a renewal when billing_reason is subscription_cycle. The Lemon Squeezy extractor marks subscription_payment_success as a renewal, so check the first subscription invoice alongside order_created rather than assuming its first-payment classification matches your business definition.

The Dodo extractor currently marks every successful payment as a new sale, including recurring charges, so the new-versus-renewal customer counts will not be accurate.

Tax exclusion and fee deduction are also separate operations. In an illustrative $120 payment containing $20 tax, with an assumed $6 fee, revenue after tax and fees is $94:

```text
recorded_revenue_before_fees = 120 - 20 = 100
revenue_after_assumed_fee = 100 - 6 = 94
```

The configured gateway schedule estimates fees; it does not read the exact settlement cost for these three providers. A missing tax field cannot be repaired by assuming all payments have the same tax rate.

## How should you verify the first attributed sale?

Run a separate test purchase for each provider and inspect both its event and the resulting source report.

1. Visit your tagged landing page in a fresh browser session.
2. Check that the visitor ID reaches the provider checkout.
3. Complete a test payment and inspect the resulting payment event.
4. Confirm the matching source, amount and reporting currency.
5. Test a recurring charge and compare its classification.
6. Test refunds within the provider's current supported limits.
7. Check the initial order and subscription invoice do not produce an unintended double count.

Grosslytics uses one reporting currency per site and rejects different-currency payments rather than converting them. Use the [dashboard definitions](/docs#dashboard) to distinguish first touch, last touch, recorded revenue and fee estimates.

Choose the provider-specific path that matches your checkout. Next, reconcile one payment and one recurring-charge attempt for each provider you actually use before enabling live reporting.

## Frequently asked questions

### Can I use checkout[custom][visitor_id] for Polar and Dodo too?

No. That field belongs to Lemon Squeezy checkout links. Polar links use reference_id, while supported Dodo links use metadata_visitor_id; programmatic sessions use provider-specific metadata objects.

### Are these read-only webhooks?

No. They are inbound event deliveries that update the Grosslytics payment ledger after signature verification. They are different from a read-only API credential.

### Does Grosslytics classify Dodo subscription renewals correctly?

The current Dodo extractor records successful payments but marks them as new sales. Subscription-aware renewal classification is not implemented in this version.

### Do all three providers have automatic refund accounting?

No. The current Dodo path handles explicitly full refunds; partial Dodo refunds and Polar or Lemon Squeezy refund events are not automatically reflected by these handlers.
