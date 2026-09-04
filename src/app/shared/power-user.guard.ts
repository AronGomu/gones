import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { PowerUserSettingsService } from './power-user-settings.service';

export const eventCreatePowerGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const power = inject(PowerUserSettingsService);
  const router = inject(Router);
  await auth.whenSessionReady();
  return auth.profile()?.globalRole === 'Admin' ? true : powerUserResult(state.url, power, router);
};

export const powerUserGuard: CanActivateFn = (_route, state) => powerUserResult(
  state.url,
  inject(PowerUserSettingsService),
  inject(Router)
);

function powerUserResult(url: string, power: PowerUserSettingsService, router: Router): true | ReturnType<Router['createUrlTree']> {
  return power.enabled() ? true : router.createUrlTree([powerUserFallback(url)]);
}

function powerUserFallback(url: string): string {
  if (url === '/events/new' || url.startsWith('/events/new?')) return '/events';
  if (/^\/organizer\/events\/[^/]+\/edit(?:[?#]|$)/.test(url)) return '/organizer/events';
  if (url === '/live-tournaments/new' || url.startsWith('/live-tournaments/new?')) return '/live-tournaments';
  return '/';
}
