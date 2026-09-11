/** Fixed GitHub provenance transport and shared immutable evidence validation. */
import { isDeepStrictEqual } from 'node:util';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateDeployment, evaluatePromotion, PROMOTION_ARTIFACTS } from './promotion-check.mjs';

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ID = /^[1-9][0-9]{0,15}$/;
const CONFIG = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/;
export const MAX_BYTES = 17 * 1024 * 1024; // W12 permits 16 MiB, plus deployment envelope.
export const hash = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
export const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const matchesId = (value, expected) => Number.isSafeInteger(value) && String(value) === expected;

function validateSelection(selection) {
  requireValue(/^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9_.-]+$/.test(selection.repository ?? ''), 'repository identity required');
  for (const key of ['repositoryId', 'runId', 'artifactId']) {
    requireValue(typeof selection[key] === 'string' && ID.test(selection[key]) && Number.isSafeInteger(Number(selection[key])), 'numeric GitHub identity required');
  }
}

/** Only GitHub API responses, never fields supplied inside evidence, establish transport identity. */
function bindArtifact({ run, artifact, commit, jobs }, selection, finalization) {
  validateSelection(selection);
  const sameRepo = repo => matchesId(repo?.id, selection.repositoryId) && repo?.full_name === selection.repository;
  requireValue(matchesId(run?.id, selection.runId) && run.run_attempt === 1, 'staging run must be its first attempt');
  requireValue(sameRepo(run.repository) && sameRepo(run.head_repository), 'staging run repository mismatch');
  // REST run paths may include @<branch>; never accept a qualifier for another ref.
  const workflow = finalization ? '.github/workflows/finalize-staging.yml' : '.github/workflows/release-images.yml';
  requireValue([workflow, `${workflow}@staging`].includes(run.path) && run.event === (finalization ? 'workflow_dispatch' : 'push') && run.head_branch === 'staging', 'staging workflow/ref/event mismatch');
  requireValue(run.status === 'completed' && run.conclusion === 'success' && SHA.test(run.head_sha), 'successful completed staging run required');
  requireValue(matchesId(artifact?.id, selection.artifactId) && artifact.name === `staging-${finalization ? 'promotion' : 'deployment'}-evidence-${run.head_sha}`, 'staging artifact identity mismatch');
  requireValue(artifact.expired === false && DIGEST.test(artifact.digest ?? ''), 'unexpired artifact with SHA-256 digest required');
  requireValue(Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0 && artifact.size_in_bytes <= MAX_BYTES, 'artifact size exceeds bound');
  const origin = artifact.workflow_run;
  requireValue(matchesId(origin?.id, selection.runId) && matchesId(origin.repository_id, selection.repositoryId) && matchesId(origin.head_repository_id, selection.repositoryId) && origin.head_branch === 'staging' && origin.head_sha === run.head_sha, 'artifact run/source/repository mismatch');
  requireValue(commit?.sha === run.head_sha && SHA.test(commit.tree?.sha ?? ''), 'staging source commit mismatch');
  const requiredJobs = finalization ? ['finalize'] : ['quality', 'publish', ...PROMOTION_ARTIFACTS.map(name => `attest (${name})`), 'sign-and-verify', 'deploy-staging'];
  requireValue(Array.isArray(jobs) && jobs.length === requiredJobs.length && requiredJobs.every(name => jobs.filter(job => job.name === name).length === 1), 'required staging jobs missing or duplicated');
  requireValue(jobs.every(job => matchesId(job.run_id, selection.runId) && job.run_attempt === 1 && job.head_sha === run.head_sha && job.status === 'completed' && job.conclusion === 'success'), 'staging jobs did not all succeed in the selected attempt');
  return { repository: selection.repository, repositoryId: selection.repositoryId, runId: selection.runId, runAttempt: 1, artifactId: selection.artifactId, artifactDigest: artifact.digest, sourceSha: run.head_sha, tree: commit.tree.sha };
}

export const bindStagingArtifact = (metadata, selection) => bindArtifact(metadata, selection, false);
export const bindFinalizationArtifact = (metadata, selection) => bindArtifact(metadata, selection, true);

export function validateImmutableEvidence(evidence, binding) {
  requireValue(evidence?.candidate?.sourceSha === binding.sourceSha && evidence.candidate.tree === binding.tree, 'evidence differs from authenticated staging source');
  requireValue(CONFIG.test(evidence.candidate.configRevision ?? ''), 'public config revision required');
  requireValue(evidence.target?.rebuild === false && evidence.target?.changed === false, 'explicit unchanged no-rebuild target required');
  const manifest = evidence.manifest;
  requireValue(Array.isArray(manifest?.images) && manifest.images.length === PROMOTION_ARTIFACTS.length, 'exactly five staged images required');
  // Match publisher order and pre-verification bytes: verification changes booleans, not identity.
  const publishedImages = manifest.images.map((image, index) => {
    const name = PROMOTION_ARTIFACTS[index];
    requireValue(image?.name === name && image.ref === `ghcr.io/${binding.repository.toLowerCase()}/gones-${name}:${binding.sourceSha}`, 'staged image name/ref mismatch');
    requireValue(DIGEST.test(image.digest ?? '') && image.critical === 0, 'staged immutable digest and successful scan required');
    return { name, ref: image.ref, digest: image.digest, signed: false, provenance: false, sbom: false, critical: 0 };
  });
  const manifestDigest = hash(JSON.stringify({ sourceSha: manifest.sourceSha, tree: manifest.tree, configRevision: manifest.configRevision, images: publishedImages }));
  requireValue(manifest.manifestDigest === manifestDigest, 'staged manifest digest mismatch');
  requireValue(evaluateDeployment(evidence).ok, 'deployment checks refused staging evidence');
  return { manifestDigest, publishedImages };
}

export function validateCandidateEvidence(evidence, binding) {
  requireValue(evidence?.promotionStatus === 'pending-w12' && !Object.hasOwn(evidence, 'w12') && !Object.hasOwn(evidence, 'releaseArtifact'), 'pending deployment evidence required');
  requireValue(Buffer.byteLength(JSON.stringify(evidence)) <= 1024 * 1024, 'deployment evidence size exceeds bound');
  return validateImmutableEvidence(evidence, binding);
}

export function validatePromotionEvidence(evidence, binding, now = Date.now()) {
  const identity = validateImmutableEvidence(evidence, binding);
  requireValue(evidence.promotionStatus === 'passed' && evaluatePromotion(evidence, now).ok, 'promotion checks refused staging evidence');
  return identity;
}

export async function boundedBody(response, limit) {
  const length = response.headers.get('content-length');
  requireValue(length === null || (/^[0-9]+$/.test(length) && Number(length) <= limit), 'response size exceeds bound');
  requireValue(response.body, 'response body missing');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    requireValue(size <= limit, 'response size exceeds bound');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function decodeArchive(archive) {
  const directory = mkdtempSync(join(tmpdir(), 'gones-staging-artifact-'));
  try {
    const file = join(directory, 'artifact.zip');
    writeFileSync(file, archive, { flag: 'wx', mode: 0o600 });
    const options = { encoding: 'utf8', maxBuffer: MAX_BYTES, timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] };
    let entries;
    try { entries = execFileSync('unzip', ['-Z1', file], options); }
    catch { throw new Error('invalid artifact archive'); }
    requireValue(entries === 'evidence.json\n', 'artifact must contain only evidence.json');
    // Print one exact member; never extract paths, follow symlinks or execute artifact contents.
    let json;
    try { json = execFileSync('unzip', ['-p', file, 'evidence.json'], options); }
    catch { throw new Error('invalid or oversized artifact evidence'); }
    try { return JSON.parse(json); }
    catch { throw new Error('invalid artifact evidence JSON'); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

async function retrieveArtifact(selection, finalization, fetcher) {
  validateSelection(selection);
  requireValue(typeof selection.token === 'string' && selection.token.length > 0, 'GitHub token required');
  const base = `https://api.github.com/repos/${selection.repository}`;
  const api = path => fetcher(`${base}${path}`, {
    headers: { authorization: `Bearer ${selection.token}`, accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    redirect: 'manual', signal: AbortSignal.timeout(30_000)
  });
  const json = async path => {
    const response = await api(path);
    requireValue(response.status === 200, 'GitHub metadata request failed');
    try { return JSON.parse((await boundedBody(response, 1024 * 1024)).toString('utf8')); }
    catch { throw new Error('invalid or oversized GitHub metadata'); }
  };
  if (finalization) {
    requireValue(SHA.test(selection.mainSha ?? ''), 'dispatched main SHA required');
    const main = await json('/git/ref/heads/main');
    requireValue(main.ref === 'refs/heads/main' && main.object?.type === 'commit' && main.object.sha === selection.mainSha, 'main advanced beyond the approved dispatch');
  }
  const run = await json(`/actions/runs/${selection.runId}`);
  requireValue(SHA.test(run?.head_sha ?? ''), 'staging source SHA required');
  const artifact = await json(`/actions/artifacts/${selection.artifactId}`);
  const commit = await json(`/git/commits/${run.head_sha}`);
  // First-attempt-only policy avoids associating old artifacts with successful reruns.
  const page = await json(`/actions/runs/${selection.runId}/attempts/1/jobs?per_page=100`);
  requireValue(Array.isArray(page.jobs) && page.total_count === page.jobs.length && page.jobs.length <= 100, 'incomplete staging job metadata');
  const binding = bindArtifact({ run, artifact, commit, jobs: page.jobs }, selection, finalization);
  const response = await api(`/actions/artifacts/${selection.artifactId}/zip`);
  requireValue(response.status === 302, 'GitHub artifact download redirect required');
  let location;
  try { location = new URL(response.headers.get('location')); }
  catch { throw new Error('invalid artifact download location'); }
  requireValue(location.protocol === 'https:' && !location.username && !location.password && !location.port && !location.hash && (location.hostname.endsWith('.blob.core.windows.net') || location.hostname.endsWith('.actions.githubusercontent.com')), 'secure GitHub storage download location required');
  // GitHub's signed storage URL is credential-free. Never forward the API bearer to storage.
  const downloaded = await fetcher(location.href, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  requireValue(downloaded.status === 200, 'artifact download failed');
  const archive = await boundedBody(downloaded, MAX_BYTES);
  requireValue(hash(archive) === binding.artifactDigest, 'artifact archive digest mismatch');
  return { binding, evidence: decodeArchive(archive) };
}

export const retrieveCandidateEvidence = (selection, fetcher = fetch) => retrieveArtifact(selection, false, fetcher);

export async function retrieveStagingEvidence(selection, fetcher = fetch) {
  const finalized = await retrieveArtifact(selection, true, fetcher);
  const claimed = finalized.evidence?.releaseArtifact;
  requireValue(claimed?.repository === selection.repository && claimed.repositoryId === selection.repositoryId, 'release chain repository mismatch');
  const original = await retrieveCandidateEvidence({ ...selection, runId: claimed.runId, artifactId: claimed.artifactId }, fetcher);
  requireValue(isDeepStrictEqual(claimed, original.binding), 'release chain binding mismatch');
  validateCandidateEvidence(original.evidence, original.binding);
  requireValue(original.binding.sourceSha === finalized.binding.sourceSha && original.binding.tree === finalized.binding.tree, 'finalizer differs from release source');
  const expected = { ...original.evidence, promotionStatus: 'passed', releaseArtifact: original.binding, w12: finalized.evidence.w12 };
  requireValue(isDeepStrictEqual(expected, finalized.evidence), 'finalized deployment differs from original artifact');
  return finalized;
}
