/**
 * Raw SQL migration for initial D1 schema setup.
 * Used by `wrangler d1 migrations apply` and the CLI provisioner.
 *
 * We keep a raw SQL version alongside Drizzle for:
 * 1. Wrangler D1 migration compatibility
 * 2. Direct PRAGMA control (WAL mode, synchronous)
 * 3. Explicit STRICT mode and WITHOUT ROWID tables
 */

export const MIGRATION_001_INIT = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

-- 1. SITES
CREATE TABLE IF NOT EXISTS sites (
    site_id TEXT PRIMARY KEY,
    domain TEXT NOT NULL,
    name TEXT NOT NULL,
    timezone TEXT DEFAULT 'UTC',
    currency TEXT DEFAULT 'USD',
    public_share_enabled INTEGER DEFAULT 0,
    cname_proxy_domain TEXT,
    stripe_secret_encrypted TEXT,
    stripe_webhook_secret TEXT,
    razorpay_webhook_secret TEXT,
    polar_webhook_secret TEXT,
    paddle_webhook_secret TEXT,
    telegram_bot_token TEXT,
    telegram_chat_id TEXT,
    discord_webhook_url TEXT,
    created_at INTEGER DEFAULT (unixepoch())
) STRICT;

-- 2. VISITORS
CREATE TABLE IF NOT EXISTS visitors (
    site_id TEXT NOT NULL,
    visitor_id TEXT NOT NULL,
    customer_email_hash TEXT,
    first_seen_at INTEGER NOT NULL,
    first_source TEXT NOT NULL DEFAULT 'Direct (Typed/Bookmark)',
    first_category TEXT NOT NULL DEFAULT 'Direct',
    first_utm_source TEXT,
    first_utm_medium TEXT,
    first_utm_campaign TEXT,
    first_landing_page TEXT,
    last_seen_at INTEGER NOT NULL,
    last_source TEXT NOT NULL DEFAULT 'Direct (Typed/Bookmark)',
    last_category TEXT NOT NULL DEFAULT 'Direct',
    last_utm_source TEXT,
    last_utm_campaign TEXT,
    country TEXT DEFAULT 'XX',
    city TEXT,
    device_type TEXT DEFAULT 'desktop',
    os TEXT,
    browser TEXT,
    total_sessions INTEGER DEFAULT 1,
    total_active_read_sec INTEGER DEFAULT 0,
    max_scroll_pct INTEGER DEFAULT 0,
    PRIMARY KEY (site_id, visitor_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_visitors_email ON visitors(site_id, customer_email_hash) WHERE customer_email_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_visitors_first_seen ON visitors(site_id, first_seen_at, first_source);

-- 3. HOURLY_ROLLUPS
CREATE TABLE IF NOT EXISTS hourly_rollups (
    site_id TEXT NOT NULL,
    hour_bucket INTEGER NOT NULL,
    source TEXT NOT NULL,
    category TEXT NOT NULL,
    landing_page TEXT NOT NULL,
    country TEXT NOT NULL,
    visitors_count INTEGER DEFAULT 0,
    sessions_count INTEGER DEFAULT 0,
    pageviews_count INTEGER DEFAULT 0,
    active_read_sec_sum INTEGER DEFAULT 0,
    scroll_pct_sum INTEGER DEFAULT 0,
    PRIMARY KEY (site_id, hour_bucket, source, landing_page, country)
) STRICT, WITHOUT ROWID;

-- 4. EVENTS
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id TEXT NOT NULL,
    visitor_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_name TEXT NOT NULL,
    source TEXT NOT NULL,
    referrer TEXT,
    scroll_depth INTEGER DEFAULT 0,
    duration_sec INTEGER DEFAULT 0,
    meta_json TEXT,
    created_at INTEGER DEFAULT (unixepoch())
) STRICT;

CREATE INDEX IF NOT EXISTS idx_events_visitor_journey ON events(site_id, visitor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_site_time ON events(site_id, created_at);

-- 5. PAYMENTS
CREATE TABLE IF NOT EXISTS payments (
    payment_id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    gateway TEXT NOT NULL,
    visitor_id TEXT,
    customer_email_hash TEXT,
    customer_email_masked TEXT,
    plan_name TEXT,
    gross_amount_cents INTEGER NOT NULL,
    fee_amount_cents INTEGER NOT NULL DEFAULT 0,
    net_amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'usd',
    status TEXT NOT NULL,
    is_renewal INTEGER NOT NULL DEFAULT 0,
    first_touch_source TEXT NOT NULL DEFAULT 'Unattributed',
    last_touch_source TEXT NOT NULL DEFAULT 'Unattributed',
    country TEXT DEFAULT '🌍',
    city TEXT,
    time_to_convert_hours REAL DEFAULT 0.0,
    buyer_read_sec INTEGER DEFAULT 0,
    buyer_scroll_pct INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch())
) STRICT;

CREATE INDEX IF NOT EXISTS idx_payments_site_created ON payments(site_id, created_at, status);
CREATE INDEX IF NOT EXISTS idx_payments_ltv ON payments(site_id, first_touch_source, created_at);

-- 6. AD_SPEND
CREATE TABLE IF NOT EXISTS ad_spend (
    site_id TEXT NOT NULL,
    source TEXT NOT NULL,
    spend_date TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    PRIMARY KEY (site_id, source, spend_date)
) STRICT, WITHOUT ROWID;

-- 7. WEBHOOK_DEDUP_LOG
CREATE TABLE IF NOT EXISTS webhook_dedup_log (
    webhook_event_id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    processed_at INTEGER DEFAULT (unixepoch())
) STRICT, WITHOUT ROWID;
`;


/** Chart annotations ("Launched on Product Hunt"), shown as markers on the main chart. */
export const MIGRATION_002_ANNOTATIONS = `
CREATE TABLE IF NOT EXISTS annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    label TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_annotations_site_at ON annotations(site_id, at);
`;

/** Interest in plans that aren't self-serve yet (Indie Cloud, Lifetime). One row per email and plan. */
export const MIGRATION_003_WAITLIST = `
CREATE TABLE IF NOT EXISTS waitlist (
    email TEXT NOT NULL,
    plan TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (email, plan)
) STRICT, WITHOUT ROWID;
`;

/** One row per fully refunded payment; the payment itself flips to status 'refunded'. */
export const MIGRATION_004_REFUNDS = `
CREATE TABLE IF NOT EXISTS refunds (
    payment_id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    refunded_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_refunds_site_at ON refunds(site_id, refunded_at);
`;

/** Durable receipts and provider references; all writes using a receipt commit in one D1 batch. */
export const MIGRATION_005_DELIVERY_RECEIPTS = `
CREATE TABLE IF NOT EXISTS processed_messages (
    message_id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL,
    processed_at INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS payment_references (
    site_id TEXT NOT NULL,
    gateway TEXT NOT NULL,
    reference_id TEXT NOT NULL,
    payment_id TEXT NOT NULL,
    PRIMARY KEY (site_id, gateway, reference_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_payment_references_payment ON payment_references(site_id, payment_id);

CREATE TABLE IF NOT EXISTS refund_references (
    site_id TEXT NOT NULL,
    gateway TEXT NOT NULL,
    reference_id TEXT NOT NULL,
    refunded_at INTEGER NOT NULL,
    PRIMARY KEY (site_id, gateway, reference_id)
) STRICT, WITHOUT ROWID;
`;

/** Read-only API tokens, one site each. Only the SHA-256 of the secret is stored; the secret is shown once. */
export const MIGRATION_006_API_TOKENS = `
CREATE TABLE IF NOT EXISTS api_tokens (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    suffix TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    last_used_at INTEGER
) STRICT, WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_api_tokens_site ON api_tokens(site_id);
`;

/** Dashboard owner login: one password (PBKDF2), hashed session IDs, and a lockout after repeated failures. */
export const MIGRATION_007_OWNER_LOGIN = `
CREATE TABLE IF NOT EXISTS owner_auth (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    password_hash TEXT NOT NULL,
    failed_count INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;

CREATE TABLE IF NOT EXISTS sessions (
    id_hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
`;

/**
 * Hosted Cloud (CLOUD=1): customer accounts with email + password, sites owned by an account,
 * monthly event usage for the plan cap, and per-site payment webhook secrets set from the dashboard.
 * New tables instead of ALTERs, so the whole file stays safe to re-run.
 */
export const MIGRATION_008_CLOUD = `
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    failed_count INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'trial',
    trial_ends_at INTEGER NOT NULL,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    current_period_end INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT, WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_accounts_subscription ON accounts(stripe_subscription_id);

CREATE TABLE IF NOT EXISTS account_sessions (
    id_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS account_sites (
    site_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL
) STRICT, WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_account_sites_account ON account_sites(account_id);

CREATE TABLE IF NOT EXISTS account_usage (
    account_id TEXT NOT NULL,
    month TEXT NOT NULL,
    events INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (account_id, month)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS site_secrets (
    site_id TEXT NOT NULL,
    gateway TEXT NOT NULL,
    secret TEXT NOT NULL,
    PRIMARY KEY (site_id, gateway)
) STRICT, WITHOUT ROWID;
`;

/** Lifetime licenses sold through Stripe. The key is derived from the checkout session (HMAC), so only its hash is stored. */
export const MIGRATION_009_LICENSES = `
CREATE TABLE IF NOT EXISTS licenses (
    key_hash TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE,
    email TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    last_download_at INTEGER
) STRICT, WITHOUT ROWID;
`;

/** AI crawler hits reported server-side (bots don't run g.js), counted per day, bot and path. */
export const MIGRATION_010_AI_CRAWLS = `
CREATE TABLE IF NOT EXISTS ai_crawls (
    site_id TEXT NOT NULL,
    day TEXT NOT NULL,
    bot TEXT NOT NULL,
    path TEXT NOT NULL,
    hits INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (site_id, day, bot, path)
) STRICT, WITHOUT ROWID;
`;

/**
 * Webhook secrets move from the old per-gateway columns on `sites` into `site_secrets`, the one place the API reads.
 * The old columns are emptied so a later rerun can't bring back a secret the owner removed. They, and the never-used
 * telegram/discord/cname/stripe_secret_encrypted columns, stay in the table: dropping a column can't be rerun safely.
 */
export const MIGRATION_011_SECRETS = `
INSERT INTO site_secrets (site_id, gateway, secret) SELECT site_id, 'stripe', stripe_webhook_secret FROM sites WHERE stripe_webhook_secret != '' ON CONFLICT DO NOTHING;
INSERT INTO site_secrets (site_id, gateway, secret) SELECT site_id, 'razorpay', razorpay_webhook_secret FROM sites WHERE razorpay_webhook_secret != '' ON CONFLICT DO NOTHING;
INSERT INTO site_secrets (site_id, gateway, secret) SELECT site_id, 'polar', polar_webhook_secret FROM sites WHERE polar_webhook_secret != '' ON CONFLICT DO NOTHING;
INSERT INTO site_secrets (site_id, gateway, secret) SELECT site_id, 'paddle', paddle_webhook_secret FROM sites WHERE paddle_webhook_secret != '' ON CONFLICT DO NOTHING;
UPDATE sites SET stripe_webhook_secret = NULL, razorpay_webhook_secret = NULL, polar_webhook_secret = NULL, paddle_webhook_secret = NULL
 WHERE stripe_webhook_secret IS NOT NULL OR razorpay_webhook_secret IS NOT NULL OR polar_webhook_secret IS NOT NULL OR paddle_webhook_secret IS NOT NULL;
`;

/** Free self-hosted installs: a row means the site's "Powered by Grosslytics" footer link was found at `checked_at`. */
export const MIGRATION_012_FOOTER = `
CREATE TABLE IF NOT EXISTS site_footer (
  site_id TEXT PRIMARY KEY,
  checked_at INTEGER NOT NULL
);
`;

/** A row means this site's raw events are deleted after `days`; no row means they are kept forever. A table, because migrations rerun and ALTER TABLE can't. */
export const MIGRATION_013_RETENTION = `
CREATE TABLE IF NOT EXISTS site_retention (
  site_id TEXT PRIMARY KEY,
  days INTEGER NOT NULL
);
`;

export const ALL_MIGRATIONS = MIGRATION_001_INIT + MIGRATION_002_ANNOTATIONS + MIGRATION_003_WAITLIST + MIGRATION_004_REFUNDS + MIGRATION_005_DELIVERY_RECEIPTS + MIGRATION_006_API_TOKENS + MIGRATION_007_OWNER_LOGIN + MIGRATION_008_CLOUD + MIGRATION_009_LICENSES + MIGRATION_010_AI_CRAWLS + MIGRATION_011_SECRETS + MIGRATION_012_FOOTER + MIGRATION_013_RETENTION;
