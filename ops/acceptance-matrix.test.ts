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

  it('maps integrated Event publication to every executable lifecycle target', () => {
    const row = result.matrix.rows.find((candidate: { id: string }) => candidate.id === 'doc00-tournaments');
    expect(row?.acceptance).toContain('product-organizer-lifecycle');
    expect(row?.evidence.map((item: { target: string }) => item.target)).toEqual(expect.arrayContaining([
      'backend/tests/Gones.IntegrationTests/EventPublicationApiTests.cs',
      'backend/tests/Gones.IntegrationTests/EventLifecycleApiTests.cs',
      'backend/tests/Gones.IntegrationTests/EventProposalTests.cs',
      'backend/tests/Gones.IntegrationTests/EventProposalDecisionTests.cs',
      'cypress/e2e/organizer-event-create.cy.js',
      'cypress/e2e/organizer-event-management.cy.js',
      'cypress/e2e/event-proposal.cy.js'
    ]));
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
      // The matrix stores plain ASCII arrows; the plan uses the same text, optionally followed by the
      // parenthetical naming the executable gate that ticked the box (C44).
      expect(planRows.some((row) => row.replaceAll('→', '->').startsWith(entry.text))).toBe(true);
    }
  });

  it('never lets a final acceptance box be ticked without naming its gate', () => {
    const plan = readFileSync('GONES_CALENDAR_V1_IMPLEMENTATION_PLAN.md', 'utf8');
    const section = plan.slice(plan.indexOf('## 5. Final V1 acceptance checklist'));
    const ticked = [...section.matchAll(/^- \[x\] (.+)$/gm)].map((match) => match[1].trim());
    const provedTexts: string[] = result.matrix.acceptanceChecklist
      .filter((entry: { status: string }) => entry.status === 'proved')
      .map((entry: { text: string }) => entry.text);

    for (const row of ticked) {
      // A ticked box must cite a runnable gate, and the matrix must agree it is proved.
      expect(row).toMatch(/\(`?npm run [\w:-]+/);
      expect(provedTexts.some((text) => row.replaceAll('→', '->').startsWith(text))).toBe(true);
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
