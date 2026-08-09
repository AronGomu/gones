import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `npm run e2e:ci` — the only Cypress gate any CI workflow runs (`.github/workflows/static.yml`) —
 * drives `scripts/full-stack-ci.mjs`, which names every spec by hand so it can order them around
 * the seed steps. A hand-written list silently loses specs: `auth-session-persistence.cy.js` was
 * unwired until T25b and `first-visit.cy.js` until T27, and in both cases nothing went red, because
 * a spec that is never executed cannot fail.
 *
 * This test is the standing guard for that class of hole: the set of spec files on disk and the set
 * of spec paths the gate runs must be identical. Adding a spec without wiring it fails here.
 */
const repoRoot = join(__dirname, '..');
const specDir = join(repoRoot, 'cypress', 'e2e');
const gateScript = join(repoRoot, 'scripts', 'full-stack-ci.mjs');

function specsOnDisk(): string[] {
  return readdirSync(specDir)
    .filter(entry => entry.endsWith('.cy.js'))
    .map(entry => `cypress/e2e/${entry}`)
    .sort();
}

function specsRunByGate(): string[] {
  const source = readFileSync(gateScript, 'utf8');
  const pattern = /runCypress\(\s*'(cypress\/e2e\/[^']+\.cy\.js)'\s*\)/g;
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) found.add(match[1]);
  return [...found].sort();
}

describe('e2e spec coverage', () => {
  it('runs every spec that exists on disk', () => {
    expect(specsRunByGate()).toEqual(specsOnDisk());
  });

  it('finds specs to check, so an empty scan can never read as green', () => {
    expect(specsOnDisk().length).toBeGreaterThan(0);
    expect(specsRunByGate().length).toBe(specsOnDisk().length);
  });
});
