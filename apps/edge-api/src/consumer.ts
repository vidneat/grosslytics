import { ingestEvents } from '@grosslytics/db-d1';
import type { EnrichedEvent } from '@grosslytics/shared/types';
import type { Bindings } from './env.js';
import { countUsage, isCloud } from './cloud.js';

/** Queue receipts, raw events and counters commit together in one D1 batch. */
export async function handleQueueBatch(
	batch: MessageBatch<EnrichedEvent>,
	env: Bindings,
): Promise<void> {
	if (batch.messages.length === 0) return;

	try {
		await ingestEvents(env.DB, batch.messages);
		batch.ackAll();
	} catch (err) {
		console.error('Queue batch ingestion failure:', err);
		// Cloudflare Queues will retry unacknowledged messages up to max_retries
		for (const msg of batch.messages) {
			msg.retry();
		}
		return;
	}
	if (!isCloud(env)) return;
	// shortcut: counted after the ingest commit, so a redelivered batch can count twice and a failed count is lost; fine for a soft plan cap.
	const perSite = new Map<string, number>();
	for (const m of batch.messages) perSite.set(m.body.sid, (perSite.get(m.body.sid) ?? 0) + 1);
	try {
		await countUsage(env.DB, perSite);
	} catch (err) {
		console.error('Usage count failed:', err);
	}
}

/** Queue retries and gateway webhook retries are over within days, so receipts older than this can't stop a duplicate any more. */
export const RECEIPT_DAYS = 14;

/** Deletes old delivery receipts and expired sign-in sessions, which otherwise grow forever. Run daily. */
export async function cleanup(db: D1Database, now = Math.floor(Date.now() / 1000)): Promise<void> {
	await db.batch([
		db.prepare('DELETE FROM processed_messages WHERE processed_at < ?').bind(now - RECEIPT_DAYS * 86400),
		db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
		db.prepare('DELETE FROM account_sessions WHERE expires_at <= ?').bind(now),
	]);
}
