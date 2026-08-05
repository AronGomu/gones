#!/usr/bin/env node
/**
 * Release rehearsal against the platform-agnostic stack (C41).
 *
 * Boots the release-mode images exactly as a generic Linux host would, behind a TLS reverse proxy,
 * with fake identity and email providers, mounted secret files and no route to the internet, then
 * proves the runtime contract end to end:
 *
 *   startup ordering, migration idempotency, TLS + forwarded headers, readiness, non-root read-only
 *   containers, fake OAuth wiring, fake Brevo delivery plus webhook replay, restart, graceful
 *   SIGTERM, and blocked external egress.
 *
 * Everything it needs is created inside the stack; no credential, domain or account is involved.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { join } from 'node:path';
import { run } from './release-images.mjs';

const root = process.cwd();
const composeFile = 'compose.release-test.yaml';
const exportDirectory = join(root, '.release-test-export');
const base = 'https://127.0.0.1:8443';
const failures = [];

const check = (condition, message) => {
  if (condition) {
    console.log(`  ok   ${message}`);
    return true;
  }
  failures.push(message);
  console.error(`  FAIL ${message}`);
  return false;
};

const compose = (args, options = {}) => run('docker', ['compose', '-f', composeFile, ...args], { stdio: 'inherit', ...options });
const composeOut = (args) => run('docker', ['compose', '-f', composeFile, ...args]);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function containerState(service, field) {
  const id = composeOut(['ps', '-a', '--quiet', service]).stdout.trim().split('\n')[0];
  if (!id) return null;
  return run('docker', ['inspect', '--format', field, id]).stdout.trim();
}

async function waitFor(predicate, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await predicate()) return true;
    await sleep(1000);
  }
  return false;
}

/**
 * The rehearsal validates the published endpoint against the stack's own CA, never by skipping TLS.
 * Redirects are never followed: several assertions are about the redirect itself.
 */
let certificateAuthority;
const secureFetch = (path) => new Promise((resolve, reject) => {
  const call = httpsRequest(`${base}${path}`, { ca: certificateAuthority, servername: 'localhost' }, (response) => {
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => resolve({
      status: response.statusCode ?? 0,
      ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300,
      header: (name) => response.headers[name.toLowerCase()] ?? null,
      body: Buffer.concat(chunks).toString('utf8')
    }));
  });
  call.on('error', reject);
  call.end();
});

try {
  console.log('=== resetting the release-test stack ===');
  compose(['down', '--volumes', '--remove-orphans'], { stdio: 'ignore' });
  rmSync(exportDirectory, { recursive: true, force: true });
  mkdirSync(exportDirectory, { recursive: true });

  console.log('\n=== building and starting the release-mode stack ===');
  if (compose(['up', '--build', '--detach']).status !== 0) throw new Error('release-test stack failed to start');

  // Startup ordering: the schema job must complete before the API is allowed to serve.
  const migratorExit = await waitFor(async () => containerState('migrator', '{{.State.Status}}') === 'exited');
  check(migratorExit && containerState('migrator', '{{.State.ExitCode}}') === '0', 'migration job completes successfully before the API serves');
  check(containerState('permissions', '{{.State.ExitCode}}') === '0', 'least-privilege grants are applied by their own job');
  const migratorFinished = Date.parse(containerState('migrator', '{{.State.FinishedAt}}') ?? '');
  const apiStarted = Date.parse(containerState('api', '{{.State.StartedAt}}') ?? '');
  check(Number.isFinite(migratorFinished) && Number.isFinite(apiStarted) && migratorFinished <= apiStarted, 'API starts only after the migration job finished');

  if (!existsSync(join(exportDirectory, 'ca.pem'))) throw new Error('bootstrap did not export the test CA');
  certificateAuthority = readFileSync(join(exportDirectory, 'ca.pem'), 'utf8');

  console.log('\n=== TLS edge, forwarded headers and health ===');
  const liveOk = await waitFor(async () => {
    try {
      const response = await secureFetch('/health/live');
      return response.ok;
    } catch { return false; }
  });
  check(liveOk, 'API answers /health/live through the TLS reverse proxy');

  const live = await secureFetch('/health/live');
  // HSTS is only emitted when the request is HTTPS, which inside the container is true only if the
  // trusted proxy's X-Forwarded-Proto was honoured. This is the ADR 0017 client-IP/scheme gap closed.
  check(live.header('strict-transport-security') !== null, 'forwarded scheme from the trusted proxy is honoured (HSTS emitted)');
  check(live.header('x-correlation-id') !== null, 'every proxied response carries a correlation id');

  const readyOk = await waitFor(async () => {
    try {
      const response = await secureFetch('/health/ready');
      return response.ok;
    } catch { return false; }
  });
  const ready = await secureFetch('/health/ready');
  check(readyOk && ready.ok, `readiness reports healthy once the Worker heartbeat lands (${ready.body.slice(0, 120)})`);

  console.log('\n=== container posture ===');
  const uid = composeOut(['exec', '-T', 'api', 'id', '-u']).stdout.trim();
  check(uid !== '' && uid !== '0', `API runs as a non-root account (uid ${uid || 'unknown'})`);
  const writeProbe = composeOut(['exec', '-T', 'api', 'sh', '-c', 'touch /gones-probe 2>/dev/null && echo writable || echo read-only']);
  check(writeProbe.stdout.trim() === 'read-only', 'API root filesystem is read-only at runtime');
  const secretProbe = composeOut(['exec', '-T', 'api', 'sh', '-c', 'printenv GONES_DB_CONNECTION || echo absent']);
  check(secretProbe.stdout.trim() === 'absent', 'database credentials reach the API as a mounted file, never as an environment value');

  console.log('\n=== migration idempotency ===');
  const before = composeOut(['exec', '-T', 'postgres', 'psql', '-U', 'gones_migration', '-d', 'gones', '-Atc', 'select count(*) from "__EFMigrationsHistory";']).stdout.trim();
  const rerun = compose(['run', '--rm', 'migrator', 'database', 'update']);
  const after = composeOut(['exec', '-T', 'postgres', 'psql', '-U', 'gones_migration', '-d', 'gones', '-Atc', 'select count(*) from "__EFMigrationsHistory";']).stdout.trim();
  check(rerun.status === 0, 're-running the migration job succeeds');
  check(before === after && Number(before) > 0, `re-running the migration job applies nothing new (${before} migrations)`);

  console.log('\n=== fake identity provider ===');
  const start = await secureFetch('/api/auth/oauth/google/start');
  const location = start.header('location') ?? '';
  check(start.status === 302 && location.startsWith('https://fake-identity:8443/authorize'), `OAuth start redirects to the local fake provider (${location.slice(0, 60)})`);
  check(!location.includes('google.com') && !location.includes('facebook.com'), 'no live identity provider is contacted');

  console.log('\n=== fake email provider and webhook replay ===');
  const enqueue = compose(['run', '--rm', '-e', 'GONES_ALLOW_TEST_NOTIFICATION=true', 'migrator', 'notifications', 'enqueue-test']);
  check(enqueue.status === 0, 'a test notification can be enqueued through the migration job');
  const delivered = await waitFor(async () => composeOut(['logs', '--no-color', 'fake-brevo']).stdout.includes('accepted send'), 90);
  check(delivered, 'the Worker delivers through the provider-neutral transport to the local fake');
  const webhookAccepted = await waitFor(async () => composeOut(['logs', '--no-color', 'fake-brevo']).stdout.includes('webhook replayed tag=') , 60);
  const webhookLine = composeOut(['logs', '--no-color', 'fake-brevo']).stdout.split('\n').find((line) => line.includes('webhook replayed')) ?? '';
  check(webhookAccepted && webhookLine.includes('status=204'), `the provider webhook is accepted back through the TLS edge (${webhookLine.trim().slice(-40)})`);

  console.log('\n=== blocked external egress ===');
  const egress = compose(['--profile', 'tools', 'run', '--rm', 'egress-probe']);
  check(egress.status === 0, 'the application network has no route off the host');

  console.log('\n=== graceful shutdown and restart ===');
  const stoppedAt = Date.now();
  compose(['stop', '--timeout', '25', 'api']);
  const drainSeconds = Math.round((Date.now() - stoppedAt) / 1000);
  const exitCode = containerState('api', '{{.State.ExitCode}}');
  check(exitCode === '0', `API exits 0 on SIGTERM (got ${exitCode}; 137 means it was killed)`);
  check(drainSeconds < 25, `API drains inside the stop timeout (${drainSeconds}s)`);

  compose(['start', 'api']);
  const restarted = await waitFor(async () => {
    try {
      const response = await secureFetch('/health/ready');
      return response.ok;
    } catch { return false; }
  });
  check(restarted, 'API returns to a ready state after a restart with the same volumes');

  const workerStatus = containerState('worker', '{{.State.Status}}');
  check(workerStatus === 'running', `the singleton Worker stayed up across the API restart (${workerStatus})`);
} finally {
  console.log('\n=== tearing the release-test stack down ===');
  compose(['--profile', 'tools', 'down', '--volumes', '--remove-orphans'], { stdio: 'ignore' });
  rmSync(exportDirectory, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\nRelease rehearsal failed with ${failures.length} finding(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\nRelease rehearsal passed: the release-mode stack runs with no cloud dependency.');
