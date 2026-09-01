import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';

// Same rationale as public-calendar.component.test.ts: no TestBed / zone.js in this repo, so
// `effect()` is stubbed to a no-op and the component is built with a bare Injector.
vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

import { Injector, createComponent, runInInjectionContext, signal } from '@angular/core';
import { createApplication } from '@angular/platform-browser';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PublicEventDetailResponse } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { translate } from '../../i18n/messages';
import { DeckArchetypeSettingsService } from '../../shared/deck-archetype-settings.service';
import { EventDetailViewComponent, trapDialogFocus } from './event-detail-view.component';

// The required input is swapped for a plain signal; rendered text and geometry are asserted in
// cypress/e2e/public-calendar.cy.js, which reads the real browser DOM.
const event = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'AURA Open',
  displayTitle: 'Modern — AURA Open',
  slug: 'gones-night',
  summary: 'Weekly night',
  bodyHtml: '<p>Body</p>',
  images: [
    { id: 'image-1', altText: 'Hero alt', variants: [{ width: 320, height: 180, url: '/api/event-images/image-1/variants/320' }, { width: 960, height: 540, url: '/api/event-images/image-1/variants/960' }] },
    { id: 'image-2', altText: undefined, variants: [{ width: 320, height: 180, url: '/api/event-images/image-2/variants/320' }] },
    { id: 'image-3', altText: 'Third alt', variants: [{ width: 320, height: 180, url: '/api/event-images/image-3/variants/320' }] },
    { id: 'image-4', altText: 'Fourth alt', variants: [{ width: 320, height: 180, url: '/api/event-images/image-4/variants/320' }] }
  ],
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
  organization: { id: '22222222-2222-2222-2222-222222222222', name: 'Gones', description: undefined, website: 'https://example.test', contactEmail: undefined, organizers: ['adam', 'zoe'] },
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
const whereRow = source.slice(source.indexOf('data-cy="event-detail-where-row"'), source.indexOf('</p>', source.indexOf('data-cy="event-detail-where-row"')));
const whenRow = source.slice(source.indexOf('data-cy="event-detail-when-row"'), source.indexOf('</p>', source.indexOf('data-cy="event-detail-when-row"')));

describe('EventDetailViewComponent hero', () => {
  it('renders the backend display title without reconstructing format or capacity', () => {
    expect(title).toContain('{{ displayTitle() }}');
    expect(title).not.toContain('event().title');
    expect(title).not.toContain('titleFormat');
    expect(title).not.toContain('event().capacity');
    expect(source).not.toContain('titleFormat = computed');
  });

  it('renders localized singular, plural and unlimited player counts beside the heading', () => {
    expect(translate('en', 'event.playerCount', { count: 1 })).toBe('1 player');
    expect(translate('en', 'event.playerCountPlural', { count: 32 })).toBe('32 players');
    expect(translate('fr', 'event.playerCount', { count: 1 })).toBe('1 joueur');
    expect(translate('fr', 'event.playerCountPlural', { count: 32 })).toBe('32 joueurs');
    expect(source).toContain('data-cy="event-detail-player-count"');
    expect(source).toContain('{{ playerCount() }}');
    expect(build({ capacity: 1 }).playerCount()).toBe(translate('fr', 'event.playerCount', { count: 1 }));
    expect(build({ capacity: 32 }).playerCount()).toBe(translate('fr', 'event.playerCountPlural', { count: 32 }));
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
    expect(whenRow).toContain('data-cy="event-detail-when"');
    expect(whenRow).toContain('naturalDate()');
    expect(whenRow).toContain('data-cy="event-detail-when-separator"');
    expect(whenRow).toContain('data-cy="event-detail-starting-hour"');
    expect(whereRow).toContain('data-cy="event-detail-where"');
    expect(whereRow).toContain('{{ venueDisplay() }}');
    expect(stylesheet).toContain('.event-when,');
  });

  it('location renders as a maps link', () => {
    const component = build({ venue: { city: 'Lyon' } } as Partial<PublicEventDetailResponse>);
    expect(component.mapsUrl()).toBe('https://www.google.com/maps/search/?api=1&query=Lyon');
    const link = whereRow.slice(whereRow.indexOf('data-cy="event-detail-where-link"'));
    expect(link).toContain('[href]="url"');
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
    expect(link).toContain(`i18n.t('event.openInMaps', { address: venue() })`);
    expect(link).toContain('class="maps-icon"');
    expect(link).toContain('aria-hidden="true"');
    expect(stylesheet).toContain('.maps-icon {');
  });

  it('location stays plain text without an address', () => {
    const component = build({ venue: {} } as Partial<PublicEventDetailResponse>);
    expect(component.mapsUrl()).toBeNull();
    expect(whereRow).toContain('@if (mapsUrl(); as url)');
    expect(whereRow).toContain('@else { <span data-cy="event-detail-where" [class.muted]="showVenuePlaceholder()">{{ venueDisplay() }}</span> }');
  });

  it('organization fact block is gone', () => {
    expect(source).not.toContain('event-detail-fact-organization');
    expect(source).not.toContain('class="event-facts"');
  });

  it('has no actions row', () => {
    expect(source).not.toContain('data-cy="event-detail-actions"');
    expect(source).not.toContain('event-detail-live-tournament');
    expect(source).not.toContain('event-detail-archive-tournament');
    expect(source).not.toContain('event-detail-organization-website');
  });

  it('renders the title line', () => {
    expect(whenRow).toContain('data-cy="event-detail-starting-hour"');
    expect(whenRow).toContain("i18n.t('event.startingHour')");
    expect(whenRow).toContain('{{ startTime() }}');
    expect(build({ venueStartTime: '14:00:00', capacity: 32 }).startTime()).toBe('14:00');
    expect(build({ venueStartTime: '14:00:00', capacity: 32 }).playerCount()).toContain('32');
  });

  it('uses the singular for one player', () => {
    expect(build({ capacity: 1 }).playerCount()).toContain('1 joueur');
  });

  it('says unlimited with no capacity', () => {
    const count = build({ capacity: undefined }).playerCount();
    expect(count).not.toContain('undefined');
    expect(count).toBe(translate('fr', 'registration.unlimited'));
  });

  it('shows venue time not viewer time', () => {
    expect(build({ venueStartTime: '14:00:00', timeZoneId: 'Europe/Paris' }).startTime()).toBe('14:00');
    expect(whenRow).toContain('{{ startTime() }}');
  });

  it('links the kicker to the website', () => {
    const kicerIdx = source.indexOf('event-detail-kicker-link');
    expect(kicerIdx).toBeGreaterThan(-1);
    const kicker = source.slice(source.lastIndexOf('<a', kicerIdx), source.indexOf('>', kicerIdx) + 1);
    expect(kicker).toContain('[href]');
    expect(kicker).toContain('externalLinkAttrs');
  });

  it('keeps a plain kicker with no website', () => {
    expect(source).toContain('data-cy="event-detail-kicker"');
    expect(source).toContain('@else { <p class="kicker" data-cy="event-detail-kicker">');
  });

  it('keeps an ics action', () => {
    expect(source).toContain('@if (showIcsAction() && icsUrl(); as url)');
    expect(source).toContain('data-cy="event-ics"');
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

  // The Add-to-Calendar rule is asserted on the anchor a visitor actually reaches, in
  // `public-event-detail.component.test.ts` — the hero anchor here is opted out by its only host.
  it('keeps the hero anchor consistent with it when a host opts in', () => {
    const icsMarker = source.indexOf('data-cy="event-ics"');
    const icsAnchor = source.slice(source.lastIndexOf('<a', icsMarker), source.indexOf('</a>', icsMarker));

    expect(icsAnchor).not.toContain(' download');
    expect(icsAnchor).toContain('type="text/calendar"');
  });

  it('renders the organizer row', () => {
    const component = build({ organization: { ...event.organization, organizers: ['adam', 'zoe'] } } as Partial<PublicEventDetailResponse>);
    expect(component.organizers()).toEqual(['adam', 'zoe']);
    expect(source).toContain('data-cy="event-detail-organizers"');
    expect(source).toContain("organizers().join(', ')");
  });

  it('omits the row when there are none', () => {
    const component = build({ organization: { ...event.organization, organizers: [] } } as Partial<PublicEventDetailResponse>);
    expect(component.organizers()).toEqual([]);
    expect(source).toContain('@if (organizers().length)');
  });

  // T8: hero reorder (round 6 feedback)
  it('hero children in order', () => {
    const hero = source.slice(source.indexOf('<section class="event-hero panel"'), source.indexOf('</section>', source.indexOf('<section class="event-hero panel"')));
    const order = ['event-detail-topline', 'event-detail-title', 'event-detail-summary', 'event-detail-when-row', 'event-detail-where-row', 'event-detail-organizers'];
    const indices = order.map(cy => hero.indexOf(`data-cy="${cy}"`));
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    }
  });

  it('player count sits left beside the organization with larger type', () => {
    const hero = source.slice(source.indexOf('<section class="event-hero panel"'), source.indexOf('</section>', source.indexOf('<section class="event-hero panel"')));
    const toplineEnd = hero.indexOf('</div>', hero.indexOf('data-cy="event-detail-topline"'));
    const toplineContent = hero.slice(0, toplineEnd);
    expect(toplineContent).toContain('data-cy="event-detail-player-count"');
    const h1End = hero.indexOf('</h1>', hero.indexOf('<h1'));
    const h1Content = hero.slice(hero.indexOf('<h1'), h1End);
    expect(h1Content).not.toContain('data-cy="event-detail-player-count"');
    const toplineRule = stylesheet.match(/\.event-hero-topline \{[^}]*\}/)?.[0] ?? '';
    expect(toplineRule).toContain('justify-content: flex-start');
    const countRule = stylesheet.match(/\.event-player-count \{[^}]*\}/)?.[0] ?? '';
    expect(countRule).toContain('font-size: 1.1rem');
  });

  it('title holds only the title text', () => {
    expect(title).toContain('data-cy="event-detail-title-text"');
    expect(title).toContain('{{ displayTitle() }}');
    expect(title).not.toContain('event-detail-player-count');
    expect(title).not.toContain('event-detail-starting-hour');
  });

  it('date row is natural language', () => {
    const whenContent = source.slice(source.indexOf('data-cy="event-detail-when-row"'), source.indexOf('</p>', source.indexOf('data-cy="event-detail-when-row"')));
    expect(whenContent).toContain('data-cy="event-detail-when"');
    expect(whenContent).toContain('naturalDate()');
    const component = build({ venueStartDate: '2026-09-12', venueStartTime: '18:00:00' });
    expect(component.naturalDate()).toContain('septembre');
    expect(component.naturalDate()).not.toContain(':');
    expect(component.naturalDate()).not.toContain('(');
  });

  it('start hour is its own span', () => {
    const h1End = source.indexOf('</h1>', source.indexOf('<h1 id="event-title"'));
    const startingHourIdx = source.indexOf('data-cy="event-detail-starting-hour"');
    expect(startingHourIdx).toBeGreaterThan(h1End);
    expect(build({ venueStartTime: '18:00:00' }).startTime()).toBe('18:00');
  });

  it('address row holds only the address', () => {
    const whereContent = source.slice(source.indexOf('data-cy="event-detail-where-row"'), source.indexOf('</p>', source.indexOf('data-cy="event-detail-where-row"')));
    expect(whereContent).not.toContain('date()');
    expect(whereContent).not.toContain('primary');
    expect(whereContent).toContain('venue()');
    expect(build().venue()).toBe('1 Rue Test, 69001, Lyon, France');
  });

  it('viewer time still renders when zones differ', () => {
    const whenRowIdx = source.indexOf('data-cy="event-detail-when-row"');
    const viewerIdx = source.indexOf('data-cy="event-detail-fact-date-viewer"');
    expect(viewerIdx).toBeGreaterThan(whenRowIdx);
    expect(source).toContain('event-detail-fact-date-viewer');
  });

  it('no when-where hook survives', () => {
    expect(source).not.toContain('event-detail-when-where');
  });

  it('renders ordered responsive hero and gallery media with exact alt fallback', () => {
    const component = build();
    expect(component.imageAlt(event.images[0], 0)).toBe('Hero alt');
    expect(component.imageAlt(event.images[1], 1)).toBe('Modern — AURA Open — image 2');
    expect(component.imageSource(event.images[0])).toBe('/api/event-images/image-1/variants/960');
    expect(component.imageSourceSet(event.images[0])).toBe('/api/event-images/image-1/variants/320 320w, /api/event-images/image-1/variants/960 960w');
    expect(source).toContain('data-cy="event-detail-media-hero"');
    expect(source).toContain('data-cy="event-detail-media-gallery"');
    expect(source).toContain('@for (image of galleryImages(); track image.id; let position = $index)');
    expect(stylesheet).toMatch(/\.event-media-hero[^}]*aspect-ratio:\s*16\s*\/\s*9/);
    expect(stylesheet).toMatch(/\.event-media-image[^}]*object-fit:\s*contain/);
    expect(stylesheet).toMatch(/\.event-media-gallery[^}]*grid-template-columns:\s*repeat\(3,/);
    expect(stylesheet).toMatch(/@media[^}]*max-width:\s*700px[\s\S]*\.event-media-gallery[^}]*grid-template-columns:\s*1fr/);
  });

  it('implements dialog keyboard navigation, focus trap, Escape close and trigger focus restore', () => {
    const component = build();
    const trigger = document.createElement('button');
    const focus = vi.spyOn(trigger, 'focus');

    component.openLightbox(1, trigger);
    expect(component.lightboxIndex()).toBe(1);
    component.onLightboxKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }));
    expect(component.lightboxIndex()).toBe(2);
    component.onLightboxKeydown(new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }));
    expect(component.lightboxIndex()).toBe(1);
    component.onLightboxKeydown(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(component.lightboxIndex()).toBeNull();
    expect(focus).toHaveBeenCalledOnce();

    const dialog = document.createElement('div');
    dialog.innerHTML = '<button id="first">First</button><button id="last">Last</button>';
    document.body.append(dialog);
    const first = dialog.querySelector<HTMLElement>('#first')!;
    const last = dialog.querySelector<HTMLElement>('#last')!;
    last.focus();
    trapDialogFocus(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }), dialog);
    expect(document.activeElement).toBe(first);
    first.focus();
    trapDialogFocus(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true }), dialog);
    expect(document.activeElement).toBe(last);
    dialog.remove();

    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain('(keydown)="onLightboxKeydown($event)"');
  });

  it('renders and operates the accessible lightbox in the real component DOM', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const application = await createApplication({ providers: [DeckArchetypeSettingsService, I18nService] });
    const reference = createComponent(EventDetailViewComponent, { hostElement: host, environmentInjector: application.injector });
    Object.defineProperty(reference.instance, 'event', { value: signal({ ...event, bodyHtml: undefined }) });
    application.attachView(reference.hostView);
    reference.changeDetectorRef.detectChanges();

    const heroTrigger = host.querySelector<HTMLButtonElement>('[data-cy="event-detail-media-hero"]')!;
    heroTrigger.focus();
    heroTrigger.click();
    reference.changeDetectorRef.detectChanges();
    await new Promise(resolve => setTimeout(resolve));

    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe(translate('fr', 'event.imageDialogLabel'));
    expect(dialog.querySelector('img')?.getAttribute('alt')).toBe('Hero alt');
    expect(document.activeElement).toBe(dialog.querySelector('[data-cy="event-detail-lightbox-close"]'));

    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    reference.changeDetectorRef.detectChanges();
    expect(dialog.querySelector('img')?.getAttribute('alt')).toBe('Modern — AURA Open — image 2');
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    reference.changeDetectorRef.detectChanges();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(heroTrigger);

    application.detachView(reference.hostView);
    reference.destroy();
    application.destroy();
    host.remove();
  });

  it('shows muted title and location placeholders only in explicit draft mode', () => {
    const publicView = build({ displayTitle: '', venue: {} } as Partial<PublicEventDetailResponse>);
    expect(publicView.displayTitle()).toBe('');
    expect(publicView.venueDisplay()).toBe('');

    const draftView = build({ displayTitle: '', venue: {} } as Partial<PublicEventDetailResponse>);
    Object.defineProperty(draftView, 'draftPlaceholderMode', { value: signal(true) });
    expect(draftView.displayTitle()).toBe(translate('fr', 'event.draftTitlePlaceholder'));
    expect(draftView.venueDisplay()).toBe(translate('fr', 'event.draftLocationPlaceholder'));
    expect(source).toContain("[class.muted]=\"showTitlePlaceholder()\"");
    expect(source).toContain("[class.muted]=\"showVenuePlaceholder()\"");
  });

  it('is the last hero child', () => {
    const heroSection = source.slice(source.indexOf('<section class="event-hero panel"'), source.indexOf('</section>'));
    const organizersIdx = heroSection.indexOf('event-detail-organizers');
    const viewerIdx = heroSection.indexOf('event-detail-fact-date-viewer');
    expect(organizersIdx).toBeGreaterThan(viewerIdx);
  });
});
