import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';

export const userGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  return auth.profile() ? true : inject(Router).createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

function roleGuard(required: 'Organizer' | 'Admin'): CanActivateFn {
  return (_route, state) => {
    const role = inject(AuthService).profile()?.globalRole;
    const allowed = required === 'Organizer' ? role === 'Organizer' || role === 'Admin' : role === 'Admin';
    return allowed ? true : inject(Router).createUrlTree(['/'], { queryParams: { denied: state.url } });
  };
}

export const organizerGuard = roleGuard('Organizer');
export const adminGuard = roleGuard('Admin');
export const verifiedEmailGuard: CanActivateFn = (_route, _state) => {
  const profile = inject(AuthService).profile();
  return profile?.emailVerified ? true : inject(Router).createUrlTree(['/verify-email'], { queryParams: { email: profile?.email ?? '' } });
};
