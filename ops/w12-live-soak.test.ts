// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
// @ts-expect-error - release tooling is plain ESM.
import { startCapture, resumeCapture, finalizeCapture, evaluateW12 } from '../scripts/w12-live-soak.mjs';
import { cost, end, evidence, HOUR, identity, input, segment, start } from './fixtures/w12-evidence';

const evaluate = (value: unknown, now = end) => evaluateW12(value, identity, now);

describe('W12 live soak evidence contract', () => {
  it('accepts exactly 72 continuous measured hours; recomputes cost and quota reserve', () => {
    const result = evaluate(evidence());
    expect(result).toMatchObject({ ok: true, findings: [], cost: { totalEur: 9.5, baselineTotalEur: 29.5, projectedCuHours: 18.6, reserveCuHours: 81.4 } });
  });

  it.each([null, {}, { ...evidence(), extra: 'forbidden' }, { ...evidence(), version: '1' }])('rejects malformed or unknown schema fields', (value) => {
    expect(evaluate(value).ok).toBe(false);
  });

  it.each(['sourceSha', 'tree', 'configRevision', 'manifestDigest', 'environment', 'workloadDigest'] as const)('binds %s across report, segments and costs', (key) => {
    for (const location of ['root', 'segment', 'cost'] as const) {
      const value = evidence();
      const target = location === 'root' ? value.identity : location === 'segment' ? value.segments[0].identity : value.cost.identity;
      target[key] = key === 'environment' ? 'production' : 'f'.repeat(64);
      expect(evaluate(value).ok).toBe(false);
    }
  });

  it.each(['synthetic', 'local-only', 'fake-provider'])('rejects %s origin at every measurement boundary', (origin) => {
    for (const location of ['segment', 'cost', 'baseline']) {
      const value = evidence();
      if (location === 'segment') value.segments[0].origin = origin;
      if (location === 'cost') value.cost.origin = origin;
      if (location === 'baseline') value.cost.baseline.origin = origin;
      expect(evaluate(value).ok).toBe(false);
    }
  });

  it.each(['lost', 'duplicates', 'deadlineMisses', 'failures'] as const)('rejects job %s', (key) => {
    const value = evidence(); value.segments[0].jobs[key] = 1;
    expect(evaluate(value).ok).toBe(false);
  });

  it('rejects lost completion, late immediate/recovery work, duplicate or uncertain provider effects', () => {
    const variants = [evidence(), evidence(), evidence(), evidence(), evidence(), evidence(), evidence()];
    variants[6].segments[0].jobs.maxImmediateLatencyMs = 5001;
    variants[6].segments[0].jobs.maxDbColdStartMs = 10_000;
    variants[0].segments[0].jobs.completed--;
    variants[1].segments[0].jobs.maxImmediateLatencyMs = 6001;
    variants[2].segments[0].jobs.maxRecoveryLatencyMs++;
    variants[3].segments[0].providerEffects.duplicates++;
    variants[4].segments[0].providerEffects.unresolved++;
    variants[5].segments[0].providerEffects.observed--;
    for (const value of variants) expect(evaluate(value).ok).toBe(false);
  });

  it('rejects missing workload/job coverage, unmeasured DB suspension, impossible compute', () => {
    const variants = [evidence(), evidence(), evidence(), evidence()];
    variants[0].segments[0].workloadClasses.pop(); variants[1].segments[0].jobClasses.pop();
    variants[2].segments[0].db.suspensions = 0; variants[3].segments[0].db.cuHours = 99;
    for (const value of variants) expect(evaluate(value).ok).toBe(false);
  });

  it('rejects short, future, stale, gapped, overlapping or duplicated intervals', () => {
    const variants = [evidence(), evidence(), evidence(), evidence()];
    variants[0].endedAt = new Date(end - 1).toISOString();
    variants[1].segments = [segment(start, start + HOUR), segment(start + HOUR + 1, end)];
    variants[2].segments = [segment(start, start + HOUR), segment(start + HOUR - 1, end)];
    variants[3].segments.push(segment());
    for (const value of variants) expect(evaluate(value).ok).toBe(false);
    expect(evaluate(evidence(), end - 1).ok).toBe(false);
    expect(evaluate(evidence(), end + 24 * HOUR).ok).toBe(true);
    expect(evaluate(evidence(), end + 24 * HOUR + 1).ok).toBe(false);
    expect(evaluate(evidence(), NaN).ok).toBe(false);
  });

  it('requires lower combined taxed/shared-host cost, equivalent baseline, reserve and ceiling', () => {
    const variants = [evidence(), evidence(), evidence(), evidence(), evidence(), evidence(), evidence()];
    variants[0].cost.monthlyCosts.dbEur = 20;
    variants[1].cost.monthlyCosts.taxEur = 50;
    variants[2].cost.baseline.workloadDigest = `sha256:${'f'.repeat(64)}`;
    variants[3].cost.monthlyOtherCuHours = 62;
    variants[4].cost.paidAutoUpgrade = true;
    variants[5].cost.baseline.activeHours = 71;
    variants[6].cost.baseline.computeUnits = 0.5;
    for (const value of variants) expect(evaluate(value).ok).toBe(false);
    const boundary = evidence(); boundary.cost.monthlyOtherCuHours = 61.4;
    expect(evaluate(boundary).cost.reserveCuHours).toBe(20);
    expect(evaluate(boundary).ok).toBe(true);
  });

  it('rejects negative, nonfinite, coerced and missing cost fields without echoing data', () => {
    for (const invalid of [-1, NaN, Infinity, '0', undefined]) {
      const value = evidence(); Object.assign(value.cost.monthlyCosts, { taxEur: invalid });
      expect(evaluate(value).ok).toBe(false);
    }
    const value = evidence(); Object.assign(value.cost, { secret: 'sensitive-marker' });
    expect(JSON.stringify(evaluate(value))).not.toContain('sensitive-marker');
  });

  it('starts/resumes/finalizes without extending original deadline or accepting stale identity', () => {
    const state = startCapture(input(), start);
    expect(state.endsAt).toBe(new Date(end).toISOString());
    const next = resumeCapture(state, segment(start, start + HOUR), start + HOUR);
    const finished = resumeCapture(next, segment(start + HOUR, end), end);
    expect(evaluate(finalizeCapture(finished, cost(), end)).ok).toBe(true);
    expect(state.segments).toEqual([]);
    expect(() => startCapture({ ...input(), durationHours: 71 }, start)).toThrow();
    expect(() => resumeCapture(next, segment(start, end), end)).toThrow();
    expect(() => resumeCapture(state, segment(), end - 1)).toThrow();
    expect(() => finalizeCapture(next, cost(), end)).toThrow();
    const wrong = segment(); wrong.identity.tree = 'e'.repeat(40);
    expect(() => resumeCapture(state, wrong, end)).toThrow();
    expect(() => resumeCapture(state, segment(start, end + 1), end + 1)).toThrow();
  });
});

const scratch: string[] = [];
afterEach(() => { for (const path of scratch.splice(0)) rmSync(path, { recursive: true }); });
function workspace() {
  mkdirSync('.tmp', { recursive: true });
  const path = mkdtempSync(resolve('.tmp/w12-test-')); scratch.push(path); return path;
}
function cli(...args: string[]) {
  return spawnSync(process.execPath, ['scripts/w12-live-soak.mjs', ...args], { encoding: 'utf8' });
}
function json(path: string, value: unknown) { writeFileSync(path, JSON.stringify(value)); }

describe('W12 opt-in file-only CLI', () => {
  it('rejects missing nested fields and unknown nested payloads', () => {
    const variants = [evidence(), evidence(), evidence()];
    Reflect.deleteProperty(variants[0].cost.monthlyCosts, 'taxEur');
    Reflect.deleteProperty(variants[1].segments[0].providerEffects, 'observed');
    Object.assign(variants[2].segments[0].jobs, { body: 'private-marker' });
    for (const value of variants) {
      expect(evaluate(value).ok).toBe(false);
      expect(JSON.stringify(evaluate(value))).not.toContain('private-marker');
    }
  });

  it('rejects symlink, oversized, malformed input; rejects unsafe output aliases', () => {
    const dir = workspace(); json(`${dir}/input.json`, input());
    symlinkSync(`${dir}/input.json`, `${dir}/link.json`);
    expect(cli('start', '--live', `--input=${dir}/link.json`, `--out=${dir}/out.json`).status).toBe(2);
    expect(cli('start', '--live', `--input=${dir}/input.json`, `--out=${dir}/link.json`).status).toBe(2);
    expect(JSON.parse(readFileSync(`${dir}/input.json`, 'utf8'))).toEqual(input());
    writeFileSync(`${dir}/large.json`, ''); truncateSync(`${dir}/large.json`, 16 * 1024 * 1024 + 1);
    expect(cli('start', '--live', `--input=${dir}/large.json`, `--out=${dir}/out.json`).status).toBe(2);
    writeFileSync(`${dir}/bad.json`, '{ private-marker');
    const refused = cli('start', '--live', `--input=${dir}/bad.json`, `--out=${dir}/out.json`);
    expect(refused.status).toBe(2); expect(refused.stderr).not.toContain('private-marker');
  });

  it('documents exact operator flow and explicitly refuses local live-proof claims', () => {
    const docs = readFileSync('docs/W12_LIVE_SOAK.md', 'utf8');
    for (const command of ['start --live', 'resume --live', 'finalize --live', 'release:promotion-check']) expect(docs).toContain(command);
    expect(docs).toContain('Repo tests cannot prove provider suspension');
    expect(docs).toContain('not verification of provider signatures');
    expect(docs).toContain('intentionally fail closed');
    expect(docs).toContain('external prerequisite');
    expect(JSON.parse(readFileSync('package.json', 'utf8')).scripts['release:w12']).toBe('node scripts/w12-live-soak.mjs');
  });

  it('requires explicit opt-in, refuses overwrite, persists private resumable state', () => {
    const dir = workspace(); json(`${dir}/input.json`, input());
    expect(cli('start', `--input=${dir}/input.json`, `--out=${dir}/state.json`).status).toBe(2);
    expect(cli('start', '--live', `--input=${dir}/input.json`, `--out=${dir}/state.json`).status).toBe(0);
    expect(statSync(`${dir}/state.json`).mode & 0o777).toBe(0o600);
    const before = readFileSync(`${dir}/state.json`, 'utf8');
    expect(cli('start', '--live', `--input=${dir}/input.json`, `--out=${dir}/state.json`).status).toBe(2);
    expect(readFileSync(`${dir}/state.json`, 'utf8')).toBe(before);
    expect(cli('start', '--live', '--now=2020', `--input=${dir}/input.json`, `--out=${dir}/other.json`).status).toBe(2);
  });

  it('resumes real CLI from externally timestamped state; finalizes evidence consumed by promotion', () => {
    const dir = workspace(); const now = Date.now(); const began = now - 72 * HOUR;
    const state = startCapture(input(), began);
    const measured = segment(began, now);
    const costs = cost(); costs.startedAt = state.startedAt; costs.endedAt = new Date(now).toISOString();
    json(`${dir}/state.json`, state); json(`${dir}/segment.json`, measured); json(`${dir}/cost.json`, costs);
    expect(cli('resume', '--live', `--state=${dir}/state.json`, `--input=${dir}/segment.json`, `--out=${dir}/next.json`).status).toBe(0);
    const finalized = cli('finalize', '--live', `--state=${dir}/next.json`, `--input=${dir}/cost.json`, `--out=${dir}/report.json`);
    expect(finalized.stderr).toBe(''); expect(finalized.status).toBe(0);
    expect(evaluateW12(JSON.parse(readFileSync(`${dir}/report.json`, 'utf8')), identity).ok).toBe(true);
    const candidate = { sourceSha: identity.sourceSha, tree: identity.tree, configRevision: identity.configRevision };
    const deployment = {
      candidate,
      manifest: { ...candidate, manifestDigest: identity.manifestDigest, images: ['api', 'worker', 'migrator', 'backup', 'frontend'].map((name) => ({ name, digest: `sha256:${'e'.repeat(64)}`, signed: true, provenance: true, sbom: true, critical: 0 })) },
      staging: { ...candidate, manifestDigest: identity.manifestDigest, status: 'passed', migrationExitCode: 0, deploymentsActive: 0, serialized: true },
      target: { ...candidate, manifestDigest: identity.manifestDigest, rebuild: false, changed: false }
    };
    json(`${dir}/deployment.json`, deployment);
    const promotion = (...args: string[]) => spawnSync(process.execPath, ['scripts/promotion-check.mjs', `--evidence=${dir}/deployment.json`, ...args], { encoding: 'utf8' });
    expect(promotion().status).toBe(1);
    expect(promotion(`--w12=${dir}/report.json`).status).toBe(0);
    json(`${dir}/failed-report.json`, { ...JSON.parse(readFileSync(`${dir}/report.json`, 'utf8')), status: 'passed' });
    expect(promotion(`--w12=${dir}/failed-report.json`).status).toBe(1);
    json(`${dir}/bad.json`, { password: 'private-marker' });
    const refused = cli('start', '--live', `--input=${dir}/bad.json`, `--out=${dir}/bad-out.json`);
    expect(refused.status).toBe(2); expect(refused.stderr).not.toContain('private-marker');
  });
});
