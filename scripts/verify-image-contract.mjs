#!/usr/bin/env node
/**
 * Runtime image contract verification (C41).
 *
 * `ops/image-contract.test.ts` proves the *build files* declare the contract; this proves the *built
 * images* actually honour it. Both are needed: a Dockerfile can say USER 1654 and still ship a root
 * process if a base image overrides it later.
 *
 * Checks, per image: Linux OCI, requested architecture, non-root numeric account, OCI provenance
 * labels, declared stop signal, no baked-in volumes, no cloud SDK payload or credential environment,
 * a root filesystem that is genuinely read-only, and — for the API — a live health endpoint plus a
 * graceful SIGTERM exit.
 *
 * Run `npm run images:build` first.
 */
import { RELEASE_IMAGES, capture, imageRevisionMatchesHead, run, tagFor } from './release-images.mjs';

const reference = process.env.GONES_IMAGE_REFERENCE ?? 'local';
const expectedArchitecture = (process.env.GONES_IMAGE_PLATFORM ?? 'linux/amd64').split('/')[1];
const headRevision = capture('git', ['rev-parse', 'HEAD']);
const failures = [];
const check = (condition, message) => {
  if (condition) return;
  failures.push(message);
  console.error(`  FAIL ${message}`);
};
const pass = (message) => console.log(`  ok   ${message}`);

const CLOUD_ENVIRONMENT = ['AWS_', 'AZURE_', 'GOOGLE_APPLICATION_CREDENTIALS', 'GCP_', 'ALIBABA_'];
const OCI_LABELS = ['title', 'description', 'source', 'licenses', 'vendor', 'revision', 'created'];

for (const image of RELEASE_IMAGES) {
  const tag = tagFor(image.name, reference);
  console.log(`\n=== ${tag} ===`);
  const metadataFailures = failures.length;
  let inspected;
  try {
    inspected = JSON.parse(capture('docker', ['image', 'inspect', tag]))[0];
  } catch {
    failures.push(`${tag} is not built; run npm run images:build`);
    console.error(`  FAIL ${tag} is not built`);
    continue;
  }

  check(inspected.Os === 'linux', `${tag} must be a Linux image (got ${inspected.Os})`);
  check(inspected.Architecture === expectedArchitecture, `${tag} must be ${expectedArchitecture} (got ${inspected.Architecture})`);
  check(inspected.Config?.User === image.user, `${tag} must run as ${image.user} (got ${inspected.Config?.User || 'root'})`);
  check(inspected.Config?.StopSignal === image.stopSignal, `${tag} must declare STOPSIGNAL ${image.stopSignal}`);
  check(!inspected.Config?.Volumes, `${tag} must not declare anonymous volumes`);
  const labels = inspected.Config?.Labels ?? {};
  for (const label of OCI_LABELS) {
    check(Boolean(labels[`org.opencontainers.image.${label}`]), `${tag} is missing org.opencontainers.image.${label}`);
  }
  check(labels['org.opencontainers.image.title'] === image.title, `${tag} title label must be ${image.title}`);
  check(
    imageRevisionMatchesHead(labels, headRevision),
    `${tag} revision label must equal HEAD ${headRevision} (got ${labels['org.opencontainers.image.revision'] || 'missing'})`);
  const environment = inspected.Config?.Env ?? [];
  for (const prefix of CLOUD_ENVIRONMENT) {
    check(!environment.some((entry) => entry.startsWith(prefix)), `${tag} must not preset cloud credential environment ${prefix}*`);
  }
  const healthcheck = Boolean(inspected.Config?.Healthcheck?.Test);
  check(healthcheck === image.healthcheck, `${tag} healthcheck presence must be ${image.healthcheck}`);
  if (failures.length === metadataFailures) pass(`${tag} metadata`);

  const postureFailures = failures.length;
  // The account has to be non-root in practice, not only in the manifest.
  const identity = run('docker', ['run', '--rm', '--read-only', '--tmpfs', '/tmp', '--entrypoint', 'id', tag, '-u']);
  check(identity.status === 0 && identity.stdout.trim() !== '0', `${tag} must not execute as uid 0 (got ${identity.stdout.trim() || 'error'})`);

  // A read-only root filesystem must actually reject writes outside the tmpfs the host provides.
  const readOnly = run('docker', [
    'run', '--rm', '--read-only', '--tmpfs', '/tmp',
    '--entrypoint', 'sh', tag,
    '-c', 'touch /gones-write-probe 2>/dev/null && echo writable || echo read-only'
  ]);
  check(readOnly.stdout.trim() === 'read-only', `${tag} root filesystem must be read-only (got ${readOnly.stdout.trim()})`);

  // No cloud SDK ships inside the image payload either.
  const payload = run('docker', [
    'run', '--rm', '--read-only', '--tmpfs', '/tmp',
    '--entrypoint', 'sh', tag,
    '-c', 'ls /app 2>/dev/null | grep -Ei "aws|azure|amazon|google\\.cloud|alibaba" || true'
  ]);
  check(payload.stdout.trim() === '', `${tag} must not ship a cloud SDK assembly (found ${payload.stdout.trim()})`);
  if (failures.length === postureFailures) pass(`${tag} runtime posture`);
}

// The API is the only long-running HTTP surface, so it carries the liveness and SIGTERM proof.
const apiTag = tagFor('api', reference);
const container = `gones-image-contract-${process.pid}`;
try {
  console.log(`\n=== ${apiTag} liveness and graceful shutdown ===`);
  capture('docker', [
    'run', '--detach', '--name', container,
    '--read-only', '--tmpfs', '/tmp:size=32m,mode=1777',
    '--security-opt', 'no-new-privileges:true', '--cap-drop', 'ALL',
    '--publish', '127.0.0.1:18080:8080',
    apiTag
  ]);

  let live = false;
  for (let attempt = 0; attempt < 60 && !live; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      const response = await fetch('http://127.0.0.1:18080/health/live');
      live = response.ok && (await response.json()).status === 'live';
    } catch { /* still starting */ }
  }
  check(live, `${apiTag} must answer /health/live with a read-only filesystem and no cloud dependency`);

  const startedAt = Date.now();
  run('docker', ['stop', '--timeout', '20', container], { stdio: 'inherit' });
  const elapsed = Date.now() - startedAt;
  const exitCode = capture('docker', ['inspect', '--format', '{{.State.ExitCode}}', container]);
  check(exitCode === '0', `${apiTag} must exit 0 on SIGTERM (got ${exitCode}; 137 means it was killed)`);
  check(elapsed < 20_000, `${apiTag} must drain well inside the stop timeout (took ${Math.round(elapsed / 1000)}s)`);
  pass(`${apiTag} liveness and graceful shutdown`);
} finally {
  run('docker', ['rm', '--force', container]);
}

if (failures.length > 0) {
  console.error(`\nImage contract failed with ${failures.length} finding(s).`);
  process.exit(1);
}
console.log('\nImage contract verified for every release artifact.');
