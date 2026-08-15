import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// No TestBed / zone.js in this repo (see AGENT.md environment facts) — assert on the template
// source string instead of a rendered DOM. Precedent: server-authority-boundary.test.ts.
const source = readFileSync(join(__dirname, 'my-registrations.component.ts'), 'utf8');

describe('MyRegistrationsComponent template', () => {
  it('renders a top and a bottom return button', () => {
    expect(source).toMatch(/<gones-back-button\s[^>]*position="top"[^>]*>/);
    expect(source).toMatch(/<gones-back-button\s[^>]*position="bottom"[^>]*>/);
    const buttons = source.match(/<gones-back-button\s[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button).toContain(`[link]="['/']"`);
    }
  });

  it('renders no page kicker, but keeps the per-card organization label', () => {
    const headerMatch = source.match(/<header class="page-heading"[^>]*>[\s\S]*?<\/header>/);
    expect(headerMatch).not.toBeNull();
    expect(headerMatch![0]).not.toContain('class="kicker"');

    const cardMatch = source.match(/<ng-template #attemptCard[\s\S]*?<\/ng-template>/);
    expect(cardMatch).not.toBeNull();
    expect(cardMatch![0]).toMatch(/<p class="kicker"[^>]*>\{\{ attempt\.organizationName \}\}<\/p>/);
  });
});
