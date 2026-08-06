import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import {
  DATA_MODES,
  DataAuthorityConfigurationError,
  dataAuthority,
  resolveDataAuthority
} from './data-authority';

const legacyInput = {
  dataMode: 'legacy-browser',
  apiBaseUrl: '',
  features: { authV1: false, adminV1: false }
};

const serverInput = {
  dataMode: 'server',
  apiBaseUrl: 'https://api.example',
  features: { authV1: true, adminV1: true }
};

function code(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DataAuthorityConfigurationError);
    return (error as DataAuthorityConfigurationError).code;
  }
  throw new Error('expected a DataAuthorityConfigurationError');
}

describe('data authority mode', () => {
  it('exposes exactly two explicit modes', () => {
    expect([...DATA_MODES]).toEqual(['legacy-browser', 'server']);
  });

  it('resolves the legacy browser authority with no server capability', () => {
    const authority = resolveDataAuthority(legacyInput);

    expect(authority.mode).toBe('legacy-browser');
    expect(authority.legacyBrowserAuthority).toBe(true);
    expect(authority.serverAuthority).toBe(false);
    expect(authority.apiBaseUrl).toBe('');
  });

  it('resolves the server authority with an API base URL', () => {
    const authority = resolveDataAuthority(serverInput);

    expect(authority.mode).toBe('server');
    expect(authority.serverAuthority).toBe(true);
    expect(authority.legacyBrowserAuthority).toBe(false);
    expect(authority.apiBaseUrl).toBe('https://api.example');
  });

  it('never infers a mode: an unknown, empty or auto value fails closed', () => {
    for (const dataMode of ['', 'auto', 'Server', 'legacy', 'legacy-browser ', 'undefined']) {
      expect(code(() => resolveDataAuthority({ ...legacyInput, dataMode }))).toBe('dataModeUnknown');
    }
  });

  it('fails closed when server mode has no API base URL instead of falling back to the browser store', () => {
    expect(code(() => resolveDataAuthority({ ...serverInput, apiBaseUrl: '' }))).toBe('serverModeApiBaseUrlMissing');
    expect(code(() => resolveDataAuthority({ ...serverInput, apiBaseUrl: '   ' }))).toBe('serverModeApiBaseUrlMissing');
  });

  it('rejects an Admin capability without auth in server mode', () => {
    expect(code(() => resolveDataAuthority({ ...serverInput, features: { authV1: false, adminV1: true } })))
      .toBe('serverModeAdminRequiresAuth');
  });

  it('keeps legacy mode frozen: no API base URL may be configured', () => {
    expect(code(() => resolveDataAuthority({ ...legacyInput, apiBaseUrl: 'https://api.example' })))
      .toBe('legacyModeApiBaseUrlForbidden');
  });

  it('keeps legacy mode frozen: no auth or admin capability may be enabled', () => {
    expect(code(() => resolveDataAuthority({ ...legacyInput, features: { authV1: true, adminV1: false } })))
      .toBe('legacyModeCapabilityForbidden');
    expect(code(() => resolveDataAuthority({ ...legacyInput, features: { authV1: true, adminV1: true } })))
      .toBe('legacyModeCapabilityForbidden');
  });

  it('trims no meaning into the base URL and normalizes a trailing slash', () => {
    expect(resolveDataAuthority({ ...serverInput, apiBaseUrl: 'https://api.example/' }).apiBaseUrl).toBe('https://api.example');
  });

  it('returns a frozen value so nothing can switch authority after startup', () => {
    const authority = resolveDataAuthority(serverInput);

    expect(Object.isFrozen(authority)).toBe(true);
    expect(() => {
      (authority as { mode: string }).mode = 'legacy-browser';
    }).toThrow();
  });

  it('memoizes the startup resolution: repeated reads return the identical decision', () => {
    expect(dataAuthority()).toBe(dataAuthority());
    expect(DATA_MODES).toContain(dataAuthority().mode);
  });
});
