#!/usr/bin/env node
/** Authenticated GitHub artifact transport; approval-gated handoff only, never a deployment. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { hash, requireValue, retrieveStagingEvidence, validatePromotionEvidence } from './staging-evidence.mjs';

const SHA = /^[0-9a-f]{40}$/;
const ID = /^[1-9][0-9]{0,15}$/;
const CONFIG = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/;

/** Revalidate the existing promotion/W12 gate against independently observed main identity. */
export function createProductionHandoff(evidence, binding, current, now = Date.now()) {
  requireValue(SHA.test(current?.sourceSha ?? '') && SHA.test(current.tree ?? '') && CONFIG.test(current.configRevision ?? ''), 'main source/tree/config identity required');
  requireValue(ID.test(current.runId ?? '') && ID.test(current.runAttempt ?? ''), 'handoff run identity required');
  requireValue(current.tree === binding.tree, 'main tree differs from staged source tree');
  const { manifestDigest, publishedImages } = validatePromotionEvidence({ ...evidence, current: { tree: current.tree, configRevision: current.configRevision } }, binding, now);
  const output = {
    kind: 'gones.production-handoff', version: 1,
    createdAt: new Date(now).toISOString(),
    rebuild: false, deploy: false, productionApprovalRequired: true,
    candidate: { sourceSha: binding.sourceSha, tree: binding.tree, configRevision: current.configRevision },
    main: { sourceSha: current.sourceSha, tree: current.tree, configRevision: current.configRevision },
    stagingArtifact: binding,
    releaseArtifact: evidence.releaseArtifact,
    handoffRun: { runId: current.runId, runAttempt: current.runAttempt },
    manifestDigest,
    images: publishedImages.map(({ name, ref, digest }) => ({ name, ref: `${ref.slice(0, ref.lastIndexOf(':'))}@${digest}`, digest })),
    w12: { endedAt: evidence.w12.endedAt, expiresAt: new Date(Date.parse(evidence.w12.endedAt) + 24 * 3_600_000).toISOString(), evidenceDigest: hash(JSON.stringify(evidence.w12)) }
  };
  requireValue(Buffer.byteLength(JSON.stringify(output)) <= 8192, 'handoff size exceeds bound');
  return output;
}

if (import.meta.filename === process.argv[1]) {
  try {
    requireValue(process.argv.length === 2, 'handoff accepts GitHub identities only, not evidence arguments');
    const env = process.env;
    requireValue(env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_REF === 'refs/heads/main' && env.GITHUB_SERVER_URL === 'https://github.com' && env.GITHUB_API_URL === 'https://api.github.com', 'handoff requires a GitHub main dispatch');
    const git = args => execFileSync('git', args, { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const sourceSha = git(['rev-parse', 'HEAD']);
    requireValue(sourceSha === env.GITHUB_SHA, 'checkout differs from dispatched main commit');
    const current = { sourceSha, tree: git(['rev-parse', 'HEAD^{tree}']), configRevision: env.GONES_PRODUCTION_CONFIG_REVISION, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT };
    const { binding, evidence } = await retrieveStagingEvidence({ repository: env.GITHUB_REPOSITORY, repositoryId: env.GITHUB_REPOSITORY_ID, runId: env.STAGING_RUN_ID, artifactId: env.STAGING_ARTIFACT_ID, mainSha: sourceSha, token: env.GITHUB_TOKEN });
    const handoff = createProductionHandoff(evidence, binding, current);
    mkdirSync('reports/production', { recursive: true });
    writeFileSync('reports/production/handoff.json', `${JSON.stringify(handoff, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ operation: 'production-handoff', status: 'verified-handoff-only', runId: binding.runId, artifactId: binding.artifactId, manifestDigest: handoff.manifestDigest, rebuild: false, deploy: false }));
  } catch {
    // External JSON, signed URLs and process errors must not leak into public workflow logs.
    console.error('Production handoff refused: GitHub identity, artifact, main/config or promotion evidence failed validation.');
    process.exitCode = 1;
  }
}
