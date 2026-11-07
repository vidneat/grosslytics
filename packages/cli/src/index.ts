#!/usr/bin/env node
import { intro, outro, text, spinner, note, isCancel, cancel } from '@clack/prompts';
import pc from 'picocolors';
import { Command } from 'commander';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { apiToml, databaseId, DIR, download, ensure, guessZone, hashPassword, isHost, loadState, saveState, unpack, webToml, wrangler } from './install.js';

const program = new Command();

program
	.name('grosslytics')
	.description('Grosslytics: Ultra-fast, edge-native revenue attribution CLI')
	.version('0.1.0');

// 1. Lifetime installer: license key → release bundle → everything created and deployed in the buyer's own Cloudflare.
// Re-running it updates the same install to the latest release.
program
	.command('install')
	.alias('init')
	.description('Install or update Grosslytics in your own Cloudflare account (needs a Lifetime license key)')
	.option('--from <origin>', 'Where licenses and releases are served', 'https://grosslytics.com')
	.option('--bundle <file>', 'Deploy a locally built bundle (bun run setup) instead of downloading one; no license needed')
	.action(async (opts: { from: string; bundle?: string }) => {
		intro(pc.bgGreen(pc.black(' Grosslytics installer ')));
		mkdirSync(DIR, { recursive: true });
		const prev = loadState();
		const ask = async (message: string, initial: string | undefined, validate: (v: string) => string | undefined, placeholder?: string) => {
			const v = await text({ message, initialValue: initial, placeholder, validate: (x) => validate(String(x ?? '').trim()) });
			if (isCancel(v)) {
				cancel('Cancelled. Nothing was changed.');
				process.exit(0);
			}
			return String(v).trim();
		};

		const license = opts.bundle ? '' : process.env.GROSSLYTICS_LICENSE || prev.license || (await ask('Your license key', undefined, (v) => (v.startsWith('gl_lic_') ? undefined : 'Paste the gl_lic_… key from your purchase page'), 'gl_lic_…'));
		const host = prev.host || (await ask('Where should Grosslytics live? A hostname on a domain you have on Cloudflare', undefined, (v) => (isHost(v.toLowerCase()) ? undefined : 'A hostname like analytics.yourstartup.com'), 'analytics.yourstartup.com')).toLowerCase();
		const zone = prev.zone || (await ask('Its Cloudflare zone (the root domain)', guessZone(host), (v) => (host === v || host.endsWith(`.${v}`) ? undefined : `${host} must be inside this domain`))).toLowerCase();
		const password = prev.passwordSet ? '' : await ask('Choose your dashboard password', undefined, (v) => (v.length >= 10 ? undefined : 'At least 10 characters'));

		const s = spinner();
		const step = async <T>(label: string, fn: () => T | Promise<T>): Promise<T> => {
			s.start(label);
			try {
				const r = await fn();
				s.stop(pc.green(label));
				return r;
			} catch (e) {
				s.stop(pc.red(`${label}: failed`));
				cancel(String((e as Error).message || e));
				process.exit(1);
			}
		};

		const bundle = opts.bundle && resolve(opts.bundle);
		const version = bundle ? await step('Unpacking your build', () => unpack(bundle)) : await step('Downloading the latest release', () => download(opts.from, license));
		saveState({ license, host, zone, version, passwordSet: prev.passwordSet });

		try {
			wrangler(['whoami'], { quiet: true });
		} catch {
			note('A browser window opens. Sign in to Cloudflare and click Allow.', 'Cloudflare sign-in');
			wrangler(['login']);
		}

		await step('Creating the database', () => ensure(['d1', 'create', 'grosslytics-db']));
		const dbId = await step('Finding the database', databaseId);
		await step('Creating the queues', () => {
			ensure(['queues', 'create', 'grosslytics-ingest']);
			ensure(['queues', 'create', 'grosslytics-ingest-dlq']);
		});
		await step('Creating or updating tables', () => wrangler(['d1', 'execute', 'grosslytics-db', '--remote', '--yes', '--file', resolve(DIR, 'release', 'migrate.sql')], { quiet: true }));

		const api = join(DIR, 'release', 'api');
		const web = join(DIR, 'release', 'web');
		writeFileSync(join(api, 'wrangler.toml'), apiToml({ host, zone }, dbId));
		writeFileSync(join(web, 'wrangler.toml'), webToml({ host }));
		await step('Deploying the API', () => wrangler(['deploy'], { cwd: api, quiet: true }));
		await step('Deploying the dashboard', () => wrangler(['deploy'], { cwd: web, quiet: true }));

		let apiToken = '';
		if (!prev.passwordSet) {
			apiToken = randomBytes(32).toString('hex');
			await step('Setting the API key', () => wrangler(['secret', 'put', 'API_TOKEN'], { cwd: api, input: apiToken, quiet: true }));
			// The hash is hex and $-separated, so it is safe inside the SQL literal
			const sql = `INSERT INTO owner_auth (id, password_hash) VALUES (1, '${hashPassword(password)}') ON CONFLICT (id) DO UPDATE SET password_hash = excluded.password_hash, failed_count = 0, locked_until = 0, updated_at = unixepoch();`;
			await step('Setting your dashboard password', () => wrangler(['d1', 'execute', 'grosslytics-db', '--remote', '--yes', '--command', sql], { quiet: true }));
			saveState({ license, host, zone, version, passwordSet: true });
		}

		note(
			`${pc.bold('Dashboard:')} ${pc.cyan(`https://${host}/app`)} (sign in with your password; a new domain can take a few minutes)\n` +
				`${pc.bold('Version:')} ${version}\n` +
				(apiToken
					? `\n${pc.bold('Your API_TOKEN')} (save it in your password manager; it is shown only now):\n${pc.yellow(apiToken)}\nYou need it to reset the dashboard password, or for scripts and MCP.\n`
					: '') +
				`\nTo update later, run ${pc.cyan(bundle ? 'bun run setup' : 'npx grosslytics install')} again in this folder.`,
			prev.passwordSet ? 'Updated' : 'Installed',
		);
		outro(pc.green('Done. Add a site on /app and paste its script tag into your site.'));
	});

// 2. MCP stdio server: bridges an MCP client's stdio JSON-RPC to the hosted Streamable HTTP endpoint
program
	.command('mcp')
	.description('Run the Grosslytics MCP server over stdio (for Claude Code, Cursor, Windsurf)')
	.option('--site <siteId>', 'Grosslytics Site ID')
	.option('--url <origin>', 'Grosslytics API origin', 'https://grosslytics.com')
	.action((opts) => {
		const token = process.env.GROSSLYTICS_API_TOKEN;
		if (!opts.site || !token) {
			process.stderr.write('Usage: GROSSLYTICS_API_TOKEN=... grosslytics mcp --site <siteId> [--url <origin>]\n');
			process.exit(1);
		}
		const endpoint = `${opts.url}/api/mcp?site=${encodeURIComponent(opts.site)}`;
		const reply = (msg: unknown) => process.stdout.write(`${JSON.stringify(msg)}\n`);

		createInterface({ input: process.stdin }).on('line', async (line) => {
			if (!line.trim()) return;
			let id: unknown = null;
			try {
				id = JSON.parse(line).id ?? null;
			} catch {}
			try {
				const res = await fetch(endpoint, {
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						accept: 'application/json, text/event-stream',
						authorization: `Bearer ${token}`,
					},
					body: line,
				});
				const text = await res.text();
				// Notifications get 202 with no body; only JSON bodies are valid protocol output
				if (text && res.headers.get('content-type')?.includes('json')) process.stdout.write(`${text.trim()}\n`);
				else if (id !== null && !res.ok) reply({ jsonrpc: '2.0', id, error: { code: -32000, message: `HTTP ${res.status}: ${text}` } });
			} catch (err) {
				if (id !== null) reply({ jsonrpc: '2.0', id, error: { code: -32000, message: String(err) } });
			}
		});
	});

program.parse();

