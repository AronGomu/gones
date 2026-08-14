import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const stylesheet = readFileSync(join(__dirname, '..', '..', '..', 'styles.css'), 'utf8');
const homeMenuComponent = readFileSync(join(__dirname, 'home-menu.component.ts'), 'utf8');

describe('home menu grid rule', () => {
  it('a lone last card spans the whole row', () => {
    expect(stylesheet).toMatch(
      /\.home-destinations\s*>\s*:last-child:nth-child\(odd\)\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/
    );
  });

  it('the about card is no longer pinned to a full row', () => {
    const aboutBlock = stylesheet.match(/\.home-destination--about\s*\{[^}]*\}/)?.[0] ?? '';
    expect(aboutBlock).not.toBe('');
    expect(aboutBlock).not.toContain('grid-column');
  });

  it('the about card keeps its own styling', () => {
    const aboutBlock = stylesheet.match(/\.home-destination--about\s*\{[^}]*\}/)?.[0] ?? '';
    expect(aboutBlock).toContain('min-height');
    expect(aboutBlock).toContain('border-color');
    expect(aboutBlock).toContain('background');
  });

  it('the dead narrow-viewport override is gone', () => {
    expect(stylesheet).not.toContain('.home-destination--about { grid-column: auto; }');
  });

  it('the grid is still two columns at full width', () => {
    const homeDestinationsBlock = stylesheet.match(/\.home-destinations\s*\{[^}]*\}/)?.[0] ?? '';
    expect(homeDestinationsBlock).toContain('repeat(2, minmax(0, 1fr))');
  });

  it('signed out renders 6 cards (even — every row fills completely)', () => {
    const withoutAuthOnlyCard = homeMenuComponent.replace(/@if \(auth\.profile\(\)\) \{[\s\S]*?\n\s*\}\n/, '');
    const matches = withoutAuthOnlyCard.match(/class="home-destination(?!s)/g) ?? [];
    expect(matches.length).toBe(6);
  });
});
