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
