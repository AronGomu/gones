import { Injectable, Signal, signal } from '@angular/core';

export const POWER_USER_STORAGE_KEY = 'gones.settings.power-user';

/** Client-only capability preference. Server authorization remains authoritative. */
@Injectable({ providedIn: 'root' })
export class PowerUserSettingsService {
  private readonly state = signal(readPowerUserSetting());
  readonly enabled: Signal<boolean> = this.state.asReadonly();

  setEnabled(value: boolean): void {
    this.state.set(value);
    try { globalThis.localStorage?.setItem(POWER_USER_STORAGE_KEY, String(value)); }
    catch { /* Browser preference remains active for this tab when storage is unavailable. */ }
  }

  requireEnabled(): void {
    if (!this.enabled()) throw new Error('powerUserRequired');
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
