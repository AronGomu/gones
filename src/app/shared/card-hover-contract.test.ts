import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const stylesheet = readFileSync(join(__dirname, '..', '..', 'styles.css'), 'utf8');
const cardSelectors = [
  'mat-card',
  '.home-destination',
  '.league-card',
  '.tournament-rect-card',
  '.running-tournament-card',
  '.public-tournament-card',
  '.registration-card',
  '.organization-card',
  '.live-registration-player-card',
  '.live-round-card',
  '.match-card',
  '.about-event',
  '.about-person',
  '.about-contributor'
];

function ruleContaining(marker: string): string {
  const markerIndex = stylesheet.indexOf(marker);
  expect(markerIndex, `CSS marker ${marker}`).toBeGreaterThan(-1);
  const ruleStart = stylesheet.lastIndexOf('}', markerIndex) + 1;
  const ruleEnd = stylesheet.indexOf('}', markerIndex);
  return stylesheet.slice(ruleStart, ruleEnd + 1);
}

function blockStarting(marker: string): string {
  const start = stylesheet.indexOf(marker);
  expect(start, `CSS block ${marker}`).toBeGreaterThan(-1);
  const open = stylesheet.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < stylesheet.length; index++) {
    if (stylesheet[index] === '{') depth++;
    else if (stylesheet[index] === '}' && --depth === 0) return stylesheet.slice(start, index + 1);
  }
  throw new Error(`unbalanced CSS block ${marker}`);
}

describe('shared card hover contract', () => {
  it('covers Material cards and every custom card family', () => {
    const rule = ruleContaining('/* shared-card-feedback */');
    for (const selector of cardSelectors) expect(rule).toContain(selector);
    expect(rule).toContain('transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease');
  });

  it('shared hover never sets pointer cursor', () => {
    const baseRule = ruleContaining('/* shared-card-feedback */');
    const hoverRule = ruleContaining('/* shared-card-feedback-hover */');
    expect(baseRule).not.toMatch(/cursor\s*:/);
    expect(hoverRule).not.toMatch(/cursor\s*:/);
  });

  it('fine-pointer hover lifts and shadows', () => {
    const mediaBlock = blockStarting('@media (hover: hover) and (pointer: fine)');
    expect(mediaBlock).toContain('/* shared-card-feedback-hover */');

    const hoverRule = ruleContaining('/* shared-card-feedback-hover */');
    for (const selector of cardSelectors) expect(hoverRule).toContain(`${selector}:hover`);
    expect(hoverRule).toContain('transform: translateY(-3px)');
    expect(hoverRule).toContain('border-color: var(--hot-blood)');
    expect(hoverRule).toContain('box-shadow: 0 18px 44px');
  });

  it('reduced motion removes transform', () => {
    const mediaBlock = blockStarting('@media (prefers-reduced-motion: reduce)');
    expect(mediaBlock).toContain('/* shared-card-feedback-reduced-motion */');

    const reducedRule = ruleContaining('/* shared-card-feedback-reduced-motion */');
    for (const selector of cardSelectors) expect(reducedRule).toContain(selector);
    expect(reducedRule).toContain('transition: none');
    expect(reducedRule).toContain('transform: none');
  });
});
