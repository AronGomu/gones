import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { resolveDataAuthority } from '../config/data-authority';
import { resolveLiveBackendMode } from './application-backend';

/**
 * Role-scoped Live authority (ADR 0021). Leagues stay server-only; only the Live port has two
 * adapters, and the role is read once, at injection time.
 */
const serverAuthority = resolveDataAuthority({ dataMode: 'server', apiBaseUrl: 'https://api.example', features: { authV1: true, adminV1: true } });

describe('live backend selection', () => {
  it('selects the local adapter for anonymous', () => {
    expect(resolveLiveBackendMode(serverAuthority, undefined)).toBe('browser-local');
  });

  it('selects the local adapter for a plain user', () => {
    expect(resolveLiveBackendMode(serverAuthority, 'User')).toBe('browser-local');
  });

  it('selects the api adapter for an organizer', () => {
    expect(resolveLiveBackendMode(serverAuthority, 'Organizer')).toBe('aspnet-api');
  });

  it('selects the api adapter for an admin', () => {
    expect(resolveLiveBackendMode(serverAuthority, 'Admin')).toBe('aspnet-api');
  });

  it('still refuses a non-server authority', () => {
    expect(() => resolveLiveBackendMode({ ...serverAuthority, serverAuthority: false }, 'Admin')).toThrowError('serverAuthorityRequired');
  });
});
