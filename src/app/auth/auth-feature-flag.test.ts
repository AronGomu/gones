import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { environment } from '../../environments/environment';
import { buildRoutes } from '../app.routes';

describe('authV1 feature flag', () => {
  it('ships the repository default as the frozen legacy build with auth disabled', () => {
    expect(environment.dataMode).toBe('legacy-browser');
    expect(environment.features.authV1).toBe(false);
    expect(environment.features.adminV1).toBe(false);
    expect(environment.apiBaseUrl).toBe('');
  });

  it('keeps auth routes absent when disabled', () => {
    const paths = buildRoutes(environment.dataMode, environment.features).map((route) => route.path);

    expect(paths.some((path) => path === 'login' || path === 'profile')).toBe(false);
  });
});
