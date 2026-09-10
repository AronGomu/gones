#!/usr/bin/env node
/**
 * Publishes already-built release images. It never builds.
 *
 * Required environment: GONES_IMAGE_REGISTRY, GONES_IMAGE_NAMESPACE and GONES_CONFIG_REVISION.
 * Every push uses source SHA as an immutable tag; no latest tag is created.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RELEASE_IMAGES, run } from './release-images.mjs';

const root = process.cwd();
const directory = join(root, 'reports', 'images');
const manifestPath = join(directory, 'manifest.json');
const registry = (process.env.GONES_IMAGE_REGISTRY ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
const namespace = (process.env.GONES_IMAGE_NAMESPACE ?? '').replace(/^\/+|\/+$/g, '').toLowerCase();
const configRevision = process.env.GONES_CONFIG_REVISION ?? '';

const fail = (message) => {
  console.error(`Publish refused: ${message}`);
  process.exit(1);
};
if (!existsSync(manifestPath)) fail('reports/images/manifest.json is missing');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (!/^\b[0-9a-f]{40}\b$/.test(manifest.revision ?? '')) fail('artifacts must be built from a clean commit SHA');
if (!registry) fail('GONES_IMAGE_REGISTRY is required');
if (!namespace) fail('GONES_IMAGE_NAMESPACE is required');
if (!configRevision) fail('GONES_CONFIG_REVISION is required');
if (!/^[a-z0-9][a-z0-9._/-]*$/.test(registry) || !/^[a-z0-9][a-z0-9._/-]*$/.test(namespace)) fail('registry and namespace contain invalid characters');

const sourceTreeResult = run('git', ['rev-parse', 'HEAD^{tree}']);
if (sourceTreeResult.status !== 0) fail('could not resolve source tree');
const tree = sourceTreeResult.stdout.trim();
const published = [];
for (const definition of RELEASE_IMAGES) {
  const image = manifest.images?.find((entry) => entry.name === definition.name);
  if (!image?.tag || !/^sha256:[0-9a-f]{64}$/.test(image.digest ?? '')) fail(`${definition.name} has no local immutable digest`);
  const ref = `${registry}/${namespace}/gones-${definition.name}:${manifest.revision}`;
  const tagged = run('docker', ['tag', image.tag, ref], { stdio: 'inherit' });
  if (tagged.status !== 0) fail(`could not tag ${definition.name}`);
  const pushed = run('docker', ['push', ref], { stdio: 'pipe', maxBuffer: 16 * 1024 * 1024 });
  if (pushed.status !== 0) {
    process.stderr.write(pushed.stderr ?? '');
    fail(`could not publish ${definition.name}`);
  }
  const digest = (pushed.stdout.match(/digest:\s*(sha256:[0-9a-f]{64})/i) ?? [])[1];
  if (!digest) fail(`registry returned no manifest digest for ${definition.name}`);
  published.push({ name: definition.name, ref, digest, signed: false, provenance: false, sbom: false, critical: 0 });
  console.log(`published ${ref}@${digest}`);
}

const identity = { sourceSha: manifest.revision, tree, configRevision, images: published };
const manifestDigest = `sha256:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
const registryManifest = { kind: 'gones.registry-manifest', manifestFormatVersion: 1, ...identity, manifestDigest };
writeFileSync(join(directory, 'registry-manifest.json'), `${JSON.stringify(registryManifest, null, 2)}\n`);
manifest.tree = tree;
manifest.configRevision = configRevision;
manifest.registry = registryManifest;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const artifacts = manifest.images.map((image) => `${image.digest.replace(/^sha256:/, '')}  ${image.tag}`);
for (const entry of (manifest.sbom ?? []).filter((item) => item.generated)) {
  const file = `sbom-${entry.image}.spdx.json`;
  const path = join(directory, file);
  if (existsSync(path)) artifacts.push(`${createHash('sha256').update(readFileSync(path)).digest('hex')}  ${file}`);
}
for (const file of ['manifest.json', 'registry-manifest.json']) {
  const path = join(directory, file);
  artifacts.push(`${createHash('sha256').update(readFileSync(path)).digest('hex')}  ${file}`);
}
writeFileSync(join(directory, 'checksums.txt'), `${artifacts.join('\n')}\n`);
console.log(`registry manifest ${manifestDigest}`);
console.log(`published ${published.length} immutable release images from ${manifest.revision}`);
