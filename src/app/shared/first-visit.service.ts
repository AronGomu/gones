import { Injectable } from '@angular/core';

export const FIRST_VISIT_KEY = 'gones.first-visit.completed';

@Injectable({ providedIn: 'root' })
export class FirstVisitService {
  isFirstVisit(): boolean {
    try {
      return globalThis.localStorage?.getItem(FIRST_VISIT_KEY) !== 'true';
    } catch {
      return false;
    }
  }

  markVisited(): void {
    try {
      globalThis.localStorage?.setItem(FIRST_VISIT_KEY, 'true');
    } catch {
      /* Preference is optional. */
    }
  }
}
