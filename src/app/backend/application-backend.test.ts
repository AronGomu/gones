import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { resolveDataAuthority } from '../config/data-authority';
import { legacyBrowserBackendAvailable, requireLegacyBrowserStore, resolveLeagueBackendMode, resolveLiveBackendMode } from './application-backend';

const legacy = resolveDataAuthority({ dataMode: 'legacy-browser', apiBaseUrl: '', features: { authV1: false, adminV1: false } });
const server = resolveDataAuthority({ dataMode: 'server', apiBaseUrl: 'https://api.example', features: { authV1: true, adminV1: false } });

describe('application backend authority gate', () => {
  it('binds the browser store adapter under the legacy authority', () => {
    expect(resolveLeagueBackendMode(legacy)).toBe('frontend-local');
    expect(resolveLiveBackendMode(legacy)).toBe('frontend-local');
    expect(legacyBrowserBackendAvailable(legacy)).toBe(true);
  });

  it('binds every port to the API under the server authority, with no browser store fallback', () => {
    expect(resolveLeagueBackendMode(server)).toBe('aspnet-api');
    expect(resolveLiveBackendMode(server)).toBe('aspnet-api');
    expect(legacyBrowserBackendAvailable(server)).toBe(false);
    expect(() => requireLegacyBrowserStore(null, 'leagueWholeDocumentSaveDisabled')).toThrowError('leagueWholeDocumentSaveDisabled');
  });

  it('never selects a per-port mode: League and Live always share one authority', () => {
    expect(resolveLeagueBackendMode(server)).toBe(resolveLiveBackendMode(server));
    expect(resolveLeagueBackendMode(legacy)).toBe(resolveLiveBackendMode(legacy));
  });
});
