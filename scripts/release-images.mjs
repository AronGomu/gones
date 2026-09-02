// Shared metadata for the C41 release image pipeline.
//
// One list, consumed by the build, the contract verification and the scanners, so the three can
// never disagree about what "the release artifacts" are.
import { spawnSync } from 'node:child_process';

/**
 * @typedef {object} ReleaseImage
 * @property {string} name        artifact name, also the reports/ file stem
 * @property {string} dockerfile  path relative to the repository root
 * @property {string} title       expected org.opencontainers.image.title
 * @property {string} user        expected runtime account
 * @property {string} stopSignal  signal the entrypoint drains on
 * @property {boolean} healthcheck whether the image declares its own probe
 */

/** @type {readonly ReleaseImage[]} */
export const RELEASE_IMAGES = [
  { name: 'api', dockerfile: 'backend/src/Gones.Api/Dockerfile', title: 'gones-api', user: '1654:1654', stopSignal: 'SIGTERM', healthcheck: true },
  { name: 'worker', dockerfile: 'backend/src/Gones.Worker/Dockerfile', title: 'gones-worker', user: '1654:1654', stopSignal: 'SIGTERM', healthcheck: false },
  { name: 'migrator', dockerfile: 'backend/src/Gones.Migrator/Dockerfile', title: 'gones-migrator', user: '1654:1654', stopSignal: 'SIGTERM', healthcheck: false },
  { name: 'backup', dockerfile: 'deploy/backup/Dockerfile', title: 'gones-backup', user: '65532:65532', stopSignal: 'SIGTERM', healthcheck: false },
  { name: 'frontend', dockerfile: 'Dockerfile', title: 'gones-frontend', user: '101:101', stopSignal: 'SIGQUIT', healthcheck: true }
];

/**
 * Scanner and SBOM tooling, pinned by digest. They are development tools, never part of a shipped
 * image, and they are run as containers so no host installation is required.
 */
export const TOOL_IMAGES = {
  trivy: 'aquasec/trivy@sha256:7cced7cae583819fc7806d4cbc0dbbc7cad18b99f7d3e235192e6da8c091045c',
  syft: 'anchore/syft@sha256:1288ea4c8b38767b4e620c1e312c8cb26b6e887a99b4f07ab6cd19fc6f225026',
  gitleaks: 'zricethezav/gitleaks@sha256:691af3c7c5a48b16f187ce3446d5f194838f91238f27270ed36eef6359a574d9'
};

/** Registry-neutral local tag. No registry host is ever baked in; publishing is a future decision. */
export const tagFor = (name, reference = 'local') => `gones-${name}:${reference}`;

export const imageRevisionMatchesHead = (labels, headRevision) =>
  labels?.['org.opencontainers.image.revision'] === headRevision;

const S3_COMPATIBLE_CLIENT_ASSEMBLIES = new Set(['AWSSDK.Core.dll', 'AWSSDK.S3.dll']);
export const unsupportedCloudSdkPayload = (entries) =>
  entries.map((entry) => entry.trim()).filter((entry) => entry && !S3_COMPATIBLE_CLIENT_ASSEMBLIES.has(entry));

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  return result;
}

export function mustRun(command, args, options = {}) {
  const result = run(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`);
  return result;
}

export function capture(command, args, options = {}) {
  const result = run(command, args, options);
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr?.trim() || result.stdout?.trim()}`);
  return result.stdout.trim();
}

/** The rootless daemon socket, mounted read-only into the scanner containers. */
export function dockerSocket() {
  const host = process.env.DOCKER_HOST ?? '';
  return host.startsWith('unix://') ? host.slice('unix://'.length) : '/var/run/docker.sock';
}

/**
 * The source revision an artifact was built from.
 *
 * A working tree with uncommitted changes is marked `-dirty` (C44): an artifact built from it is not
 * the commit it names, and provenance that quietly rounds that off is worse than no provenance. The
 * release preflight compares this to the same value, so a candidate is only ever accepted while its
 * artifacts and its source agree — rebuilding on the committed terminal SHA is what clears the mark.
 */
export function gitRevision() {
  const result = run('git', ['rev-parse', 'HEAD']);
  if (result.status !== 0) return 'unknown';
  const revision = result.stdout.trim();
  const status = run('git', ['status', '--porcelain']);
  const dirty = status.status === 0 && status.stdout.trim().length > 0;
  return dirty ? `${revision}-dirty` : revision;
}
