#!/usr/bin/env node
/**
 * Fixed staging deployment operation. The host exposes one HTTPS endpoint; callers cannot provide
 * Docker, SSH or an arbitrary command. The endpoint must return migration and serialization evidence.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from './release-images.mjs';

const argument = (name) => process.argv.find((entry) => entry.startsWith(`--${name}=`))?.slice(name.length + 3);
const manifestPath = argument('manifest') ?? join(process.cwd(), 'reports', 'images', 'manifest.json');
const evidencePath = argument('evidence') ?? join(process.cwd(), 'reports', 'staging', 'evidence.json');
const endpoint = process.env.GONES_STAGING_DEPLOY_URL ?? '';
const token = process.env.GONES_STAGING_DEPLOY_TOKEN ?? '';
const fail = (message) => { console.error(`Staging deployment refused: ${message}`); process.exit(1); };
if (!existsSync(manifestPath)) fail('immutable manifest is missing');
if (!endpoint.startsWith('https://')) fail('GONES_STAGING_DEPLOY_URL must use HTTPS');
if (!token) fail('GONES_STAGING_DEPLOY_TOKEN is required');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const registry = manifest.registry;
if (!registry?.manifestDigest || !registry.sourceSha || !Array.isArray(registry.images)) fail('manifest has no registry provenance');
const head = run('git', ['rev-parse', 'HEAD']).stdout.trim();
if (head !== registry.sourceSha) fail(`checked out source ${head} differs from published source ${registry.sourceSha}`);

const payload = {
  operation: 'gones-staging-deploy-v1',
  sourceSha: registry.sourceSha,
  tree: registry.tree,
  configRevision: registry.configRevision,
  manifestDigest: registry.manifestDigest,
  images: registry.images.map(({ name, ref, digest }) => ({ name, ref, digest }))
};
let response;
try {
  response = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
} catch (error) {
  fail(`fixed deployment operation unavailable: ${error instanceof Error ? error.message : String(error)}`);
}
if (!response.ok) fail(`fixed deployment operation returned HTTP ${response.status}`);
let staging;
try { staging = await response.json(); } catch { fail('fixed deployment operation returned invalid JSON'); }
const evidence = {
  candidate: { sourceSha: registry.sourceSha, tree: registry.tree, configRevision: registry.configRevision },
  manifest: {
    sourceSha: registry.sourceSha,
    tree: registry.tree,
    configRevision: registry.configRevision,
    manifestDigest: registry.manifestDigest,
    images: registry.images
  },
  staging: {
    sourceSha: staging.sourceSha,
    tree: staging.tree,
    configRevision: staging.configRevision,
    manifestDigest: staging.manifestDigest,
    status: staging.status,
    migrationExitCode: staging.migrationExitCode,
    deploymentsActive: staging.deploymentsActive,
    serialized: staging.serialized
  },
  target: { sourceSha: registry.sourceSha, tree: registry.tree, configRevision: registry.configRevision, manifestDigest: registry.manifestDigest, rebuild: false, changed: false }
};
const directory = evidencePath.slice(0, evidencePath.lastIndexOf('/'));
if (directory) mkdirSync(directory, { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`Staging deployment evidence written to ${evidencePath}`);
