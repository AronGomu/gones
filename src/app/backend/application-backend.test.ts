import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { resolveDataAuthority } from '../config/data-authority';
import { resolveBackendMode } from './application-backend';

const server = resolveDataAuthority({ dataMode: 'server', apiBaseUrl: 'https://api.example', features: { authV1: true, adminV1: false } });

describe('application backend authority gate', () => {
  it('binds every port to the API, with no browser store to fall back to', () => {
    expect(resolveBackendMode(server)).toBe('aspnet-api');
  });

  it('refuses to resolve a port when the authority is not the server', () => {
    expect(() => resolveBackendMode({ ...server, serverAuthority: false })).toThrowError('serverAuthorityRequired');
  });
});
