import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { translate } from '../i18n/messages';

const liveList = readFileSync(join(process.cwd(), 'src/app/features/live-tournaments/live-tournament-list.component.ts'), 'utf8');
const liveRunner = readFileSync(join(process.cwd(), 'src/app/features/live-tournaments/live-tournament-runner.component.ts'), 'utf8');

/**
 * The retired League detail page was the third source here. The three-tier archive says the same
 * thing through `gones-sync-bar` → `gones-offline-banner` instead of its own inline warning, so only
 * the two Live pages still carry this pattern and only they are asserted.
 */
describe('cached server-read warnings', () => {
  it.each([
    [liveList, 'liveRepo.listStale()', 'live-list-cached-stale'],
    [liveRunner, 'liveRepo.detailStale()', 'live-runner-cached-stale']
  ])('renders warning only from its repository stale signal', (source, signal, dataCy) => {
    expect(source).toContain(`@if (${signal})`);
    expect(source).toContain(`data-cy="${dataCy}"`);
    expect(source).toContain("i18n.t('offline.cachedServerRead')");
  });

  it('ships visible English and French stale-answer copy', () => {
    expect(translate('en', 'offline.cachedServerRead')).toContain('cached server data');
    expect(translate('fr', 'offline.cachedServerRead')).toContain('cache');
  });
});
