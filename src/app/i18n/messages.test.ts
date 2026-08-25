import { describe, expect, it } from 'vitest';
import { catalogs, translate } from './messages';

describe('messages', () => {
  it('names the archive Leagues Archive', () => {
    expect(translate('en', 'home.leagues')).toBe('Leagues Archive');
  });

  it('names the archive Archives des ligues in French', () => {
    expect(translate('fr', 'home.leagues')).toBe('Archives des ligues');
  });

  it('uses the same name in the breadcrumb', () => {
    expect(translate('en', 'crumb.leagues')).toBe('Leagues Archive');
  });

  it('says Classement Global', () => {
    expect(translate('fr', 'globalStats.title')).toBe('Classement Global');
  });

  it('fr home rankings label is Classement Global', () => {
    expect(translate('fr', 'home.globalStats')).toBe('Classement Global');
  });

  it('fr rankings breadcrumb label is Classement Global', () => {
    expect(translate('fr', 'crumb.globalStats')).toBe('Classement Global');
  });

  it('fr rankings description starts with Classement global des joueurs', () => {
    expect(translate('fr', 'home.globalStatsDesc')).toMatch(/^Classement global des joueurs/);
  });

  it('en events card is Events', () => {
    expect(translate('en', 'home.calendar')).toBe('Events');
  });

  it('fr events card is Événements', () => {
    expect(translate('fr', 'home.calendar')).toBe('Événements');
  });

  it('en local badge is Local only', () => {
    expect(translate('en', 'archive.localBadge')).toBe('Local only');
  });

  it('fr local badge is Local uniquement', () => {
    expect(translate('fr', 'archive.localBadge')).toBe('Local uniquement');
  });

  it('the local notice says the browser is the only copy in both languages', () => {
    // ADR 0028's stated consequence: clearing site data destroys these records, and the list page
    // is where the reader is told so.
    expect(translate('en', 'archive.localNotice')).toMatch(/this browser only/);
    expect(translate('fr', 'archive.localNotice')).toMatch(/uniquement dans ce navigateur/);
  });

  it('no french label still says mondial', () => {
    // "Classement Mondial" was renamed to "Classement Global". An exact-equality guard let the aria,
    // pagination and error strings keep the old word, which a screen reader reads out loud on a table
    // titled "Classement Global" — so this matches the word wherever it appears, in any inflection.
    const offenders = (Object.entries(catalogs.fr) as [string, string][])
      .filter(([, value]) => /mondial/i.test(value))
      .map(([key, value]) => `${key}: ${value}`);
    expect(offenders).toEqual([]);
  });
});
