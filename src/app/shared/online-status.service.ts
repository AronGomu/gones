import { Injectable, signal } from '@angular/core';

/**
 * Single connectivity source for the app. Reads are allowed to fall back to cached public data
 * while offline; writes are refused immediately and are never queued.
 */
@Injectable({ providedIn: 'root' })
export class OnlineStatusService {
  private readonly state = signal(readNavigatorOnline());
  readonly online = this.state.asReadonly();

  constructor() {
    const target = globalThis as unknown as Partial<Window>;
    target.addEventListener?.('online', () => this.state.set(true));
    target.addEventListener?.('offline', () => this.state.set(false));
  }

  /** Authoritative check for write guards: re-reads the browser instead of trusting the last event. */
  isOnline(): boolean {
    const online = readNavigatorOnline();
    if (online !== this.state()) this.state.set(online);
    return online;
  }
}

function readNavigatorOnline(): boolean {
  return globalThis.navigator?.onLine !== false;
}
