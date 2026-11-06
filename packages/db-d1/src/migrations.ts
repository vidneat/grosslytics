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
