import { computed, inject, Injectable, Signal, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';

export const POWER_USER_STORAGE_KEY = 'gones.settings.power-user';

/** Client-only capability preference. Server authorization remains authoritative. */
@Injectable({ providedIn: 'root' })
export class PowerUserSettingsService {
  private readonly auth = inject(AuthService);
  private readonly state = signal(readPowerUserSetting());
  readonly forced = computed(() => {
    const role = this.auth.profile()?.globalRole;
    return role === 'Organizer' || role === 'Admin';
  });
  readonly enabled: Signal<boolean> = computed(() => this.forced() || this.state());

  constructor() {
    // Cross-tab sync, the behaviour the language setting already has: turning Power User mode on in
    // one tab takes effect in the others, instead of leaving them silently stale until a reload.
    window.addEventListener('storage', (event) => {
      if (event.key === POWER_USER_STORAGE_KEY) this.refreshFromStorage();
    });
  }

  setEnabled(value: boolean): void {
    if (this.forced()) return;
    this.state.set(value);
    try { globalThis.localStorage?.setItem(POWER_USER_STORAGE_KEY, String(value)); }
    catch { /* Browser preference remains active for this tab when storage is unavailable. */ }
  }

  requireEnabled(): void {
    if (!this.enabled()) throw new Error('powerUserRequired');
  }

  private refreshFromStorage(): void {
    try { this.state.set(globalThis.localStorage?.getItem(POWER_USER_STORAGE_KEY) === 'true'); }
    catch { /* Browser preference remains active for this tab when storage is unavailable. */ }
  }
}

/** Combines Power User opt-in with existing role/resource authority without replacing either. */
export function canUsePowerMutation(power: boolean, authority: boolean): boolean {
  return power && authority;
}

function readPowerUserSetting(): boolean {
  try { return globalThis.localStorage?.getItem(POWER_USER_STORAGE_KEY) === 'true'; }
  catch { return false; }
}
