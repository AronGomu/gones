import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const listComponent = readFileSync(join(__dirname, 'live-tournament-list.component.ts'), 'utf8');

describe('Live Tournament list Power User gate', () => {
  it('composes Power mode with existing Live authority for the create card', () => {
    expect(listComponent).toContain('canUsePowerMutation(this.power.enabled(), this.existingAuthorityAllowed())');
    expect(listComponent).toContain('@if (canManage()) {');
  });

  it('blocks direct create handler calls while read-only', () => {
    const body = listComponent.slice(listComponent.indexOf('async createTournament(): Promise<void>'));
    const handler = body.slice(0, body.indexOf('\n  }'));
    expect(handler).toContain('if (!this.canManage() || this.creating()) return;');
  });
});
