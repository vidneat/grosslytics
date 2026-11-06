/**
 * ClickHouse schema SQL — applied via docker-entrypoint-initdb.d or migration script.
 * Includes:
 * - events_raw: MergeTree partitioned by month, ordered for range scans
 * - mv_daily_channel_stats: AggregatingMergeTree for sub-3ms aggregations
 * - payments: ReplacingMergeTree for idempotent payment upserts
 */

export const CLICKHOUSE_SCHEMA = `
-- Raw events (MergeTree, partitioned by month)
CREATE TABLE IF NOT EXISTS events_raw (
    site_id LowCardinality(String),
    visitor_id String,
    session_id String,
    event_type Enum8('pageview' = 1, 'leave' = 2, 'goal' = 3, 'ai_crawl' = 4),
    event_name String,
    source LowCardinality(String),
    category LowCardinality(String),
    referrer String DEFAULT '',
    country FixedString(2),
    city String DEFAULT '',
    device_type LowCardinality(String) DEFAULT 'desktop',
    os LowCardinality(String) DEFAULT '',
    browser LowCardinality(String) DEFAULT '',
    scroll_depth UInt8 DEFAULT 0,
    duration_sec UInt16 DEFAULT 0,
    meta_json String DEFAULT '',
    created_at DateTime DEFAULT now()
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (site_id, toDate(created_at), source, visitor_id)
SETTINGS index_granularity = 8192;

-- Materialized View: Daily channel stats (AggregatingMergeTree)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_channel_stats
ENGINE = AggregatingMergeTree()
ORDER BY (site_id, day, source, category)
AS SELECT
    site_id,
    toDate(created_at) AS day,
    source,
    category,
    uniqState(visitor_id) AS unique_visitors,
    uniqState(session_id) AS unique_sessions,
    countState() AS total_pageviews,
    sumState(toUInt64(duration_sec)) AS total_read_sec,
    avgState(toFloat32(scroll_depth)) AS avg_scroll_depth
FROM events_raw
GROUP BY site_id, day, source, category;

-- Visitors (ReplacingMergeTree — last write wins for last-touch fields)
CREATE TABLE IF NOT EXISTS visitors (
    site_id LowCardinality(String),
    visitor_id String,
    customer_email_hash String DEFAULT '',
    first_seen_at DateTime,
    first_source LowCardinality(String),
    first_category LowCardinality(String),
    first_utm_source String DEFAULT '',
    first_utm_medium String DEFAULT '',
    first_utm_campaign String DEFAULT '',
    first_landing_page String DEFAULT '',
    last_seen_at DateTime,
    last_source LowCardinality(String),
    last_category LowCardinality(String),
    last_utm_source String DEFAULT '',
    last_utm_campaign String DEFAULT '',
    country FixedString(2) DEFAULT 'XX',
    city String DEFAULT '',
    device_type LowCardinality(String) DEFAULT 'desktop',
    os LowCardinality(String) DEFAULT '',
    browser LowCardinality(String) DEFAULT '',
    total_sessions UInt32 DEFAULT 1,
    total_active_read_sec UInt32 DEFAULT 0,
    max_scroll_pct UInt8 DEFAULT 0,
    updated_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (site_id, visitor_id);

-- Payments (ReplacingMergeTree for idempotent upserts)
CREATE TABLE IF NOT EXISTS payments (
    payment_id String,
    site_id LowCardinality(String),
    gateway LowCardinality(String),
    visitor_id String DEFAULT '',
    customer_email_hash String DEFAULT '',
    customer_email_masked String DEFAULT '',
    plan_name String DEFAULT '',
    gross_amount_cents Int64,
    fee_amount_cents Int64 DEFAULT 0,
    net_amount_cents Int64,
    currency LowCardinality(String) DEFAULT 'usd',
    status LowCardinality(String),
    is_renewal UInt8 DEFAULT 0,
    first_touch_source LowCardinality(String) DEFAULT 'Unattributed',
    last_touch_source LowCardinality(String) DEFAULT 'Unattributed',
    country FixedString(2) DEFAULT 'XX',
    city String DEFAULT '',
    time_to_convert_hours Float32 DEFAULT 0,
    buyer_read_sec UInt32 DEFAULT 0,
    buyer_scroll_pct UInt8 DEFAULT 0,
    created_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (site_id, payment_id);

-- Ad Spend
CREATE TABLE IF NOT EXISTS ad_spend (
    site_id LowCardinality(String),
    source LowCardinality(String),
    spend_date Date,
    amount_cents Int64,
    updated_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (site_id, source, spend_date);

-- Webhook Dedup Log
CREATE TABLE IF NOT EXISTS webhook_dedup_log (
    webhook_event_id String,
    site_id LowCardinality(String),
    processed_at DateTime DEFAULT now()
) ENGINE = MergeTree()
ORDER BY (webhook_event_id)
TTL processed_at + INTERVAL 30 DAY;
`;

