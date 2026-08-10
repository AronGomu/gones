#!/usr/bin/env node
/**
 * Load one local development environment from `fixtures/dev-environments/<name>` (ADR 0030).
 *
 * `npm run dev -- --env=<name>` calls this, and `npm run dev:env -- --env=<name>` re-runs it against
 * a stack that is already up. The dataset goes in through the real HTTP API, so a fixture the app
 * would refuse cannot reach the database; the one exception is the `email_confirmed` / `global_role`
 * pair, which has no endpoint and is written with SQL exactly as `scripts/seed-dev-accounts.mjs`
 * does (ADR 0029).
 *
 * An environment that carries data resets the local stack first, so swapping environments never
 * leaves the previous dataset behind. The reset is the same volume-dropping sequence as
 * `scripts/reset-local-stack.mjs`, minus that script's `frontend-development` container: it publishes
 * 127.0.0.1:4200, which is the port `npm run dev` then needs for its own `ng serve`.
 */
import { spawnSync } from 'node:child_process';

import { DEV_PASSWORD } from './dev-accounts.mjs';
import { DATA_FILES, devComposeEnv, listEnvironmentNames, parseDevArgs, readEnvironment, validateEnvironment } from './dev-environments.mjs';

const API_ORIGIN = 'http://127.0.0.1:5080';
const BACKEND_SERVICES = ['postgres', 'migrator', 'api', 'worker'];

/** Runs one reset command and propagates its exit code, so a failed reset never seeds onto a half-built stack. */
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: devComposeEnv() });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function resetDatabase() {
  run('docker', ['compose', '--profile', 'development', 'down', '--volumes', '--remove-orphans']);
  run('docker', ['compose', 'up', '--build', '-d', '--wait', ...BACKEND_SERVICES]);
  run(process.execPath, ['scripts/seed-local.mjs']);
}

/** Single quotes are the only SQL metacharacter reachable from a fixture string. */
function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function psql(sql, { capture = false } = {}) {
  const result = spawnSync('docker', [
    'compose', 'exec', '-T', 'postgres', 'psql', '-U', 'gones_migration', '-d', 'gones',
    '-v', 'ON_ERROR_STOP=1', capture ? '-tAc' : '-c', sql
  ], { encoding: 'utf8', stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit' });
  if (result.status !== 0) {
    console.error('Environment seeding could not reach the local database. Is the stack up? (docker compose ps postgres)');
    process.exit(result.status ?? 1);
  }
  return result;
}

async function seedAccounts(environment) {
  for (const { email, username, password, firstName, lastName } of environment.accounts) {
    // The existence probe means a re-run spends no auth rate-limit permit.
    const probe = psql(`SELECT 1 FROM asp_net_users WHERE normalized_email = ${sqlLiteral(email.toUpperCase())} LIMIT 1`, { capture: true });
    if (probe.stdout.trim() === '1') continue;

    const response = await fetch(`${API_ORIGIN}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, username, password: password ?? DEV_PASSWORD, firstName, lastName })
    });
    if (!response.ok && response.status !== 409) {
      console.error(`Registration failed for ${email}: ${response.status} ${await response.text()}`);
      process.exit(1);
    }
  }

  if (!environment.accounts.length) return;
  psql(environment.accounts.map(({ email, role, emailConfirmed }) =>
    `UPDATE asp_net_users SET email_confirmed = ${emailConfirmed === false ? 'false' : 'true'}, global_role = ${sqlLiteral(role)}, lockout_end = NULL, access_failed_count = 0 WHERE normalized_email = ${sqlLiteral(email.toUpperCase())};`
  ).join('\n'));
}

async function seedOrganizations(environment, tokens) { if (!environment.organizations.length) return new Map(); /* T2 */ return new Map(); }
async function seedFormats(environment, tokens) { if (!environment.formats.length) return new Map(); /* T2 */ return new Map(); }
async function seedTournaments(environment, tokens, organizationIds, formatIds) { if (!environment.tournaments.length) return new Map(); /* T2 */ return new Map(); }
async function seedRegistrations(environment, tokens, tournamentIds) { if (!environment.registrations.length) return; /* T2 */ }
async function seedLeagues(environment, tokens) { if (!environment.leagues.length) return; /* T3 */ }
async function seedLiveTournaments(environment, tokens) { if (!environment.liveTournaments.length) return; /* T3 */ }

const { environment: name } = parseDevArgs(process.argv.slice(2));

let environment;
try {
  environment = readEnvironment(name);
} catch (error) {
  if (error.message !== 'unknownDevEnvironment') throw error;
  console.error(`Unknown environment "${name}". Available: ${listEnvironmentNames().join(', ')}`);
  process.exit(2);
}

const problems = validateEnvironment(environment);
if (problems.length) {
  for (const problem of problems) console.error(problem);
  process.exit(2);
}

if (!environment.resetDatabase && DATA_FILES.every((key) => environment[key].length === 0)) {
  console.log(`Environment "${name}" seeds nothing.`);
  process.exit(0);
}

if (environment.resetDatabase) resetDatabase();

await seedAccounts(environment);

// Filled by the tickets that add the `demo` dataset; each hook returns immediately while its list is
// empty, so the call order here is already the order that dataset needs.
const tokens = new Map();
const organizationIds = await seedOrganizations(environment, tokens);
const formatIds = await seedFormats(environment, tokens);
const tournamentIds = await seedTournaments(environment, tokens, organizationIds, formatIds);
await seedRegistrations(environment, tokens, tournamentIds);
await seedLeagues(environment, tokens);
await seedLiveTournaments(environment, tokens);

const emailWidth = Math.max(0, ...environment.accounts.map(({ email }) => email.length));
const roleWidth = Math.max(0, ...environment.accounts.map(({ role }) => role.length));
console.log(`\nEnvironment "${name}" ready.`);
for (const { email, role, password } of environment.accounts) {
  console.log(`  ${email.padEnd(emailWidth + 2)}${role.padEnd(roleWidth + 2)}${password ?? DEV_PASSWORD}`);
}
