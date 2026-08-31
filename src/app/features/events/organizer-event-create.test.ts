import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PreviewPublicationState, eventPayload } from './organizer-event-create';

const preview = { previewTicket: 'ticket', expiresAt: '2027-01-01T00:00:00Z', render: {} } as never;

describe('Organizer Event create state', () => {
  it('associates required Event Type errors with its select', () => {
    const source = readFileSync(join(__dirname, 'organizer-event-create.component.ts'), 'utf8');
    const start = source.indexOf('id="event-type"');
    const field = source.slice(start, source.indexOf('</div>', start));
    expect(field).toContain("[attr.aria-invalid]=\"fieldError('eventType') ? 'true' : null\"");
    expect(field).toContain("[attr.aria-describedby]=\"fieldError('eventType') ? 'event-type-error' : null\"");
    expect(field).toContain('id="event-type-error"');
  });

  it('keeps resolved timezone and coordinates hidden from manual editing', () => {
    const source = readFileSync(join(__dirname, 'organizer-event-create.component.ts'), 'utf8');
    expect(source).not.toContain('id="event-zone"');
    expect(source).toContain('type="hidden" data-cy="event-location-time-zone" formControlName="timeZoneId"');
    expect(source).toContain('type="hidden" data-cy="event-location-latitude" formControlName="latitude"');
    expect(source).toContain('type="hidden" data-cy="event-location-longitude" formControlName="longitude"');
  });

  it('exposes stable hooks for every location autocomplete and error state', () => {
    const source = readFileSync(join(__dirname, 'organizer-event-create.component.ts'), 'utf8');
    for (const hook of [
      'event-location-loading',
      'event-location-suggestions',
      'event-location-suggestion-',
      'event-location-empty',
      'event-location-resolving',
      'event-location-error',
      'event-location-error-message',
      'event-location-retry',
      'event-location-token-error'
    ]) {
      expect(source).toContain(hook);
    }
  });

  it('builds payload from the resolved form zone without inferring a replacement', () => {
    expect(eventPayload({
      organizationId: 'org', title: ' Cup ', summary: ' ', bodyHtml: ' <p>Body</p> ', streetAddress: ' 1 Street ',
      postalCode: '', city: ' Lyon ', country: ' France ', region: ' Rhône ', locationToken: 'token', latitude: 45.764, longitude: 4.8357,
      eventType: 'weekly', timeZoneId: '', startsAtLocal: '2027-08-01T10:00',
      endsAtLocal: '', capacity: null, formatId: 'legacy', liveTournamentUrl: ' /live/123 ', archiveTournamentUrl: ' '
    })).toEqual({
      organizationId: 'org', title: 'Cup', summary: undefined, bodyHtml: '<p>Body</p>', streetAddress: '1 Street',
      postalCode: undefined, city: 'Lyon', country: 'France', region: 'Rhône', eventType: 'weekly', timeZoneId: '', startsAtLocal: '2027-08-01T10:00',
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
