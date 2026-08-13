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
import { translate } from '../../i18n/messages';
import { DeckArchetypeSettingsService } from '../../shared/deck-archetype-settings.service';
import { EventDetailViewComponent } from './event-detail-view.component';

// The required input is swapped for a plain signal; rendered text and geometry are asserted in
// cypress/e2e/public-calendar.cy.js, which reads the real browser DOM.
const event = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'AURA Open',
  displayTitle: 'Modern — AURA Open',
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
  liveTournamentUrl: '/live-tournaments/gones-night',
  archiveTournamentUrl: 'https://archive.example.test/gones-night',
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
  it('renders the backend display title without reconstructing format or capacity', () => {
    expect(title).toContain('{{ event().displayTitle }}');
    expect(title).not.toContain('event().title');
    expect(title).not.toContain('titleFormat');
    expect(title).not.toContain('event().capacity');
    expect(source).not.toContain('titleFormat = computed');
  });

  it('renders localized singular, plural and unlimited player counts beside the heading', () => {
    expect(translate('en', 'calendar.playerCount', { count: 1 })).toBe('1 player');
    expect(translate('en', 'calendar.playerCountPlural', { count: 32 })).toBe('32 players');
    expect(translate('fr', 'calendar.playerCount', { count: 1 })).toBe('1 joueur');
    expect(translate('fr', 'calendar.playerCountPlural', { count: 32 })).toBe('32 joueurs');
    expect(title).toContain('data-cy="event-detail-player-count"');
    expect(title).toContain('{{ playerCount() }}');
    expect(build({ capacity: 1 }).playerCount()).toBe(translate('fr', 'calendar.playerCount', { count: 1 }));
    expect(build({ capacity: 32 }).playerCount()).toBe(translate('fr', 'calendar.playerCountPlural', { count: 32 }));
    expect(build({ capacity: undefined }).playerCount()).toBe(translate('fr', 'registration.unlimited'));
  });

  it('removes event status from the detail DOM', () => {
    expect(source).not.toContain('data-cy="event-detail-status"');
    expect(source).not.toContain('statusPresentation');
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

  it('orders tournament and organization links in the end-aligned action row', () => {
    const actionsStart = source.indexOf('class="event-detail-actions info-actions info-actions--end"');
    expect(actionsStart).toBeGreaterThan(-1);
    const actions = source.slice(actionsStart, source.indexOf('</div>', actionsStart));
    expect(actions).toContain('data-cy="event-detail-live-tournament"');
    expect(actions).toContain('data-cy="event-detail-archive-tournament"');
    expect(actions).toContain('data-cy="event-detail-organization-website"');
    expect(actions.indexOf('event-detail-live-tournament')).toBeLessThan(actions.indexOf('event-detail-archive-tournament'));
    expect(actions.indexOf('event-detail-archive-tournament')).toBeLessThan(actions.indexOf('event-detail-organization-website'));
    expect(actionsStart).toBeGreaterThan(source.indexOf('data-cy="event-detail-when-where"'));
    expect(stylesheet).toContain('.info-actions--end { justify-content: flex-end; }');
  });

  it('opens only absolute HTTP(S) tournament links in a new tab', () => {
    expect(build().externalLinkAttrs('/live-tournaments/gones-night')).toEqual({});
    expect(build().externalLinkAttrs('https://archive.example.test/gones-night')).toEqual({ target: '_blank', rel: 'noopener noreferrer' });
    expect(build().externalLinkAttrs('http://archive.example.test/gones-night')).toEqual({ target: '_blank', rel: 'noopener noreferrer' });
  });

  it('the ics anchor is on by default and opt-out for hosts that render their own', () => {
    expect(build().showIcsAction()).toBe(true);
    expect(source).toContain('@if (showIcsAction() && icsUrl(); as url)');
    expect(source).toContain('showIcsAction() && icsUrl()');
  });
});
