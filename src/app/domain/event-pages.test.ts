import { describe, expect, it } from 'vitest';
import { createCalendarEvent, createLeague, createTournament, normalizeCalendarEvent, normalizeCalendarEvents } from './models';
import { exportFullData, restoreFullDataBundle } from './export-restore';

describe('event pages', () => {
  it('normalizes event page fields with a slug and tournament links', () => {
    const event = normalizeCalendarEvent({
      title: 'Weekend Championship!',
      country: 'France',
      city: 'Lyon',
      address: '12 Rue Example',
      richDescriptionHtml: '<h2>Main event</h2><p><strong>Bring decklists.</strong></p>',
      tournamentLinks: [
        { leagueId: 'league-1', tournamentId: 'tournament-1' },
        { leagueId: 'league-1', tournamentId: 'tournament-1' },
        { leagueId: '', tournamentId: 'ignored' }
      ]
    });

    expect(event.slug).toBe('weekend-championship');
    expect(event.location).toBe('12 Rue Example, Lyon, France');
    expect(event.richDescriptionHtml).toContain('<h2>Main event</h2>');
    expect(event.tournamentLinks).toEqual([{ leagueId: 'league-1', tournamentId: 'tournament-1' }]);
  });

  it('sanitizes event rich text HTML before storage/rendering', () => {
    const event = normalizeCalendarEvent({
      richDescriptionHtml: '<h2 onclick="alert(1)">Title</h2><script>alert(1)</script><img src="http://example.test/image.png" onerror="alert(1)"><img src="https://example.test/safe.png" alt="Safe">'
    });

    expect(event.richDescriptionHtml).toContain('<h2>Title</h2>');
    expect(event.richDescriptionHtml).not.toContain('<script>');
    expect(event.richDescriptionHtml).not.toContain('onclick');
    expect(event.richDescriptionHtml).not.toContain('http://example.test/image.png');
    expect(event.richDescriptionHtml).toContain('https://example.test/safe.png');
    expect(event.richDescriptionHtml).toContain('alt="Safe"');
  });

  it('deduplicates slugs within normalized event collections', () => {
    const events = normalizeCalendarEvents([
      createCalendarEvent({ title: 'Store Championship' }),
      createCalendarEvent({ title: 'Store Championship' })
    ]);

    expect(events.map((event) => event.slug)).toEqual(['store-championship', 'store-championship-2']);
  });

  it('remaps linked tournaments when restoring full data with regenerated IDs', () => {
    const tournament = createTournament({ id: 'old-tournament', leagueId: 'old-league', name: 'Main Event' });
    const league = createLeague({ id: 'old-league', name: 'Old League', tournaments: [tournament] });
    const event = createCalendarEvent({ title: 'Weekend', tournamentLinks: [{ leagueId: 'old-league', tournamentId: 'old-tournament' }] });
    const exported = exportFullData([league], { calendarEvents: [event] });
    const ids = ['new-league', 'new-tournament', 'new-event'];

    const restored = restoreFullDataBundle(exported, { idFactory: () => ids.shift() ?? 'extra-id' });

    expect(restored.leagues[0].id).toBe('new-league');
    expect(restored.leagues[0].tournaments[0].id).toBe('new-tournament');
    expect(restored.calendarEvents[0].tournamentLinks).toEqual([{ leagueId: 'new-league', tournamentId: 'new-tournament' }]);
  });
});
