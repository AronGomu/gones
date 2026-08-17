import { describe, expect, it } from 'vitest';
import { translate } from './messages';

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
});
