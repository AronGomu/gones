#!/usr/bin/env node
/** Post-soak evidence finalization only: no deployment, build or local evidence input. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { boundedBody, MAX_BYTES, requireValue, retrieveCandidateEvidence, validateCandidateEvidence, validatePromotionEvidence } from './staging-evidence.mjs';
import { fixedEndpoint } from './staging-http.mjs';

export async function finalizeStaging(selection, service, fetcher = fetch, now = Date.now()) {
  requireValue(/^[0-9a-f]{40}$/.test(selection.sourceSha ?? ''), 'finalizer dispatch SHA required');
  const endpoint = fixedEndpoint(service.endpoint);
  requireValue(endpoint.pathname === '/v1/w12/evidence', 'fixed W12 evidence path required');
  requireValue(typeof service.token === 'string' && service.token.length > 0, 'staging evidence token required');
  const { binding, evidence } = await retrieveCandidateEvidence(selection, fetcher);
  requireValue(binding.sourceSha === selection.sourceSha, 'finalizer dispatch differs from release source');
  validateCandidateEvidence(evidence, binding);
  const response = await fetcher(endpoint.href, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { authorization: `Bearer ${service.token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ operation: 'gones-staging-w12-evidence-v1', releaseArtifact: binding, ...evidence.candidate, manifestDigest: evidence.manifest.manifestDigest, environment: 'staging' })
  });
  requireValue(response.status === 200 && /^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? ''), 'staging evidence request failed');
  let w12;
  try { w12 = JSON.parse((await boundedBody(response, 16 * 1024 * 1024)).toString('utf8')); }
  catch { throw new Error('invalid or oversized staging W12 evidence'); }
  const finalized = { ...evidence, promotionStatus: 'passed', releaseArtifact: binding, w12 };
  validatePromotionEvidence(finalized, binding, now);
  requireValue(Buffer.byteLength(JSON.stringify(finalized)) <= MAX_BYTES, 'finalized evidence size exceeds bound');
  return finalized;
}

if (import.meta.filename === process.argv[1]) {
  try {
    requireValue(process.argv.length === 2, 'finalizer accepts GitHub identities only');
    const env = process.env;
    requireValue(env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_REF === 'refs/heads/staging' && env.GITHUB_RUN_ATTEMPT === '1' && env.GITHUB_SERVER_URL === 'https://github.com' && env.GITHUB_API_URL === 'https://api.github.com', 'finalizer requires first-attempt GitHub staging dispatch');
    const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    requireValue(sourceSha === env.GITHUB_SHA, 'checkout differs from finalizer dispatch');
    const finalized = await finalizeStaging({ repository: env.GITHUB_REPOSITORY, repositoryId: env.GITHUB_REPOSITORY_ID, runId: env.CANDIDATE_RUN_ID, artifactId: env.CANDIDATE_ARTIFACT_ID, sourceSha, token: env.GITHUB_TOKEN }, { endpoint: env.GONES_STAGING_EVIDENCE_URL, token: env.GONES_STAGING_EVIDENCE_TOKEN });
    mkdirSync('reports/staging-finalized', { recursive: true });
    writeFileSync('reports/staging-finalized/evidence.json', `${JSON.stringify(finalized)}\n`, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ operation: 'staging-finalization', status: 'promotion-verified', runId: finalized.releaseArtifact.runId, artifactId: finalized.releaseArtifact.artifactId }));
  } catch {
    console.error('Staging finalization refused: GitHub identity, deployment or live W12 evidence failed validation.');
    process.exitCode = 1;
  }
}
