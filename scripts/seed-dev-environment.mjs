#!/usr/bin/env node
/**
 * Load one local development environment from `fixtures/dev-environments/<name>` (ADR 0030).
 *
 * `npm run dev -- --env=<name>` calls this, and `npm run dev:env -- --env=<name>` re-runs it against
 * a stack that is already up. The dataset goes in through the real HTTP API, so a fixture the app
 * would refuse cannot reach the database; the first exception is the `email_confirmed` / `global_role`
 * pair, which has no endpoint and is written with SQL exactly as `scripts/seed-dev-accounts.mjs`
 * does (ADR 0029).
 *
 * The second exception is the generated `stress` environment (T29), and only that one: its Events,
 * registrations, League Archives and audit rows are bulk-inserted by `scripts/bulk-load-stress.mjs`
 * because a whole simulated circuit through preview-then-publish would take hours. Its accounts,
 * organizations, formats and running tournaments still take the API path above, and the bulk rows are
 * generated in exactly the shape those endpoints would have written.
 *
 * An environment that carries data resets the local stack first, so swapping environments never
 * leaves the previous dataset behind. The reset is the same volume-dropping sequence as
 * `scripts/reset-local-stack.mjs`, minus that script's `frontend-development` container: it publishes
 * 127.0.0.1:4200, which is the port `npm run dev` then needs for its own `ng serve`.
 */
import { spawnSync } from 'node:child_process';

import { bulkLoadStress } from './bulk-load-stress.mjs';
import { DEV_PASSWORD } from './dev-accounts.mjs';
import { DATA_FILES, devComposeEnv, expectedEventSlug, isLocalDockerEndpoint, listEnvironmentNames, localDateTime, loginToken, normalizeFixtureEmail, parseDevArgs, readEnvironment, validateEnvironment } from './dev-environments.mjs';
import { readStressAuditRecords, STRESS_DIRECTORY, STRESS_ENVIRONMENT } from './generate-stress-environment.mjs';

const API_ORIGIN = 'http://127.0.0.1:5080';
const BACKEND_SERVICES = ['postgres', 'migrator', 'api', 'worker'];
/** 2-0, 2-1, 1-1 in rotation: a fixture needs a spread of wins and draws, and no randomness. */
const LIVE_SCORES = [[2, 0], [2, 1], [1, 1]];

// Parsed here rather than at the bottom: `seedComposeEnv` below has to know which environment is being
// seeded before the reset spawns anything.
const { environment: name } = parseDevArgs(process.argv.slice(2));
/** The one environment that is bulk-loaded instead of driven entirely through the API (T29). */
const bulk = name === STRESS_ENVIRONMENT;

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
  const relaxed = {
    ...devComposeEnv(),
    GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT: process.env.GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT || '1000',
    GONES_RATE_LIMIT_WRITE_PERMIT_LIMIT: process.env.GONES_RATE_LIMIT_WRITE_PERMIT_LIMIT || '1000'
  };
  if (!bulk) return relaxed;

  // The stress environment registers 700 accounts and then creates 400 formats and 200 organizations
  // through the API, which is well past the thousand permits above on both limiters. The admin bucket
  // is a third one: everything under `/api/admin` is 60 calls a minute per user by default, which is
  // exactly where a 400-format catalog stops. An explicitly exported value still wins, and nothing
  // outside this local Compose stack reads any of these names.
  return {
    ...relaxed,
    GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT: process.env.GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT || '100000',
    GONES_RATE_LIMIT_WRITE_PERMIT_LIMIT: process.env.GONES_RATE_LIMIT_WRITE_PERMIT_LIMIT || '100000',
    GONES_RATE_LIMIT_ADMIN_PERMIT_LIMIT: process.env.GONES_RATE_LIMIT_ADMIN_PERMIT_LIMIT || '100000'
  };
}

/** Runs one reset command and propagates its exit code, so a failed reset never seeds onto a half-built stack. */
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: seedComposeEnv() });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function dockerOutput(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', env: seedComposeEnv() });
  if (result.status !== 0) {
    console.error(`Could not resolve local Docker endpoint: ${String(result.stderr || result.error || 'docker command failed').trim()}`);
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
}

function effectiveDockerEndpoint() {
  const context = String(process.env.DOCKER_CONTEXT ?? '').trim();
  if (context) return dockerOutput(['context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}']);
  const host = String(process.env.DOCKER_HOST ?? '').trim();
  if (host) return host;
  const current = dockerOutput(['context', 'show']);
  return dockerOutput(['context', 'inspect', current, '--format', '{{.Endpoints.docker.Host}}']);
}

function requireLocalDocker() {
  const endpoint = effectiveDockerEndpoint();
  if (isLocalDockerEndpoint(endpoint)) return;
  console.error(`Unsafe Docker endpoint "${endpoint}": local Unix Docker is required for environment reset.`);
  process.exit(2);
}

function resetDatabase() {
  requireLocalDocker();
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
  if (!environment.accounts.length) return;

  // The existence probe means a re-run spends no auth rate-limit permit. It asks once for the whole
  // roster rather than once per account: a seven-account environment would not care, but the stress
  // environment would otherwise pay seven hundred `docker compose exec` round trips before its first
  // registration.
  const registered = new Set(psql(
    `SELECT lower(normalized_email) FROM asp_net_users WHERE normalized_email IN (${environment.accounts.map(({ email }) => sqlLiteral(email.toUpperCase())).join(', ')})`,
    { capture: true }
  ).stdout.split('\n').map((line) => line.trim()).filter(Boolean));

  for (const { email, username, password, firstName, lastName } of environment.accounts) {
    if (registered.has(normalizeFixtureEmail(email))) continue;

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
async function loginAll(environment, only = null) {
  const tokens = new Map();
  for (const { email, password, emailConfirmed } of environment.accounts) {
    if (emailConfirmed === false) continue;
    if (only !== null && !only.has(normalizeFixtureEmail(email))) continue;
    const { accessToken } = await loginToken(email, password ?? DEV_PASSWORD);
    tokens.set(normalizeFixtureEmail(email), accessToken);
  }
  return tokens;
}

function api(method, path, { token, body, idempotencyKey, ifMatch } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  // Both tournament writes require it; the key is derived from the fixture so a re-run replays
  // instead of publishing a second copy.
  if (idempotencyKey !== undefined) headers['Idempotency-Key'] = idempotencyKey;
  // Every Live command is guarded by the version predicate of the response before it.
  if (ifMatch !== undefined) headers['If-Match'] = ifMatch;
  return fetch(`${API_ORIGIN}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

/** Every seeding step fails the same way: name the step, the fixture key and what the API answered. */
async function requireResponse(response, step, key, tolerated = []) {
  if (response.ok || tolerated.includes(response.status)) return response;
  console.error(`Seeding ${step} failed for ${key}: ${response.status} ${await response.text()}`);
  process.exit(1);
}

function verifiedAccountForRole(environment, role) {
  return environment.accounts.find((candidate) => candidate.role === role && candidate.emailConfirmed !== false);
}

/**
 * The emails a bulk-loaded environment actually needs a token for: the Admin that creates the formats
 * and the organizations, and the organizer of each running tournament. Logging in the other 697 stress
 * accounts would cost seven hundred password hashes to hold tokens nothing calls.
 */
function bulkTokenEmails(environment) {
  const emails = new Set();
  const admin = verifiedAccountForRole(environment, 'Admin');
  if (admin !== undefined) emails.add(normalizeFixtureEmail(admin.email));
  for (const live of environment.liveTournaments) emails.add(normalizeFixtureEmail(live.organizerEmail));
  return emails;
}

function tokenForRole(environment, tokens, role, step) {
  const account = verifiedAccountForRole(environment, role);
  if (account === undefined) {
    console.error(`Seeding ${step} failed: the environment declares no verified ${role} account.`);
    process.exit(1);
  }
  return tokens.get(normalizeFixtureEmail(account.email));
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
  // A fixture names its members by email; only the admin user list turns those into the user IDs the
  // roster endpoint wants. That list is paged and caps its page at a hundred, so an environment with
  // more accounts than that has to walk it to the end or it would resolve nobody past the first page.
  const userIds = new Map();
  for (let page = 1; ; page += 1) {
    const listed = await requireResponse(await api('GET', `/api/admin/users?page=${page}&pageSize=100`, { token }), 'organizations', 'user lookup');
    const body = await listed.json();
    for (const user of body.items) userIds.set(normalizeFixtureEmail(user.email), user.id);
    if (body.items.length === 0 || userIds.size >= body.total) break;
  }

  for (const organization of environment.organizations) {
    const memberUserIds = [];
    for (const email of organization.memberEmails ?? []) {
      const memberUserId = userIds.get(normalizeFixtureEmail(email));
      if (memberUserId === undefined) {
        console.error(`Seeding organizations failed for ${organization.key}: member ${email} was not registered.`);
        process.exit(1);
      }
      memberUserIds.push(memberUserId);
    }

    const created = await requireResponse(await api('POST', '/api/admin/organizations', {
      token,
      body: {
        name: organization.name,
        description: organization.description ?? null,
        website: organization.website ?? null,
        contactEmail: organization.contactEmail ?? null
      }
    }), 'organizations', organization.key);
    const organizationId = (await created.json()).id;
    ids.set(organization.key, organizationId);

    // Nobody owns an organization (ADR 0041), so every fixture member joins the same way: as an
    // Organizer, which is also what promotes the account to the global Organizer role.
    for (const memberUserId of memberUserIds) {
      await requireResponse(await api('POST', `/api/organizations/${organizationId}/members`, {
        token,
        body: { userId: memberUserId, role: 'Organizer' }
      }), 'organizations', `${organization.key} member`);
    }

    // Creating an organization makes the actor its first member, and the actor here is the seeding
    // admin. Step it back out so the roster is exactly what the fixture declares.
    const roster = await requireResponse(await api('GET', `/api/organizations/${organizationId}/members`, { token }), 'organizations', `${organization.key} roster`);
    for (const member of await roster.json()) {
      if (memberUserIds.includes(member.userId)) continue;
      await requireResponse(await api('DELETE', `/api/organizations/${organizationId}/members/${member.userId}`, { token }), 'organizations', `${organization.key} seeder membership`);
    }
  }
  return ids;
}

/** Preview then publish, exactly as the organizer UI does: publishing consumes the preview ticket. */
async function seedEvents(environment, tokens, organizationIds, formatIds, formatSlugs) {
  const ids = new Map();
  if (!environment.tournaments.length) return ids;

  for (const entry of environment.tournaments) {
    const token = tokens.get(normalizeFixtureEmail(entry.organizerEmail));
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

    const previewed = await requireResponse(await api('POST', '/api/events/preview', { token, body: payload }), 'tournaments', entry.key);
    const { previewTicket } = await previewed.json();
    const published = await requireResponse(await api('POST', '/api/events', {
      token,
      body: { previewTicket, payload },
      idempotencyKey: `${environment.name}-tournament-${entry.key}`
    }), 'tournaments', entry.key);
    const { id, slug } = await published.json();
    const expectedSlug = expectedEventSlug(entry.title, formatSlugs.get(entry.formatKeys[0]));
    if (slug !== expectedSlug) {
      console.error(`Seeding Events failed for ${entry.key}: published slug "${slug}" did not match "${expectedSlug}".`);
      process.exit(1);
    }
    ids.set(entry.key, { id, slug });
  }
  return ids;
}

async function seedRegistrations(environment, tokens, eventIds) {
  if (!environment.registrations.length) return;

  for (const { tournamentKey, userEmail } of environment.registrations) {
    const event = eventIds.get(tournamentKey);
    // 409 covers both re-runs of this script against a stack that already carries the dataset and a
    // tournament whose start time passed while the seed was running.
    await requireResponse(await api('POST', `/api/events/${event.id}/registrations`, {
      token: tokens.get(normalizeFixtureEmail(userEmail)),
      idempotencyKey: `${environment.name}-registration-${tournamentKey}-${userEmail}`
    }), 'registrations', `${tournamentKey}/${userEmail}`, [409]);
  }
}

/**
 * One `POST /api/leagues-archive/restore` per fixture League: the file is a whole `LeagueDocument`,
 * which is the shape League Restore already takes, so the archive lands in a single validated call.
 *
 * League Restore mints new identities (a restored League is a new League, ADR 0022), so the fixture
 * id is only a key: the restored id is what `live-tournaments.json` has to be pointed at, and it is
 * what this returns. The idempotency key makes a re-run replay the first restore instead of adding a
 * second `Gones League 6 (restored)`.
 */
async function seedLeagues(environment, tokens) {
  const ids = new Map();
  if (!environment.leagues.length) return ids;

  // Admin passes the Organizer policy and owns no League, so ownership never blocks a re-seed.
  const token = tokenForRole(environment, tokens, 'Admin', 'leagues');

  for (const league of environment.leagues) {
    const restored = await requireResponse(await api('POST', '/api/leagues-archive/restore', {
      token,
      body: { kind: 'league', gonesDataVersion: 2, league },
      idempotencyKey: `${environment.name}-league-restore-${league.id}`
    }), 'leagues', league.id);
    ids.set(league.id, (await restored.json()).id);
  }
  return ids;
}

/**
 * Runs each fixture running tournament forward through the real Live commands: create, add every
 * player, then start / score / validate one Round per `scoredRounds`, and finally start one more
 * Round when `leaveRoundOpen` asks for a tournament caught mid-round.
 *
 * Every command answers `{ document, documentVersion, eTag }` and the next one must send that latest
 * `eTag` as `If-Match`, so the chain is strictly sequential.
 */
async function seedLiveTournaments(environment, tokens, leagueIds) {
  if (!environment.liveTournaments.length) return;

  for (const entry of environment.liveTournaments) {
    const token = tokens.get(normalizeFixtureEmail(entry.organizerEmail));
    const created = await requireResponse(await api('POST', '/api/live-tournaments', {
      token,
      body: {
        name: entry.name,
        leagueId: entry.leagueKey === null ? null : leagueIds.get(entry.leagueKey) ?? null,
        // A running tournament is happening now, so its date is relative like the Calendar's; only
        // the archive keeps absolute dates (ADR 0030).
        tournamentDate: localDateTime(entry.tournamentDate.offsetDays, '00:00').slice(0, 10),
        roundCount: entry.roundCount,
        customRoundCount: entry.customRoundCount,
        paidTrackingEnabled: entry.paidTrackingEnabled
      },
      idempotencyKey: `${environment.name}-live-create-${entry.key}`
    }), 'live tournaments', entry.key);

    let state = await created.json();
    const id = state.document.id;
    const command = async (step, path, body) => {
      const response = await api('POST', path, { token, body, ifMatch: state.eTag });
      await requireResponse(response, `live tournament ${step}`, entry.key);
      state = await response.json();
    };

    for (const player of entry.players) {
      await command('players', `/api/live-tournaments/${id}/players`, {
        name: player.name,
        initialWins: player.initialWins,
        initialDraws: player.initialDraws,
        initialLosses: player.initialLosses,
        archetype: player.archetype
      });
    }

    for (let round = 0; round < entry.scoredRounds; round += 1) {
      await command('round start', `/api/live-tournaments/${id}/rounds/start`);
      const open = state.document.rounds.at(-1);
      const matches = open.entries.filter((item) => item.entry.kind === 'match');
      for (const [index, item] of matches.entries()) {
        const [player1Score, player2Score] = LIVE_SCORES[index % LIVE_SCORES.length];
        await command('round score', `/api/live-tournaments/${id}/rounds/${open.id}/entries/${item.entry.id}/score`, { player1Score, player2Score });
      }
      await command('round validation', `/api/live-tournaments/${id}/rounds/validate`);
    }

    if (entry.leaveRoundOpen) await command('round start', `/api/live-tournaments/${id}/rounds/start`);
  }
}

/** Polls the readiness endpoint after a restart and answers how long the API took to serve again. */
async function waitForApiReady(timeoutMilliseconds = 300_000) {
  const started = Date.now();
  for (;;) {
    try {
      const response = await fetch(`${API_ORIGIN}/health/ready`);
      if (response.ok) return Date.now() - started;
    } catch {
      // Connection refused while the container is still starting; that is the normal first answer.
    }
    if (Date.now() - started > timeoutMilliseconds) {
      console.error('The API did not become ready after the statistics rebuild restart. (docker compose logs api)');
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/**
 * Rebuilds `player_statistics` after a bulk load.
 *
 * The read model is written inside archive write transactions (T22, ADR 0040) and a raw INSERT never
 * enters one, so a bulk-loaded archive would leave the table holding whatever the reset seeded.
 * Clearing the formula stamp is what makes `PlayerStatisticsStartupRebuild` treat the table as stale:
 * the restarted API then recomputes every row from every stored League, which is also the only end to
 * end proof that each bulk-written document is one the domain can still read.
 */
async function rebuildPlayerStatistics() {
  psql('DELETE FROM player_statistics_meta;');
  run('docker', ['compose', 'restart', 'api']);
  const readyMilliseconds = await waitForApiReady();

  const rows = Number(psql('SELECT count(*) FROM player_statistics;', { capture: true }).stdout.trim());
  if (!Number.isInteger(rows) || rows <= 0) {
    console.error('Player statistics are empty after the bulk load: the startup rebuild refused the archive it just read. (docker compose logs api)');
    process.exit(1);
  }

  const logs = spawnSync('docker', ['compose', 'logs', '--tail', '400', 'api'], { encoding: 'utf8', env: seedComposeEnv() });
  const rebuilt = String(logs.stdout ?? '').split('\n').reverse().find((line) => line.includes('Player statistics rebuilt'));
  console.log(`\nPlayer statistics rebuilt: ${rows} rows, API ready again ${readyMilliseconds} ms after the restart.`);
  if (rebuilt !== undefined) console.log(`  ${rebuilt.trim()}`);
}

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

// The stress dataset is generated rather than committed, so an ungenerated directory reads as a valid
// environment carrying nothing. Refuse it here: a reset that dropped the previous dataset and then
// seeded zero rows is the worst possible way to learn the generator never ran.
if (bulk && DATA_FILES.every((key) => environment[key].length === 0)) {
  console.error(`The "${STRESS_ENVIRONMENT}" environment carries no data: it is generated, not committed. Run \`npm run dev:stress:generate -- --seed=1\` first.`);
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
const tokens = carriesContent ? await loginAll(environment, bulk ? bulkTokenEmails(environment) : null) : new Map();
const formatIds = await seedFormats(environment, tokens);
const formatSlugs = new Map(environment.formats.map((format) => [format.key, format.slug]));
const organizationIds = await seedOrganizations(environment, tokens);

// Events, registrations, League Archives and audit rows go in as SQL for the stress environment only:
// thousands of Events through preview-then-publish is hours of HTTP, and the rows are generated
// in exactly the shape those endpoints would have written. Everything else still goes through the API.
let eventIds;
let leagueIds;
if (bulk) {
  const loaded = bulkLoadStress({
    environment,
    auditRecords: readStressAuditRecords(STRESS_DIRECTORY),
    organizationIds,
    formatIds,
    formatSlugs
  });
  eventIds = loaded.eventIds;
  leagueIds = loaded.leagueIds;
  console.log(`\nBulk-loaded ${loaded.counts.events} Events, ${loaded.counts.registrations} registrations, ${loaded.counts.leagues} League Archives and ${loaded.counts.auditRecords} audit rows.`);
  await rebuildPlayerStatistics();
} else {
  eventIds = await seedEvents(environment, tokens, organizationIds, formatIds, formatSlugs);
  await seedRegistrations(environment, tokens, eventIds);
  leagueIds = await seedLeagues(environment, tokens);
}
await seedLiveTournaments(environment, tokens, leagueIds);

const emailWidth = Math.max(0, ...environment.accounts.map(({ email }) => email.length));
const roleWidth = Math.max(0, ...environment.accounts.map(({ role }) => role.length));
console.log(`\nEnvironment "${name}" ready.`);
// Seven hundred identical credential lines would bury the seeded volumes below them; the password is
// the same for every generated account, so a sample says everything the whole roster would.
const listedAccounts = bulk ? environment.accounts.slice(0, 5) : environment.accounts;
for (const { email, role, password } of listedAccounts) {
  console.log(`  ${email.padEnd(emailWidth + 2)}${role.padEnd(roleWidth + 2)}${password ?? DEV_PASSWORD}`);
}
if (listedAccounts.length < environment.accounts.length) {
  console.log(`  ... and ${environment.accounts.length - listedAccounts.length} more, same password.`);
}

const seeded = [
  [environment.accounts.length, 'accounts'],
  [organizationIds.size, 'organizations'],
  [formatIds.size, 'formats'],
  [eventIds.size, 'Events'],
  [environment.registrations.length, 'registrations'],
  [leagueIds.size, 'league archives'],
  [environment.liveTournaments.length, 'running tournaments']
].filter(([count]) => count > 0);
if (seeded.length) console.log(`\nSeeded ${seeded.map(([count, label]) => `${count} ${label}`).join(', ')}.`);
