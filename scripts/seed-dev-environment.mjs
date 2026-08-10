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
import { DATA_FILES, devComposeEnv, listEnvironmentNames, localDateTime, loginToken, parseDevArgs, readEnvironment, validateEnvironment } from './dev-environments.mjs';

const API_ORIGIN = 'http://127.0.0.1:5080';
const BACKEND_SERVICES = ['postgres', 'migrator', 'api', 'worker'];

/**
 * `docker compose` environment for the reset, on top of the feature flags every local stack needs.
 *
 * `/api/auth/register` and `/api/auth/login` allow 5 calls per 15 minutes per IP
 * (`AuthRateLimiting.PermitLimit`), and the local stack does not relax it: compose runs the API with
 * `ASPNETCORE_ENVIRONMENT=Production`. A seven-account environment makes thirteen auth calls in a
 * row and would be answered 429 from the sixth, so the reset starts the API with the same relaxed
 * permit limit `scripts/full-stack-ci.mjs` uses. An explicitly exported value still wins, and
 * nothing outside this local Compose stack reads it.
 */
function seedComposeEnv() {
  return {
    ...devComposeEnv(),
    GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT: process.env.GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT || '1000'
  };
}

/** Runs one reset command and propagates its exit code, so a failed reset never seeds onto a half-built stack. */
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: seedComposeEnv() });
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

/**
 * One access token per seedable account, taken once so the content hooks never log in again — the
 * login endpoint is rate-limited per IP, and a hook that logged in per row would exhaust it.
 * Unverified accounts are skipped: they exist to show the unverified state, and the API refuses
 * every content call they could make.
 */
async function loginAll(environment) {
  const tokens = new Map();
  for (const { email, password, emailConfirmed } of environment.accounts) {
    if (emailConfirmed === false) continue;
    const { accessToken } = await loginToken(email, password ?? DEV_PASSWORD);
    tokens.set(email, accessToken);
  }
  return tokens;
}

function api(method, path, { token, body, idempotencyKey } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  // Both tournament writes require it; the key is derived from the fixture so a re-run replays
  // instead of publishing a second copy.
  if (idempotencyKey !== undefined) headers['Idempotency-Key'] = idempotencyKey;
  return fetch(`${API_ORIGIN}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

/** Every seeding step fails the same way: name the step, the fixture key and what the API answered. */
async function requireResponse(response, step, key, tolerated = []) {
  if (response.ok || tolerated.includes(response.status)) return response;
  console.error(`Seeding ${step} failed for ${key}: ${response.status} ${await response.text()}`);
  process.exit(1);
}

function tokenForRole(environment, tokens, role, step) {
  const account = environment.accounts.find((candidate) => candidate.role === role && candidate.emailConfirmed !== false);
  if (account === undefined) {
    console.error(`Seeding ${step} failed: the environment declares no verified ${role} account.`);
    process.exit(1);
  }
  return tokens.get(account.email);
}

/** Formats are catalog rows the local seed already ships some of, so match on slug before creating. */
async function seedFormats(environment, tokens) {
  const ids = new Map();
  if (!environment.formats.length) return ids;

  const token = tokenForRole(environment, tokens, 'Admin', 'formats');
  const listed = await requireResponse(await api('GET', '/api/formats'), 'formats', 'list');
  const existing = await listed.json();
  for (const format of environment.formats) {
    const match = existing.find((candidate) => candidate.slug === format.slug);
    if (match !== undefined) {
      ids.set(format.key, match.id);
      continue;
    }

    const created = await requireResponse(await api('POST', '/api/admin/formats', {
      token,
      body: { name: format.name, slug: format.slug, sortOrder: format.sortOrder }
    }), 'formats', format.key);
    ids.set(format.key, (await created.json()).id);
  }
  return ids;
}

async function seedOrganizations(environment, tokens) {
  const ids = new Map();
  if (!environment.organizations.length) return ids;

  const token = tokenForRole(environment, tokens, 'Admin', 'organizations');
  // A fixture names its owner by email; only the admin user list turns that into the user ID the
  // create endpoint wants.
  const listed = await requireResponse(await api('GET', '/api/admin/users?pageSize=100', { token }), 'organizations', 'user lookup');
  const userIds = new Map((await listed.json()).items.map((user) => [user.email.toLowerCase(), user.id]));

  for (const organization of environment.organizations) {
    const ownerUserId = userIds.get(organization.ownerEmail.toLowerCase());
    if (ownerUserId === undefined) {
      console.error(`Seeding organizations failed for ${organization.key}: owner ${organization.ownerEmail} was not registered.`);
      process.exit(1);
    }

    const created = await requireResponse(await api('POST', '/api/admin/organizations', {
      token,
      body: {
        name: organization.name,
        description: organization.description ?? null,
        website: organization.website ?? null,
        contactEmail: organization.contactEmail ?? null,
        ownerUserId
      }
    }), 'organizations', organization.key);
    ids.set(organization.key, (await created.json()).id);
  }
  return ids;
}

/** Preview then publish, exactly as the organizer UI does: publishing consumes the preview ticket. */
async function seedTournaments(environment, tokens, organizationIds, formatIds) {
  const ids = new Map();
  if (!environment.tournaments.length) return ids;

  for (const entry of environment.tournaments) {
    const token = tokens.get(entry.organizerEmail);
    const payload = {
      organizationId: organizationIds.get(entry.organizationKey),
      title: entry.title,
      summary: entry.summary,
      bodyHtml: entry.bodyHtml,
      streetAddress: entry.streetAddress,
      postalCode: entry.postalCode,
      city: entry.city,
      country: entry.country,
      timeZoneId: entry.timeZoneId,
      // `:00` because the server parses these with NodaTime's extended ISO pattern, which wants
      // seconds; the fixtures and `localDateTime` stay at minute precision, which is what a person
      // editing a tournament time cares about.
      startsAtLocal: `${localDateTime(entry.startsAtLocalOffsetDays, entry.startsAtLocalTime)}:00`,
      endsAtLocal: `${localDateTime(entry.endsAtLocalOffsetDays, entry.endsAtLocalTime)}:00`,
      capacity: entry.capacity,
      formatIds: entry.formatKeys.map((key) => formatIds.get(key))
    };

    const previewed = await requireResponse(await api('POST', '/api/tournaments/preview', { token, body: payload }), 'tournaments', entry.key);
    const { previewTicket } = await previewed.json();
    const published = await requireResponse(await api('POST', '/api/tournaments', {
      token,
      body: { previewTicket, payload },
      idempotencyKey: `${environment.name}-tournament-${entry.key}`
    }), 'tournaments', entry.key);
    const { id, slug } = await published.json();
    ids.set(entry.key, { id, slug });
  }
  return ids;
}

async function seedRegistrations(environment, tokens, tournamentIds) {
  if (!environment.registrations.length) return;

  for (const { tournamentKey, userEmail } of environment.registrations) {
    const tournament = tournamentIds.get(tournamentKey);
    // 409 covers both re-runs of this script against a stack that already carries the dataset and a
    // tournament whose start time passed while the seed was running.
    await requireResponse(await api('POST', `/api/tournaments/${tournament.id}/registrations`, {
      token: tokens.get(userEmail),
      idempotencyKey: `${environment.name}-registration-${tournamentKey}-${userEmail}`
    }), 'registrations', `${tournamentKey}/${userEmail}`, [409]);
  }
}

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

// Content seeding drives the API as the accounts themselves, so it needs their tokens — but only
// when there is content: an accounts-only environment must not spend login rate-limit permits.
const carriesContent = DATA_FILES.filter((key) => key !== 'accounts').some((key) => environment[key].length > 0);
const tokens = carriesContent ? await loginAll(environment) : new Map();
const formatIds = await seedFormats(environment, tokens);
const organizationIds = await seedOrganizations(environment, tokens);
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

const seeded = [
  [environment.accounts.length, 'accounts'],
  [organizationIds.size, 'organizations'],
  [formatIds.size, 'formats'],
  [tournamentIds.size, 'tournaments'],
  [environment.registrations.length, 'registrations']
].filter(([count]) => count > 0);
if (seeded.length) console.log(`\nSeeded ${seeded.map(([count, label]) => `${count} ${label}`).join(', ')}.`);
