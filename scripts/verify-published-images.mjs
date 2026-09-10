#!/usr/bin/env node
/** Verifies registry signatures/attestations, then records only observed evidence. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from './release-images.mjs';

const directory = join(process.cwd(), 'reports', 'images');
const manifestPath = join(directory, 'manifest.json');
const registryManifestPath = join(directory, 'registry-manifest.json');
const identity = process.env.GONES_COSIGN_IDENTITY_REGEXP ?? '';
const issuer = process.env.GONES_COSIGN_OIDC_ISSUER ?? 'https://token.actions.githubusercontent.com';
const fail = (message) => { console.error(`Published-image verification failed: ${message}`); process.exit(1); };
if (!existsSync(manifestPath) || !existsSync(registryManifestPath)) fail('publish manifests are missing');
if (!identity) fail('GONES_COSIGN_IDENTITY_REGEXP is required');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const registryManifest = JSON.parse(readFileSync(registryManifestPath, 'utf8'));
for (const image of registryManifest.images ?? []) {
  const subject = `${image.ref}@${image.digest}`;
  const signature = run('cosign', ['verify', '--certificate-oidc-issuer', issuer, '--certificate-identity-regexp', identity, subject], { maxBuffer: 16 * 1024 * 1024 });
  if (signature.status !== 0) fail(`signature rejected for ${image.name}`);
  const attestation = run('cosign', ['verify-attestation', '--type', 'slsaprovenance', '--certificate-oidc-issuer', issuer, '--certificate-identity-regexp', identity, subject], { maxBuffer: 16 * 1024 * 1024 });
  if (attestation.status !== 0) fail(`build provenance rejected for ${image.name}`);
  image.signed = true;
  image.provenance = true;
  image.sbom = existsSync(join(directory, `sbom-${image.name}.spdx.json`));
  if (!image.sbom) fail(`SBOM missing for ${image.name}`);
  console.log(`verified ${subject}`);
}
if ((registryManifest.images ?? []).length !== 5) fail('registry manifest does not contain exactly five release images');
writeFileSync(registryManifestPath, `${JSON.stringify(registryManifest, null, 2)}\n`);
manifest.registry = registryManifest;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const files = ['manifest.json', 'registry-manifest.json'];
const checksumsPath = join(directory, 'checksums.txt');
const checksums = readFileSync(checksumsPath, 'utf8').split('\n').filter((line) => line && !files.some((file) => line.endsWith(`  ${file}`)));
for (const file of files) checksums.push(`${createHash('sha256').update(readFileSync(join(directory, file))).digest('hex')}  ${file}`);
writeFileSync(checksumsPath, `${checksums.join('\n')}\n`);
