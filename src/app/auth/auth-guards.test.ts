import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import { adminGuard, organizerGuard, userGuard, verifiedEmailGuard } from './auth.guards';

const state = { url: '/protected' } as never;
function setup(profile: unknown) {
  const tree = { redirected: true };
  const injector = Injector.create({ providers: [
    { provide: AuthService, useValue: { profile: () => profile } },
    { provide: Router, useValue: { createUrlTree: vi.fn(() => tree) } }
  ] });
  return { tree, run: <T>(fn: () => T) => runInInjectionContext(injector, fn) };
}

describe('auth guards', () => {
  it('redirects anonymous users to login', () => {
    const { tree, run } = setup(null);
    expect(run(() => userGuard({} as never, state))).toBe(tree);
  });

  it('treats Organizer and Admin guards as UX role checks', () => {
    const { run } = setup({ globalRole: 'Organizer', emailVerified: true });
    expect(run(() => organizerGuard({} as never, state))).toBe(true);
    expect(run(() => adminGuard({} as never, state))).not.toBe(true);
  });

  it('gates unverified users', () => {
    const { tree, run } = setup({ globalRole: 'User', emailVerified: false });
    expect(run(() => verifiedEmailGuard({} as never, state))).toBe(tree);
  });
});
