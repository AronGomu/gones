import '@angular/compiler';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalogs, MessageKey } from '../../i18n/messages';

const source = readFileSync(join(__dirname, 'about.component.ts'), 'utf8');
const routesSource = readFileSync(join(__dirname, '../../app.routes.ts'), 'utf8');
const guardSource = readFileSync(join(__dirname, '../../shared/first-visit.guard.ts'), 'utf8');
const homeMenuSource = readFileSync(join(__dirname, 'home-menu.component.ts'), 'utf8');

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

describe('AboutComponent i18n contract', () => {
  it('binds host language to active locale without forced French', () => {
    expect(source).toContain("'[attr.lang]': 'i18n.language()'");
    expect(source).not.toContain("lang: 'fr'");
  });

  it('uses translation keys for representative full-page content', () => {
    for (const key of [
      'about.hero.title',
      'about.intro.paragraph1',
      'about.weekly.body',
      'about.events.fireSeason',
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
