import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// No TestBed / zone.js in this repo (see AGENT.md environment facts) — assert on the template
// source string instead of a rendered DOM. Precedent: server-authority-boundary.test.ts.
const source = readFileSync(join(__dirname, 'home-menu.component.ts'), 'utf8');

describe('HomeMenuComponent template', () => {
  it('shows the registrations card only when signed in', () => {
    const ifMatch = source.match(/@if \(auth\.profile\(\)\) \{[\s\S]*?\n\s*\}/);
    expect(ifMatch).not.toBeNull();
    const block = ifMatch![0];
    expect(block).toContain('data-cy="menu-registrations-card"');
    expect(block).toContain('routerLink="/registrations"');
  });

  // No separate DOM test is possible without TestBed; the @if guard above is what hides the
  // card for anonymous visitors, so this is the same assertion from the other direction.
  it('does not render the registrations card outside the signed-in guard', () => {
    const outsideGuard = source.replace(/@if \(auth\.profile\(\)\) \{[\s\S]*?\n\s*\}/, '');
    expect(outsideGuard).not.toContain('data-cy="menu-registrations-card"');
  });
});
