import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { PowerUserSettingsService } from './power-user-settings.service';

export const powerUserGuard: CanActivateFn = (_route, state) => {
  const power = inject(PowerUserSettingsService);
  const router = inject(Router);
  return power.enabled() ? true : router.createUrlTree([powerUserFallback(state.url)]);
};

function powerUserFallback(url: string): string {
  if (url === '/events/new' || url.startsWith('/events/new?')) return '/calendar';
  if (/^\/organizer\/events\/[^/]+\/edit(?:[?#]|$)/.test(url)) return '/organizer/events';
  if (url === '/live-tournaments/new' || url.startsWith('/live-tournaments/new?')) return '/live-tournaments';
  return '/';
}
