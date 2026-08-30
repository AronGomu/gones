import '@angular/compiler';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nService } from '../../i18n/i18n.service';
import { catalogs, MessageKey } from '../../i18n/messages';
import { EventCatalogCacheService, EventCatalogResult } from '../events/event-catalog-cache.service';
import { PublicEventView } from '../events/public-event-list';
import { AboutComponent } from './about.component';

const source = readFileSync(join(__dirname, 'about.component.ts'), 'utf8');
const stylesSource = readFileSync(join(__dirname, '../../../styles.css'), 'utf8');
const routesSource = readFileSync(join(__dirname, '../../app.routes.ts'), 'utf8');
const guardSource = readFileSync(join(__dirname, '../../shared/first-visit.guard.ts'), 'utf8');
const homeMenuSource = readFileSync(join(__dirname, 'home-menu.component.ts'), 'utf8');

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

@Component({ selector: 'gones-back-button', standalone: true, template: '' })
class BackButtonStub {
  @Input() link: readonly string[] = [];
  @Input() label = '';
  @Input() position = '';
}

@Component({ selector: 'gones-sync-bar', standalone: true, template: '<button type="button" [attr.data-cy]="cyPrefix + \'-sync-button\'" [disabled]="loading" (click)="sync.emit()">Sync</button>' })
class SyncBarStub {
  @Input() cyPrefix = '';
  @Input() syncedAt: string | undefined;
  @Input() loading = false;
  @Input() stale = false;
  @Output() sync = new EventEmitter<void>();
}

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function event(slug: string, startsAtUtc = new Date(Date.now() + 86_400_000).toISOString()): PublicEventView {
  const date = startsAtUtc.slice(0, 10);
  return {
    id: slug,
    title: slug,
    displayTitle: `Display ${slug}`,
    slug,
    summary: undefined,
    venue: { city: 'Lyon', country: 'FR' } as PublicEventView['venue'],
    timeZoneId: 'Europe/Paris',
    venueStartDate: date,
    venueStartTime: '12:00:00',
    venueEndDate: date,
    venueEndTime: '18:00:00',
    startsAtUtc,
    endsAtUtc: new Date(new Date(startsAtUtc).getTime() + 3_600_000).toISOString(),
    capacity: undefined,
    status: 'published',
    organization: undefined as unknown as PublicEventView['organization'],
    formats: [] as PublicEventView['formats']
  };
}

function result(items: PublicEventView[], stale = false): EventCatalogResult {
  return { items, fetchedAt: '2026-08-30T12:00:00.000Z', fromCache: stale, stale, truncated: false };
}

function createAboutFixture(load: (options?: { force?: boolean }) => Promise<EventCatalogResult>) {
  const catalog = { load: vi.fn(load) };
  TestBed.configureTestingModule({
    imports: [AboutComponent, RouterTestingModule.withRoutes([])],
    providers: [
      { provide: I18nService, useValue: {
        language: () => 'en',
        locale: () => 'en-US',
        t: (key: string) => key,
        formatDateTime: (value: string) => value
      } },
      { provide: EventCatalogCacheService, useValue: catalog },
    ]
  });
  TestBed.overrideComponent(AboutComponent, { set: { imports: [RouterLink, BackButtonStub, SyncBarStub] } });
  const fixture = TestBed.createComponent(AboutComponent);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, load: catalog.load };
}

async function settle<T>(fixture: { whenStable: () => Promise<T>; detectChanges: () => void }): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
}

const aboutKeys = [
  'about.back',
  'about.nav.aria',
  'about.nav.association',
  'about.nav.tournaments',
  'about.nav.staff',
  'about.nav.calendar',
  'about.nextUp.kicker',
  'about.nextUp.title',
  'about.nextUp.emptyTitle',
  'about.nextUp.emptyBody',
  'about.nextUp.calendar',
  'about.nextUp.loadFailed',
  'about.hero.kicker',
  'about.hero.title',
  'about.hero.lede',
  'about.hero.calendar',
  'about.hero.team',
  'about.hero.logoAria',
  'about.hero.logoCaption',
  'about.intro.kicker',
  'about.intro.title',
  'about.intro.paragraph1',
  'about.intro.paragraph2',
  'about.intro.paragraph3',
  'about.numbers.aria',
  'about.numbers.weeklyTerm',
  'about.numbers.weeklyValue',
  'about.numbers.playersTerm',
  'about.numbers.playersValue',
  'about.numbers.formatTerm',
  'about.numbers.formatValue',
  'about.weekly.datePrefix',
  'about.weekly.dateDay',
  'about.weekly.kicker',
  'about.weekly.title',
  'about.weekly.body',
  'about.weekly.calendar',
  'about.events.kicker',
  'about.events.body',
  'about.events.fireSeason',
  'about.events.iceSeason',
  'about.events.formatsTitle',
  'about.events.formatsAria',
  'about.events.formatRulesAria',
  'about.team.kicker',
  'about.team.title',
  'about.team.body',
  'about.team.founders',
  'about.team.members',
  'about.team.roleFounder',
  'about.team.roleOrganizer',
  'about.team.roleCook',
  'about.team.roleCommunityManager',
  'about.team.roleMediaCreator',
  'about.team.photoPending',
  'about.team.namePending',
  'about.team.bioPending',
  'about.team.bioGregory',
  'about.team.bioAlex',
  'about.team.bioLoic',
  'about.team.bioLuka',
  'about.contributors.kicker',
  'about.contributors.title',
  'about.contributors.body',
  'about.contributors.pendingName',
  'about.contributors.pendingDescription',
  'about.contact.kicker',
  'about.contact.title',
  'about.contact.body',
  'about.contact.calendar',
  'about.contact.locationLabel',
  'about.contact.locationValue',
  'about.contact.emailLabel',
  'about.contact.emailPending',
  'about.contact.comingSoon',
  'about.contact.socialsLabel',
  'about.contact.discordAria',
  'about.contact.facebookAria',
  'about.contact.xAria'
] satisfies MessageKey[];

const staffOrder = ['gregory', 'ganesh', 'edouart', 'alex', 'loic', 'luka', 'nathan', 'yoan', 'simon'] as const;
const completeStaff = ['gregory', 'alex', 'loic', 'luka'] as const;
const pendingStaff = ['ganesh', 'edouart', 'nathan', 'yoan', 'simon'] as const;
const avatarPaths = [
  'assets/images/greg-avatar.jpeg',
  'assets/images/alex-avatar-alpha-bolt.jpeg',
  'assets/images/chowchow-avatar.jpg',
  'assets/images/lukas-avatar.jpg'
] as const;

function blockFor(id: string): string {
  const rosterStart = source.indexOf('export const aboutStaff');
  const start = source.indexOf(`id: '${id}'`, rosterStart);
  const end = source.indexOf("id: '", start + 5);
  return source.slice(start, end === -1 ? source.length : end);
}

describe('AboutComponent live Next Up behavior', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('keeps skeleton geometry and visual treatment scoped to About', () => {
    expect(source).toContain(':host.about-route .about-next-up__skeleton');
    expect(source).toContain('min-height: 5.5rem');
    expect(source).toContain('background: linear-gradient');
  });

  it('renders three rows after initial cache success and settles loading', async () => {
    const first = deferred<EventCatalogResult>();
    const { fixture, component, load } = createAboutFixture(() => first.promise);

    expect(load).toHaveBeenCalledWith();
    expect(component.loading()).toBe(true);
    expect(fixture.nativeElement.querySelectorAll('.about-next-up__skeleton').length).toBe(3);

    first.resolve(result([event('one'), event('two'), event('three'), event('four')]));
    await settle(fixture);

    expect(component.loading()).toBe(false);
    expect(component.error()).toBe(false);
    expect(component.stale()).toBe(false);
    expect(component.syncedAt()).toBe('2026-08-30T12:00:00.000Z');
    expect(fixture.nativeElement.querySelectorAll('.about-next-up__row').length).toBe(3);
  });

  it('keeps stale cache rows usable without showing error', async () => {
    const { fixture, component } = createAboutFixture(() => Promise.resolve(result([event('stale-event')], true)));
    await settle(fixture);

    expect(component.stale()).toBe(true);
    expect(component.error()).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-cy="about-next-up-event-stale-event"]')).not.toBeNull();
  });

  it('renders empty state with calendar CTA when no future events exist', async () => {
    const { fixture, component } = createAboutFixture(() => Promise.resolve(result([])));
    await settle(fixture);

    expect(component.loading()).toBe(false);
    expect(component.upcomingEvents()).toEqual([]);
    expect(fixture.nativeElement.querySelector('[data-cy="about-next-up-empty"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-cy="about-next-up-empty"] a')?.getAttribute('href')).toBe('/events');
    expect(fixture.nativeElement.querySelector('[data-cy="about-next-up-event-one"]')).toBeNull();
  });

  it('renders failure recovery and retries with force', async () => {
    const first = deferred<EventCatalogResult>();
    const retry = deferred<EventCatalogResult>();
    const load = vi.fn((options: { force?: boolean } = {}) => options.force ? retry.promise : first.promise);
    const { fixture, component } = createAboutFixture(load);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    first.reject(new Error('offline'));
    await settle(fixture);

    expect(component.loading()).toBe(false);
    expect(component.error()).toBe(true);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-cy="about-next-up-retry"]')).not.toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('about.load-upcoming-events'));

    (fixture.nativeElement.querySelector('[data-cy="about-next-up-retry"]') as HTMLButtonElement).click();
    expect(load).toHaveBeenLastCalledWith({ force: true });
    retry.resolve(result([event('recovered')]));
    await settle(fixture);

    expect(component.error()).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-cy="about-next-up-event-recovered"]')).not.toBeNull();
    errorSpy.mockRestore();
  });

  it('keeps latest forced load result when initial request finishes later', async () => {
    const initial = deferred<EventCatalogResult>();
    const forced = deferred<EventCatalogResult>();
    const load = vi.fn((options: { force?: boolean } = {}) => options.force ? forced.promise : initial.promise);
    const { fixture, component } = createAboutFixture(load);

    component.syncUpcomingEvents();
    expect(load).toHaveBeenNthCalledWith(2, { force: true });

    forced.resolve(result([event('latest')]));
    await settle(fixture);
    expect(fixture.nativeElement.querySelector('[data-cy="about-next-up-event-latest"]')).not.toBeNull();

    initial.resolve(result([event('old')]));
    await settle(fixture);
    expect(fixture.nativeElement.querySelector('[data-cy="about-next-up-event-latest"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-cy="about-next-up-event-old"]')).toBeNull();
  });

  it('uses force load when sync button is activated', async () => {
    const initial = deferred<EventCatalogResult>();
    const forced = deferred<EventCatalogResult>();
    const load = vi.fn((options: { force?: boolean } = {}) => options.force ? forced.promise : initial.promise);
    const { fixture } = createAboutFixture(load);

    initial.resolve(result([event('before-sync')]));
    await settle(fixture);
    (fixture.nativeElement.querySelector('[data-cy="about-next-up-sync-button"]') as HTMLButtonElement).click();
    expect(load).toHaveBeenLastCalledWith({ force: true });

    forced.resolve(result([event('after-sync')]));
    await settle(fixture);
    expect(fixture.nativeElement.querySelector('[data-cy="about-next-up-event-after-sync"]')).not.toBeNull();
  });

  it('binds event row RouterLink to event detail segments', async () => {
    const { fixture } = createAboutFixture(() => Promise.resolve(result([event('salty-2')])));
    await settle(fixture);

    const row = fixture.debugElement.query(By.css('[data-cy="about-next-up-event-salty-2"]'));
    expect(row.nativeElement.getAttribute('href')).toBe('/events/salty-2');
  });
});

describe('AboutComponent route and interaction contract', () => {
  it('keeps the root route, first-visit redirect, and home About entry boundary intact', () => {
    expect(routesSource).toContain("{ path: '', canActivate: [firstVisitHomeGuard]");
    expect(routesSource).toContain("{ path: 'about', canActivate: [markVisitedGuard]");
    expect(guardSource).toContain("return inject(Router).createUrlTree(['/about']);");
    expect(homeMenuSource).toContain("'home.about'");
    expect(homeMenuSource).toContain("routerLink=\"/about\"");
  });

  it('exposes shell-safe internal navigation, CTAs, and both return actions', () => {
    for (const fragment of ['association', 'tournaments', 'staff']) {
      expect(source).toContain(`href="#${fragment}"`);
    }
    expect(source).toContain('routerLink="/events"');
    expect(source).toContain('href="#tournaments"');
    expect(source.match(/<gones-back-button/g)?.length).toBe(2);
    expect(source.match(/\[link\]="\['\/']"/g)?.length).toBe(2);
    expect(source.match(/about\.back/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('covers live Next Up states, sync, retry, and detail navigation contract', () => {
    expect(source).toContain("import { selectUpcomingEvents } from './about-upcoming-events';");
    expect(source).toContain('EventCatalogCacheService');
    expect(source).toContain('implements OnInit, AfterViewInit, OnDestroy');
    expect(source).toContain('readonly upcomingSkeletons: readonly [0, 1, 2] = [0, 1, 2]');
    expect(source).toContain('<gones-sync-bar cyPrefix="about-next-up"');
    expect(source).toContain('(sync)="syncUpcomingEvents()"');
    expect(source).toContain('aria-busy="true"');
    expect(source).toContain("i18n.t('common.loading')");
    expect(source).toContain("i18n.t('about.nextUp.emptyTitle')");
    expect(source).toContain("i18n.t('about.nextUp.loadFailed')");
    expect(source).toContain('role="alert"');
    expect(source).toContain('routerLink="/events"');
    expect(source).toContain("[routerLink]=\"['/events', event.slug]\"");
    expect(source).toContain('this.upcomingEvents.set([]);');
    expect(source).toContain("logBoundaryError('about.load-upcoming-events', error)");
    expect(source).toContain('if (loadId !== this.upcomingLoadId) return;');
    expect(source).toContain('this.loading.set(false)');
    expect(source).toContain('loadUpcomingEvents(true)');
  });

  it('keeps verified socials active and unknown contacts disabled without placeholder hrefs', () => {
    for (const url of [
      'https://discord.gg/znGRG36Kz',
      'https://www.facebook.com/mtgones/',
      'https://x.com/MtgOnes'
    ]) {
      const urlIndex = source.indexOf(url);
      const link = source.slice(source.lastIndexOf('<a', urlIndex), source.indexOf('</a>', urlIndex));
      expect(link).toContain('target="_blank"');
      expect(link).toContain('rel="noopener noreferrer"');
    }

    expect(source).toContain("i18n.t('about.contact.comingSoon')");
    expect(source).toContain('aria-disabled="true"');
    expect(source).toContain('tabindex="-1"');
    const emailBlock = source.slice(source.indexOf('data-cy="about-contact-email"'), source.indexOf('</p>', source.indexOf('data-cy="about-contact-email"')));
    const instagramBlock = source.slice(source.indexOf('data-cy="about-contact-instagram"'), source.indexOf('</span>', source.indexOf('data-cy="about-contact-instagram"')));
    expect(emailBlock).not.toContain('href');
    expect(instagramBlock).not.toContain('href');
  });
});

describe('AboutComponent roster and asset contract', () => {
  it('defines ordered staff data with exact completeness and role invariants', () => {
    expect(source).toContain('aboutStaff: readonly AboutStaffMember[]');
    let previousIndex = -1;
    for (const id of staffOrder) {
      const index = source.indexOf(`id: '${id}'`);
      expect(index, `missing staff ${id}`).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }

    for (const id of completeStaff) {
      expect(blockFor(id)).toContain('complete: true');
      expect(blockFor(id)).toContain('image:');
      expect(blockFor(id)).toContain('imageWidth:');
      expect(blockFor(id)).toContain('imageHeight:');
    }
    for (const id of pendingStaff) {
      expect(blockFor(id)).toContain('complete: false');
      expect(blockFor(id)).not.toContain('image:');
    }
    expect(blockFor('alex')).not.toContain('roleKey:');
    expect(source).toContain("@if (member.roleKey; as roleKey)");
    expect(source).toContain('aboutContributors: readonly AboutContributor[]');
    expect(source).toContain("id: 'contributor-1'");
    expect(source).toContain("id: 'contributor-2'");
    expect(source).toContain("id: 'contributor-3'");
  });

  it('uses existing avatar assets with positive declared dimensions', () => {
    for (const path of avatarPaths) {
      expect(source).toContain(path);
      expect(existsSync(join(__dirname, '../../../assets/images', path.split('/').pop()!))).toBe(true);
    }
    for (const id of completeStaff) {
      const block = blockFor(id);
      expect(block).toMatch(/imageWidth: [1-9]\d*/);
      expect(block).toMatch(/imageHeight: [1-9]\d*/);
    }
  });
});

describe('AboutComponent approved layout contract', () => {
  it('keeps approved landing order and semantic hierarchy', () => {
    const anchors = ['about-hero', 'about-next-up', 'association', 'tournaments', 'staff', 'about-contact'];
    const positions = anchors.map(anchor => source.indexOf(anchor === 'association' || anchor === 'tournaments' || anchor === 'staff' ? `id="${anchor}"` : `data-cy="${anchor}"`));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect((source.match(/<h1\b/g) ?? []).length).toBe(1);
    expect((source.match(/<h2\b/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(source).toContain('id="association"');
    expect(source).toContain('id="tournaments"');
    expect(source).toContain('id="staff"');
  });

  it('renders five ordered tournament articles with one combined Fire/Ice section', () => {
    const ids = ['weekly', 'monthly', 'salty', 'leagues'];
    const dataStart = source.indexOf('export const aboutTournamentBands');
    const dataEnd = source.indexOf('];', dataStart);
    const dataSource = source.slice(dataStart, dataEnd);
    const positions = ids.map(id => dataSource.indexOf(`id: '${id}'`));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(source).toContain('[attr.data-cy]="\'about-\' + band.id"');
    const template = source.slice(source.indexOf('template: `'));
    expect(template.indexOf('tournamentBands.slice(0, 3)')).toBeLessThan(template.indexOf('data-cy="about-fire-ice"'));
    expect(template.indexOf('data-cy="about-fire-ice"')).toBeLessThan(template.indexOf('tournamentBands.slice(3)'));
    expect((source.match(/about-fire-ice/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(source).toContain('assets/card-art/fire-ice.jpg');
    expect(stylesSource).toContain('--fire-ember');
    expect(stylesSource).toContain('--ice-glacier');
  });

  it('declares inspected image dimensions and bounded lazy content media', () => {
    for (const declaration of [
      'assets/images/2025-01-ice-mtgones-10-years.jpeg',
      'assets/images/2019-10-mtglyon-mtgones-gathering.jpeg',
      'assets/images/2024-01-gones-legacy-brindas-01.jpeg',
      'assets/images/2021-12-gones-legacy-top-8-cartajeu.jpeg',
      'assets/images/2023-05-gones-legacy-fact-top-8.jpeg',
      'assets/images/2025-06-fire-team-orga.jpeg',
      'assets/images/2026-01-ice-01.jpeg',
      'assets/images/2025-01-mtgones-10-years-top-2.jpeg'
    ]) expect(source).toContain(declaration);
    expect(stylesSource).toContain('aspect-ratio: 3 / 2');
    expect(stylesSource).toContain('max-height: 380px');
    expect(source).toContain('loading="lazy"');
    expect(source).toContain('decoding="async"');
    expect(stylesSource).toContain('object-position: center top');
  });

  it('keeps complete staff dimensions aligned with inspected source assets', () => {
    expect(blockFor('gregory')).toContain('imageWidth: 1152, imageHeight: 2048');
    expect(blockFor('alex')).toContain('imageWidth: 672, imageHeight: 936');
    expect(blockFor('loic')).toContain('imageWidth: 1080, imageHeight: 1920');
    expect(blockFor('luka')).toContain('imageWidth: 720, imageHeight: 719');
    expect(source).toContain('aboutContributors: readonly AboutContributor[]');
  });

  it('does not duplicate static data-cy hooks', () => {
    const hooks = [...source.matchAll(/data-cy="([^"]+)"/g)].map(match => match[1]);
    expect(new Set(hooks).size).toBe(hooks.length);
  });
});

describe('AboutComponent i18n contract', () => {
  it('binds host language to active locale without forced French', () => {
    expect(source).toContain("'[attr.lang]': 'i18n.language()'");
    expect(source).not.toContain("lang: 'fr'");
  });

  it('uses translation keys for representative full-page content', () => {
    for (const key of [
      'about.hero.title',
      'about.intro.paragraph1',
      'about.tournament.weekly.body',
      'about.fireIce.fire',
      'about.team.roleOrganizer',
      'about.team.bioPending',
      'about.team.bioGregory',
      'about.contributors.pendingDescription',
      'about.contact.discordAria',
      'about.contact.comingSoon'
    ]) {
      expect(source).toContain(key);
    }

    expect(source).not.toContain('Le Legacy se joue à Lyon.');
    expect(source).not.toContain('Biographie à venir.');
    expect(source).not.toContain('nouvel onglet');
  });

  it('defines complete non-empty English and French About catalogs', () => {
    for (const key of aboutKeys) {
      expect(catalogs.en[key], `missing EN ${key}`).toBeTruthy();
      expect(catalogs.fr[key], `missing FR ${key}`).toBeTruthy();
    }

    expect(catalogs.en['about.hero.title']).toBe('Legacy is played in Lyon.');
    expect(catalogs.fr['about.hero.title']).toBe('Le Legacy se joue à Lyon.');
    const gregoryBio = "Joueur depuis 2000, débuts avec Invasion et le bloc IPA. Beaucoup d'ancien jeu organisé (CR, QT, GP) en Standard & Étendu, puis le Legacy en 2007, où il rencontre Alex. Après avoir aidé MtgLyon, il fonde MTGones en 2015 avec notre regretté Toon pour organiser la CDF Legacy d'octobre 2015, puis Ganesh et la team d'aujourd'hui. Plus belle perf : 57e sur 1200 au GP Birmingham Legacy (11W–4L). Jeu préféré : Storm ⛈️.";
    expect(catalogs.en['about.team.bioGregory']).toBe(gregoryBio);
    expect(catalogs.fr['about.team.bioGregory']).toBe(gregoryBio);
  });

  it('preserves stable names, social URLs, paths, and approved complete bios', () => {
    for (const value of [
      'Gregory Millon',
      'Ganesh',
      'Edouart',
      'Alex Noir',
      'Loïc Chowchow',
      'Luka Mrakovcic',
      'Nathan Flachaire',
      ...avatarPaths,
      'https://discord.gg/znGRG36Kz',
      'https://www.facebook.com/mtgones/',
      'https://x.com/MtgOnes'
    ]) {
      expect(source).toContain(value);
    }
    expect(catalogs.en['about.team.bioAlex']).toContain('Korean enthusiast');
    expect(catalogs.en['about.team.bioLuka']).toContain('play Magic');
    expect(catalogs.en['about.team.bioLoic']).toContain('Began playing MTG in 1996');
  });
});
