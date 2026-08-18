/**
 * File-driven local development environments (ADR 0030).
 *
 * A local environment is a directory of JSON files under `fixtures/dev-environments/`, and this
 * module is the only reader of that format: `scripts/dev.mjs` uses it to route `--env`, and
 * `scripts/seed-dev-environment.mjs` uses it to load and check a dataset before it spends a Docker
 * reset on it. Everything here is pure and Docker-free on purpose, so `ops/dev-environments.test.ts`
 * can run the same validation inside `npm run test` instead of leaving a typo to surface thirty
 * seconds into a reset.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { DEV_PASSWORD, meetsPasswordPolicy } from './dev-accounts.mjs';

export const DEV_ENVIRONMENTS_DIR = 'fixtures/dev-environments';
export const DEFAULT_DEV_ENVIRONMENT = 'empty';
export const DATA_FILES = ['accounts', 'organizations', 'formats', 'tournaments', 'registrations', 'leagues', 'liveTournaments'];

const GLOBAL_ROLES = ['User', 'Organizer', 'Admin'];
const LEAGUE_STATUSES = ['active', 'completed'];
const ROUND_ENTRY_KINDS = ['match', 'bye'];
const API_ORIGIN = 'http://127.0.0.1:5080';

/** Only an absolute Unix socket is safe for destructive local development resets. */
export function isLocalDockerEndpoint(endpoint) {
  return /^unix:\/\/\/.+/.test(String(endpoint ?? '').trim());
}

/** Fixture references are case-insensitive everywhere, including post-reset token lookup. */
export function normalizeFixtureEmail(email) {
  return String(email).toLowerCase();
}

/** `liveTournaments` -> `live-tournaments.json`; every other key is already its own file name. */
function fileNameFor(key) {
  return `${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}.json`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Directory names under DEV_ENVIRONMENTS_DIR, sorted. */
export function listEnvironmentNames(root = DEV_ENVIRONMENTS_DIR) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Load one environment directory. Throws `unknownDevEnvironment` when there is no such directory or
 * it carries no `environment.json` — both mean "this is not an environment", and the CLI turns that
 * single error into the list of the names that do exist.
 */
export function readEnvironment(name, root = DEV_ENVIRONMENTS_DIR) {
  const directory = join(root, name);
  if (!existsSync(directory) || !statSync(directory).isDirectory()) throw new Error('unknownDevEnvironment');

  const manifestPath = join(directory, 'environment.json');
  if (!existsSync(manifestPath)) throw new Error('unknownDevEnvironment');
  const manifest = readJson(manifestPath);

  const environment = {
    name: manifest.name,
    directory: name,
    description: manifest.description,
    resetDatabase: manifest.resetDatabase
  };
  for (const key of DATA_FILES) {
    const path = join(directory, fileNameFor(key));
    environment[key] = existsSync(path) ? readJson(path) : [];
  }
  return environment;
}

/** [] when valid; one human-readable string per problem otherwise. */
export function validateEnvironment(environment) {
  const problems = [];
  const label = environment.directory ?? environment.name ?? '(unnamed)';
  const nonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

  if (!nonEmptyString(environment.name)) problems.push(`${label}: name must be a non-empty string`);
  else if (environment.directory !== undefined && environment.name !== environment.directory) {
    problems.push(`${label}: environment.json declares name "${environment.name}" but lives in directory "${environment.directory}"`);
  }
  if (!nonEmptyString(environment.description)) problems.push(`${label}: description must be a non-empty string`);
  if (typeof environment.resetDatabase !== 'boolean') problems.push(`${label}: resetDatabase must be a boolean`);

  const accounts = environment.accounts ?? [];
  const emails = new Set();
  const usernames = new Set();
  for (const account of accounts) {
    const who = account.email ?? '(no email)';
    if (!nonEmptyString(account.email) || !account.email.includes('@')) problems.push(`${label}: account "${who}" needs an email address`);
    for (const key of ['username', 'firstName', 'lastName']) {
      if (!nonEmptyString(account[key])) problems.push(`${label}: account "${who}" needs a non-empty ${key}`);
    }
    if (!GLOBAL_ROLES.includes(account.role)) problems.push(`${label}: account "${who}" has role "${account.role}", expected one of ${GLOBAL_ROLES.join(', ')}`);
    if (!meetsPasswordPolicy(account.password ?? DEV_PASSWORD)) problems.push(`${label}: account "${who}" has a password the server would refuse`);
    // `"emailConfirmed": "false"` is truthy: a quoted boolean would silently verify an account the
    // fixture meant to leave unverified.
    if (account.emailConfirmed !== undefined && typeof account.emailConfirmed !== 'boolean') {
      problems.push(`${label}: account "${who}" has a non-boolean emailConfirmed`);
    }

    const email = normalizeFixtureEmail(account.email);
    if (emails.has(email)) problems.push(`${label}: account email "${account.email}" is declared twice`);
    emails.add(email);
    const username = String(account.username).toLowerCase();
    if (usernames.has(username)) problems.push(`${label}: account username "${account.username}" is declared twice`);
    usernames.add(username);
  }

  const organizations = environment.organizations ?? [];
  const formats = environment.formats ?? [];
  const tournaments = environment.tournaments ?? [];
  const registrations = environment.registrations ?? [];

  // A fixture points at what it needs by hand — GUIDs do not exist before the seed runs — so nothing
  // but these rules catches a mistyped key. Without them the mistake surfaces as an API rejection
  // thirty seconds into a Docker reset, with the previous dataset already dropped.
  const organizationKeys = new Set(organizations.map(({ key }) => key));
  const formatKeys = new Set(formats.map(({ key }) => key));
  const formatsByKey = new Map(formats.map((format) => [format.key, format]));
  const tournamentKeys = new Set(tournaments.map(({ key }) => key));
  const accountsByEmail = new Map(accounts.map((account) => [normalizeFixtureEmail(account.email), account]));

  for (const [listName, list] of [['organization', organizations], ['format', formats], ['tournament', tournaments], ['registration', registrations]]) {
    const seen = new Set();
    for (const entry of list) {
      const key = listName === 'registration' ? `${entry.tournamentKey}/${entry.userEmail}` : entry.key;
      if (seen.has(key)) problems.push(`${label}: ${listName} key "${key}" is declared twice`);
      seen.add(key);
    }
  }

  for (const organization of organizations) {
    // Nobody owns an organization (ADR 0041): a fixture lists the members it wants on the roster.
    if (!Array.isArray(organization.memberEmails)) {
      problems.push(`${label}: organization ${organization.key} must declare a memberEmails array`);
      continue;
    }
    for (const email of organization.memberEmails) {
      if (!accountsByEmail.has(normalizeFixtureEmail(email))) {
        problems.push(`${label}: organization ${organization.key} member ${email} is not a seeded account`);
      }
    }
  }

  for (const tournament of tournaments) {
    if (!organizationKeys.has(tournament.organizationKey)) {
      problems.push(`${label}: tournament ${tournament.key} references unknown organization ${tournament.organizationKey}`);
    }
    if (!Array.isArray(tournament.formatKeys) || tournament.formatKeys.length !== 1) {
      problems.push(`${label}: tournament ${tournament.key} must reference exactly one format`);
    }
    for (const formatKey of tournament.formatKeys ?? []) {
      if (!formatKeys.has(formatKey)) problems.push(`${label}: tournament ${tournament.key} references unknown format ${formatKey}`);
    }
    const organizer = accountsByEmail.get(normalizeFixtureEmail(tournament.organizerEmail));
    if (organizer === undefined || !['Organizer', 'Admin'].includes(organizer.role)) {
      problems.push(`${label}: tournament ${tournament.key} organizer ${tournament.organizerEmail} is not an Organizer`);
    }
  }

  const tournamentsByTitle = new Map();
  for (const tournament of tournaments) {
    const sameTitle = tournamentsByTitle.get(tournament.title) ?? [];
    sameTitle.push(tournament);
    tournamentsByTitle.set(tournament.title, sameTitle);
  }
  for (const sameTitle of tournamentsByTitle.values()) {
    if (sameTitle.length < 2) continue;
    const firstFormat = formatsByKey.get(sameTitle[0].formatKeys?.[0]);
    if (firstFormat === undefined) continue;
    const suffix = `-${firstFormat.slug}`;
    const sourceKey = sameTitle[0].key.endsWith(suffix) ? sameTitle[0].key.slice(0, -suffix.length) : sameTitle[0].key;
    for (const tournament of sameTitle) {
      const format = formatsByKey.get(tournament.formatKeys?.[0]);
      if (format === undefined) continue;
      const expectedKey = `${sourceKey}-${format.slug}`;
      if (tournament.key !== expectedKey) {
        problems.push(`${label}: split tournament ${tournament.key} must use key "${expectedKey}"`);
      }
    }
  }

  for (const registration of registrations) {
    // An unverified account is registerable nowhere: the API refuses it with emailVerificationRequired.
    const registrant = accountsByEmail.get(normalizeFixtureEmail(registration.userEmail));
    if (!tournamentKeys.has(registration.tournamentKey) || registrant === undefined || registrant.emailConfirmed === false) {
      problems.push(`${label}: registration ${registration.tournamentKey}/${registration.userEmail} is not seedable`);
    }
  }

  // The League Archive fixtures are whole `LeagueDocument`s: the restore endpoint takes them as they
  // are written here, so a shape the API refuses would only surface after the reset dropped the
  // previous dataset. These rules mirror the server's own document validation.
  const leagues = environment.leagues ?? [];
  const leagueIds = new Set();
  for (const league of leagues) {
    if (!nonEmptyString(league.id) || !nonEmptyString(league.name)) problems.push(`${label}: league "${league.id ?? '(no id)'}" needs a non-empty id and name`);
    if (leagueIds.has(league.id)) problems.push(`${label}: duplicate league id ${league.id}`);
    leagueIds.add(league.id);
    if (!LEAGUE_STATUSES.includes(league.status)) problems.push(`${label}: league ${league.id} has status "${league.status}", expected one of ${LEAGUE_STATUSES.join(', ')}`);

    for (const tournament of league.tournaments ?? []) {
      // The server refuses a document whose Archive Tournament claims another League.
      if (tournament.leagueId !== league.id) problems.push(`${label}: tournament ${tournament.id} claims league ${tournament.leagueId}`);
      for (const round of tournament.rounds ?? []) {
        for (const entry of round.entries ?? []) {
          if (!ROUND_ENTRY_KINDS.includes(entry.kind)) problems.push(`${label}: tournament ${tournament.id} has a round entry of kind "${entry.kind}", expected one of ${ROUND_ENTRY_KINDS.join(', ')}`);
        }
      }
    }
  }

  for (const live of environment.liveTournaments ?? []) {
    const organizer = accountsByEmail.get(normalizeFixtureEmail(live.organizerEmail));
    if (organizer === undefined || !['Organizer', 'Admin'].includes(organizer.role)) {
      problems.push(`${label}: running tournament ${live.key} organizer ${live.organizerEmail} is not an Organizer`);
    }
    // `null` is the unassigned running tournament; anything else must name a League this environment
    // restores, because the create endpoint refuses an unknown leagueId.
    if (live.leagueKey !== null && live.leagueKey !== undefined && !leagueIds.has(live.leagueKey)) {
      problems.push(`${label}: running tournament ${live.key} references unknown league ${live.leagueKey}`);
    }
    if (live.scoredRounds > live.roundCount) problems.push(`${label}: running tournament ${live.key} cannot score ${live.scoredRounds} of its ${live.roundCount} rounds`);
    // Swiss pairing needs at least one table, and an odd roster would make the seeder score a bye.
    const playerCount = (live.players ?? []).length;
    if (playerCount < 2 || playerCount % 2 !== 0) problems.push(`${label}: running tournament ${live.key} cannot pair ${playerCount} players`);
  }

  const carriesData = DATA_FILES.some((key) => (environment[key] ?? []).length > 0);
  if (environment.resetDatabase === false && carriesData) problems.push(`${label}: resetDatabase=false but the environment carries data`);

  return problems;
}

/**
 * A fixture date is a signed day offset plus a wall-clock time, rendered against today, so a dataset
 * committed once keeps showing past, ongoing and upcoming tournaments a year later (ADR 0030). The
 * result is `YYYY-MM-DDTHH:mm`, the minute precision a fixture is written in; the seeder appends the
 * seconds the server's ISO parser wants. No zone conversion happens here — the fixture's own
 * `timeZoneId` is what the server resolves the local time against.
 */
export function localDateTime(offsetDays, time, today = new Date()) {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offsetDays);
  const pad = (value) => String(value).padStart(2, '0');
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T${time}`;
}

/**
 * The server's ASCII slug contract for a published Event: the slugified title, then the format slug.
 * The seeder checks the slug the API answered against this, and the stress bulk loader — which writes
 * the row itself — has to produce exactly the same string.
 */
export function expectedEventSlug(title, formatSlug) {
  const titleSlug = String(title).normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${titleSlug}-${formatSlug}`;
}

/** Splits process.argv.slice(2) for scripts/dev.mjs. */
export function parseDevArgs(argv) {
  const parsed = { environment: DEFAULT_DEV_ENVIRONMENT, skipDocker: false, skipAccounts: false, detached: false, ngArgs: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--no-docker') parsed.skipDocker = true;
    else if (arg === '--no-accounts') parsed.skipAccounts = true;
    else if (arg === '--detached') parsed.detached = true;
    else if (arg.startsWith('--env=')) parsed.environment = arg.slice('--env='.length);
    else if (arg === '--env') {
      // `--env demo`: the value is the next token, and it is consumed rather than forwarded to ng.
      const value = argv[index + 1];
      if (value !== undefined && !value.startsWith('-')) {
        parsed.environment = value;
        index += 1;
      }
    } else parsed.ngArgs.push(arg);
  }
  return parsed;
}

/**
 * The environment `docker compose` needs to bring the local stack up with the V1 features on.
 * compose.yaml defaults every one of them to `false`, so a stack started without this answers 404 on
 * `/api/auth/register` — which is exactly what an environment seeder has to call first.
 */
export function devComposeEnv() {
  return {
    ...process.env,
    GONES_FEATURES__AUTH_V1: process.env.GONES_FEATURES__AUTH_V1 ?? 'true',
    GONES_FEATURES__ADMIN_V1: process.env.GONES_FEATURES__ADMIN_V1 ?? 'true',
    GONES_FEATURES__CALENDAR_V1: process.env.GONES_FEATURES__CALENDAR_V1 ?? 'true',
    GONES_FEATURES__LEAGUE_SERVER: process.env.GONES_FEATURES__LEAGUE_SERVER ?? 'true',
    GONES_FEATURES__LIVE_SERVER: process.env.GONES_FEATURES__LIVE_SERVER ?? 'true'
  };
}

/** POST /api/auth/login, returns { accessToken } for a fixture account email. */
export async function loginToken(email, password = DEV_PASSWORD) {
  const response = await fetch(`${API_ORIGIN}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, deviceLabel: 'dev environment seeder' })
  });
  if (!response.ok) throw new Error(`Login failed for ${email}: ${response.status} ${await response.text()}`);
  const body = await response.json();
  return { accessToken: body.accessToken };
}
