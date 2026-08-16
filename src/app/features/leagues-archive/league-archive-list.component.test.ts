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

/**
 * The source slice a control-flow block owns, from its opening `{` to the `}` that balances it.
 * Lets an assertion say "this element is *inside* that guard" rather than "both strings exist
 * somewhere in the file", which a badge hoisted out of the guard would still satisfy.
 */
function templateBlock(opening: string): string {
  const start = source.indexOf(opening);
  expect(start, `template block "${opening}"`).toBeGreaterThan(-1);
  let depth = 0;
  for (let index = start + opening.length - 1; index < source.length; index++) {
    if (source[index] === '{') depth++;
    else if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unbalanced template block "${opening}"`);
}

describe('league archive list template', () => {
  it('offers create only after browser Power User opt-in, without adding a role gate', () => {
    expect(source.match(/data-cy="leagues-archive-list-create-card"/g)).toHaveLength(1);
    expect(templateBlock('@if (power.enabled()) {')).toContain('data-cy="leagues-archive-list-create-card"');
    expect(source).not.toContain('@if (canManage())');
    expect(source).not.toMatch(/readonly canManage = computed/);
  });

  it('the read-only notice is about server leagues only', () => {
    expect(source).toContain('@if (hasUnmanageableServerLeagues()) { <p class="muted" data-cy="leagues-archive-list-read-only"');
  });

  it('local rows are badged, and only local rows', () => {
    // Asserting the guard and the badge independently is satisfied by a badge hoisted out of the
    // guard with a dummy element left inside — which would badge every server row too. The badge is
    // rendered exactly once in the template, and that one occurrence is inside the local guard.
    expect(source.match(/data-cy="leagues-archive-list-item-local-badge"/g)).toHaveLength(1);
    expect(templateBlock('@if (isLocal(league)) {')).toContain('data-cy="leagues-archive-list-item-local-badge"');
  });

  it('the local notice explains the store', () => {
    expect(source).toContain('data-cy="leagues-archive-local-notice"');
    expect(source).toContain("i18n.t('leagues.localNotice')");
  });

  it('a failed server read is surfaced, not swallowed', () => {
    expect(source).toContain('@if (repo.serverUnavailable()) {');
    expect(source).toContain('data-cy="leagues-archive-server-unavailable"');
  });

  it('renders the sync bar', () => {
    expect(source).toContain('gones-sync-bar');
    expect(source).toContain('cyPrefix="leagues-archive-list"');
    // SyncBarComponent produces data-cy="{prefix}-sync-button"
    expect(source).toContain('cyPrefix="leagues-archive-list"');
  });

  it('sync forces a refetch', () => {
    expect(source).toContain('sync(): void { void this.load({ force: true }); }');
  });

  it('always reads local leagues live', () => {
    expect(source).toContain('this.repo.listLocalLeagues()');
    expect(source).toContain('this.catalogCache.load(options)');
  });

  it('both placeholders are hidden and labelled the same way', () => {
    expect(source).toContain('!isAnyPlaceholderLeagueId(league.id) || league.tournaments.length > 0');
    expect(source).toContain("isAnyPlaceholderLeagueId(league.id) ? this.i18n.t('liveList.unassigned') : league.name");
  });
});
