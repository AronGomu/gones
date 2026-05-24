import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.refresh();
  return auth.isAdmin() || router.createUrlTree(['/login'], { queryParams: { returnUrl: location.pathname + location.search } });
};
