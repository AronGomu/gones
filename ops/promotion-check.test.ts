import { describe, expect, it } from 'vitest';
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
  current?: { tree: string; configRevision: string };
};

function baseline(): PromotionFixture {
  return {
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
  it('accepts matching signed staging evidence', () => {
    expect(evaluatePromotion(baseline())).toEqual({ ok: true, findings: [] });
  });

  it('rejects changed candidate source or config', () => {
    const context = baseline();
    context.target.sourceSha = 'e'.repeat(40);
    context.target.changed = true;
    context.manifest.configRevision = 'f'.repeat(64);
    expect((evaluatePromotion(context) as { findings: Finding[] }).findings.map((finding: Finding) => finding.check)).toEqual(expect.arrayContaining(['config', 'immutable']));
  });

  it('blocks failed migration before rollout', () => {
    const context = baseline();
    context.staging.migrationExitCode = 1;
    expect((evaluatePromotion(context) as { findings: Finding[] }).findings.some((finding: Finding) => finding.check === 'migration')).toBe(true);
  });

  it('rejects concurrent staging deployment', () => {
    const context = baseline();
    context.staging.deploymentsActive = 2;
    context.staging.serialized = false;
    expect((evaluatePromotion(context) as { findings: Finding[] }).findings.map((finding: Finding) => finding.check)).toEqual(expect.arrayContaining(['serialization']));
  });

  it('requires every artifact signature and immutable digest', () => {
    const context = baseline();
    context.manifest.images[0]['signed'] = false;
    context.manifest.images[1]['digest'] = 'latest';
    expect((evaluatePromotion(context) as { findings: Finding[] }).findings.map((finding: Finding) => finding.check)).toEqual(expect.arrayContaining(['signature', 'provenance']));
  });

  it('rejects a main tree or config revision that differs from staging', () => {
    const context = baseline();
    context.current = { tree: 'f'.repeat(40), configRevision };
    expect((evaluatePromotion(context) as { findings: Finding[] }).findings.map((finding: Finding) => finding.check)).toContain('source');
    context.current = { tree, configRevision: 'f'.repeat(64) };
    expect((evaluatePromotion(context) as { findings: Finding[] }).findings.map((finding: Finding) => finding.check)).toContain('config');
  });
});
