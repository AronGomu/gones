import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalogs, MessageKey } from '../../i18n/messages';

const source = readFileSync(join(__dirname, 'about.component.ts'), 'utf8');

const aboutKeys = [
  'about.back',
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
  'about.contact.socialsLabel',
  'about.contact.discordAria',
  'about.contact.facebookAria',
  'about.contact.xAria'
] satisfies MessageKey[];

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
      'about.contributors.pendingDescription',
      'about.contact.discordAria'
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
  });

  it('preserves names, social URLs, and image paths as stable data', () => {
    for (const value of [
      'Gregory Millon',
      'Ganesh',
      'assets/fire-about.webp',
      'assets/ice-about.webp',
      'https://discord.gg/znGRG36Kz',
      'https://www.facebook.com/mtgones/',
      'https://x.com/MtgOnes'
    ]) {
      expect(source).toContain(value);
    }
  });
});
