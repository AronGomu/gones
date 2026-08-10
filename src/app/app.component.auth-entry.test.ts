import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// No TestBed / zone.js in this repo (see AGENT.md environment facts) — assert on the template
// source string instead of a rendered DOM. Precedent: home-menu.component.test.ts.
const source = readFileSync(join(__dirname, 'app.component.ts'), 'utf8');

describe('AppComponent toolbar auth entry', () => {
  it('the toolbar offers a sign-in action when signed out', () => {
    const line = source.split('\n').find((l) => l.includes('data-cy="toolbar-sign-in-link"'));
    expect(line).toBeDefined();
    expect(line).toContain('routerLink="/login"');
  });

  it('the sign-in action lives in the same slot as logout', () => {
    const start = source.indexOf('data-cy="auth-toolbar-actions"');
    expect(start).toBeGreaterThan(-1);
    const ifMatch = source.slice(start).match(/@if \(auth\.profile\(\); as profile\) \{[\s\S]*?\n\s*\} @else \{[\s\S]*?\n\s*\}/);
    expect(ifMatch).not.toBeNull();
    const authBlockEnd = start + ifMatch!.index! + ifMatch![0].length;
    const signInIndex = source.indexOf('data-cy="toolbar-sign-in-link"');
    expect(signInIndex).toBeGreaterThan(start);
    expect(signInIndex).toBeLessThan(authBlockEnd);
  });

  it('the sign-in action is only rendered when there is no profile', () => {
    const start = source.indexOf('@if (auth.profile(); as profile) {');
    expect(start).toBeGreaterThan(-1);
    const elseIndex = source.indexOf('} @else {', start);
    expect(elseIndex).toBeGreaterThan(start);
    const signInIndex = source.indexOf('data-cy="toolbar-sign-in-link"');
    expect(signInIndex).toBeGreaterThan(elseIndex);
  });
});
