import { describe, expect, it } from 'vitest';
import { PreviewPublicationState, browserTimeZoneSuggestion, eventPayload } from './organizer-event-create';

const preview = { previewTicket: 'ticket', expiresAt: '2027-01-01T00:00:00Z', render: {} } as never;

describe('Organizer Event create state', () => {
  it('uses browser zone only as editable initial suggestion', () => {
    expect(browserTimeZoneSuggestion(() => 'Europe/Paris')).toBe('Europe/Paris');
    expect(browserTimeZoneSuggestion(() => '')).toBe('');
    expect(browserTimeZoneSuggestion(() => { throw new Error('unavailable'); })).toBe('');
  });

  it('builds payload from explicit form zone without inferring a replacement', () => {
    expect(eventPayload({
      organizationId: 'org', title: ' Cup ', summary: ' ', bodyHtml: ' <p>Body</p> ', streetAddress: ' 1 Street ',
      postalCode: '', city: ' Lyon ', country: ' France ', timeZoneId: '', startsAtLocal: '2027-08-01T10:00',
      endsAtLocal: '', capacity: null, formatId: 'legacy', liveTournamentUrl: ' /live/123 ', archiveTournamentUrl: ' '
    })).toEqual({
      organizationId: 'org', title: 'Cup', summary: undefined, bodyHtml: '<p>Body</p>', streetAddress: '1 Street',
      postalCode: undefined, city: 'Lyon', country: 'France', timeZoneId: '', startsAtLocal: '2027-08-01T10:00',
      endsAtLocal: undefined, capacity: undefined, formatIds: ['legacy'], liveTournamentUrl: '/live/123', archiveTournamentUrl: undefined
    });
  });

  it('invalidates preview after edit and keeps idempotency key stable through retry', () => {
    const state = new PreviewPublicationState();
    state.accept(preview);
    expect(state.idempotencyKey(() => 'attempt-1')).toBe('attempt-1');
    expect(state.idempotencyKey(() => 'attempt-2')).toBe('attempt-1');

    state.invalidate();
    expect(state.preview).toBeUndefined();
    state.accept(preview);
    expect(state.idempotencyKey(() => 'attempt-2')).toBe('attempt-2');
  });
});
