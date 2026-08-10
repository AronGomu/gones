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
const API_ORIGIN = 'http://127.0.0.1:5080';

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

    const email = String(account.email).toLowerCase();
    if (emails.has(email)) problems.push(`${label}: account email "${account.email}" is declared twice`);
    emails.add(email);
    const username = String(account.username).toLowerCase();
    if (usernames.has(username)) problems.push(`${label}: account username "${account.username}" is declared twice`);
    usernames.add(username);
  }

  const carriesData = DATA_FILES.some((key) => (environment[key] ?? []).length > 0);
  if (environment.resetDatabase === false && carriesData) problems.push(`${label}: resetDatabase=false but the environment carries data`);

  return problems;
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
