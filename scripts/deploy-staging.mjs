#!/usr/bin/env node
/**
 * Fixed staging deployment operation. The host exposes one HTTPS endpoint; callers cannot provide
 * Docker, SSH or an arbitrary command. The endpoint must return migration and serialization evidence.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { boundedBody, validateCandidateEvidence } from './staging-evidence.mjs';
import { fixedEndpoint } from './staging-http.mjs';

try {
  const argument = (name) => process.argv.find((entry) => entry.startsWith(`--${name}=`))?.slice(name.length + 3);
  const manifestPath = argument('manifest') ?? join(process.cwd(), 'reports', 'images', 'manifest.json');
  const evidencePath = argument('evidence') ?? join(process.cwd(), 'reports', 'staging', 'evidence.json');
  const endpoint = process.env.GONES_STAGING_DEPLOY_URL ?? '';
  const token = process.env.GONES_STAGING_DEPLOY_TOKEN ?? '';
  const fail = (message) => { throw new Error(message); };
  if (!existsSync(manifestPath)) fail('immutable manifest is missing');
  const url = fixedEndpoint(endpoint);
  if (!token) fail('GONES_STAGING_DEPLOY_TOKEN is required');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const registry = manifest.registry;
  if (!registry?.manifestDigest || !registry.sourceSha || !Array.isArray(registry.images)) fail('manifest has no registry provenance');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (head !== registry.sourceSha) fail(`checked out source ${head} differs from published source ${registry.sourceSha}`);

  const payload = {
    operation: 'gones-staging-deploy-v1',
    sourceSha: registry.sourceSha,
    tree: registry.tree,
    configRevision: registry.configRevision,
    manifestDigest: registry.manifestDigest,
    images: registry.images.map(({ name, ref, digest }) => ({ name, ref, digest }))
  };
  const response = await fetch(url.href, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (response.status !== 200) fail(`fixed deployment operation returned HTTP ${response.status}`);
  let staging;
  try { staging = JSON.parse((await boundedBody(response, 64 * 1024)).toString('utf8')); } catch { fail('fixed deployment operation returned invalid JSON'); }
  const evidence = {
    promotionStatus: 'pending-w12',
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
  validateCandidateEvidence(evidence, { sourceSha: head, tree: registry.tree, repository: process.env.GITHUB_REPOSITORY });
  const directory = evidencePath.slice(0, evidencePath.lastIndexOf('/'));
  if (directory) mkdirSync(directory, { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence)}\n`, { flag: 'wx', mode: 0o600 });
  console.log('Staging deployment verified; promotion pending live W12 finalization.');
} catch {
  console.error('Staging deployment refused: fixed operation or immutable deployment evidence failed validation.');
  process.exitCode = 1;
}
