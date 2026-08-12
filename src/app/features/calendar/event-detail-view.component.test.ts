import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';

// Same rationale as public-calendar.component.test.ts: no TestBed / zone.js in this repo, so
// `effect()` is stubbed to a no-op and the component is built with a bare Injector.
vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PublicEventDetailResponse } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { DeckArchetypeSettingsService } from '../../shared/deck-archetype-settings.service';
import { EventDetailViewComponent } from './event-detail-view.component';

// The required input is swapped for a plain signal; rendered text and geometry are asserted in
// cypress/e2e/public-calendar.cy.js, which reads the real browser DOM.
const event = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'Gones Night',
  slug: 'gones-night',
  summary: 'Weekly night',
  bodyHtml: '<p>Body</p>',
  venue: { streetAddress: '1 Rue Test', postalCode: '69001', city: 'Lyon', country: 'France' },
  timeZoneId: 'Europe/Paris',
  venueStartDate: '2026-08-01',
  venueStartTime: '10:00:00',
  venueEndDate: '2026-08-01',
  venueEndTime: '18:00:00',
  startsAtUtc: '2026-08-01T08:00:00Z',
  endsAtUtc: '2026-08-01T16:00:00Z',
  capacity: 32,
  status: 'Published',
  organization: { id: '22222222-2222-2222-2222-222222222222', name: 'Gones', description: undefined, website: 'https://example.test', contactEmail: undefined },
  formats: [{ id: '33333333-3333-3333-3333-333333333333', name: 'Modern', slug: 'modern', sortOrder: 1 }]
} as unknown as PublicEventDetailResponse;

function build(overrides: Partial<PublicEventDetailResponse> = {}): EventDetailViewComponent {
  const injector = Injector.create({ providers: [DeckArchetypeSettingsService, I18nService] });
  const component = runInInjectionContext(injector, () => new EventDetailViewComponent());
  Object.defineProperty(component, 'event', { value: signal({ ...event, ...overrides }) });
  return component;
}

const source = readFileSync(join(__dirname, 'event-detail-view.component.ts'), 'utf8');
const stylesheet = readFileSync(join(__dirname, '..', '..', '..', 'styles.css'), 'utf8');
const title = source.slice(source.indexOf('<h1 id="event-title"'), source.indexOf('</h1>'));
const whenWhere = source.slice(source.indexOf('data-cy="event-detail-when-where"'), source.indexOf('</p>', source.indexOf('data-cy="event-detail-when-where"')));

describe('EventDetailViewComponent hero', () => {
  it('title row shows format, title and capacity', () => {
    expect(build().titleFormat()).toBe('Modern');
    expect(title).toContain('data-cy="event-detail-title-format"');
    expect(title).toContain('[{{ format }}]');
    expect(title).toContain('data-cy="event-detail-title-text"');
    expect(title).toContain('{{ event().title }}');
    expect(title).toContain('data-cy="event-detail-title-capacity"');
    expect(title).toContain('({{ capacity }})');
    expect(title.indexOf('title-format')).toBeLessThan(title.indexOf('title-text'));
    expect(title.indexOf('title-text')).toBeLessThan(title.indexOf('title-capacity'));
  });

  it('title row omits capacity when absent', () => {
    expect(build({ capacity: undefined }).event().capacity).toBeFalsy();
    expect(title).toContain('@if (event().capacity; as capacity)');
  });

  it('title row omits the bracket when there is no format', () => {
    expect(build({ formats: [] }).titleFormat()).toBe('');
    expect(title).toContain('@if (titleFormat(); as format)');
  });

  it('title row joins multiple formats', () => {
    const formats = [
      { id: 'f1', name: 'Modern', slug: 'modern', sortOrder: 1 },
      { id: 'f2', name: 'Legacy', slug: 'legacy', sortOrder: 2 }
    ] as PublicEventDetailResponse['formats'];
    expect(build({ formats }).titleFormat()).toBe('Modern / Legacy');
  });

  it('when-where row holds date and location', () => {
    const component = build();
    expect(component.date().primary).toContain('2026');
    expect(component.venue()).toBe('1 Rue Test, 69001, Lyon, France');
    expect(whenWhere).toContain('data-cy="event-detail-when"');
    expect(whenWhere).toContain('{{ date().primary }}');
    expect(whenWhere).toContain('data-cy="event-detail-when-where-separator"');
    expect(whenWhere).toContain('data-cy="event-detail-where"');
    expect(whenWhere).toContain('{{ venue() }}');
    expect(stylesheet).toContain('.event-when-where {');
  });

  it('location renders as a maps link', () => {
    const component = build({ venue: { city: 'Lyon' } } as Partial<PublicEventDetailResponse>);
    expect(component.mapsUrl()).toBe('https://www.google.com/maps/search/?api=1&query=Lyon');
    const link = whenWhere.slice(whenWhere.indexOf('data-cy="event-detail-where-link"'));
    expect(link).toContain('[href]="url"');
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
    expect(link).toContain(`i18n.t('calendar.openInMaps', { address: venue() })`);
    expect(link).toContain('class="maps-icon"');
    expect(link).toContain('aria-hidden="true"');
    expect(stylesheet).toContain('.maps-icon {');
  });

  it('location stays plain text without an address', () => {
    const component = build({ venue: {} } as Partial<PublicEventDetailResponse>);
    expect(component.mapsUrl()).toBeNull();
    expect(whenWhere).toContain('@if (mapsUrl(); as url)');
    expect(whenWhere).toContain('@else { <span data-cy="event-detail-where">{{ venue() }}</span> }');
  });

  it('organization fact block is gone', () => {
    expect(source).not.toContain('event-detail-fact-organization');
    expect(source).not.toContain('class="event-facts"');
  });

  it('website button sits in the end-aligned actions row', () => {
    const actionsStart = source.indexOf('class="info-actions info-actions--end"');
    expect(actionsStart).toBeGreaterThan(-1);
    const actions = source.slice(actionsStart, source.indexOf('</div>', actionsStart));
    expect(actions).toContain('data-cy="event-detail-organization-website"');
    expect(actions.indexOf('data-cy="event-ics"')).toBeLessThan(actions.indexOf('data-cy="event-detail-organization-website"'));
    expect(actionsStart).toBeGreaterThan(source.indexOf('data-cy="event-detail-when-where"'));
    expect(stylesheet).toContain('.info-actions--end { justify-content: flex-end; }');
  });

  it('the ics anchor is on by default and opt-out for hosts that render their own', () => {
    expect(build().showIcsAction()).toBe(true);
    expect(source).toContain('@if (showIcsAction() && icsUrl(); as url)');
    expect(source).toContain('@if ((showIcsAction() && icsUrl()) || event().organization.website)');
  });
});
