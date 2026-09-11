// @vitest-environment node
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { evidence, end, HOUR, identity, start } from './fixtures/w12-evidence';
// @ts-expect-error - plain ESM CI entry point.
import { createProductionHandoff } from '../scripts/production-handoff.mjs';
// @ts-expect-error - plain ESM CI entry point.
import { bindStagingArtifact, bindFinalizationArtifact, boundedBody, retrieveCandidateEvidence, retrieveStagingEvidence } from '../scripts/staging-evidence.mjs';
// @ts-expect-error - plain ESM CI entry point.
import { finalizeStaging } from '../scripts/finalize-staging.mjs';
// @ts-expect-error - plain ESM operation contract.
import { fixedEndpoint } from '../scripts/staging-http.mjs';

const repository = 'example/gones';
const sourceSha = identity.sourceSha;
const hash = (value: string | Buffer) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const names = ['api', 'worker', 'migrator', 'backup', 'frontend'];
const trusted = { repository, repositoryId: '7', runId: '42', artifactId: '84', mainSha: 'f'.repeat(40), token: 'test-only-token' };
const current = { sourceSha: 'f'.repeat(40), tree: identity.tree, configRevision: identity.configRevision, runId: '90', runAttempt: '1' };
const finalSelection = { ...trusted, runId: '43', artifactId: '85' };
const service = { endpoint: 'https://staging.example.com/v1/w12/evidence', token: 'evidence-only-token' };

function finalMetadata() {
  const value = metadata();
  Object.assign(value.run, { id: 43, event: 'workflow_dispatch', path: '.github/workflows/finalize-staging.yml' });
  Object.assign(value.artifact, { id: 85, name: `staging-promotion-evidence-${sourceSha}` });
  value.artifact.workflow_run.id = 43;
  value.jobs = [{ ...value.jobs[0], name: 'finalize', run_id: 43 }];
  return value;
}

function metadata() {
  return {
    run: { id: 42, run_attempt: 1, path: '.github/workflows/release-images.yml', event: 'push', head_branch: 'staging', head_sha: sourceSha, status: 'completed', conclusion: 'success', repository: { id: 7, full_name: repository }, head_repository: { id: 7, full_name: repository } },
    artifact: { id: 84, name: `staging-deployment-evidence-${sourceSha}`, expired: false, size_in_bytes: 100, digest: hash('zip'), workflow_run: { id: 42, repository_id: 7, head_repository_id: 7, head_branch: 'staging', head_sha: sourceSha } },
    commit: { sha: sourceSha, tree: { sha: identity.tree } },
    jobs: ['quality', 'publish', ...names.map(name => `attest (${name})`), 'sign-and-verify', 'deploy-staging'].map((name, id) => ({ id, name, run_id: 42, run_attempt: 1, head_sha: sourceSha, status: 'completed', conclusion: 'success' }))
  };
}

function context(tree = identity.tree, sha = sourceSha) {
  const candidate = { sourceSha: sha, tree, configRevision: identity.configRevision };
  const images = names.map((name) => ({ name, ref: `ghcr.io/${repository}/gones-${name}:${sha}`, digest: hash(name), signed: true, provenance: true, sbom: true, critical: 0 }));
  // Publisher hashes identity before verification mutates its three booleans.
  const manifestDigest = hash(JSON.stringify({ ...candidate, images: images.map(image => ({ ...image, signed: false, provenance: false, sbom: false })) }));
  const w12 = evidence();
  for (const value of [w12.identity, w12.cost.identity, ...w12.segments.map(segment => segment.identity)]) {
    value.manifestDigest = manifestDigest;
    value.tree = tree;
    value.sourceSha = sha;
  }
  return { promotionStatus: 'passed', candidate, manifest: { ...candidate, manifestDigest, images }, staging: { ...candidate, manifestDigest, status: 'passed', migrationExitCode: 0, deploymentsActive: 0, serialized: true }, target: { ...candidate, manifestDigest, rebuild: false, changed: false }, w12 };
}

function pending(value = context()) {
  const { w12: _w12, ...deployment } = value;
  return { ...deployment, promotionStatus: 'pending-w12' };
}

function handoff(value = context(), now = end) {
  return createProductionHandoff(value, bindFinalizationArtifact(finalMetadata(), finalSelection), current, now);
}

describe('authenticated immutable production handoff', () => {
  it('emits only bounded identity and exact staged digest refs without rebuild or deployment authority', () => {
    const result = handoff();
    expect(result).toMatchObject({ kind: 'gones.production-handoff', version: 1, rebuild: false, deploy: false, productionApprovalRequired: true, candidate: context().candidate, main: { sourceSha: current.sourceSha, tree: current.tree, configRevision: current.configRevision }, stagingArtifact: { repository, runId: '43', runAttempt: 1, artifactId: '85', artifactDigest: hash('zip'), sourceSha } });
    expect(result.images).toEqual(context().manifest.images.map(({ name, ref, digest }) => ({ name, ref: `${ref.split(':')[0]}@${digest}`, digest })));
    expect(JSON.stringify(result).length).toBeLessThan(8192);
    expect(result).not.toHaveProperty('w12.segments');
    expect(result).not.toHaveProperty('token');
  });

  it('accepts GitHub REST ref-qualified workflow paths only for staging', () => {
    const value = metadata();
    value.run.path = '.github/workflows/release-images.yml@staging';
    expect(bindStagingArtifact(value, trusted).sourceSha).toBe(sourceSha);
    value.run.path = '.github/workflows/release-images.yml@main';
    expect(() => bindStagingArtifact(value, trusted)).toThrow();
  });

  it.each([
    ['run ID', (m: ReturnType<typeof metadata>) => { m.run.id++; }],
    ['rerun', (m: ReturnType<typeof metadata>) => { m.run.run_attempt++; }],
    ['workflow', (m: ReturnType<typeof metadata>) => { m.run.path = '.github/workflows/static.yml'; }],
    ['event', (m: ReturnType<typeof metadata>) => { m.run.event = 'pull_request'; }],
    ['branch', (m: ReturnType<typeof metadata>) => { m.run.head_branch = 'dev'; }],
    ['incomplete run', (m: ReturnType<typeof metadata>) => { m.run.status = 'in_progress'; }],
    ['failed run', (m: ReturnType<typeof metadata>) => { m.run.conclusion = 'failure'; }],
    ['fork', (m: ReturnType<typeof metadata>) => { m.run.head_repository.id = 9; }],
    ['repository', (m: ReturnType<typeof metadata>) => { m.run.repository.full_name = 'other/gones'; }],
    ['artifact ID', (m: ReturnType<typeof metadata>) => { m.artifact.id++; }],
    ['artifact name', (m: ReturnType<typeof metadata>) => { m.artifact.name = 'operator-evidence'; }],
    ['expired artifact', (m: ReturnType<typeof metadata>) => { m.artifact.expired = true; }],
    ['absent digest', (m: ReturnType<typeof metadata>) => { m.artifact.digest = ''; }],
    ['artifact run', (m: ReturnType<typeof metadata>) => { m.artifact.workflow_run.id++; }],
    ['artifact source', (m: ReturnType<typeof metadata>) => { m.artifact.workflow_run.head_sha = 'e'.repeat(40); }],
    ['artifact fork', (m: ReturnType<typeof metadata>) => { m.artifact.workflow_run.head_repository_id++; }],
    ['oversized artifact', (m: ReturnType<typeof metadata>) => { m.artifact.size_in_bytes = 20 * 1024 * 1024; }],
    ['source commit', (m: ReturnType<typeof metadata>) => { m.commit.sha = 'e'.repeat(40); }],
    ['skipped deploy', (m: ReturnType<typeof metadata>) => { m.jobs.at(-1)!.conclusion = 'skipped'; }],
    ['missing job', (m: ReturnType<typeof metadata>) => { m.jobs.pop(); }],
    ['job rerun', (m: ReturnType<typeof metadata>) => { m.jobs[0].run_attempt++; }]
  ])('rejects unauthenticated or mismatched %s binding', (_label, mutate) => {
    const value = metadata();
    mutate(value);
    expect(() => bindStagingArtifact(value, trusted)).toThrow();
  });

  it.each([
    ['source', (e: ReturnType<typeof context>) => { e.candidate.sourceSha = 'e'.repeat(40); }],
    ['tree', (e: ReturnType<typeof context>) => { e.candidate.tree = 'e'.repeat(40); }],
    ['digest substitution', (e: ReturnType<typeof context>) => { e.manifest.images[0].digest = hash('forged'); }],
    ['mutable ref', (e: ReturnType<typeof context>) => { e.manifest.images[0].ref = 'ghcr.io/example/gones/gones-api:latest'; }],
    ['foreign ref', (e: ReturnType<typeof context>) => { e.manifest.images[0].ref = `ghcr.io/other/gones/gones-api:${sourceSha}`; }],
    ['duplicate image', (e: ReturnType<typeof context>) => { e.manifest.images[1] = e.manifest.images[0]; }],
    ['extra image', (e: ReturnType<typeof context>) => { e.manifest.images.push(e.manifest.images[0]); }],
    ['signature', (e: ReturnType<typeof context>) => { e.manifest.images[0].signed = false; }],
    ['provenance', (e: ReturnType<typeof context>) => { e.manifest.images[0].provenance = false; }],
    ['SBOM', (e: ReturnType<typeof context>) => { e.manifest.images[0].sbom = false; }],
    ['scan', (e: ReturnType<typeof context>) => { e.manifest.images[0].critical = 1; }],
    ['missing scan', (e: ReturnType<typeof context>) => { Reflect.deleteProperty(e.manifest.images[0], 'critical'); }],
    ['migration', (e: ReturnType<typeof context>) => { e.staging.migrationExitCode = 1; }],
    ['serialization', (e: ReturnType<typeof context>) => { e.staging.serialized = false; }],
    ['active deployment', (e: ReturnType<typeof context>) => { e.staging.deploymentsActive = 1; }],
    ['rebuild omission', (e: ReturnType<typeof context>) => { Reflect.deleteProperty(e.target, 'rebuild'); }],
    ['W12 omission', (e: ReturnType<typeof context>) => { Reflect.deleteProperty(e, 'w12'); }],
    ['W12 fake', (e: ReturnType<typeof context>) => { e.w12.segments[0].origin = 'synthetic'; }],
    ['W12 mismatch', (e: ReturnType<typeof context>) => { e.w12.identity.manifestDigest = hash('different'); }],
    ['W12 failed', (e: ReturnType<typeof context>) => { e.w12.segments[0].jobs.lost = 1; }]
  ])('refuses forged or failed %s evidence', (_label, mutate) => {
    const value = context();
    mutate(value);
    expect(() => handoff(value)).toThrow();
  });

  it('independently binds main tree/config, revalidates W12 freshness after approval', () => {
    const binding = bindStagingArtifact(metadata(), trusted);
    for (const config of [{ ...current, tree: 'e'.repeat(40) }, { ...current, configRevision: '' }, { ...current, configRevision: 'different' }]) {
      expect(() => createProductionHandoff(context(), binding, config, end)).toThrow();
    }
    expect(() => handoff(context(), end + 24 * HOUR + 1)).toThrow();
  });
});

async function withArchive(run: (zip: Buffer) => Promise<void>, entries: Record<string, string> = { 'evidence.json': JSON.stringify(context()) }) {
  const dir = mkdtempSync(join(tmpdir(), 'gones-handoff-'));
  try {
    for (const [name, contents] of Object.entries(entries)) writeFileSync(join(dir, name), contents);
    execFileSync('zip', ['-q', 'evidence.zip', ...Object.keys(entries)], { cwd: dir });
    await run(readFileSync(join(dir, 'evidence.zip')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function api(archive: Buffer, change?: (m: ReturnType<typeof metadata>) => void) {
  const m = metadata();
  m.artifact.digest = hash(archive);
  m.artifact.size_in_bytes = archive.length;
  change?.(m);
  const calls: Array<{ url: string; options: RequestInit }> = [];
  const fetcher = async (url: string, options: RequestInit) => {
    calls.push({ url, options });
    if (url.endsWith('/git/ref/heads/main')) return Response.json({ ref: 'refs/heads/main', object: { type: 'commit', sha: trusted.mainSha } });
    if (url === 'https://test.blob.core.windows.net/evidence.zip') return new Response(new Uint8Array(archive));
    if (url.endsWith('/84/zip')) return new Response(null, { status: 302, headers: { location: 'https://test.blob.core.windows.net/evidence.zip' } });
    const value = url.endsWith('/42') ? m.run : url.endsWith('/84') ? m.artifact : url.includes('/jobs?') ? { total_count: m.jobs.length, jobs: m.jobs } : m.commit;
    return Response.json(value);
  };
  return { fetcher, calls };
}

describe('GitHub authenticated artifact transport', () => {
  it('retrieves by run/artifact ID, verifies archive bytes, decodes only JSON, never forwards bearer to storage', async () => {
    await withArchive(async (archive) => {
      const { fetcher, calls } = api(archive);
      const result = await retrieveCandidateEvidence(trusted, fetcher);
      expect(result.evidence).toEqual(context());
      expect(result.binding.artifactDigest).toBe(hash(archive));
      expect(calls.filter(call => call.url.startsWith('https://api.github.com/')).every(call => (call.options.headers as Record<string, string>)['authorization'] === 'Bearer test-only-token' && call.options.redirect === 'manual')).toBe(true);
      expect(calls.at(-1)?.options.headers).toBeUndefined();
      expect(calls.every(call => call.options.signal instanceof AbortSignal)).toBe(true);
    });
  });

  it('refuses main moving while approval is pending', async () => {
    const fetcher = async () => Response.json({ ref: 'refs/heads/main', object: { type: 'commit', sha: 'e'.repeat(40) } });
    await expect(retrieveStagingEvidence(trusted, fetcher)).rejects.toThrow('main advanced beyond the approved dispatch');
  });

  it('refuses archive digest mismatch before JSON parsing', async () => {
    await withArchive(async (archive) => {
      const { fetcher } = api(archive, m => { m.artifact.digest = hash('forged'); });
      await expect(retrieveCandidateEvidence(trusted, fetcher)).rejects.toThrow('artifact archive digest mismatch');
    });
  });

  it('refuses ZIP extra files rather than extracting attacker paths', async () => {
    await withArchive(async (archive) => {
      await expect(retrieveCandidateEvidence(trusted, api(archive).fetcher)).rejects.toThrow('artifact must contain only evidence.json');
    }, { 'evidence.json': JSON.stringify(context()), 'script.sh': 'exit 0' });
  });

  it('refuses API failure, redirects, missing credentials, unsafe IDs, oversized bodies', async () => {
    for (const status of [302, 403, 404, 500]) await expect(retrieveCandidateEvidence(trusted, async () => new Response(null, { status }))).rejects.toThrow();
    for (const input of [{ ...trusted, token: '' }, { ...trusted, runId: '../42' }, { ...trusted, repository: 'example/../other' }]) await expect(retrieveCandidateEvidence(input, async () => { throw new Error('must not fetch'); })).rejects.toThrow();
    await expect(retrieveCandidateEvidence(trusted, async () => new Response('x', { headers: { 'content-length': String(20 * 1024 * 1024) } }))).rejects.toThrow();
  });
});

describe('manual production handoff workflow boundary', () => {
  const workflow = readFileSync(new URL('../.github/workflows/promote-main.yml', import.meta.url), 'utf8');
  it('accepts only run/artifact IDs, authenticates read-only, pins main dispatch, retains environment approval', () => {
    for (const required of ['staging_run_id:', 'staging_artifact_id:', 'actions: read', 'contents: read', 'environment: production', "github.ref == 'refs/heads/main'", 'ref: ${{ github.sha }}', 'persist-credentials: false', 'GONES_PRODUCTION_CONFIG_REVISION: ${{ vars.GONES_PRODUCTION_CONFIG_REVISION }}', 'node scripts/production-handoff.mjs', 'actions/upload-artifact@', 'if-no-files-found: error']) expect(workflow).toContain(required);
    expect(workflow).not.toMatch(/evidence_json|EVIDENCE_JSON|candidate\.configRevision|ref: main/);
  });
  it('has no image build, registry write, merge, prod deploy or shell-interpolated inputs', () => {
    expect(workflow).not.toMatch(/images:build|docker (build|push)|build-push-action|git (push|merge)|release:deploy|packages: write|id-token: write/);
    expect(workflow).not.toMatch(/run:.*\$\{\{\s*inputs\./);
  });
});

type Finalized = ReturnType<typeof context> & { releaseArtifact: ReturnType<typeof bindStagingArtifact> };
type Chain = { fetcher: (url: string, options: RequestInit) => Promise<Response>; responses: Record<string, unknown>; archives: Record<string, string>; finalized: Finalized };
async function withChain(run: (chain: Chain) => Promise<void>, change?: (release: ReturnType<typeof metadata>, final: ReturnType<typeof metadata>, evidence: Finalized) => void, value = context()) {
  await withArchive(async originalArchive => {
    const release = metadata();
    const final = finalMetadata();
    const sha = value.candidate.sourceSha;
    for (const m of [release, final]) {
      m.run.head_sha = sha;
      m.commit = { sha, tree: { sha: value.candidate.tree } };
      m.artifact.workflow_run.head_sha = sha;
      m.artifact.name = `staging-${m === release ? 'deployment' : 'promotion'}-evidence-${sha}`;
      m.jobs.forEach(job => { job.head_sha = sha; });
    }
    release.artifact.digest = hash(originalArchive);
    release.artifact.size_in_bytes = originalArchive.length;
    const responses: Record<string, unknown> = {};
    const archives: Record<string, string> = { '84': originalArchive.toString('base64') };
    const base = `https://api.github.com/repos/${repository}`;
    const register = (m: ReturnType<typeof metadata>) => {
      responses[`${base}/actions/runs/${m.run.id}`] = m.run;
      responses[`${base}/actions/artifacts/${m.artifact.id}`] = m.artifact;
      responses[`${base}/git/commits/${m.run.head_sha}`] = m.commit;
      responses[`${base}/actions/runs/${m.run.id}/attempts/1/jobs?per_page=100`] = { total_count: m.jobs.length, jobs: m.jobs };
    };
    register(release);
    const fetcher = async (url: string, _options: RequestInit) => {
      if (url === service.endpoint) return Response.json(value.w12);
      const artifact = url.match(/\/artifacts\/(84|85)\/zip$/)?.[1];
      if (artifact) return new Response(null, { status: 302, headers: { location: `https://test.blob.core.windows.net/${artifact}.zip` } });
      const storage = url.match(/^https:\/\/test\.blob\.core\.windows\.net\/(84|85)\.zip$/)?.[1];
      if (storage && archives[storage]) return new Response(Buffer.from(archives[storage], 'base64'));
      if (!responses[url]) throw new Error('unexpected request');
      return Response.json(responses[url]);
    };
    const finalized: Finalized = await finalizeStaging({ ...trusted, sourceSha: sha }, service, fetcher, end);
    change?.(release, final, finalized);
    await withArchive(async finalArchive => {
      final.artifact.digest = hash(finalArchive);
      final.artifact.size_in_bytes = finalArchive.length;
      archives['85'] = finalArchive.toString('base64');
      register(release);
      register(final);
      responses[`${base}/git/ref/heads/main`] = { ref: 'refs/heads/main', object: { type: 'commit', sha: trusted.mainSha } };
      await run({ fetcher, responses, archives, finalized });
    }, { 'evidence.json': JSON.stringify(finalized) });
  }, { 'evidence.json': JSON.stringify(pending(value)) });
}

describe('reachable authenticated post-soak finalization', () => {
  it('finalizes pending deployment from successful first attempt, authenticates both archives before handoff', async () => {
    await withChain(async ({ fetcher, finalized }) => {
      expect(finalized.promotionStatus).toBe('passed');
      const result = await retrieveStagingEvidence(finalSelection, fetcher);
      expect(result.evidence).toEqual(finalized);
      const output = createProductionHandoff(result.evidence, result.binding, current, end);
      expect(output).toMatchObject({ stagingArtifact: { runId: '43', artifactId: '85' }, releaseArtifact: { runId: '42', artifactId: '84' }, rebuild: false, deploy: false });
    });
  });

  it.each(['rerun', 'failed', 'workflow', 'event', 'source', 'missing job', 'skipped job', 'artifact name'])('refuses finalizer %s', async flaw => {
    await withChain(async ({ fetcher }) => {
      await expect(retrieveStagingEvidence(finalSelection, fetcher)).rejects.toThrow();
    }, (_release, final) => {
      if (flaw === 'rerun') final.run.run_attempt = 2;
      if (flaw === 'failed') final.run.conclusion = 'failure';
      if (flaw === 'workflow') final.run.path = '.github/workflows/release-images.yml';
      if (flaw === 'event') final.run.event = 'push';
      if (flaw === 'source') final.run.head_sha = 'e'.repeat(40);
      if (flaw === 'missing job') final.jobs.pop();
      if (flaw === 'skipped job') final.jobs[0].conclusion = 'skipped';
      if (flaw === 'artifact name') final.artifact.name = 'operator-evidence';
    });
  });

  it.each(['failed release', 'release rerun', 'release job', 'expired release', 'chain digest', 'chain repository', 'chain source', 'deployment substitution', 'missing chain'])('rechecks original chain: %s', async flaw => {
    await withChain(async ({ fetcher }) => {
      await expect(retrieveStagingEvidence(finalSelection, fetcher)).rejects.toThrow();
    }, (release, _final, finalized) => {
      if (flaw === 'failed release') release.run.conclusion = 'failure';
      if (flaw === 'release rerun') release.run.run_attempt = 2;
      if (flaw === 'release job') release.jobs[0].conclusion = 'failure';
      if (flaw === 'expired release') release.artifact.expired = true;
      if (flaw === 'chain digest') finalized.releaseArtifact.artifactDigest = hash('wrong');
      if (flaw === 'chain repository') finalized.releaseArtifact.repository = 'other/gones';
      if (flaw === 'chain source') finalized.releaseArtifact.sourceSha = 'e'.repeat(40);
      if (flaw === 'deployment substitution') finalized.staging.migrationExitCode = 1;
      if (flaw === 'missing chain') Reflect.deleteProperty(finalized, 'releaseArtifact');
    });
  });

  it('posts only fixed candidate identity, separates tokens, refuses missing/malformed/stale/failed W12', async () => {
    await withArchive(async archive => {
      const upstream = api(archive);
      const calls: Array<{ url: string; options: RequestInit }> = [];
      const fetcher = async (url: string, options: RequestInit) => {
        calls.push({ url, options });
        return url === service.endpoint ? Response.json(context().w12) : upstream.fetcher(url, options);
      };
      await finalizeStaging({ ...trusted, sourceSha }, service, fetcher, end);
      const request = calls.at(-1)!;
      expect(request.url).toBe(service.endpoint);
      expect(request.options).toMatchObject({ method: 'POST', redirect: 'error', headers: { authorization: 'Bearer evidence-only-token' } });
      expect(request.options.signal).toBeInstanceOf(AbortSignal);
      expect(JSON.parse(request.options.body as string)).toMatchObject({ operation: 'gones-staging-w12-evidence-v1', releaseArtifact: { runId: '42', artifactId: '84' }, ...context().candidate, manifestDigest: context().manifest.manifestDigest, environment: 'staging' });
      expect(calls.filter(call => call.url.startsWith('https://api.github.com/')).every(call => (call.options.headers as Record<string, string>)['authorization'] === 'Bearer test-only-token')).toBe(true);
      for (const response of [() => Response.json({}), () => new Response('{', { headers: { 'content-type': 'application/json' } }), () => new Response(null, { status: 302 }), () => new Response(null, { status: 500 }), () => new Response('x', { headers: { 'content-type': 'application/json', 'content-length': String(17 * 1024 * 1024) } })]) {
        await expect(finalizeStaging({ ...trusted, sourceSha }, service, (url: string, options: RequestInit) => url === service.endpoint ? response() : upstream.fetcher(url, options), end)).rejects.toThrow();
      }
      await expect(finalizeStaging({ ...trusted, sourceSha }, service, fetcher, end + 24 * HOUR + 1)).rejects.toThrow();
      const failed = context().w12;
      failed.segments[0].jobs.lost = 1;
      await expect(finalizeStaging({ ...trusted, sourceSha }, service, (url: string, options: RequestInit) => url === service.endpoint ? Response.json(failed) : upstream.fetcher(url, options), end)).rejects.toThrow();
      await expect(finalizeStaging({ ...trusted, sourceSha: 'e'.repeat(40) }, service, fetcher, end)).rejects.toThrow('finalizer dispatch differs from release source');
    }, { 'evidence.json': JSON.stringify(pending()) });
  });

  it('refuses raw final evidence as candidate, unsafe fixed URLs, missing token before fetching', async () => {
    await withArchive(async archive => {
      await expect(finalizeStaging({ ...trusted, sourceSha }, service, api(archive).fetcher, end)).rejects.toThrow('pending deployment evidence required');
    });
    for (const endpoint of ['http://staging.example.com/v1/w12/evidence', 'https://user:secret@staging.example.com/v1/w12/evidence', 'https://127.0.0.1/v1/w12/evidence', 'https://localhost/v1/w12/evidence', 'https://staging.example.com:444/v1/w12/evidence', 'https://staging.example.com/v1/w12/evidence?q=secret', 'https://staging.example.com/v1/w12/evidence#secret', 'https://staging.example.com/other']) {
      await expect(finalizeStaging({ ...trusted, sourceSha }, { ...service, endpoint }, async () => { throw new Error('must not fetch'); }, end)).rejects.toThrow(/fixed/);
    }
    await expect(finalizeStaging({ ...trusted, sourceSha }, { ...service, token: '' }, async () => { throw new Error('must not fetch'); }, end)).rejects.toThrow('staging evidence token required');
    expect(() => fixedEndpoint('https://staging.internal/v1/w12/evidence')).toThrow();
  });

  it('bounds streamed bodies without content-length and rejects unsafe artifact redirect targets', async () => {
    await expect(boundedBody(new Response(new Uint8Array(5)), 4)).rejects.toThrow('response size exceeds bound');
    await withArchive(async archive => {
      for (const location of ['http://test.blob.core.windows.net/evidence.zip', 'https://user:secret@test.blob.core.windows.net/evidence.zip', 'https://127.0.0.1/evidence.zip', 'https://test.blob.core.windows.net.evil.com/evidence.zip', 'https://test.blob.core.windows.net:444/evidence.zip', 'https://test.blob.core.windows.net/evidence.zip#secret']) {
        const upstream = api(archive);
        await expect(retrieveCandidateEvidence(trusted, (url: string, options: RequestInit) => url.endsWith('/84/zip') ? new Response(null, { status: 302, headers: { location } }) : upstream.fetcher(url, options))).rejects.toThrow('secure GitHub storage download location required');
      }
    });
  });
});

describe('first-attempt finalizer and handoff CLI chain', () => {
  it('writes create-only outputs, redacts external errors, rejects raw JSON/rerun/foreign ref', async () => {
    const root = new URL('..', import.meta.url).pathname;
    const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    const mainSha = git(['rev-parse', 'HEAD']);
    const tree = git(['rev-parse', 'HEAD^{tree}']);
    const now = Date.now() - 60_000;
    await withChain(async ({ responses, archives, finalized }) => {
      const dir = mkdtempSync(join(tmpdir(), 'gones-finalizer-cli-'));
      try {
        responses[`https://api.github.com/repos/${repository}/git/ref/heads/main`] = { ref: 'refs/heads/main', object: { type: 'commit', sha: mainSha } };
        // Keep the deterministic unit fixture at `end`; CLI receives freshly timestamped live measurements.
        const freshW12 = JSON.stringify(finalized.w12).replaceAll(new Date(end).toISOString(), new Date(now).toISOString()).replaceAll(new Date(start).toISOString(), new Date(now - 72 * HOUR).toISOString());
        const bootstrap = `const responses=${JSON.stringify(responses)},archives=${JSON.stringify(archives)}; globalThis.fetch=async(url)=>{ if(url==='${service.endpoint}') return Response.json(${freshW12}); const id=url.match(/\\/artifacts\\/(84|85)\\/zip$/)?.[1]; if(id) return new Response(null,{status:302,headers:{location:'https://test.blob.core.windows.net/'+id+'.zip'}}); const storage=url.match(/^https:\\/\\/test\\.blob\\.core\\.windows\\.net\\/(84|85)\\.zip$/)?.[1]; if(storage) return new Response(Buffer.from(archives[storage],'base64')); if(!responses[url]) throw new Error('sensitive-remote-secret'); return Response.json(responses[url]); };`;
        const env = { ...process.env, GIT_DIR: git(['rev-parse', '--absolute-git-dir']), GIT_WORK_TREE: root, GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/staging', GITHUB_SERVER_URL: 'https://github.com', GITHUB_API_URL: 'https://api.github.com', GITHUB_SHA: mainSha, GITHUB_REPOSITORY: repository, GITHUB_REPOSITORY_ID: '7', GITHUB_RUN_ID: '43', GITHUB_RUN_ATTEMPT: '1', GITHUB_TOKEN: 'test-only-token', CANDIDATE_RUN_ID: '42', CANDIDATE_ARTIFACT_ID: '84', GONES_STAGING_EVIDENCE_URL: service.endpoint, GONES_STAGING_EVIDENCE_TOKEN: service.token, STAGING_RUN_ID: '43', STAGING_ARTIFACT_ID: '85', GONES_PRODUCTION_CONFIG_REVISION: identity.configRevision };
        const execute = (script: string, extra: string[] = [], overrides = {}, preload = bootstrap) => spawnSync(process.execPath, ['--import', `data:text/javascript;base64,${Buffer.from(preload).toString('base64')}`, join(root, `scripts/${script}.mjs`), ...extra], { cwd: dir, env: { ...env, ...overrides }, encoding: 'utf8' });
        const deployed = context(tree, mainSha);
        const manifestPath = join(dir, 'manifest.json');
        writeFileSync(manifestPath, JSON.stringify({ registry: deployed.manifest }));
        const deployEnv = { GONES_STAGING_DEPLOY_URL: 'https://staging.example.com/v1/deploy', GONES_STAGING_DEPLOY_TOKEN: 'deploy-only-token' };
        const deployArgs = [`--manifest=${manifestPath}`];
        const deployPreload = `globalThis.fetch=async(url,options)=>{ if(url!=='https://staging.example.com/v1/deploy'||options.redirect!=='error'||!(options.signal instanceof AbortSignal)||options.headers.authorization!=='Bearer deploy-only-token') throw new Error('unsafe request'); return Response.json(${JSON.stringify(deployed.staging)}); };`;
        const invalidStaging = { ...deployed.staging, migrationExitCode: 1 };
        expect(execute('deploy-staging', deployArgs, deployEnv, `globalThis.fetch=async()=>Response.json(${JSON.stringify(invalidStaging)});`).status).toBe(1);
        expect(existsSync(join(dir, 'reports/staging/evidence.json'))).toBe(false);
        const deployment = execute('deploy-staging', deployArgs, deployEnv, deployPreload);
        expect(deployment.status, deployment.stderr).toBe(0);
        const deploymentPath = join(dir, 'reports/staging/evidence.json');
        const deploymentOutput = readFileSync(deploymentPath, 'utf8');
        expect(JSON.parse(deploymentOutput)).toEqual(pending(deployed));
        expect(execute('deploy-staging', deployArgs, deployEnv, deployPreload).status).toBe(1);
        expect(readFileSync(deploymentPath, 'utf8')).toBe(deploymentOutput);
        for (const overrides of [{ GITHUB_RUN_ATTEMPT: '2' }, { GITHUB_REF: 'refs/heads/main' }]) expect(execute('finalize-staging', [], overrides).status).toBe(1);
        expect(execute('finalize-staging', ['--evidence={}']).status).toBe(1);
        expect(existsSync(join(dir, 'reports/staging-finalized/evidence.json'))).toBe(false);
        const rejected = execute('finalize-staging', [], {}, "globalThis.fetch=async()=>{ throw new Error('https://secret.example/?token=secret'); };");
        expect(rejected.stderr).toBe('Staging finalization refused: GitHub identity, deployment or live W12 evidence failed validation.\n');
        const result = execute('finalize-staging');
        expect(result.status, result.stderr).toBe(0);
        const outputPath = join(dir, 'reports/staging-finalized/evidence.json');
        const output = readFileSync(outputPath, 'utf8');
        expect(JSON.parse(output)).toMatchObject({ promotionStatus: 'passed', releaseArtifact: { runId: '42', artifactId: '84' } });
        expect(execute('finalize-staging').status).toBe(1);
        expect(readFileSync(outputPath, 'utf8')).toBe(output);
        await withArchive(async archive => {
          const final = responses[`https://api.github.com/repos/${repository}/actions/artifacts/85`] as ReturnType<typeof metadata>['artifact'];
          final.digest = hash(archive);
          final.size_in_bytes = archive.length;
          const promotionBootstrap = bootstrap.replace(JSON.stringify(archives), JSON.stringify({ ...archives, '85': archive.toString('base64') })).replace(/const responses=.*?,archives=/, `const responses=${JSON.stringify(responses)},archives=`);
          const mainEnv = { GITHUB_REF: 'refs/heads/main', GITHUB_RUN_ID: '90' };
          expect(execute('production-handoff', ['--evidence={}'], mainEnv, promotionBootstrap).status).toBe(1);
          const promoted = execute('production-handoff', [], mainEnv, promotionBootstrap);
          expect(promoted.status, promoted.stderr).toBe(0);
          expect(JSON.parse(promoted.stdout)).toMatchObject({ status: 'verified-handoff-only', rebuild: false, deploy: false });
          const handoffPath = join(dir, 'reports/production/handoff.json');
          const handoff = readFileSync(handoffPath, 'utf8');
          expect(JSON.parse(handoff)).toMatchObject({ main: { sourceSha: mainSha, tree }, releaseArtifact: { runId: '42' }, stagingArtifact: { runId: '43' } });
          const duplicate = execute('production-handoff', [], mainEnv, promotionBootstrap);
          expect(duplicate.status).toBe(1);
          expect(duplicate.stderr).toBe('Production handoff refused: GitHub identity, artifact, main/config or promotion evidence failed validation.\n');
          expect(readFileSync(handoffPath, 'utf8')).toBe(handoff);
        }, { 'evidence.json': output });
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }, undefined, context(tree, mainSha));
  });
});

describe('manual post-soak finalizer workflow boundary', () => {
  const workflow = readFileSync(new URL('../.github/workflows/finalize-staging.yml', import.meta.url), 'utf8');
  it('accepts IDs only, pins staging dispatch, shares deploy serialization, runs read-only first attempt', () => {
    for (const required of ['candidate_run_id:', 'candidate_artifact_id:', 'actions: read', 'contents: read', 'environment: staging', "github.ref == 'refs/heads/staging' && github.run_attempt == 1", 'ref: ${{ github.sha }}', 'persist-credentials: false', 'group: gones-staging-staging', 'cancel-in-progress: false', 'GONES_STAGING_EVIDENCE_URL: ${{ secrets.GONES_STAGING_EVIDENCE_URL }}', 'GONES_STAGING_EVIDENCE_TOKEN: ${{ secrets.GONES_STAGING_EVIDENCE_TOKEN }}', 'node scripts/finalize-staging.mjs', 'staging-promotion-evidence-${{ github.sha }}', 'if-no-files-found: error']) expect(workflow).toContain(required);
    expect(workflow).not.toMatch(/evidence_json|EVIDENCE_JSON|if: always|images:build|docker (build|push)|build-push-action|git (push|merge)|release:deploy|packages: write|id-token: write|run:.*\$\{\{\s*inputs\./);
  });
});
