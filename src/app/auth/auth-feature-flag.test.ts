import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { environment } from '../../environments/environment';
import { routes } from '../app.routes';

describe('authV1 feature flag', () => {
  it('keeps auth routes absent when disabled', () => {
    expect(environment.features.authV1).toBe(false);
    expect(routes.some(route => route.path === 'login' || route.path === 'profile')).toBe(false);
  });
});
