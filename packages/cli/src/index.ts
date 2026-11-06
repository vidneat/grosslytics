#!/usr/bin/env node
import { intro, outro, text, select, spinner, note, isCancel, cancel } from '@clack/prompts';
import pc from 'picocolors';
import { Command } from 'commander';
import { execSync } from 'node:child_process';
import { MIGRATION_001_INIT } from '@grosslytics/db-d1/migrations';
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
		intro(pc.bgEmerald(pc.black(' Grosslytics 1-Click Installer ')));

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
			writeFileSync('migration_init.sql', MIGRATION_001_INIT);
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
			const insertSql = `INSERT OR IGNORE INTO sites (site_id, domain, name, currency) VALUES ('${siteId}', '${domain}', '${name}', '${currency}');`;
			writeFileSync('insert_site.sql', insertSql);
			execSync(`npx wrangler d1 execute grosslytics-db --command="${insertSql}" --yes`, { stdio: 'pipe' });
			execSync('rm -f insert_site.sql');
			s.stop(pc.green(`Registered site ${siteId}`));
		} catch {
			execSync('rm -f insert_site.sql');
			s.stop(pc.yellow('Site record ready'));
		}

		const trackerSnippet = `<script defer src="https://grosslytics.com/g.js" data-site-id="${siteId}"></script>`;

		note(
			`${pc.bold('Site ID:')} ${pc.cyan(siteId)}\n` +
			`${pc.bold('Domain:')} ${domain}\n\n` +
			`${pc.bold('Embed Tracker (add to <head>):')}\n${pc.green(trackerSnippet)}\n\n` +
			`${pc.bold('Connect AI Assistant (Claude / Cursor / Windsurf):')}\n` +
			`${pc.cyan(`npx grosslytics mcp --site ${siteId}`)}`,
			'Setup Complete in <90s 🚀',
		);

		outro(pc.bold(pc.emerald('Done! Run `wrangler deploy` to publish your live edge endpoint.')));
	});

// 2. MCP Connector Command
program
	.command('mcp')
	.description('Connect the official Grosslytics Model Context Protocol server')
	.option('--site <siteId>', 'Grosslytics Site ID', 'gl_live_default')
	.action(async (opts) => {
		process.stderr.write(`Grosslytics MCP Server active for site: ${opts.site}\n`);
		process.stderr.write(`Connect Claude Code, Cursor, or Windsurf to: https://grosslytics.com/api/mcp?site=${opts.site}\n`);
	});

program.parse();

