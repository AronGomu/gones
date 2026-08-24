import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// No TestBed / zone.js in this repo, so `effect()` — which drags `ChangeDetectionScheduler` into
// I18nService — is stubbed and the component is built in a bare Injector.
vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

const source = readFileSync(join(__dirname, 'archive-shell.component.ts'), 'utf8');

describe('archive shell template', () => {
  it('renders both tabs, always', () => {
    expect(source.match(/data-cy="archive-tab-league-seasons"/g)).toHaveLength(1);
    expect(source.match(/data-cy="archive-tab-tournaments"/g)).toHaveLength(1);
  });

  it('the tabs are links, not buttons', () => {
    expect(source).toContain('routerLink="/archive/league-seasons"');
    expect(source).toContain('routerLink="/archive/tournaments"');
  });

  it('marks the active tab with aria-current', () => {
    expect(source).toContain(`activeTab() === 'league-seasons' ? 'page' : null`);
    expect(source).toContain(`activeTab() === 'tournaments' ? 'page' : null`);
  });

  it('the tab strip is a labelled nav', () => {
    expect(source).toContain('<nav class="archive-tabs"');
    expect(source).toContain(`i18n.t('archive.tabsAria')`);
  });

  it('renders the sync bar with the archive prefix', () => {
    expect(source).toContain('cyPrefix="archive"');
    expect(source).toContain('(sync)="sync.emit()"');
  });

  it('projects the tab body', () => {
    expect(source).toContain('<ng-content />');
  });

  it('owns no data', () => {
    expect(source).not.toContain('ArchiveRepository');
    expect(source).not.toContain('inject(Router');
    expect(source).not.toContain('signal(');
    expect(source).not.toContain('fetch(');
  });

  it('hardcodes no colour', () => {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|oklch\(/);
  });
});
