import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ADR 0028 turns the League list into a heterogeneous grid: the create affordance is offered to
 * everyone because every visitor can always write their own browser store, and the rows that live
 * there say so. These are source assertions — the component drives Material and a Router, and this
 * repo has no TestBed to render it in — so each one pins the exact template shape the Cypress spec
 * then drives for real.
 */
const source = readFileSync(join(__dirname, 'league-archive-list.component.ts'), 'utf8');

describe('league archive list template', () => {
  it('the list page always offers create', () => {
    expect(source).toContain('data-cy="leagues-archive-list-create-card"');
    // The create card is no longer inside a role gate at all: the old `@if (canManage())` wrapper
    // and the component-wide `canManage` computed it read are both gone.
    expect(source).not.toContain('@if (canManage())');
    expect(source).not.toMatch(/readonly canManage = computed/);
  });

  it('the read-only notice is about server leagues only', () => {
    expect(source).toContain('@if (hasUnmanageableServerLeagues()) { <p class="muted" data-cy="leagues-archive-list-read-only"');
  });

  it('local rows are badged', () => {
    expect(source).toContain('@if (isLocal(league)) {');
    expect(source).toContain('data-cy="leagues-archive-list-item-local-badge"');
  });

  it('the local notice explains the store', () => {
    expect(source).toContain('data-cy="leagues-archive-local-notice"');
    expect(source).toContain("i18n.t('leagues.localNotice')");
  });

  it('a failed server read is surfaced, not swallowed', () => {
    expect(source).toContain('@if (repo.serverUnavailable()) {');
    expect(source).toContain('data-cy="leagues-archive-server-unavailable"');
  });

  it('both placeholders are hidden and labelled the same way', () => {
    expect(source).toContain('!isAnyPlaceholderLeagueId(league.id) || league.tournaments.length > 0');
    expect(source).toContain("isAnyPlaceholderLeagueId(league.id) ? this.i18n.t('liveList.unassigned') : league.name");
  });
});
