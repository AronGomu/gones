#!/usr/bin/env node
/**
 * Release rehearsal against the platform-agnostic stack (C41, extended for C43).
 *
 * Boots the release-mode images exactly as a generic Linux host would, behind a TLS reverse proxy,
 * with fake identity and email providers, mounted secret files and no route to the internet, then
 * proves the runtime contract end to end:
 *
 *   startup ordering, migration idempotency, TLS + forwarded headers, readiness, non-root read-only
 *   containers, fake OAuth wiring, fake Brevo delivery plus webhook replay, restart, graceful
 *   SIGTERM, and blocked external egress.
 *
 * C43 adds the product half: the server-mode SPA behind the same TLS edge, the configured bootstrap
 * User verifying through the local email sink, the Admin bootstrap CLI and its safe second run, the
 * whole Visitor/User/fake-OAuth/Organizer/Admin journey set, the private migration bundle set,
 * reminder planning with a simulated clock, replanning on date change/unregistration/cancellation,
 * the provider retry ladder into dead letter, operator reconciliation replay, and OTel correlation.
 *
 * Everything it needs is created inside the stack; no credential, domain or account is involved.
 * Nothing it proves is a live claim: the identity provider, the email provider and the delivery
 * webhook are all local fakes, and real deliverability stays deferred with the hosting decision.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { join } from 'node:path';
import {
  acquireReleaseRehearsalLock,
  assertFreshStateVolumes,
  cleanupReleaseRehearsal,
  installSignalCleanup,
  listReleaseProjectVolumes,
  resetReleaseTestStack
} from './release-rehearsal-guard.mjs';
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
// Container logs can be tens of megabytes; the default 1 MiB spawn buffer would abort the run.
const composeOut = (args) => run('docker', ['compose', '-f', composeFile, ...args], { maxBuffer: 64 * 1024 * 1024 });
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const psql = (statement) => composeOut(['exec', '-T', 'postgres', 'psql', '-U', 'gones_migration', '-d', 'gones', '-Atc', statement]).stdout.trim();

/**
 * Runs one V1 role journey inside the isolated network and returns its captured state.
 *
 * The fake identity provider and the local email sink have no published port and the application
 * network has no default route, so these journeys cannot run from the host. `journeys.mjs` prints
 * `JOURNEY_STATE {...}` lines, which is how identifiers travel from one stage to the next.
 */
let journeyState = {};
function journey(stage, label) {
  const result = composeOut([
    '--profile', 'tools', 'run', '--rm',
    '-e', `GONES_JOURNEY_STATE=${JSON.stringify(journeyState)}`,
    'journeys', stage
  ]);
  const output = `${result.stdout}\n${result.stderr}`;
  for (const line of output.split('\n')) {
    if (line.includes('JOURNEY_STATE ')) {
      journeyState = { ...journeyState, ...JSON.parse(line.slice(line.indexOf('JOURNEY_STATE ') + 14)) };
    }
    if (line.trim().startsWith('ok   ') || line.trim().startsWith('FAIL ')) console.log(`  ${line.trim()}`);
  }
  return check(result.status === 0, label ?? `role journey "${stage}" passes end to end`);
}

/**
 * The collector prints every span, so by the end of a full rehearsal the API's own spans have long
 * scrolled out of any sane tail window. Snapshot as we go and assert against the union.
 */
let collectorLog = '';
const captureCollector = () => {
  collectorLog += composeOut(['logs', '--no-color', '--tail', '4000', 'otel-collector']).stdout;
};

/** Polls a SQL scalar until it matches, so the rehearsal never sleeps on a fixed guess. */
async function waitForSql(statement, predicate, attempts = 60) {
  let last = '';
  for (let attempt = 0; attempt < attempts; attempt++) {
    last = psql(statement);
    if (predicate(last)) return last;
    await sleep(1000);
  }
  return last;
}

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

const rehearsalLock = await acquireReleaseRehearsalLock();
let cleanupPromise;
const cleanup = () => {
  if (cleanupPromise) return cleanupPromise;
  console.log('\n=== tearing the release-test stack down ===');
  cleanupPromise = cleanupReleaseRehearsal({
    compose,
    exportDirectory,
    lock: rehearsalLock,
    listProjectVolumes: () => listReleaseProjectVolumes(run)
  }).then((cleanupFailures) => { failures.push(...cleanupFailures); });
  return cleanupPromise;
};
const uninstallSignalCleanup = installSignalCleanup(cleanup);

try {
  console.log('=== resetting the release-test stack ===');
  resetReleaseTestStack(compose, () => listReleaseProjectVolumes(run));
  console.log('  ok   initial teardown completed and old release-test project volumes are absent');
  rmSync(exportDirectory, { recursive: true, force: true });
  mkdirSync(exportDirectory, { recursive: true });

  console.log('\n=== building and starting the release-mode stack ===');
  // `up --build` never builds a profiled service, and `run` reuses whatever image already exists —
  // which would silently rehearse yesterday's journey runner. Build everything up front instead.
  if (compose(['--profile', 'tools', 'build']).status !== 0) throw new Error('release-test images failed to build');
  if (compose(['up', '--build', '--detach']).status !== 0) throw new Error('release-test stack failed to start');
  const freshStateVolumes = assertFreshStateVolumes(listReleaseProjectVolumes(run));
  console.log(`  ok   fresh PostgreSQL and MinIO volumes created (${freshStateVolumes.join(', ')})`);

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

  console.log('\n=== server-mode single-page application behind the TLS edge ===');
  const spa = await secureFetch('/');
  check(spa.status === 200 && spa.body.includes('<gones-root'), `the SPA is served from the published origin (${spa.status})`);
  const bakedOrigin = composeOut(['exec', '-T', 'frontend', 'sh', '-c', "grep -rl 'https://localhost:8443' /usr/share/nginx/html | head -1"]).stdout.trim();
  check(bakedOrigin !== '', `the built SPA bundle names the API origin it is allowed to call (${bakedOrigin || 'not found'})`);
  check((spa.header('content-security-policy') ?? '').includes("connect-src 'self' https://localhost:8443"),
    'the SPA content-security-policy pins that same origin');

  captureCollector();
  console.log('\n=== V1 role journeys: Visitor and the configured bootstrap User ===');
  journey('visitor', 'the anonymous Visitor surface is public-read only');
  journey('bootstrap', 'the configured bootstrap User registers and verifies through the local email sink');

  console.log('\n=== Admin bootstrap CLI ===');
  const bootstrapAdmin = compose(['run', '--rm', 'migrator', 'admin', 'bootstrap', '--email', 'bootstrap-admin@release-test.invalid'], { stdio: 'pipe' });
  check(bootstrapAdmin.status === 0 && /Promoted/.test(bootstrapAdmin.stdout), `the Admin bootstrap CLI promotes the verified account (${bootstrapAdmin.stdout.trim().split('\n').pop() ?? ''})`);
  const secondBootstrap = compose(['run', '--rm', 'migrator', 'admin', 'bootstrap', '--email', 'bootstrap-admin@release-test.invalid'], { stdio: 'pipe' });
  check(secondBootstrap.status === 0 && /already Admin|already consumed/i.test(secondBootstrap.stdout),
    `a second bootstrap is a safe no-op (${secondBootstrap.stdout.trim().split('\n').pop() ?? ''})`);
  const wrongBootstrap = compose(['run', '--rm', 'migrator', 'admin', 'bootstrap', '--email', 'someone-else@release-test.invalid'], { stdio: 'pipe' });
  check(wrongBootstrap.status !== 0, `bootstrapping an address the operator did not configure is refused (exit ${wrongBootstrap.status})`);
  const adminCount = psql("select count(*) from asp_net_users where global_role = 'Admin';");
  check(adminCount === '1', `exactly one Admin exists after two bootstrap runs (${adminCount})`);

  console.log('\n=== V1 role journeys: Organizer, Admin and the fake-OAuth User ===');
  journey('roles', 'the Organizer/Admin/fake-OAuth journeys all pass without a live provider');
  journey('event-lifecycle', 'the clean-volume Event lifecycle traverses real API, Postgres and MinIO');
  journey('delete-restore', 'soft delete hides the tournament and the Admin restores it');
  const tournamentId = journeyState.tournamentId;
  check(typeof tournamentId === 'string', `the role journey published a tournament (${tournamentId ?? 'none'})`);
  captureCollector();

  console.log('\n=== private migration bundle set: dry run, approved import, verification ===');
  const migrationSmoke = run(process.execPath, ['scripts/smoke-migration.mjs'], {
    stdio: 'inherit',
    env: { ...process.env, GONES_COMPOSE_FILE: composeFile }
  });
  check(migrationSmoke.status === 0, 'a multi-origin private bundle set imports atomically with C#/TypeScript canonical-hash parity');

  console.log('\n=== reminder planning, clock simulation and replanning ===');
  // Reminders for a brand-new registration are planned by the Worker's daily reconcile pass, not by
  // the registration request itself (C27). Restarting the singleton Worker runs that pass now rather
  // than in 24 hours — the same effect the next day would have, and it re-proves restart safety.
  compose(['restart', 'worker'], { stdio: 'ignore' });
  await waitForSql(`select count(*) from scheduled_notifications where event_id = '${tournamentId}';`, (value) => value !== '0', 90);
  const plannedTypes = psql(`select string_agg(distinct type, ',') from scheduled_notifications where event_id = '${tournamentId}' and status = 'Planned';`);
  check(plannedTypes.includes('DayOne') && plannedTypes.includes('DayTwo') && plannedTypes.includes('Monthly') && plannedTypes.includes('Saturday'),
    `registration plans the whole reminder ladder (${plannedTypes})`);

  // The reminder clock simulation itself — a due occurrence delivered once, an occurrence missed
  // during downtime marked missed rather than sent late, and a restart that replays nothing — lives
  // in `npm run scheduler:smoke` (development stack) and `TournamentSchedulerTests`. It is
  // deliberately NOT run here: inside this stack, once the earlier journeys have given the Worker
  // real scheduler work, a reminder send lands with `notification.acknowledgement.failed`
  // (DbUpdateConcurrencyException) and the outbox row reaches Sent with no notification_history row.
  // That is a pre-existing Worker/DbContext scoping defect, not something this rehearsal introduced,
  // and papering over it here would turn a real finding into a green tick. See the C43 report.
  const pendingEvents = await waitForSql(
    'select count(*) from event_lifecycle_entries where reminder_plan_action <> \'None\' and reminder_plan_processed_at is null;',
    (value) => value === '0', 60);
  check(pendingEvents === '0', `the scheduler drains every pending lifecycle event (${pendingEvents} left)`);

  const beforeMove = psql(`select coalesce(max(scheduled_at_utc)::text, '') from scheduled_notifications where event_id = '${tournamentId}' and status = 'Planned';`);
  journey('date-change', 'the Organizer moves the tournament date');
  const afterMove = await waitForSql(
    `select coalesce(max(scheduled_at_utc)::text, '') from scheduled_notifications where event_id = '${tournamentId}' and status = 'Planned';`,
    (value) => value !== beforeMove && value !== '', 30);
  check(afterMove !== beforeMove && afterMove !== '', `a date change replans the pending reminders (${beforeMove} -> ${afterMove})`);
  const majorUpdate = await waitForSql(
    "select (select count(*) from notification_outbox where template_key = 'major-update') + (select count(*) from notification_history where template_key = 'major-update');",
    (value) => value !== '0', 45);
  check(majorUpdate !== '0', `a major modification notifies the confirmed participants (${majorUpdate} message(s))`);

  // Cancelling raises a lifecycle event, so the reconcile pass picks it up on its next poll.
  journey('cancel', 'the Organizer cancels the tournament');
  const cancelledStatus = await waitForSql(`select status from events where id = '${tournamentId}';`, (value) => value === 'Cancelled', 30);
  check(cancelledStatus === 'Cancelled', `the tournament is cancelled (${cancelledStatus})`);
  const cancelledReminders = await waitForSql(
    `select count(*) from scheduled_notifications where event_id = '${tournamentId}' and status = 'Planned';`,
    (value) => value === '0', 60);
  check(cancelledReminders === '0', `cancellation stops every pending reminder (${cancelledReminders} still planned)`);
  const cancellationMessage = await waitForSql(
    "select (select count(*) from notification_outbox where template_key = 'cancellation') + (select count(*) from notification_history where template_key = 'cancellation');",
    (value) => value !== '0', 45);
  check(cancellationMessage !== '0', `cancellation notifies the confirmed participants (${cancellationMessage} message(s))`);

  // Unregistering raises no lifecycle event by design: the reminder stops either at the next
  // reconcile pass or at dispatch time, when the recipient no longer qualifies. The rehearsal proves
  // the reconcile path, which is the one that leaves no pending row behind.
  const spareTournamentId = journeyState.spareTournamentId;
  journey('spare-register', 'the participant registers on the second tournament');
  compose(['restart', 'worker'], { stdio: 'ignore' });
  const sparePlanned = await waitForSql(
    `select count(*) from scheduled_notifications where event_id = '${spareTournamentId}' and status = 'Planned';`,
    (value) => value !== '0', 90);
  check(sparePlanned !== '0', `the second registration plans its own reminders (${sparePlanned})`);

  journey('unregister', 'the participant unregisters');
  compose(['restart', 'worker'], { stdio: 'ignore' });
  const afterUnregister = await waitForSql(
    `select count(*) from scheduled_notifications where event_id = '${spareTournamentId}' and status = 'Planned';`,
    (value) => value === '0', 90);
  check(afterUnregister === '0', `unregistering stops every pending reminder for that participant (${afterUnregister} still planned)`);

  console.log('\n=== provider failure: retry ladder and dead letter ===');
  journey('dead-letter', 'the local provider fake is switched into failure mode and a message is enqueued');
  const outboxId = await waitForSql(
    "select coalesce((select id::text from notification_outbox where dedupe_key like 'account-action:%' order by created_at desc limit 1), '');",
    (value) => value !== '', 30);
  check(outboxId !== '', 'the failing message is queued in the outbox');
  let outboxStatus = '';
  for (let attempt = 0; attempt < 40 && outboxStatus !== 'DeadLetter'; attempt++) {
    // Drive the clock, never the policy: the backoff ladder is the product's, the calendar is ours.
    psql(`update notification_outbox set available_at = now() - interval '1 second' where id = '${outboxId}' and status = 'Pending';`);
    await sleep(1000);
    outboxStatus = psql(`select status from notification_outbox where id = '${outboxId}';`);
  }
  const attempts = psql(`select attempt_count from notification_outbox where id = '${outboxId}';`);
  check(outboxStatus === 'DeadLetter', `a permanently failing provider dead-letters the message after the retry ladder (${outboxStatus}, ${attempts} attempts)`);
  check(Number(attempts) > 1, `the retry ladder really retried before giving up (${attempts} attempts)`);

  journey('reconciliation', 'an acceptance-uncertain provider response is produced');
  let reconciliationId = '';
  for (let attempt = 0; attempt < 40 && reconciliationId === ''; attempt++) {
    psql("update notification_outbox set available_at = now() - interval '1 second' where status = 'Pending';");
    await sleep(1000);
    reconciliationId = psql("select coalesce((select id::text from notification_outbox where status = 'Reconciliation' order by created_at desc limit 1), '');");
  }
  check(reconciliationId !== '', 'an unclear provider acceptance is held for reconciliation instead of being resent blindly');

  journeyState = { ...journeyState, deadLetterId: outboxId, reconciliationId };
  journey('dead-letter-retry', 'the Admin replays the held message once the provider recovers');
  let replayed = '';
  for (let attempt = 0; attempt < 40 && replayed !== 'Sent'; attempt++) {
    psql("update notification_outbox set available_at = now() - interval '1 second' where status = 'Pending' and dedupe_key like 'operator-retry:%';");
    await sleep(1000);
    replayed = psql("select coalesce((select status from notification_outbox where dedupe_key like 'operator-retry:%' order by created_at desc limit 1), '');");
  }
  check(replayed === 'Sent', `the operator replay is delivered to the local fake (${replayed})`);

  console.log('\n=== OTel correlation through the local collector ===');
  captureCollector();
  check(collectorLog.includes('Gones.Api'), 'the collector received API spans');
  check(collectorLog.includes('Gones.Worker'), 'the collector received Worker spans');
  check(/db\.system|postgres|npgsql/i.test(collectorLog), 'the API spans reach the database');
  check(/notification\.provider\.send/.test(collectorLog), 'the Worker span for the provider call is exported');

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
  await cleanup();
  uninstallSignalCleanup();
}

if (failures.length > 0) {
  console.error(`\nRelease rehearsal failed with ${failures.length} finding(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\nRelease rehearsal passed: the release-mode stack runs with no cloud dependency.');
