import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DirectPublicationState, eventPayload } from './organizer-event-create';

describe('Organizer Event create state', () => {
  it('associates required Event Type errors with its select', () => {
    const source = readFileSync(join(__dirname, 'organizer-event-create.component.ts'), 'utf8');
    const start = source.indexOf('id="event-type"');
    const field = source.slice(start, source.indexOf('</div>', start));
    expect(field).toContain("[attr.aria-invalid]=\"fieldError('eventType') ? 'true' : null\"");
    expect(field).toContain("[attr.aria-describedby]=\"fieldError('eventType') ? 'event-type-error' : null\"");
    expect(field).toContain('id="event-type-error"');
  });

  it('renders visible country and timezone catalog selects without provider geodata', () => {
    const source = readFileSync(join(__dirname, 'organizer-event-create.component.ts'), 'utf8');
    expect(source).toContain('<select id="event-country" data-cy="event-country" formControlName="country"');
    expect(source).toContain('[value]="country.name"');
    expect(source).toContain('<select id="event-time-zone" data-cy="event-time-zone" formControlName="timeZoneId"');
    expect(source).toContain('[value]="timeZone"');
    expect(source).not.toContain('type="hidden"');
    expect(source).not.toContain('formControlName="latitude"');
    expect(source).not.toContain('formControlName="longitude"');
  });

  it('removes location provider autocomplete and token states', () => {
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
      'event-location-token-error',
      'locationToken',
      'sessionUuid',
      'expiresAt'
    ]) {
      expect(source).not.toContain(hook);
    }
    expect(source).not.toContain('/api/event-locations/autocomplete');
    expect(source).not.toContain('/api/event-locations/resolve');
  });

  it('builds exact nested create payload from separate date/time controls with manual timezone', () => {
    expect(eventPayload({
      organizationId: 'org', title: ' Cup ', summary: ' ', bodyMarkdown: ' **Body** ', streetAddress: ' 1 Street ',
      postalCode: ' 69001 ', city: ' Lyon ', country: ' France ', region: ' Rhône ',
      eventType: 'weekly', timeZoneId: ' Europe/Paris ', startDate: '2027-08-01', startTime: '10:00',
      capacity: 32, formatId: 'legacy', imageId: 'image-1'
    })).toEqual({
      organizationId: 'org',
      title: 'Cup',
      summary: undefined,
      bodyMarkdown: ' **Body** ',
      location: {
        streetAddress: '1 Street',
        postalCode: '69001',
        city: 'Lyon',
        country: 'France',
        region: 'Rhône',
        timeZoneId: 'Europe/Paris'
      },
      eventType: 'weekly',
      startsAtLocal: '2027-08-01T10:00',
      capacity: 32,
      formatIds: ['legacy'],
      imageId: 'image-1'
    });
  });

  it('uses exact create rows and removes Preview interstitial/client call', () => {
    const source = readFileSync(join(__dirname, 'organizer-event-create.component.ts'), 'utf8');
    for (const row of [
      'data-cy="event-row-title"',
      'data-cy="event-row-summary"',
      'data-cy="event-row-classification"',
      'data-cy="event-row-location"',
      'data-cy="event-row-start"',
      'data-cy="event-row-description"',
      'data-cy="event-row-images"'
    ]) expect(source).toContain(row);
    expect(source).not.toContain('this.client.preview(');
    expect(source).not.toContain('data-cy="event-preview-notice"');
    expect(source).not.toContain('data-cy="event-back-edit"');
    expect(source).toContain('data-cy="event-publish"');
  });

  it('defines responsive split, sticky desktop preview, and collapse session contract', () => {
    const component = readFileSync(join(__dirname, 'organizer-event-create.component.ts'), 'utf8');
    const styles = readFileSync(join(__dirname, '../../../styles.css'), 'utf8');
    expect(component).toContain("gones.event-editor.preview-collapsed");
    expect(component).toContain('aria-controls="event-live-preview"');
    expect(component).toContain('[attr.aria-expanded]="!previewCollapsed()"');
    expect(component).toContain('[hidden]="previewCollapsed()"');
    expect(styles).toContain('@media (min-width: 1024px)');
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)');
    expect(styles).toContain('position: sticky');
  });

  it('enforces title maxlength in browser markup', () => {
    const component = readFileSync(join(__dirname, 'organizer-event-create.component.ts'), 'utf8');
    expect(component).toContain('data-cy="event-title" formControlName="title" autocomplete="off" maxlength="160"');
  });

  it('keeps direct idempotency key stable through retry and resets after edit', () => {
    const state = new DirectPublicationState();
    expect(state.idempotencyKey(() => 'attempt-1')).toBe('attempt-1');
    expect(state.idempotencyKey(() => 'attempt-2')).toBe('attempt-1');

    state.reset();
    expect(state.idempotencyKey(() => 'attempt-2')).toBe('attempt-2');
  });
});
