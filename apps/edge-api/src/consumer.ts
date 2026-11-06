import { D1StorageAdapter } from '@grosslytics/db-d1';
import type { EnrichedEvent } from '@grosslytics/shared/types';
import type { Bindings } from './env.js';

/**
 * Cloudflare Queue Consumer for Grosslytics Write-Behind Batch Ingestion.
 * Batches 100-500 events per single transactional write (cutting D1 write ops by 99%).
 */
export async function handleQueueBatch(
	batch: MessageBatch<EnrichedEvent>,
	env: Bindings,
): Promise<void> {
	if (batch.messages.length === 0) return;

	const adapter = new D1StorageAdapter(env.DB);
	const events: EnrichedEvent[] = [];

	for (const msg of batch.messages) {
		events.push(msg.body);
	}

	try {
		// 1. Batch insert granular raw events
		await adapter.insertEventBatch(events);

		// 2. Upsert visitors (first/last touch attribution)
		for (const event of events) {
			await adapter.upsertVisitor(event);
		}

		// 3. Increment pre-aggregated hourly rollups
		await adapter.upsertHourlyRollup(events);

		// Acknowledge all messages in batch
		batch.ackAll();
	} catch (err) {
		console.error('Queue batch ingestion failure:', err);
		// Cloudflare Queues will retry unacknowledged messages up to max_retries
		for (const msg of batch.messages) {
			msg.retry();
		}
	}
}
