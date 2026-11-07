import { eventAttribution, toHourBucket } from '@grosslytics/shared/attribution';
import type { EnrichedEvent } from '@grosslytics/shared/types';

/** Claim messages and apply every counter in the same transaction. Redeliveries select no rows. */
export async function ingestEvents(
	db: D1Database,
	messages: ReadonlyArray<{ id: string; body: EnrichedEvent }>,
): Promise<void> {
	if (!messages.length) return;
	const attempt = crypto.randomUUID();
	const payload = JSON.stringify([
		...new Map(
			messages.map(({ id, body }) => [
				id,
				{
					id: `queue:${id}`,
					...body,
					hour: toHourBucket(body.createdAt),
					...eventAttribution(body),
				},
			]),
		).values(),
	]);
	const incoming = `WITH incoming AS (
		SELECT j.value AS e FROM json_each(?1) j
		JOIN processed_messages r ON r.message_id = json_extract(j.value, '$.id') AND r.attempt_id = ?2
	)`;
	const statements = [
		`INSERT INTO processed_messages (message_id, attempt_id)
		 SELECT json_extract(value, '$.id'), ?2 FROM json_each(?1) WHERE true ON CONFLICT DO NOTHING`,
		`${incoming} INSERT INTO events (site_id, visitor_id, session_id, event_type, event_name, source, referrer, scroll_depth, duration_sec, meta_json, created_at)
		 SELECT e->>'$.sid', e->>'$.vid', e->>'$.ses', e->>'$.t', e->>'$.n', e->>'$.src', e->>'$.ref', e->>'$.sd', e->>'$.dur', e->>'$.meta', e->>'$.createdAt' FROM incoming`,
		`${incoming} INSERT INTO visitors (site_id, visitor_id, first_seen_at, first_source, first_category, first_utm_source, first_utm_medium, first_utm_campaign, first_landing_page,
		 last_seen_at, last_source, last_category, last_utm_source, last_utm_campaign, country, city, device_type, os, browser, total_sessions, total_active_read_sec, max_scroll_pct)
		 SELECT e->>'$.sid', e->>'$.vid', e->>'$.createdAt', e->>'$.src', e->>'$.category', e->>'$.us', e->>'$.um', e->>'$.uc', e->>'$.n',
		 e->>'$.createdAt', e->>'$.src', e->>'$.category', e->>'$.us', e->>'$.uc', e->>'$.country', e->>'$.city', e->>'$.deviceType', e->>'$.os', e->>'$.browser', 1, e->>'$.dur', e->>'$.sd'
		 FROM incoming WHERE true ORDER BY e->>'$.createdAt'
		 ON CONFLICT (site_id, visitor_id) DO UPDATE SET
		 first_source = CASE WHEN excluded.first_seen_at < first_seen_at THEN excluded.first_source ELSE first_source END,
		 first_category = CASE WHEN excluded.first_seen_at < first_seen_at THEN excluded.first_category ELSE first_category END,
		 first_utm_source = CASE WHEN excluded.first_seen_at < first_seen_at THEN excluded.first_utm_source ELSE first_utm_source END,
		 first_utm_medium = CASE WHEN excluded.first_seen_at < first_seen_at THEN excluded.first_utm_medium ELSE first_utm_medium END,
		 first_utm_campaign = CASE WHEN excluded.first_seen_at < first_seen_at THEN excluded.first_utm_campaign ELSE first_utm_campaign END,
		 first_landing_page = CASE WHEN excluded.first_seen_at < first_seen_at THEN excluded.first_landing_page ELSE first_landing_page END,
		 first_seen_at = MIN(first_seen_at, excluded.first_seen_at),
		 last_source = CASE WHEN excluded.last_seen_at >= last_seen_at THEN excluded.last_source ELSE last_source END,
		 last_category = CASE WHEN excluded.last_seen_at >= last_seen_at THEN excluded.last_category ELSE last_category END,
		 last_utm_source = CASE WHEN excluded.last_seen_at >= last_seen_at THEN excluded.last_utm_source ELSE last_utm_source END,
		 last_utm_campaign = CASE WHEN excluded.last_seen_at >= last_seen_at THEN excluded.last_utm_campaign ELSE last_utm_campaign END,
		 country = CASE WHEN excluded.last_seen_at >= last_seen_at THEN excluded.country ELSE country END,
		 city = CASE WHEN excluded.last_seen_at >= last_seen_at THEN excluded.city ELSE city END,
		 last_seen_at = MAX(last_seen_at, excluded.last_seen_at), total_sessions = total_sessions + 1,
		 total_active_read_sec = total_active_read_sec + excluded.total_active_read_sec, max_scroll_pct = MAX(max_scroll_pct, excluded.max_scroll_pct)`,
		`${incoming} UPDATE visitors AS v SET customer_email_hash = p.customer_email_hash FROM payments p
		 WHERE p.site_id = v.site_id AND p.visitor_id = v.visitor_id AND v.customer_email_hash IS NULL AND p.customer_email_hash IS NOT NULL
		 AND EXISTS (SELECT 1 FROM incoming WHERE e->>'$.sid' = v.site_id AND e->>'$.vid' = v.visitor_id)`,
		// A payment may beat the queued visit. Fill only missing attribution, using touches before payment.
		`${incoming} UPDATE payments AS p SET
		 first_touch_source = v.first_source, last_touch_source = v.last_source,
		 time_to_convert_hours = ROUND(MAX(0, p.created_at - v.first_seen_at) / 3600.0, 1),
		 buyer_read_sec = v.total_active_read_sec, buyer_scroll_pct = v.max_scroll_pct,
		 country = CASE WHEN p.country = 'XX' THEN v.country ELSE p.country END, city = COALESCE(p.city, v.city)
		 FROM visitors v WHERE p.site_id = v.site_id AND p.visitor_id = v.visitor_id AND p.first_touch_source = 'Unattributed'
		 AND v.last_seen_at <= p.created_at AND EXISTS (SELECT 1 FROM incoming WHERE e->>'$.sid' = p.site_id AND e->>'$.vid' = p.visitor_id)`,
	];
	await db.batch(statements.map((sql) => db.prepare(sql).bind(payload, attempt)));
}
