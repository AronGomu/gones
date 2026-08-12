import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';

// Every guard awaits the session restore before it reads `profile()`, and injects before that await:
// the injection context is only guaranteed synchronously, at the top of the guard.
export const userGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.whenSessionReady();
  return auth.profile() ? true : router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

function roleGuard(required: 'Organizer' | 'Admin'): CanActivateFn {
  return async (_route, state) => {
    const auth = inject(AuthService);
    const router = inject(Router);
    await auth.whenSessionReady();
    const role = auth.profile()?.globalRole;
    const allowed = required === 'Organizer' ? role === 'Organizer' || role === 'Admin' : role === 'Admin';
    return allowed ? true : router.createUrlTree(['/'], { queryParams: { denied: state.url } });
  };
}

export const organizerGuard = roleGuard('Organizer');
export const adminGuard = roleGuard('Admin');
export const verifiedEmailGuard: CanActivateFn = async (_route, _state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.whenSessionReady();
  const profile = auth.profile();
  return profile?.emailVerified ? true : router.createUrlTree(['/verify-email'], { queryParams: { email: profile?.email ?? '' } });
};
