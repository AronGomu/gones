#!/usr/bin/env node
/**
 * Registry-neutral release image build (C41).
 *
 * Produces, for every release artifact:
 *   - a linux/amd64 OCI image built from digest-pinned bases
 *   - its immutable image digest, recorded in reports/images/manifest.json
 *   - an SPDX SBOM, when an SBOM generator is reachable
 *   - reports/images/checksums.txt covering every artifact this run produced
 *
 * Nothing is pushed and no registry host appears anywhere: choosing a registry is deferred with the
 * rest of the hosting decision, so the build stops at "reproducible local artifact plus provenance".
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { RELEASE_IMAGES, TOOL_IMAGES, capture, dockerSocket, gitRevision, mustRun, run, tagFor } from './release-images.mjs';

const root = process.cwd();
const outputDirectory = join(root, 'reports', 'images');
const platform = process.env.GONES_IMAGE_PLATFORM ?? 'linux/amd64';
const reference = process.env.GONES_IMAGE_REFERENCE ?? 'local';
const revision = gitRevision();
const created = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

mkdirSync(outputDirectory, { recursive: true });

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const artifacts = [];
const manifest = { platform, revision, created, images: [] };

// C42: the frontend artifact declares its data authority explicitly. Without a public API origin
// the only coherent declaration is the frozen legacy static build, so that stays the default; a
// server-mode release passes both variables. An incoherent pair fails the image build (ADR 0019).
const frontendDataMode = process.env.GONES_FRONTEND_DATA_MODE ?? 'legacy-browser';
const frontendApiBaseUrl = process.env.GONES_FRONTEND_API_BASE_URL ?? '';
const frontendBuildArgs = [
  '--build-arg', `GONES_FRONTEND_DATA_MODE=${frontendDataMode}`,
  '--build-arg', `GONES_FRONTEND_API_BASE_URL=${frontendApiBaseUrl}`,
  '--build-arg', `GONES_FRONTEND_AUTH_V1=${process.env.GONES_FRONTEND_AUTH_V1 ?? 'false'}`,
  '--build-arg', `GONES_FRONTEND_ADMIN_V1=${process.env.GONES_FRONTEND_ADMIN_V1 ?? 'false'}`
];

for (const image of RELEASE_IMAGES) {
  const tag = tagFor(image.name, reference);
  const idFile = join(outputDirectory, `${image.name}.iid`);
  console.log(`\n=== building ${tag} (${platform}) ===`);
  if (image.name === 'frontend') console.log(`    dataMode=${frontendDataMode} apiBaseUrl='${frontendApiBaseUrl}'`);
  mustRun('docker', [
    'buildx', 'build',
    '--platform', platform,
    '--file', image.dockerfile,
    '--tag', tag,
    '--build-arg', `GONES_IMAGE_REVISION=${revision}`,
    '--build-arg', `GONES_IMAGE_CREATED=${created}`,
    ...(image.name === 'frontend' ? frontendBuildArgs : []),
    '--iidfile', idFile,
    '--load',
    '.'
  ]);

  const digest = readFileSync(idFile, 'utf8').trim();
  rmSync(idFile, { force: true });
  const inspected = JSON.parse(capture('docker', ['image', 'inspect', tag]))[0];
  manifest.images.push({
    name: image.name,
    tag,
    digest,
    os: inspected.Os,
    architecture: inspected.Architecture,
    user: inspected.Config?.User ?? '',
    stopSignal: inspected.Config?.StopSignal ?? '',
    labels: inspected.Config?.Labels ?? {}
  });
  artifacts.push({ artifact: tag, sha256: digest.replace(/^sha256:/, '') });
}

// SBOM generation runs as a pinned container against the local daemon, so no host tool is required.
// If the generator cannot be reached the run still succeeds but says so loudly: a silently missing
// SBOM would be worse than an explicitly absent one.
const sbomStatus = [];
for (const image of RELEASE_IMAGES) {
  const tag = tagFor(image.name, reference);
  const target = join(outputDirectory, `sbom-${image.name}.spdx.json`);
  const result = run('docker', [
    'run', '--rm',
    '-v', `${dockerSocket()}:/var/run/docker.sock`,
    TOOL_IMAGES.syft,
    'scan', `docker:${tag}`, '-o', 'spdx-json', '-q'
  ], { maxBuffer: 256 * 1024 * 1024 });
  if (result.status === 0 && result.stdout.trim().startsWith('{')) {
    writeFileSync(target, result.stdout);
    artifacts.push({ artifact: `sbom-${image.name}.spdx.json`, sha256: sha256(target) });
    sbomStatus.push({ image: image.name, generated: true });
    continue;
  }
  sbomStatus.push({ image: image.name, generated: false, reason: (result.stderr || result.stdout || '').trim().slice(0, 300) });
}

manifest.sbom = sbomStatus;
const manifestPath = join(outputDirectory, 'manifest.json');
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
artifacts.push({ artifact: 'manifest.json', sha256: sha256(manifestPath) });

writeFileSync(
  join(outputDirectory, 'checksums.txt'),
  `${artifacts.map((entry) => `${entry.sha256}  ${entry.artifact}`).join('\n')}\n`
);

console.log('\nRelease images built:');
for (const entry of manifest.images) console.log(`  ${entry.tag} ${entry.digest} (${entry.os}/${entry.architecture}, user ${entry.user})`);
const missing = sbomStatus.filter((entry) => !entry.generated);
if (missing.length > 0) {
  console.warn(`\nWARNING: no SBOM produced for ${missing.map((entry) => entry.image).join(', ')}.`);
  console.warn('The image build itself is unaffected; rerun with a reachable SBOM generator to complete provenance.');
}
console.log(`\nProvenance written to ${join('reports', 'images')} (manifest.json, checksums.txt${missing.length < RELEASE_IMAGES.length ? ', sbom-*.spdx.json' : ''}).`);
if (!existsSync(join(outputDirectory, 'checksums.txt'))) process.exit(1);
