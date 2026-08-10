#!/usr/bin/env node
/**
 * `npm run dev` — start the API stack in Docker, then serve the app against it.
 *
 * The browser build has one data authority: the API database (ADR 0020). A dev server with no API
 * behind it would have nothing to read, so this brings up PostgreSQL, the migrator, the API and the
 * Worker in the background, waits for the API to report healthy, and only then starts `ng serve`
 * pointed at that origin. Hot reload stays local; only the backend runs in containers.
 *
 * Flags:
 *   --no-docker   skip the Compose phase and just run `ng serve` (an API is already running)
 *   --detached    bring the stack up and exit without starting the dev server
 *   --no-accounts skip the dev-account seeding step
 *   --env=<name>  seed a local environment from fixtures/dev-environments/<name> (default: empty)
 * Anything else is forwarded to `ng serve` (for example `--port 4300`).
 */
import { spawn, spawnSync } from 'node:child_process';

import { DEFAULT_DEV_ENVIRONMENT, devComposeEnv, parseDevArgs } from './dev-environments.mjs';

const API_ORIGIN = process.env.GONES_FRONTEND_API_BASE_URL ?? 'http://127.0.0.1:5080';
const HEALTH_URL = `${API_ORIGIN}/health/ready`;
const BACKEND_SERVICES = ['postgres', 'migrator', 'api', 'worker'];
const WAIT_TIMEOUT_MS = 180_000;

const { environment, skipDocker, skipAccounts, detached, ngArgs } = parseDevArgs(process.argv.slice(2));

const composeEnv = devComposeEnv();

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

async function apiIsReady() {
  try {
    const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(2_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForApi() {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  process.stdout.write(`Waiting for the API on ${API_ORIGIN} `);
  while (Date.now() < deadline) {
    if (await apiIsReady()) {
      process.stdout.write(' ready\n');
      return;
    }
    process.stdout.write('.');
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  process.stdout.write('\n');
  fail(`The API did not become ready within ${WAIT_TIMEOUT_MS / 1000}s. Check: docker compose logs api`);
}

if (environment !== DEFAULT_DEV_ENVIRONMENT && skipDocker) {
  fail('--env needs the Docker stack; drop --no-docker.');
}

if (!skipDocker) {
  // `--wait` blocks on the healthchecks the Compose file already declares, so a failed migration
  // surfaces here rather than as an empty page in the browser.
  const up = spawnSync('docker', ['compose', 'up', '-d', '--wait', ...BACKEND_SERVICES], { stdio: 'inherit', env: composeEnv });
  if (up.status !== 0) {
    fail('docker compose failed to start the API stack. Is the Docker daemon running? (docker info)');
  }
  await waitForApi();
  if (!skipAccounts) {
    const seeded = spawnSync(process.execPath, ['scripts/seed-dev-accounts.mjs'], { stdio: 'inherit' });
    if (seeded.status !== 0) fail('Dev account seeding failed. Re-run it with: npm run dev:accounts');
  }
  if (environment !== DEFAULT_DEV_ENVIRONMENT) {
    const seeded = spawnSync(process.execPath, ['scripts/seed-dev-environment.mjs', `--env=${environment}`], { stdio: 'inherit' });
    if (seeded.status !== 0) fail(`Seeding the "${environment}" environment failed. Re-run it with: npm run dev:env -- --env=${environment}`);
  }
} else if (!(await apiIsReady())) {
  fail(`--no-docker was passed but nothing answers on ${HEALTH_URL}. Start an API first, or drop the flag.`);
}

if (detached) {
  console.log(`\nAPI stack is up. API: ${API_ORIGIN}`);
  console.log('Start the app with: npm run dev -- --no-docker');
  console.log('Stop the stack with: docker compose down');
  process.exit(0);
}

console.log(`\nServing the app against ${API_ORIGIN}. Stop the API stack later with: docker compose down\n`);
const serve = spawn('npx', ['ng', 'serve', '--host', '127.0.0.1', ...ngArgs], { stdio: 'inherit' });
serve.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
