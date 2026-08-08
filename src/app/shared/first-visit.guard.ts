import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { FirstVisitService } from './first-visit.service';

export const firstVisitHomeGuard: CanActivateFn = () => {
  const service = inject(FirstVisitService);
  if (!service.isFirstVisit()) return true;
  service.markVisited();
  return inject(Router).createUrlTree(['/about']);
};

export const markVisitedGuard: CanActivateFn = () => {
  inject(FirstVisitService).markVisited();
  return true;
};
