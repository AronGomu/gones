import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { environment } from '../../environments/environment';
import { buildRoutes } from '../app.routes';

describe('repository default build', () => {
  it('ships the modern API-connected declaration, not a browser-store one', () => {
    expect(environment.dataMode).toBe('server');
    expect(environment.apiBaseUrl).not.toBe('');
    expect(environment.features.authV1).toBe(true);
    expect(environment.features.adminV1).toBe(true);
  });

  it('routes the auth surface by default', () => {
    const paths = buildRoutes(environment.features).map((route) => route.path);

    expect(paths).toContain('login');
    expect(paths).toContain('profile');
  });

  it('keeps auth routes absent when the capability is disabled', () => {
    const paths = buildRoutes({ authV1: false, adminV1: false }).map((route) => route.path);

    expect(paths.some((path) => path === 'login' || path === 'profile')).toBe(false);
  });
});
