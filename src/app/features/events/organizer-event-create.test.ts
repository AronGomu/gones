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
      'sessionUuid'
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

  it('keeps the preview header outside its sticky desktop scroll region and collapse reachable', () => {
    const component = readFileSync(join(__dirname, 'organizer-event-create.component.ts'), 'utf8');
    const styles = readFileSync(join(__dirname, '../../../styles.css'), 'utf8');
    const aside = component.slice(component.indexOf('<aside'), component.indexOf('</aside>'));
    expect(component).toContain("gones.event-editor.preview-collapsed");
    expect(aside).toContain('data-cy="event-live-preview-header"');
    expect(aside).toContain('data-cy="event-live-preview-title"');
    expect(aside).toContain('data-cy="event-preview-collapse"');
    expect(aside).toContain('aria-controls="event-live-preview"');
    expect(aside).toContain('[attr.aria-expanded]="!previewCollapsed()"');
    expect(aside.indexOf('event-live-preview-header')).toBeLessThan(aside.indexOf('event-live-preview-scroll'));
    expect(aside).toContain('data-cy="event-live-preview-scroll" [hidden]="previewCollapsed()"');
    expect(styles).toContain('@media (min-width: 1024px)');
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)');
    expect(styles).toContain('top: var(--event-preview-sticky-offset)');
    expect(styles).toMatch(/\.event-live-preview \{[^}]*max-height: calc\(100dvh - var\(--event-preview-sticky-offset\)\)[^}]*grid-template-rows: auto minmax\(0, 1fr\)/);
    expect(styles).toMatch(/\.event-live-preview__scroll \{[^}]*min-height: 0[^}]*overflow: auto/);
    expect(styles).toMatch(/\.event-live-preview__title \{[^}]*font-size: clamp\(1\.5rem, 2vw, 2rem\)[^}]*text-align: left/);
  });

  it('wraps disabled Publish tooltip access and keeps the green action full width', () => {
    const component = readFileSync(join(__dirname, 'organizer-event-create.component.ts'), 'utf8');
    const styles = readFileSync(join(__dirname, '../../../styles.css'), 'utf8');
    expect(component).toContain('MatTooltipModule');
    expect(component).toContain('data-cy="event-publish-tooltip"');
    expect(component).toContain('[matTooltip]="publishTooltip()"');
    expect(component).toContain('[attr.tabindex]="publishErrors().length ? 0 : null"');
    expect(component).toContain("[attr.aria-describedby]=\"publishErrors().length ? 'event-publish-errors' : null\"");
    expect(component).toContain('data-cy="event-publish-errors"');
    expect(component).toContain('class="home-primary-action create-action-button event-publish-button"');
    expect(styles).toMatch(/\.event-create-actions \{[^}]*width: 100%/);
    expect(styles).toMatch(/\.event-publish-button \{[^}]*width: 100%/);
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
