import { describe, expect, it } from 'vitest';
import { CalendarEventDocument, createCalendarEvent, normalizeCalendarEvent, normalizeCalendarEvents } from './models';

describe('event pages', () => {
  it('normalizes event page fields with a slug and ignores legacy tournament links', () => {
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
    } as Partial<CalendarEventDocument> & { tournamentLinks: unknown });

    expect(event.slug).toBe('weekend-championship');
    expect(event.location).toBe('12 Rue Example, Lyon, France');
    expect(event.richDescriptionHtml).toContain('<h2>Main event</h2>');
    expect('tournamentLinks' in event).toBe(false);
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
});
