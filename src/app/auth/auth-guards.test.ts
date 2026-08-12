import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import { adminGuard, organizerGuard, userGuard, verifiedEmailGuard } from './auth.guards';

const state = { url: '/protected' } as never;

function setup(profile: unknown, whenSessionReady: () => Promise<void> = () => Promise.resolve()) {
  const tree = { redirected: true };
  const createUrlTree = vi.fn(() => tree);
  const injector = Injector.create({ providers: [
    { provide: AuthService, useValue: { profile: typeof profile === 'function' ? profile : () => profile, whenSessionReady } },
    { provide: Router, useValue: { createUrlTree } }
  ] });
  return { tree, createUrlTree, run: <T>(fn: () => T) => runInInjectionContext(injector, fn) };
}

describe('auth guards', () => {
  // The reported bug (feedback 18): the guard used to read `profile()` synchronously, so a decision
  // taken while the startup refresh was still in flight saw a null profile and bounced a signed-in
  // user — or, on the mirror path, let a stale profile through.
  it('waits for the session restore before deciding', async () => {
    let profile: unknown = null;
    let restored!: () => void;
    const sessionReady = new Promise<void>(resolve => { restored = resolve; });
    const { createUrlTree, run } = setup(() => profile, () => sessionReady);

    const decision = run(() => userGuard({} as never, state));
    setTimeout(() => { profile = { globalRole: 'User', emailVerified: true }; restored(); }, 10);

    await expect(decision).resolves.toBe(true);
    expect(createUrlTree).not.toHaveBeenCalled();
  });

  it('redirects anonymous users to login with the return url', async () => {
    const { tree, createUrlTree, run } = setup(null);
    await expect(run(() => userGuard({} as never, { url: '/registrations' } as never))).resolves.toBe(tree);
    expect(createUrlTree).toHaveBeenCalledWith(['/login'], { queryParams: { returnUrl: '/registrations' } });
  });

  it('treats Organizer and Admin guards as UX role checks', async () => {
    const { tree, createUrlTree, run } = setup({ globalRole: 'Organizer', emailVerified: true });
    await expect(run(() => organizerGuard({} as never, state))).resolves.toBe(true);
    await expect(run(() => adminGuard({} as never, { url: '/admin' } as never))).resolves.toBe(tree);
    expect(createUrlTree).toHaveBeenCalledWith(['/'], { queryParams: { denied: '/admin' } });
  });

  it('refuses a plain user at the admin guard', async () => {
    const { tree, createUrlTree, run } = setup({ globalRole: 'User', emailVerified: true });
    await expect(run(() => adminGuard({} as never, { url: '/admin' } as never))).resolves.toBe(tree);
    expect(createUrlTree).toHaveBeenCalledWith(['/'], { queryParams: { denied: '/admin' } });
  });

  it('gates unverified users', async () => {
    const { tree, createUrlTree, run } = setup({ globalRole: 'User', emailVerified: false, email: 'a@b.test' });
    await expect(run(() => verifiedEmailGuard({} as never, state))).resolves.toBe(tree);
    expect(createUrlTree).toHaveBeenCalledWith(['/verify-email'], { queryParams: { email: 'a@b.test' } });
  });
});
