import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { resolveBackendMode, resolveLeagueBackendMode } from './application-backend';

describe('application backend feature gate', () => {
  it('preserves local adapter while apiBackend is disabled', () => {
    expect(resolveBackendMode(false, '')).toBe('frontend-local');
  });

  it('selects ASP.NET adapter only with enabled flag and URL', () => {
    expect(resolveBackendMode(true, 'https://api.example')).toBe('aspnet-api');
  });

  it('rejects enabled API backend without base URL', () => {
    expect(() => resolveBackendMode(true, '')).toThrowError('aspNetApiBaseUrlMissing');
  });

  it('switches only League port when leagueServer is enabled', () => {
    expect(resolveLeagueBackendMode(false, '')).toBe('frontend-local');
    expect(resolveLeagueBackendMode(true, 'https://api.example')).toBe('aspnet-api');
    expect(() => resolveLeagueBackendMode(true, '')).toThrowError('aspNetApiBaseUrlMissing');
  });
});
