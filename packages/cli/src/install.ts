import { execFileSync } from 'node:child_process';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Saved next to the bundle so re-running `install` updates the same deployment instead of asking again. */
export interface InstallState {
	license: string;
	host: string;
	zone: string;
	version?: string;
	passwordSet?: boolean;
}

export const DIR = 'grosslytics-install';
const STATE = join(DIR, 'state.json');

export const loadState = (): Partial<InstallState> => {
	try {
		return JSON.parse(readFileSync(STATE, 'utf8'));
	} catch {
		return {};
	}
};
export const saveState = (s: InstallState) => writeFileSync(STATE, JSON.stringify(s, null, 2));

/** Same format as the API's hashPassword (apps/edge-api/src/routes/auth.ts), so /app accepts it. */
export function hashPassword(password: string): string {
	const salt = randomBytes(16);
	return `pbkdf2$100000$${salt.toString('hex')}$${pbkdf2Sync(password, salt, 100_000, 32, 'sha256').toString('hex')}`;
}

/** "analytics.acme.co.uk" → "acme.co.uk" is not guessable from labels alone, so this is only the prompt's default. */
export const guessZone = (host: string) => host.split('.').slice(-2).join('.');

export const isHost = (h: string) => /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(h);

/** The edge API: pre-bundled, served at <host>/api/*. SQLite-backed Durable Objects work on the Workers Free and Paid plans. */
export function apiToml(s: Pick<InstallState, 'host' | 'zone'>, databaseId: string): string {
	return `name = "grosslytics-edge-api"
main = "index.js"
no_bundle = true
compatibility_date = "2024-12-01"
compatibility_flags = ["nodejs_compat"]
routes = [{ pattern = "${s.host}/api/*", zone_name = "${s.zone}" }]

[[d1_databases]]
binding = "DB"
database_name = "grosslytics-db"
database_id = "${databaseId}"

[[queues.producers]]
queue = "grosslytics-ingest"
binding = "INGEST_QUEUE"

[[queues.consumers]]
queue = "grosslytics-ingest"
max_batch_size = 100
max_batch_timeout = 1
max_retries = 3
dead_letter_queue = "grosslytics-ingest-dlq"

[durable_objects]
bindings = [{ name = "SITE_LIVE_HUB", class_name = "SiteLiveHub" }]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["SiteLiveHub"]

[vars]
ENVIRONMENT = "production"
TRACKER_ORIGIN = "https://${s.host}"
`;
}

/** The website and dashboard, on <host> as a custom domain (Cloudflare creates the DNS record). */
export function webToml(s: Pick<InstallState, 'host'>): string {
	// 2025-09-01+: React 19 server rendering needs the MessageChannel global
	return `name = "grosslytics-web"
main = "./dist/_worker.js/index.js"
compatibility_date = "2025-09-01"
compatibility_flags = ["nodejs_compat"]
routes = [{ pattern = "${s.host}", custom_domain = true }]

[assets]
binding = "ASSETS"
directory = "./dist"
`;
}

// shortcut: runs `npx` without a shell, which Windows can't resolve; macOS and Linux only until someone needs Windows.
// Runs inside DIR by default, so a wrangler.toml in the user's own folder is never read or edited.
// Quiet steps get no stdin: a prompt fails instead of waiting invisibly.
export const wrangler = (args: string[], opts: { cwd?: string; input?: string; quiet?: boolean } = {}) =>
	execFileSync('npx', ['--yes', 'wrangler@4', ...args], {
		cwd: opts.cwd ?? DIR,
		input: opts.input,
		stdio: [opts.input !== undefined ? 'pipe' : opts.quiet ? 'ignore' : 'inherit', opts.quiet ? 'pipe' : 'inherit', 'pipe'],
	})?.toString() ?? '';

/** Runs a wrangler command whose failure only means "already exists". Any other failure is rethrown with wrangler's message. */
export function ensure(args: string[]): void {
	try {
		wrangler(args, { quiet: true });
	} catch (e) {
		const msg = String((e as { stderr?: Buffer }).stderr ?? '') + String((e as { stdout?: Buffer }).stdout ?? '');
		if (!/already exists|already taken|\[code: 11009\]/i.test(msg)) throw new Error(msg.trim() || String(e));
	}
}

export function databaseId(): string {
	const list = JSON.parse(wrangler(['d1', 'list', '--json'], { quiet: true })) as Array<{ name: string; uuid: string }>;
	const db = list.find((d) => d.name === 'grosslytics-db');
	if (!db) throw new Error('Could not find the grosslytics-db database after creating it.');
	return db.uuid;
}

/** Downloads and unpacks the release bundle. Throws the server's message (bad key, no release) on failure. */
export async function download(origin: string, license: string): Promise<string> {
	const res = await fetch(`${origin.replace(/\/$/, '')}/api/license/download`, { headers: { authorization: `Bearer ${license}` } });
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error || `Download failed (HTTP ${res.status}).`);
	}
	const file = join(DIR, 'release.tgz');
	writeFileSync(file, Buffer.from(await res.arrayBuffer()));
	return unpack(file);
}

/** Unpacks a release bundle into DIR/release and returns its version. */
export function unpack(file: string): string {
	rmSync(join(DIR, 'release'), { recursive: true, force: true });
	mkdirSync(join(DIR, 'release'), { recursive: true });
	execFileSync('tar', ['-xzf', file, '-C', join(DIR, 'release')]);
	const version = join(DIR, 'release', 'VERSION');
	if (!existsSync(version)) throw new Error('The download was not a Grosslytics release.');
	return readFileSync(version, 'utf8').trim();
}
