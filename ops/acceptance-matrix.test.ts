import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error - the acceptance matrix validator is a plain ESM script shared with the CLI.
import { evaluateMatrix, docFiles, docsRoot, matrixPath } from '../scripts/acceptance-matrix.mjs';

/**
 * The acceptance matrix is only worth something if it cannot be ticked by hand. This keeps the
 * validator inside `npm run test`, so a row that loses its evidence — or a Cypress spec that quietly
 * drops out of `scripts/full-stack-ci.mjs` — fails the normal test gate rather than a manual review.
 */
describe('V1 acceptance matrix', () => {
  const result = evaluateMatrix(process.cwd());

  it('resolves every non-deferred row to evidence that actually runs', () => {
    expect(result.errors).toEqual([]);
  });

  it('proves 100% of the non-deferred capability rows', () => {
    expect(result.totals.proved).toBe(result.totals.nonDeferred);
    expect(result.totals.nonDeferred).toBeGreaterThan(50);
  });

  it('covers every V1 architecture document', () => {
    const covered = new Set(result.matrix.rows.map((row: { doc: string }) => row.doc));
    expect([...covered].sort()).toEqual([...docFiles].sort());
  });

  it('keeps the checklist aligned with the implementation plan', () => {
    const plan = readFileSync('GONES_CALENDAR_V1_IMPLEMENTATION_PLAN.md', 'utf8');
    const section = plan.slice(plan.indexOf('## 5. Final V1 acceptance checklist'));
    const planRows = [...section.matchAll(/^- \[[ x]\] (.+)$/gm)].map((match) => match[1].trim());
    expect(planRows).toHaveLength(result.matrix.acceptanceChecklist.length);
    for (const entry of result.matrix.acceptanceChecklist) {
      // The matrix stores plain ASCII arrows; the plan uses the same text.
      expect(planRows.some((row) => row.replaceAll('→', '->') === entry.text)).toBe(true);
    }
  });

  it('never lets a deferred row masquerade as proved', () => {
    for (const row of result.matrix.rows) {
      if (row.status === 'deferred') expect(row.deferredReason.length).toBeGreaterThan(20);
    }
    for (const entry of result.matrix.acceptanceChecklist) {
      if (entry.status !== 'proved') expect(entry.reason.length).toBeGreaterThan(20);
    }
  });

  it('points every row at a document that exists', () => {
    for (const file of docFiles) expect(() => readFileSync(`${docsRoot}/${file}`, 'utf8')).not.toThrow();
    expect(() => readFileSync(matrixPath, 'utf8')).not.toThrow();
  });
});
