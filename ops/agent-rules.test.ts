import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'node:fs';

const root = process.cwd();
const agent = readFileSync(join(root, 'AGENT.md'), 'utf8');

function newestAdrIds(count: number): string[] {
  return globSync('docs/adr/[0-9][0-9][0-9][0-9]-*.md', { cwd: root })
    .map((file) => file.slice('docs/adr/'.length, 'docs/adr/'.length + 4))
    .sort()
    .slice(-count);
}

describe('agent-rules', () => {
  it('states the cache rule', () => {
    expect(agent).toMatch(/24.hour|24h|CATALOG_TTL_MS/i);
    expect(agent).toMatch(/gones-sync-bar/);
    expect(agent).toMatch(/catalog-cache/);
    expect(agent).toMatch(/ServerReadCacheService/);
  });

  it('states the back button rule', () => {
    expect(agent).toMatch(/top.*bottom|bottom.*top/i);
    expect(agent).toMatch(/auth.*exception|exception.*auth/i);
    expect(agent).toMatch(/back-button-coverage\.test\.ts/);
  });

  it('states the logout rule', () => {
    expect(agent).toMatch(/returnUrl/);
    expect(agent).toMatch(/\/login/);
  });

  it('names the four newest ADRs on disk', () => {
    for (const num of newestAdrIds(4)) {
      expect(agent, `AGENT.md must mention ADR ${num}`).toMatch(new RegExp(num));
    }
  });

  it('the four newest ADR files exist and are Accepted', () => {
    const adrs = newestAdrIds(4);
    expect(adrs, 'docs/adr/ must hold at least four numbered ADRs').toHaveLength(4);
    for (const num of adrs) {
      const matches = globSync(`docs/adr/${num}-*.md`, { cwd: root });
      expect(matches.length, `ADR ${num} must exist`).toBeGreaterThan(0);
      const content = readFileSync(join(root, matches[0]), 'utf8');
      expect(content, `ADR ${num} must have a ## Status section`).toMatch(/^## Status/m);
      expect(content, `ADR ${num} must be Accepted`).toMatch(/Accepted/);
    }
  });

  it('ADR 0038 supersedes the redirect clause', () => {
    const matches = globSync('docs/adr/0038-*.md', { cwd: root });
    expect(matches.length).toBeGreaterThan(0);
    const content = readFileSync(join(root, matches[0]), 'utf8');
    expect(content).toMatch(/ADR 0035/);
    expect(content).toMatch(/supersede/i);
  });

  it('no doc still routes to /calendar (outside historical notes)', () => {
    const files = globSync('docs/**/*.{md,html}', { cwd: root }).filter(
      (f) =>
        !f.startsWith('docs/adr/') &&
        f !== 'docs/event-vocabulary-rename.html',
    );
    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(join(root, file), 'utf8');
      // Match /calendar as a route but not /calendar-ics, /calendar-events, or calendar as a word
      if (/`\/calendar`|"\/calendar"|\/calendar[^-\w]/.test(content)) {
        violations.push(file);
      }
    }
    expect(violations, `Files still routing to /calendar: ${violations.join(', ')}`).toEqual([]);
  });
});
