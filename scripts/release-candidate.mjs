#!/usr/bin/env node
/**
 * Gones Calendar V1 release candidate assembly (C44).
 *
 * This is the terminal step of the plan: it turns the repository into an immutable, platform-agnostic
 * artifact set and then proves that set runs — from those exact bytes, on a clean machine, with no
 * public domain, no registry, no cloud account and no live provider.
 *
 *   1. builds the API/Worker/Migrator/backup/frontend images once, recording digests, SBOMs,
 *      checksums, scan reports and the source revision they were built from,
 *   2. runs the release preflight against the built artifacts and the candidate configuration,
 *   3. starts a clean stack in which every release service is pinned to its immutable digest
 *      (`pull_policy: never` — the bytes that were scanned, or nothing),
 *   4. migrates, registers and verifies the bootstrap User through the local email sink, promotes
 *      the Admin, and runs the V1 role journeys with every server feature flag enabled,
 *   5. replays the private migration bundle rehearsal and an encrypted backup/restore smoke,
 *   6. re-runs the preflight with everything it observed, which is the digest verification on the
 *      exact terminal candidate.
 *
 * The frontend artifact is built with a deliberately *different* default origin from the one this
 * stack serves it on. That is the runtime-injection proof: if the image only worked on the origin it
 * was built for, the candidate would be bound to one domain and step 6 would refuse it.
 *
 * Nothing here claims a live provider, real deliverability, a public cutover or a recovery objective.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { join } from 'node:path';
import { RELEASE_IMAGES, gitRevision, run, tagFor } from './release-images.mjs';

const root = process.cwd();
const composeFiles = ['compose.release-test.yaml', 'compose.release-candidate.yaml'];
const reference = process.env.GONES_IMAGE_REFERENCE ?? 'candidate';
const origin = 'https://localhost:8443';
/** The artifact's *default* origin. Never served here: overriding it is the point of the exercise. */
const artifactDefaultOrigin = 'https://gones.example';
const reportDirectory = join(root, 'reports', 'release');
const exportDirectory = join(root, '.release-test-export');
const observationsPath = join(reportDirectory, 'observations.json');
const reuseArtifacts = process.argv.includes('--reuse-artifacts');

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

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/* ------------------------------------------------------------------------ 1. immutable artifacts */

const artifactEnvironment = {
  ...process.env,
  GONES_IMAGE_REFERENCE: reference,
  // C42 carry-forward: without these the release SPA would ship as the frozen legacy artifact.
  GONES_FRONTEND_DATA_MODE: 'server',
  GONES_FRONTEND_API_BASE_URL: artifactDefaultOrigin,
  GONES_FRONTEND_AUTH_V1: 'true',
  GONES_FRONTEND_ADMIN_V1: 'true'
};

const step = (label, command, args, environment = artifactEnvironment) => {
  console.log(`\n=== ${label} ===`);
  const result = run(command, args, { stdio: 'inherit', env: environment });
  return result.status === 0;
};

mkdirSync(reportDirectory, { recursive: true });

if (!reuseArtifacts) {
  if (!step('building the release artifacts once', process.execPath, ['scripts/build-release-images.mjs'])) {
    console.error('The release artifacts did not build; there is no candidate.');
    process.exit(1);
  }
  if (!step('verifying the runtime contract of the built artifacts', process.execPath, ['scripts/verify-image-contract.mjs'])) {
    console.error('The built artifacts do not honour the runtime contract.');
    process.exit(1);
  }
  if (!step('scanning the built artifacts', process.execPath, ['scripts/scan-images.mjs'])) {
    console.error('The built artifacts did not pass the vulnerability and secret scan.');
    process.exit(1);
  }
}

const manifestPath = join(root, 'reports', 'images', 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('No release manifest was produced. Run without --reuse-artifacts.');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const digestOf = (name) => manifest.images.find((image) => image.name === name)?.digest ?? '';

/** The candidate stack reads its images from these, so nothing can substitute a rebuilt image. */
const candidateEnvironment = {
  ...process.env,
  GONES_IMAGE_REFERENCE: reference,
  GONES_IMAGE_API: digestOf('api'),
  GONES_IMAGE_WORKER: digestOf('worker'),
  GONES_IMAGE_MIGRATOR: digestOf('migrator'),
  GONES_IMAGE_BACKUP: digestOf('backup'),
  GONES_IMAGE_FRONTEND: digestOf('frontend')
};

const compose = (args, options = {}) =>
  run('docker', ['compose', ...composeFiles.flatMap((file) => ['-f', file]), ...args], { stdio: 'inherit', env: candidateEnvironment, ...options });
// Container logs run to tens of megabytes; the default 1 MiB spawn buffer would abort the run.
const composeOut = (args) =>
  run('docker', ['compose', ...composeFiles.flatMap((file) => ['-f', file]), ...args], { env: candidateEnvironment, maxBuffer: 64 * 1024 * 1024 });
const psql = (statement) => composeOut(['exec', '-T', 'postgres', 'psql', '-U', 'gones_migration', '-d', 'gones', '-Atc', statement]).stdout.trim();

const preflight = (extra = []) => run(process.execPath, [
  'scripts/release-preflight.mjs',
  `--compose=${composeFiles.join(',')}`,
  `--origin=${origin}`,
  `--reference=${reference}`,
  ...extra
], { stdio: 'inherit', env: candidateEnvironment });

/* ------------------------------------------------------------------------------- 2. preflight */

console.log('\n=== release preflight: artifacts and candidate configuration ===');
if (preflight().status !== 0) {
  console.error('\nThe release preflight refused the candidate before it was started.');
  process.exit(1);
}

/* ------------------------------------------------------------------ 3. clean stack from digests */

let certificateAuthority;
const secureFetch = (path) => new Promise((resolve, reject) => {
  const call = httpsRequest(`${origin}${path}`, { ca: certificateAuthority, servername: 'localhost' }, (response) => {
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

function containerState(service, field) {
  const id = composeOut(['ps', '-a', '--quiet', service]).stdout.trim().split('\n')[0];
  if (!id) return null;
  return run('docker', ['inspect', '--format', field, id]).stdout.trim();
}

async function waitFor(predicate, attempts = 180) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await predicate()) return true;
    await sleep(1000);
  }
  return false;
}

async function waitForSql(statement, predicate, attempts = 60) {
  let last = '';
  for (let attempt = 0; attempt < attempts; attempt++) {
    last = psql(statement);
    if (predicate(last)) return last;
    await sleep(1000);
  }
  return last;
}

let journeyState = {};
function journey(stage, label) {
  const result = composeOut(['--profile', 'tools', 'run', '--rm', '-e', `GONES_JOURNEY_STATE=${JSON.stringify(journeyState)}`, 'journeys', stage]);
  const output = `${result.stdout}\n${result.stderr}`;
  for (const line of output.split('\n')) {
    if (line.includes('JOURNEY_STATE ')) journeyState = { ...journeyState, ...JSON.parse(line.slice(line.indexOf('JOURNEY_STATE ') + 14)) };
    if (line.trim().startsWith('ok   ') || line.trim().startsWith('FAIL ')) console.log(`  ${line.trim()}`);
  }
  return check(result.status === 0, label);
}

const observed = { health: {}, runtimeConfig: null, contentSecurityPolicy: '', restoreSmoke: null, appliedMigrations: null };

try {
  console.log('\n=== starting a clean candidate environment from the immutable artifacts ===');
  compose(['--profile', 'tools', 'down', '--volumes', '--remove-orphans'], { stdio: 'ignore' });
  rmSync(exportDirectory, { recursive: true, force: true });
  mkdirSync(exportDirectory, { recursive: true });

  // Only the test scaffolding may be built. Every release service is pinned to a digest and would
  // refuse to build anyway, so an accidental rebuild cannot slip into the candidate.
  if (compose(['--profile', 'tools', 'build', 'bootstrap', 'fake-identity', 'fake-brevo', 'tls-proxy', 'journeys', 'egress-probe']).status !== 0) {
    throw new Error('the release-test fixtures failed to build');
  }
  if (compose(['up', '--detach']).status !== 0) throw new Error('the candidate stack failed to start');

  const migratorExit = await waitFor(async () => containerState('migrator', '{{.State.Status}}') === 'exited');
  check(migratorExit && containerState('migrator', '{{.State.ExitCode}}') === '0', 'the migration job completes before the API serves');
  check(containerState('permissions', '{{.State.ExitCode}}') === '0', 'least-privilege grants are applied by their own job');

  // The strongest form of "runs from the artifacts": what the daemon actually started is the digest.
  for (const image of RELEASE_IMAGES.filter((entry) => ['api', 'worker', 'frontend'].includes(entry.name))) {
    const running = containerState(image.name, '{{.Image}}');
    check(running === digestOf(image.name), `the running ${image.name} container is the released digest (${running})`);
  }

  if (!existsSync(join(exportDirectory, 'ca.pem'))) throw new Error('bootstrap did not export the test CA');
  certificateAuthority = readFileSync(join(exportDirectory, 'ca.pem'), 'utf8');

  const ready = await waitFor(async () => {
    try {
      return (await secureFetch('/health/ready')).ok;
    } catch { return false; }
  });
  check(ready, 'the candidate API reports ready through the TLS edge');
  for (const service of ['api', 'frontend']) {
    // The images declare a 10s probe interval, so a container that answers HTTP is still `starting`
    // for one cycle. Wait for the probe the image itself owns rather than sampling it once.
    const probe = () => containerState(service, '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}');
    await waitFor(async () => probe() !== 'starting', 90);
    const health = probe();
    observed.health[service] = health;
    check(health === 'healthy', `the ${service} container reports its own health probe healthy (${health})`);
  }

  const applied = psql('select "MigrationId" from "__EFMigrationsHistory" order by "MigrationId";');
  observed.appliedMigrations = applied.split('\n').filter(Boolean);
  check(observed.appliedMigrations.length > 0, `the clean database is migrated to the shipped schema (${observed.appliedMigrations.length} migrations)`);

  console.log('\n=== runtime configuration injection ===');
  const runtimeConfig = await secureFetch('/runtime-config.json');
  observed.runtimeConfig = runtimeConfig.ok ? JSON.parse(runtimeConfig.body) : null;
  check(observed.runtimeConfig?.dataMode === 'server' && observed.runtimeConfig?.apiBaseUrl === origin,
    `the artifact is serving the injected declaration (${runtimeConfig.body.trim()})`);
  const page = await secureFetch('/');
  observed.contentSecurityPolicy = page.header('content-security-policy') ?? '';
  check(page.status === 200 && page.body.includes('<gones-root'), `the single-page application is served from the candidate origin (${page.status})`);
  check(observed.contentSecurityPolicy.includes(`connect-src 'self' ${origin}`), 'the served content-security-policy names the injected origin');
  // The same artifact was built for another origin entirely: that is what makes it portable.
  const bakedDefault = composeOut(['exec', '-T', 'frontend', 'sh', '-c', `grep -rl '${artifactDefaultOrigin}' /usr/share/nginx/html | head -1`]).stdout.trim();
  check(bakedDefault !== '', `the artifact's own default origin is ${artifactDefaultOrigin}, not the origin it is being served on`);

  console.log('\n=== every server feature flag is enabled ===');
  for (const service of ['api', 'worker']) {
    const flags = composeOut(['exec', '-T', service, 'sh', '-c', 'printenv | grep ^GONES_FEATURES__ | sort']).stdout.trim().split('\n').filter(Boolean);
    const disabled = flags.filter((entry) => !entry.endsWith('=true'));
    check(flags.length === 6 && disabled.length === 0, `${service} runs with all six server feature flags enabled (${flags.length} flags, ${disabled.length} disabled)`);
  }

  console.log('\n=== bootstrap User, local email sink and Admin bootstrap ===');
  journey('visitor', 'the anonymous Visitor surface is public-read only');
  journey('bootstrap', 'the configured bootstrap User registers and verifies through the local email sink');
  const bootstrapAdmin = compose(['run', '--rm', 'migrator', 'admin', 'bootstrap', '--email', 'bootstrap-admin@release-test.invalid'], { stdio: 'pipe' });
  check(bootstrapAdmin.status === 0 && /Promoted/.test(bootstrapAdmin.stdout), `the Admin bootstrap CLI promotes the verified account (${bootstrapAdmin.stdout.trim().split('\n').pop() ?? ''})`);
  const adminCount = psql("select count(*) from asp_net_users where global_role = 'Admin';");
  check(adminCount === '1', `exactly one Admin exists in the candidate environment (${adminCount})`);

  console.log('\n=== synthetic V1 role journeys ===');
  journey('roles', 'the Organizer/Owner/Admin/fake-OAuth journeys all pass without a live provider');
  journey('delete-restore', 'soft delete hides the tournament and the Admin restores it');
  check(typeof journeyState.tournamentId === 'string', `the role journeys published a tournament (${journeyState.tournamentId ?? 'none'})`);

  console.log('\n=== the Worker leader picks the scheduler work up ===');
  compose(['restart', 'worker'], { stdio: 'ignore' });
  const planned = await waitForSql(
    `select count(*) from scheduled_notifications where event_id = '${journeyState.tournamentId}' and status = 'Planned';`,
    (value) => value !== '0', 120);
  check(planned !== '0', `the singleton Worker plans the reminder ladder for the published tournament (${planned})`);
  const delivered = await waitFor(async () => composeOut(['logs', '--no-color', '--tail', '2000', 'fake-brevo']).stdout.includes('accepted send'), 90);
  check(delivered, 'the Worker delivers through the provider-neutral transport to the local email sink');

  console.log('\n=== private migration bundle rehearsal against the clean candidate database ===');
  const migrationSmoke = run(process.execPath, ['scripts/smoke-migration.mjs'], {
    stdio: 'inherit',
    env: { ...candidateEnvironment, GONES_COMPOSE_FILE: composeFiles.join(',') }
  });
  check(migrationSmoke.status === 0, 'a multi-origin private bundle set imports atomically with C#/TypeScript canonical-hash parity');

  console.log('\n=== encrypted backup and restore smoke inside the candidate stack ===');
  const marker = `release-candidate-${Date.now()}`;
  psql('CREATE TABLE IF NOT EXISTS release_candidate_marker (id text primary key);');
  psql(`INSERT INTO release_candidate_marker (id) VALUES ('${marker}');`);
  const backup = composeOut(['--profile', 'tools', 'run', '--rm', '-e', 'GONES_BACKUP_NAME=candidate', 'backup']);
  check(backup.status === 0, `the shipped backup image writes an encrypted archive (${(backup.stdout || backup.stderr).trim().split('\n').pop() ?? ''})`);
  psql('DROP TABLE release_candidate_marker;');
  const restore = composeOut(['--profile', 'tools', 'run', '--rm', '--entrypoint', '/usr/local/bin/gones-restore.sh', 'backup', 'candidate.dump.enc']);
  const restored = restore.status === 0 && psql(`select count(*) from release_candidate_marker where id = '${marker}';`) === '1';
  observed.restoreSmoke = restored ? 'passed' : 'failed';
  check(restored, `the shipped restore command recovers the candidate database (${(restore.stderr || restore.stdout).trim().split('\n').pop() ?? ''})`);

  console.log('\n=== the candidate tier still has no route off the host ===');
  check(compose(['--profile', 'tools', 'run', '--rm', 'egress-probe']).status === 0, 'the candidate application network has no route off the host');

  console.log('\n=== release preflight: digest verification on the terminal candidate ===');
  writeFileSync(observationsPath, `${JSON.stringify(observed, null, 2)}\n`);
  check(preflight([`--observations=${observationsPath}`]).status === 0, 'the release preflight accepts the terminal candidate with everything it observed');
} finally {
  console.log('\n=== tearing the candidate environment down ===');
  compose(['--profile', 'tools', 'down', '--volumes', '--remove-orphans'], { stdio: 'ignore' });
  rmSync(exportDirectory, { recursive: true, force: true });
}

const summary = {
  revision: gitRevision(),
  builtRevision: manifest.revision,
  platform: manifest.platform,
  created: manifest.created,
  artifactDefaultOrigin,
  servedOrigin: origin,
  images: manifest.images.map((image) => ({ name: image.name, tag: image.tag, digest: image.digest })),
  sbom: manifest.sbom,
  observed,
  failures
};
writeFileSync(join(reportDirectory, 'candidate.json'), `${JSON.stringify(summary, null, 2)}\n`);

console.log('\nRelease candidate artifacts:');
for (const image of manifest.images) console.log(`  ${tagFor(image.name, reference).padEnd(24)} ${image.digest}`);
console.log(`  source revision ${manifest.revision}`);

if (failures.length > 0) {
  console.error(`\nRelease candidate assembly failed with ${failures.length} finding(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\nRelease candidate assembled: the immutable artifact set runs a complete V1 environment with no cloud, domain or live provider.');
