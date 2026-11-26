import { hashToken, newTokenSecret } from './auth.js';
import type { Bindings } from './env.js';

type Purpose = 'account' | 'license';

export const canSendProof = (env: Bindings) => env.PLUNK_API_KEY?.startsWith('sk_') === true && !!env.PLUNK_FROM_EMAIL;

export async function sendEmailProof(env: Bindings, purpose: Purpose, subject: string, email: string): Promise<void> {
	if (!canSendProof(env)) throw new Error('Email verification is unavailable');
	const code = newTokenSecret().slice('gl_pat_'.length);
	const hash = await hashToken(code);
	const issued = await env.DB.prepare(`INSERT INTO email_proofs VALUES (?, ?, ?, unixepoch(), unixepoch() + 900)
		ON CONFLICT (purpose, subject) DO UPDATE SET code_hash = excluded.code_hash, issued_at = excluded.issued_at, expires_at = excluded.expires_at
		WHERE email_proofs.issued_at <= unixepoch() - 300`).bind(purpose, subject, hash).run();
	if (!issued.meta.changes) return;

	try {
		const response = await fetch('https://next-api.useplunk.com/v1/send', {
			method: 'POST',
			redirect: 'manual',
			signal: AbortSignal.timeout(8000),
			headers: { authorization: `Bearer ${env.PLUNK_API_KEY}`, 'content-type': 'application/json' },
			body: JSON.stringify({
				from: env.PLUNK_FROM_EMAIL, to: email,
				subject: purpose === 'account' ? 'Verify your Grosslytics email' : 'Claim your Grosslytics license',
				body: `<p>Paste this code into Grosslytics to continue.</p><p><code>${code}</code></p><p>It expires in 15 minutes. If you did not request it, you can ignore this email.</p>`,
			}),
		});
		if (!response.ok) {
			await response.body?.cancel();
			throw new Error('Email delivery failed');
		}
	} catch {
		await env.DB.prepare('DELETE FROM email_proofs WHERE purpose = ? AND subject = ? AND code_hash = ?').bind(purpose, subject, hash).run();
		throw new Error('Email delivery failed');
	}
}

export async function redeemEmailProof(db: D1Database, purpose: Purpose, subject: string, code: string): Promise<boolean> {
	if (!/^[a-f0-9]{40}$/.test(code)) return false;
	const result = await db.prepare('DELETE FROM email_proofs WHERE purpose = ? AND subject = ? AND code_hash = ? AND expires_at > unixepoch()')
		.bind(purpose, subject, await hashToken(code)).run();
	return !!result.meta.changes;
}
