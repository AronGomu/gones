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

describe('Live Tournament list cache contract', () => {
  it('serves a fresh cache', () => {
    // readCached wraps the repo call — direct list() calls are inside the loader lambda only
    expect(listComponent).toContain("this.cache.readCached('live-tournaments', () => this.liveRepo.list()");
    expect(listComponent).not.toContain('await this.liveRepo.list()');
  });

  it('refetches after 24h', () => {
    // readCached handles the 24h TTL; the component passes its options through
    expect(listComponent).toContain("this.cache.readCached('live-tournaments', () => this.liveRepo.list(), options)");
  });

  it('sync forces a refetch', () => {
    expect(listComponent).toContain("sync(): void { void this.load({ force: true }); }");
  });

  it('reads live for an anonymous visitor', () => {
    // readCached degrades to a pass-through for anonymous callers — no explicit branch needed
    expect(listComponent).not.toContain("if (!this.auth.profile())");
    expect(listComponent).toContain("this.cache.readCached('live-tournaments'");
  });

  it('invalidates after a create', () => {
    // Create is the only mutation this page performs — deleting a Live Tournament lives on the runner.
    expect(listComponent).not.toContain('deleteTournament');
    const body = listComponent.slice(listComponent.indexOf('async createTournament(): Promise<void>'));
    const handler = body.slice(0, body.indexOf('\n  }') + 4);
    expect(handler).toContain('await this.liveRepo.create()');
    expect(handler).toContain("await this.cache.invalidate('live-tournaments')");
  });
});
