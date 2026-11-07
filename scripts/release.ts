/**
 * Builds the release bundle that Lifetime buyers' `npx grosslytics install` downloads (operator only).
 *   bun scripts/release.ts            build .release/grosslytics.tgz
 *   bun scripts/release.ts --upload   also put it in R2 as grosslytics-releases/latest.tgz (needs `wrangler login`)
 *   bun scripts/release.ts --keep-env keep PUBLIC_* build settings (`bun run setup`, deploying your own copy)
 * Bundle: api/index.js (pre-bundled edge API), web/dist (the built site + dashboard), migrate.sql, VERSION.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { ALL_MIGRATIONS } from '../packages/db-d1/src/migrations.ts';

const OUT = '.release';
const run = (cmd: string, args: string[], env?: NodeJS.ProcessEnv) => execFileSync(cmd, args, { stdio: 'inherit', env });

rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/bundle/web`, { recursive: true });

// Buyers' sites must not carry the operator's checkout links or API URL
const cleanEnv = process.argv.includes('--keep-env') ? process.env : Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('PUBLIC_')));
run('bun', ['run', '--cwd', 'apps/web', 'build'], cleanEnv);
cpSync('apps/web/dist', `${OUT}/bundle/web/dist`, { recursive: true });
run('bunx', ['wrangler', 'deploy', '--dry-run', '--outdir', `${OUT}/bundle/api`]);
rmSync(`${OUT}/bundle/api/index.js.map`, { force: true });
rmSync(`${OUT}/bundle/api/README.md`, { force: true });

// D1 manages journal mode itself and rejects these pragmas (same as scripts/db.ts)
writeFileSync(`${OUT}/bundle/migrate.sql`, ALL_MIGRATIONS.replace(/^PRAGMA .*$/gm, ''));
const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim();
const version = `${new Date().toISOString().slice(0, 10)}-${sha}`;
writeFileSync(`${OUT}/bundle/VERSION`, version);

run('tar', ['-czf', `${OUT}/grosslytics.tgz`, '-C', `${OUT}/bundle`, '.']);
console.log(`\nBuilt ${OUT}/grosslytics.tgz (${version})`);

if (process.argv.includes('--upload')) {
	run('bunx', ['wrangler', 'r2', 'object', 'put', 'grosslytics-releases/latest.tgz', '--file', `${OUT}/grosslytics.tgz`, '--content-type', 'application/gzip', '--remote']);
	console.log('Uploaded as latest.tgz. Every license holder gets it on their next `npx grosslytics install`.');
}
