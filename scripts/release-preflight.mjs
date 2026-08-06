#!/usr/bin/env node
/**
 * Release preflight for the platform-agnostic V1 candidate (C44).
 *
 * A pile of freshly built images is not a release candidate. This is the gate that decides whether
 * one is: it compares what was built, what is committed and what the candidate stack is configured
 * to run, and refuses the candidate on any of nine mismatch classes:
 *
 *   image-digest    the built digests, their SBOMs, checksums, scan result and source revision
 *   migration       the EF migrations on disk, the smoke allowlist and the applied database set
 *   openapi         the committed contract and the generated client that ships in the artifact
 *   config-schema   the vendor-neutral runtime keys, and secrets arriving as files not env values
 *   health          declared container health probes, and observed health once the stack runs
 *   backup          a mounted backup root, a key file and a restore that actually succeeded
 *   fake-provider   no live identity or email provider may appear anywhere in the candidate
 *   authority-mode  server data authority, injected at runtime, not bound to one build-time origin
 *   feature-flag    every server feature flag enabled on the API and the Worker
 *
 * `evaluatePreflight` is a pure function over a context object and performs no I/O at all. That is
 * the point: deciding whether a candidate is releasable must never need a registry account, a public
 * domain or a cloud credential. The CLI below builds that context from the local filesystem, the
 * local Docker daemon and `docker compose config`; `ops/release-preflight.test.ts` builds it from
 * fixtures and proves every mismatch class really rejects.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RELEASE_IMAGES, capture, gitRevision, run, tagFor } from './release-images.mjs';

export const MISMATCH_CLASSES = Object.freeze([
  'image-digest',
  'migration',
  'openapi',
  'config-schema',
  'health',
  'backup',
  'fake-provider',
  'authority-mode',
  'feature-flag'
]);

/** The release artifact set, in the order the manifest records it. */
const ARTIFACTS = ['api', 'worker', 'migrator', 'backup', 'frontend'];

/**
 * Vendor-neutral runtime keys each service must carry. Every one of them is documented in
 * `docs/RUNTIME_CONTRACT.md` and pinned by `ops/host-contract.test.ts`.
 */
const REQUIRED_CONFIGURATION = {
  api: [
    'GONES_DB_CONNECTION_FILE',
    'GONES_AUTH_SIGNING_KEY_FILE',
    'GONES_ALLOWED_ORIGINS',
    'GONES_PUBLIC_APP_ORIGIN',
    'GONES_FORWARDED_PROXIES',
    'GONES_SHUTDOWN_TIMEOUT_SECONDS',
    'OTEL_EXPORTER_OTLP_ENDPOINT'
  ],
  worker: ['GONES_DB_CONNECTION_FILE', 'GONES_NOTIFICATION_LEASE_SECONDS', 'OTEL_EXPORTER_OTLP_ENDPOINT'],
  migrator: ['GONES_DB_CONNECTION_FILE'],
  backup: ['GONES_BACKUP_ROOT', 'GONES_BACKUP_KEY_FILE']
};

/** Secrets that must arrive as a mounted file. The plain form leaks into `docker inspect` and logs. */
const FILE_ONLY_SECRETS = ['GONES_DB_CONNECTION', 'GONES_AUTH_SIGNING_KEY', 'GONES_GOOGLE_CLIENT_SECRET', 'GONES_FACEBOOK_CLIENT_SECRET', 'GONES_BREVO_API_KEY', 'GONES_BACKUP_KEY'];

/** Credential environment that would make the candidate depend on a cloud account. */
const CLOUD_CREDENTIALS = ['AWS_', 'AZURE_', 'GOOGLE_APPLICATION_CREDENTIALS', 'GCP_', 'ALIBABA_', 'DIGITALOCEAN_'];

/** Hosts that would turn a local rehearsal into a live-provider claim. */
const LIVE_PROVIDER_HOSTS = [
  'accounts.google.com',
  'oauth2.googleapis.com',
  'googleapis.com',
  'graph.facebook.com',
  'facebook.com',
  'api.brevo.com',
  'brevo.com',
  'sendgrid.net',
  'api.sendgrid.com',
  'amazonaws.com'
];

/** Provider endpoints the candidate must override, or it would fall back to a live default. */
const REQUIRED_PROVIDER_OVERRIDES = [
  'GONES_OAUTH_GOOGLE_AUTHORIZATION_ENDPOINT',
  'GONES_OAUTH_GOOGLE_TOKEN_ENDPOINT',
  'GONES_OAUTH_GOOGLE_USERINFO_ENDPOINT',
  'GONES_OAUTH_FACEBOOK_AUTHORIZATION_ENDPOINT',
  'GONES_OAUTH_FACEBOOK_TOKEN_ENDPOINT',
  'GONES_OAUTH_FACEBOOK_USERINFO_ENDPOINT'
];

const SERVER_FEATURE_FLAGS = [
  'GONES_FEATURES__API_BACKEND',
  'GONES_FEATURES__CALENDAR_V1',
  'GONES_FEATURES__AUTH_V1',
  'GONES_FEATURES__ADMIN_V1',
  'GONES_FEATURES__LEAGUE_SERVER',
  'GONES_FEATURES__LIVE_SERVER'
];

const same = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
const environmentOf = (service) => service?.environment ?? {};

function checkImageDigests(context, fail) {
  const { manifest, checksums = '', daemon = {}, scan = {} } = context.images ?? {};
  if (!manifest) return fail('image-digest', 'no release image manifest was produced');

  if (manifest.revision !== context.revision) {
    fail('image-digest', `the images were built from ${manifest.revision}, but the candidate source is ${context.revision}`);
  }
  if (manifest.platform !== 'linux/amd64') fail('image-digest', `unexpected build platform ${manifest.platform}`);

  const sbom = new Map((manifest.sbom ?? []).map((entry) => [entry.image, entry.generated === true]));
  for (const name of ARTIFACTS) {
    const entry = (manifest.images ?? []).find((image) => image.name === name);
    if (!entry) {
      fail('image-digest', `${name} is missing from the release manifest`);
      continue;
    }
    if (entry.os !== 'linux' || entry.architecture !== 'amd64') fail('image-digest', `${name} is ${entry.os}/${entry.architecture}, not linux/amd64`);
    if (daemon[name] !== entry.digest) {
      fail('image-digest', `${name} digest mismatch: manifest ${entry.digest}, local image ${daemon[name] ?? 'absent'}`);
    }
    if (!checksums.includes((entry.digest ?? '').replace('sha256:', ''))) fail('image-digest', `${name} digest is not covered by checksums.txt`);
    if (!checksums.includes(`sbom-${name}.spdx.json`)) fail('image-digest', `${name} has no SBOM entry in checksums.txt`);
    if (sbom.get(name) !== true) fail('image-digest', `${name} shipped without an SBOM`);
    const critical = scan[name]?.critical ?? 0;
    if (critical > 0) fail('image-digest', `${name} carries ${critical} unresolved CRITICAL finding(s)`);

    const service = context.candidate?.services?.[name];
    if (service && service.image !== entry.tag && service.image !== entry.digest) {
      fail('image-digest', `the candidate stack runs ${service.image} for ${name}, not the released ${entry.tag} (${entry.digest})`);
    }
  }
}

function checkMigrations(context, fail) {
  const { onDisk = [], allowlist = [], applied = null } = context.migrations ?? {};
  if (onDisk.length === 0) return fail('migration', 'no EF migration was found in the candidate source');
  if (!same(onDisk, allowlist)) {
    const missing = onDisk.filter((id) => !allowlist.includes(id));
    const extra = allowlist.filter((id) => !onDisk.includes(id));
    fail('migration', `the smoke allowlist does not match the shipped migrations (missing ${missing.join(', ') || 'none'}; stale ${extra.join(', ') || 'none'})`);
  }
  if (applied !== null && !same(onDisk, applied)) {
    const pending = onDisk.filter((id) => !applied.includes(id));
    const unknown = applied.filter((id) => !onDisk.includes(id));
    fail('migration', `the candidate database is not on the shipped schema (pending ${pending.join(', ') || 'none'}; unknown ${unknown.join(', ') || 'none'})`);
  }
}

function checkOpenApi(context, fail) {
  const { snapshotOperations = [], clientOperations = [] } = context.openapi ?? {};
  if (snapshotOperations.length === 0) return fail('openapi', 'the committed OpenAPI contract is empty');
  const uncallable = snapshotOperations.filter((operation) => !clientOperations.includes(operation));
  const invented = clientOperations.filter((operation) => !snapshotOperations.includes(operation));
  if (uncallable.length > 0) fail('openapi', `the shipped client cannot call ${uncallable.length} contract operation(s): ${uncallable.slice(0, 3).join(', ')}`);
  if (invented.length > 0) fail('openapi', `the shipped client calls ${invented.length} operation(s) the contract does not declare: ${invented.slice(0, 3).join(', ')}`);
}

function checkConfigurationSchema(context, fail) {
  const services = context.candidate?.services ?? {};
  for (const [name, keys] of Object.entries(REQUIRED_CONFIGURATION)) {
    const environment = environmentOf(services[name]);
    if (!services[name]) {
      fail('config-schema', `the candidate stack declares no ${name} service`);
      continue;
    }
    for (const key of keys) {
      if (!environment[key]) fail('config-schema', `${name} is missing the required runtime key ${key}`);
    }
  }
  for (const [name, service] of Object.entries(services)) {
    const environment = environmentOf(service);
    for (const key of Object.keys(environment)) {
      if (FILE_ONLY_SECRETS.includes(key) && environment[key]) {
        fail('config-schema', `${name} passes ${key} as an environment value; the contract requires ${key}_FILE`);
      }
      if (CLOUD_CREDENTIALS.some((prefix) => key.startsWith(prefix))) {
        fail('config-schema', `${name} carries the cloud credential ${key}; the candidate must run with none`);
      }
    }
  }
}

function checkHealth(context, fail) {
  const services = context.candidate?.services ?? {};
  for (const name of ['api', 'frontend']) {
    if (services[name] && services[name].healthcheck !== true) fail('health', `${name} no longer declares a health probe`);
  }
  const observed = context.observed?.health ?? null;
  if (!observed) return;
  for (const [name, state] of Object.entries(observed)) {
    if (state !== 'healthy') fail('health', `${name} never reached a healthy state (${state})`);
  }
}

function checkBackup(context, fail) {
  const backup = context.candidate?.services?.backup;
  if (!backup) return fail('backup', 'the candidate stack ships no backup command');
  const environment = environmentOf(backup);
  if (!environment.GONES_BACKUP_ROOT) fail('backup', 'the backup command has no mounted backup root');
  if (!environment.GONES_BACKUP_KEY_FILE) fail('backup', 'the backup command has no encryption key file');
  const mountsRoot = (backup.volumes ?? []).some((volume) => volume.includes(environment.GONES_BACKUP_ROOT ?? ' '));
  if (environment.GONES_BACKUP_ROOT && !mountsRoot) fail('backup', `nothing is mounted at the backup root ${environment.GONES_BACKUP_ROOT}`);
  const smoke = context.observed?.restoreSmoke ?? null;
  if (smoke !== null && smoke !== 'passed') fail('backup', `the restore smoke did not pass (${smoke})`);
}

function checkFakeProviders(context, fail) {
  const services = context.candidate?.services ?? {};
  for (const [name, service] of Object.entries(services)) {
    for (const [key, value] of Object.entries(environmentOf(service))) {
      const host = LIVE_PROVIDER_HOSTS.find((candidate) => String(value).includes(candidate));
      if (host) fail('fake-provider', `${name}.${key} points at the live provider ${host}; the candidate may only use local fakes`);
    }
  }
  const api = environmentOf(services.api);
  for (const key of REQUIRED_PROVIDER_OVERRIDES) {
    if (!api[key]) fail('fake-provider', `api does not override ${key}, so it would fall back to a live provider default`);
  }
}

function checkAuthorityMode(context, fail) {
  const frontend = context.candidate?.services?.frontend;
  if (!frontend) return fail('authority-mode', 'the candidate stack ships no frontend service');
  const environment = environmentOf(frontend);
  const origin = context.candidate?.origin ?? '';
  if (environment.GONES_DATA_MODE !== 'server') {
    fail('authority-mode', `the candidate frontend declares dataMode=${environment.GONES_DATA_MODE ?? 'none'}; the release candidate is server authority`);
  }
  if (environment.GONES_API_BASE_URL !== origin) {
    fail('authority-mode', `the injected API base URL ${environment.GONES_API_BASE_URL ?? 'none'} is not the candidate origin ${origin}`);
  }
  const bakedDefault = context.images?.manifest?.frontend ?? null;
  if (!bakedDefault) fail('authority-mode', 'the release manifest does not record the frontend artifact default declaration');
  else if (bakedDefault.apiBaseUrl === origin) {
    fail('authority-mode', 'the frontend artifact is bound at build time to the origin it is serving, so runtime injection is unproven');
  }

  const observed = context.observed ?? null;
  if (!observed) return;
  const runtime = observed.runtimeConfig ?? null;
  if (!runtime) return fail('authority-mode', 'the running artifact serves no runtime configuration document');
  if (runtime.dataMode !== 'server') fail('authority-mode', `the running artifact resolved dataMode=${runtime.dataMode}`);
  if (runtime.apiBaseUrl !== origin) fail('authority-mode', `the running artifact resolved apiBaseUrl=${runtime.apiBaseUrl}, not ${origin}`);
  if (runtime.features?.authV1 !== true || runtime.features?.adminV1 !== true) {
    fail('authority-mode', 'the running artifact did not receive the auth and admin capabilities');
  }
  const policy = observed.contentSecurityPolicy ?? '';
  if (!policy.includes(origin)) fail('authority-mode', 'the served content-security-policy does not admit the injected API origin');
}

function checkFeatureFlags(context, fail) {
  const services = context.candidate?.services ?? {};
  for (const name of ['api', 'worker']) {
    const environment = environmentOf(services[name]);
    for (const flag of SERVER_FEATURE_FLAGS) {
      if (!(flag in environment)) fail('feature-flag', `${name} never declares ${flag}`);
      else if (String(environment[flag]).toLowerCase() !== 'true') fail('feature-flag', `${name} runs with ${flag}=${environment[flag]}`);
    }
  }
}

const CHECKS = {
  'image-digest': checkImageDigests,
  migration: checkMigrations,
  openapi: checkOpenApi,
  'config-schema': checkConfigurationSchema,
  health: checkHealth,
  backup: checkBackup,
  'fake-provider': checkFakeProviders,
  'authority-mode': checkAuthorityMode,
  'feature-flag': checkFeatureFlags
};

/**
 * Decides whether a candidate is releasable. Pure: it reads only the context it is given.
 *
 * @returns {{ok: boolean, findings: {mismatch: string, message: string}[]}}
 */
export function evaluatePreflight(context) {
  const findings = [];
  const fail = (mismatch, message) => findings.push({ mismatch, message });
  for (const mismatch of MISMATCH_CLASSES) CHECKS[mismatch](context, fail);
  return { ok: findings.length === 0, findings };
}

/* ------------------------------------------------------------------ context building (CLI only) */

/** True when the image itself declares a HEALTHCHECK; Compose does not restate what the image owns. */
function imageDeclaresHealthcheck(reference) {
  if (!reference) return false;
  const inspected = run('docker', ['image', 'inspect', '--format', '{{if .Config.Healthcheck}}true{{end}}', reference]);
  return inspected.status === 0 && inspected.stdout.trim() === 'true';
}

/** Reads the resolved candidate configuration. `docker compose config` does the interpolation. */
export function readCandidateConfiguration(composeFiles, origin) {
  const files = composeFiles.flatMap((file) => ['-f', file]);
  // The run-to-completion commands (backup, journeys) sit behind the tools profile; without it
  // `config` would hide the backup service and the preflight would pass by not looking.
  const resolved = JSON.parse(capture('docker', ['compose', ...files, '--profile', 'tools', 'config', '--format', 'json'], { maxBuffer: 32 * 1024 * 1024 }));
  const services = {};
  for (const [name, service] of Object.entries(resolved.services ?? {})) {
    services[name] = {
      image: service.image ?? '',
      healthcheck: Boolean(service.healthcheck?.test) || imageDeclaresHealthcheck(service.image),
      environment: Object.fromEntries(Object.entries(service.environment ?? {}).filter(([, value]) => value !== null && value !== '')),
      volumes: (service.volumes ?? []).map((volume) => (typeof volume === 'string' ? volume : `${volume.source}:${volume.target}`))
    };
  }
  return { origin, services };
}

function readMigrations(root) {
  const directory = join(root, 'backend/src/Gones.Infrastructure/Persistence/Migrations');
  const onDisk = readdirSync(directory)
    .filter((file) => file.endsWith('.cs') && !file.endsWith('.Designer.cs') && /^\d{14}_/.test(file))
    .map((file) => file.replace(/\.cs$/, ''))
    .sort();
  const smoke = readFileSync(join(root, 'scripts/smoke-full-stack.mjs'), 'utf8');
  const allowlist = [...(smoke.match(/const expectedMigrations = \[[^\]]*\]/s)?.[0] ?? '').matchAll(/'(\d{14}_[^']+)'/g)].map((match) => match[1]).sort();
  return { onDisk, allowlist };
}

function readOpenApi(root) {
  const document = JSON.parse(readFileSync(join(root, 'backend/openapi/gones.json'), 'utf8'));
  const client = readFileSync(join(root, 'src/app/api/generated/gones-api.ts'), 'utf8');
  return {
    snapshotOperations: [...new Set(Object.keys(document.paths ?? {}))].sort(),
    clientOperations: [...new Set([...client.matchAll(/this\.baseUrl \+ "([^"]+)"/g)].map((match) => match[1].replace(/\?$/, '')))].sort()
  };
}

function readImages(root, reference) {
  const directory = join(root, 'reports', 'images');
  const manifestPath = join(directory, 'manifest.json');
  if (!existsSync(manifestPath)) return { manifest: null, checksums: '', daemon: {}, scan: {} };
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const checksums = existsSync(join(directory, 'checksums.txt')) ? readFileSync(join(directory, 'checksums.txt'), 'utf8') : '';
  const daemon = {};
  for (const name of ARTIFACTS) {
    const inspected = run('docker', ['image', 'inspect', '--format', '{{.Id}}', tagFor(name, reference)]);
    if (inspected.status === 0) daemon[name] = inspected.stdout.trim();
  }
  const scan = {};
  const summaryPath = join(directory, 'scan-summary.json');
  if (existsSync(summaryPath)) {
    for (const entry of JSON.parse(readFileSync(summaryPath, 'utf8')).images ?? []) {
      scan[entry.image] = { critical: entry.scanned ? (entry.critical ?? []).length : Number.NaN };
    }
  }
  return { manifest, checksums, daemon, scan };
}

/**
 * Builds the real context from this repository, the local daemon and the candidate Compose files.
 * `observed` stays null until the candidate stack has actually run; `npm run release:candidate`
 * feeds it back in through `--observations`.
 */
export function buildContext({ root = process.cwd(), composeFiles, origin, reference = 'candidate', observationsFile = null } = {}) {
  const observed = observationsFile && existsSync(observationsFile) ? JSON.parse(readFileSync(observationsFile, 'utf8')) : null;
  return {
    revision: gitRevision(),
    images: readImages(root, reference),
    migrations: { ...readMigrations(root), applied: observed?.appliedMigrations ?? null },
    openapi: readOpenApi(root),
    candidate: readCandidateConfiguration(composeFiles, origin),
    observed
  };
}

if (import.meta.filename === process.argv[1]) {
  const argument = (name, fallback) => {
    const match = process.argv.find((entry) => entry.startsWith(`--${name}=`));
    return match ? match.slice(name.length + 3) : fallback;
  };
  const composeFiles = argument('compose', 'compose.release-test.yaml,compose.release-candidate.yaml').split(',').filter(Boolean);
  const context = buildContext({
    composeFiles,
    origin: argument('origin', 'https://localhost:8443'),
    reference: argument('reference', 'candidate'),
    observationsFile: argument('observations', null)
  });

  const { ok, findings } = evaluatePreflight(context);
  console.log(`Release preflight for ${context.revision}`);
  console.log(`  compose: ${composeFiles.join(' + ')}`);
  for (const mismatch of MISMATCH_CLASSES) {
    const failed = findings.filter((finding) => finding.mismatch === mismatch);
    if (failed.length === 0) console.log(`  ok    ${mismatch}`);
    else for (const finding of failed) console.error(`  FAIL  ${mismatch}: ${finding.message}`);
  }
  if (!ok) {
    console.error(`\nRelease preflight refused the candidate: ${findings.length} mismatch(es).`);
    process.exit(1);
  }
  console.log(`\nRelease preflight passed${context.observed ? ' (including the observations from the running candidate)' : ' (artifact and configuration half; the stack has not run yet)'}.`);
}
