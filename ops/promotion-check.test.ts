// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { evidence, end, HOUR } from './fixtures/w12-evidence';
// @ts-expect-error - promotion gate is a plain ESM script shared with CI.
import { evaluatePromotion, PROMOTION_ARTIFACTS } from '../scripts/promotion-check.mjs';

const sha = 'a'.repeat(40);
const tree = 'b'.repeat(40);
const configRevision = 'c'.repeat(64);
const manifestDigest = `sha256:${'d'.repeat(64)}`;
type Finding = { check: string; message: string };
type PromotionFixture = {
  candidate: { sourceSha: string; tree: string; configRevision: string };
  manifest: { sourceSha: string; tree: string; configRevision: string; manifestDigest: string; images: Array<Record<string, unknown>> };
  staging: { sourceSha: string; tree: string; configRevision: string; manifestDigest: string; status: string; migrationExitCode: number; deploymentsActive: number; serialized: boolean };
  target: { sourceSha: string; tree: string; configRevision: string; manifestDigest: string; rebuild: boolean; changed: boolean };
  w12?: ReturnType<typeof evidence>;
  current?: { tree: string; configRevision: string };
};

function baseline(): PromotionFixture {
  return {
    w12: evidence(),
    candidate: { sourceSha: sha, tree, configRevision },
    manifest: {
      sourceSha: sha,
      tree,
      configRevision,
      manifestDigest,
      images: PROMOTION_ARTIFACTS.map((name: string) => ({
        name,
        digest: `sha256:${'e'.repeat(64)}`,
        signed: true,
        provenance: true,
        sbom: true,
        critical: 0
      }))
    },
    staging: {
      sourceSha: sha,
      tree,
      configRevision,
      manifestDigest,
      status: 'passed',
      migrationExitCode: 0,
      deploymentsActive: 0,
      serialized: true
    },
    target: { sourceSha: sha, tree, configRevision, manifestDigest, rebuild: false, changed: false }
  };
}

describe('immutable promotion gate', () => {
  it('rejects absent, stale, mismatched, short, failed or non-live W12 evidence', () => {
    const variants = [baseline(), baseline(), baseline(), baseline(), baseline(), baseline()];
    delete variants[0].w12;
    variants[1].w12!.identity.tree = 'f'.repeat(40);
    variants[2].w12!.endedAt = new Date(end - HOUR).toISOString();
    variants[3].w12!.segments[0].jobs.lost = 1;
    variants[4].w12!.segments[0].origin = 'synthetic';
    variants[5].w12!.segments[0].origin = 'local-only';
    for (const context of variants) {
      expect(evaluatePromotion(context, end)).toMatchObject({ ok: false, findings: expect.arrayContaining([expect.objectContaining({ check: 'w12' })]) });
    }
    expect(evaluatePromotion(baseline(), end + 24 * HOUR + 1).ok).toBe(false);
  });

  it('accepts matching signed staging evidence', () => {
    expect(evaluatePromotion(baseline(), end)).toEqual({ ok: true, findings: [] });
  });

  it('rejects changed candidate source or config', () => {
    const context = baseline();
    context.target.sourceSha = 'e'.repeat(40);
    context.target.changed = true;
    context.manifest.configRevision = 'f'.repeat(64);
    expect((evaluatePromotion(context, end) as { findings: Finding[] }).findings.map((finding: Finding) => finding.check)).toEqual(expect.arrayContaining(['config', 'immutable']));
  });

  it('blocks failed migration before rollout', () => {
    const context = baseline();
    context.staging.migrationExitCode = 1;
    expect((evaluatePromotion(context, end) as { findings: Finding[] }).findings.some((finding: Finding) => finding.check === 'migration')).toBe(true);
  });

  it('rejects concurrent staging deployment', () => {
    const context = baseline();
    context.staging.deploymentsActive = 2;
    context.staging.serialized = false;
    expect((evaluatePromotion(context, end) as { findings: Finding[] }).findings.map((finding: Finding) => finding.check)).toEqual(expect.arrayContaining(['serialization']));
  });

  it('requires every artifact signature and immutable digest', () => {
    const context = baseline();
    context.manifest.images[0]['signed'] = false;
    context.manifest.images[1]['digest'] = 'latest';
    expect((evaluatePromotion(context, end) as { findings: Finding[] }).findings.map((finding: Finding) => finding.check)).toEqual(expect.arrayContaining(['signature', 'provenance']));
  });

  it('rejects a main tree or config revision that differs from staging', () => {
    const context = baseline();
    context.current = { tree: 'f'.repeat(40), configRevision };
    expect((evaluatePromotion(context, end) as { findings: Finding[] }).findings.map((finding: Finding) => finding.check)).toContain('source');
    context.current = { tree, configRevision: 'f'.repeat(64) };
    expect((evaluatePromotion(context, end) as { findings: Finding[] }).findings.map((finding: Finding) => finding.check)).toContain('config');
  });
});
