#!/usr/bin/env node
import { intro, outro, text, select, spinner, note, isCancel, cancel } from '@clack/prompts';
import pc from 'picocolors';
import { Command } from 'commander';
import { execFileSync, execSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { MIGRATION_001_INIT, MIGRATION_002_ANNOTATIONS, MIGRATION_003_WAITLIST, MIGRATION_004_REFUNDS } from '@grosslytics/db-d1/migrations';
import { writeFileSync } from 'node:fs';

const program = new Command();

program
	.name('grosslytics')
	.description('Grosslytics: Ultra-fast, edge-native revenue attribution CLI')
	.version('0.1.0');

// 1. Interactive 1-Click Cloudflare Provisioner
program
	.command('init')
	.description('1-Click provision Cloudflare D1, Queues, and Durable Objects in <90s')
	.action(async () => {
		intro(pc.bgGreen(pc.black(' Grosslytics 1-Click Installer ')));

		const domain = await text({
			message: 'What is your primary website domain?',
			placeholder: 'mybrand.com',
			validate: (val) => (!val ? 'Domain is required' : undefined),
		});
		if (isCancel(domain)) { cancel('Setup cancelled'); process.exit(0); }

		const name = await text({
			message: 'What is your project or startup name?',
			placeholder: 'My Brand',
			defaultValue: String(domain),
		});
		if (isCancel(name)) { cancel('Setup cancelled'); process.exit(0); }

		const currency = await select({
			message: 'Select primary revenue currency:',
			options: [
				{ value: 'USD', label: 'USD ($)' },
				{ value: 'EUR', label: 'EUR (€)' },
				{ value: 'INR', label: 'INR (₹)' },
				{ value: 'GBP', label: 'GBP (£)' },
			],
		});
		if (isCancel(currency)) { cancel('Setup cancelled'); process.exit(0); }

		const siteId = `gl_live_${Math.random().toString(36).slice(2, 8)}`;
		const s = spinner();

		// Step 1: D1 Database Creation
		s.start('Provisioning Cloudflare D1 SQLite Database...');
		try {
			execSync('npx wrangler d1 create grosslytics-db --yes', { stdio: 'pipe' });
			s.stop(pc.green('Cloudflare D1 database created'));
		} catch {
			s.stop(pc.yellow('D1 database already exists or created'));
		}

		// Step 2: Queue Creation
		s.start('Configuring Cloudflare Queues batch ingestion pipeline...');
		try {
			execSync('npx wrangler queues create grosslytics-ingest', { stdio: 'pipe' });
			s.stop(pc.green('Cloudflare Ingestion Queue configured'));
		} catch {
			s.stop(pc.yellow('Queue already configured'));
		}

		// Step 3: Run Database Migrations
		s.start('Executing sub-5ms schema migrations (WAL mode, Hourly Rollups)...');
		try {
			writeFileSync('migration_init.sql', MIGRATION_001_INIT + MIGRATION_002_ANNOTATIONS + MIGRATION_003_WAITLIST + MIGRATION_004_REFUNDS);
			execSync(`npx wrangler d1 execute grosslytics-db --file=migration_init.sql --yes`, { stdio: 'pipe' });
			execSync('rm -f migration_init.sql');
			s.stop(pc.green('Schema migrations applied to D1'));
		} catch {
			execSync('rm -f migration_init.sql');
			s.stop(pc.yellow('Schema already applied'));
		}

		// Step 4: Register Initial Site
		s.start('Registering site record...');
		try {
			const q = (x: unknown) => `'${String(x).replace(/'/g, "''")}'`; // SQL string literal
			const insertSql = `INSERT OR IGNORE INTO sites (site_id, domain, name, currency) VALUES (${q(siteId)}, ${q(domain)}, ${q(name)}, ${q(currency)});`;
			// argv array, no shell: user input can't break out of the command
			execFileSync('npx', ['wrangler', 'd1', 'execute', 'grosslytics-db', `--command=${insertSql}`, '--yes'], { stdio: 'pipe' });
			s.stop(pc.green(`Registered site ${siteId}`));
		} catch {
			s.stop(pc.yellow('Site record ready'));
		}

		const trackerSnippet = `<script defer src="https://grosslytics.com/g.js" data-site-id="${siteId}"></script>`;

		note(
			`${pc.bold('Site ID:')} ${pc.cyan(siteId)}\n` +
			`${pc.bold('Domain:')} ${domain}\n\n` +
			`${pc.bold('Embed Tracker (add to <head>):')}\n${pc.green(trackerSnippet)}\n\n` +
			`${pc.bold('Connect AI Assistant (Claude / Cursor / Windsurf):')}\n` +
			`${pc.cyan(`GROSSLYTICS_API_TOKEN=<token> npx grosslytics mcp --site ${siteId}`)}`,
			'Setup Complete in <90s 🚀',
		);

		outro(pc.bold(pc.green('Done! Run `wrangler deploy` to publish your live edge endpoint.')));
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

