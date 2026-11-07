# Grosslytics

Revenue analytics that counts what you keep. Grosslytics ties every visit, post, search and AI answer to the sales it brought, after payment fees and ad spend. It runs entirely in your own Cloudflare account: a 1.5 KB cookie-free tracker, a Worker API, a D1 database and a queue.

- Payment webhooks from Stripe, Paddle, Polar, Lemon Squeezy, Razorpay, Cashfree, Gumroad, PayPal, Dodo Payments and RevenueCat, each matched to the visitor who paid
- First-touch, last-touch and linear attribution, net revenue after fees, ad spend and profit per channel
- Live visitors, buyer journeys, funnels, goals, click maps and AI-crawler reports
- An MCP server, so Claude Code, Cursor or Windsurf can answer questions about your numbers

Website and live demo: https://grosslytics.com

## Self-host (free)

Needs [Bun](https://bun.sh), Node.js 18+, a free Cloudflare account and a domain on it.

```bash
git clone https://github.com/vidneat/grosslytics.git
cd grosslytics && bun install
bun run setup
```

`bun run setup` asks for a hostname and a dashboard password, signs in to Cloudflare, creates everything and deploys it. Run it again to update. Full guide: [DEPLOY.md](DEPLOY.md) and https://grosslytics.com/docs/.

## Lifetime ($29 once)

The easy way to self-host, and the way to support the project: [grosslytics.com/start?plan=lifetime](https://grosslytics.com/start?plan=lifetime)

- `npx grosslytics install` with your license key: installs and updates it without git or Bun
- Priority email support at support@grosslytics.com
- A commercial license: modify Grosslytics and run it for yourself or your clients without the AGPL's requirement to publish your changes ([terms](https://grosslytics.com/terms/))

Don't want to run it at all? Indie Cloud is hosted for you at $5.99 a month.

## License

[AGPL-3.0](LICENSE). Free to use, change and self-host. If you offer a modified version to others over a network, the AGPL asks you to publish your changes, unless you hold a Lifetime commercial license.
