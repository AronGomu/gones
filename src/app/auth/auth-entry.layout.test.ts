import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const componentSource = readFileSync(join(__dirname, 'auth-entry.component.ts'), 'utf8');
const stylesheet = readFileSync(join(__dirname, '..', '..', 'styles.css'), 'utf8');
const messages = readFileSync(join(__dirname, '..', 'i18n', 'messages.ts'), 'utf8');

function lineContaining(source: string, needle: string): string {
  const line = source.split('\n').find((candidate) => candidate.includes(needle));
  if (!line) throw new Error(`no line found containing ${needle}`);
  return line;
}

describe('auth-entry login OAuth layout', () => {
  it('the google button shows the shared continue-with label', () => {
    const line = lineContaining(componentSource, 'data-cy="oauth-google-label"');
    expect(line).toContain("i18n.t('auth.continueWith')");
  });

  it('the facebook button shows the shared continue-with label', () => {
    const line = lineContaining(componentSource, 'data-cy="oauth-facebook-label"');
    expect(line).toContain("i18n.t('auth.continueWith')");
  });

  it('the logo follows the label in both buttons', () => {
    const gridStart = componentSource.indexOf('data-cy="login-oauth-grid"');
    const gridEnd = componentSource.indexOf('</div>', gridStart);
    const grid = componentSource.slice(gridStart, gridEnd);

    const googleLabelIndex = grid.indexOf('oauth-google-label');
    const googleLogoIndex = grid.indexOf('oauth-google-logo');
    expect(googleLabelIndex).toBeGreaterThan(-1);
    expect(googleLogoIndex).toBeGreaterThan(-1);
    expect(googleLabelIndex).toBeLessThan(googleLogoIndex);

    const facebookLabelIndex = grid.indexOf('oauth-facebook-label');
    const facebookLogoIndex = grid.indexOf('oauth-facebook-logo');
    expect(facebookLabelIndex).toBeGreaterThan(-1);
    expect(facebookLogoIndex).toBeGreaterThan(-1);
    expect(facebookLabelIndex).toBeLessThan(facebookLogoIndex);
  });

  it('the logos name their platform for assistive tech', () => {
    const googleLine = lineContaining(componentSource, 'data-cy="oauth-google-logo"');
    expect(googleLine).toContain('alt="Google"');
    expect(googleLine).not.toContain('aria-hidden');

    const facebookLine = lineContaining(componentSource, 'data-cy="oauth-facebook-logo"');
    expect(facebookLine).toContain('alt="Facebook"');
    expect(facebookLine).not.toContain('aria-hidden');
  });

  it('the login links row is not forced back to inline flow', () => {
    const badRule = /\.auth-card\s+\.oauth-grid\s*\+\s*\.auth-links[^{]*\{[^}]*display:\s*inline-block/;
    expect(badRule.test(stylesheet)).toBe(false);
  });

  it('the login links row keeps its space-between layout', () => {
    const blockStart = stylesheet.indexOf('.auth-links {');
    const blockEnd = stylesheet.indexOf('}', blockStart);
    const block = stylesheet.slice(blockStart, blockEnd);
    expect(block).toContain('display: flex');
    expect(block).toContain('justify-content: space-between');
  });

  it('both catalogs define the shared label', () => {
    const matches = messages.match(/'auth\.continueWith'/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it('the register page still uses the platform-specific labels', () => {
    const line = lineContaining(componentSource, 'register-oauth-google-label');
    expect(line).toContain('auth.continueGoogle');
  });
});
