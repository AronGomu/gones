import '@angular/compiler';
import { Injector } from '@angular/core';
import { afterEach, describe, expect, it } from 'vitest';
import { OnlineStatusService } from './online-status.service';

describe('OnlineStatusService', () => {
  afterEach(() => setNavigatorOnline(true));

  it('tracks browser connectivity events for read-only UI', () => {
    setNavigatorOnline(true);
    const service = Injector.create({ providers: [OnlineStatusService] }).get(OnlineStatusService);

    expect(service.online()).toBe(true);
    window.dispatchEvent(new Event('offline'));
    expect(service.online()).toBe(false);
    window.dispatchEvent(new Event('online'));
    expect(service.online()).toBe(true);
  });

  it('re-reads the browser for write guards even when no event was seen', () => {
    setNavigatorOnline(true);
    const service = Injector.create({ providers: [OnlineStatusService] }).get(OnlineStatusService);

    setNavigatorOnline(false);
    expect(service.isOnline()).toBe(false);
    expect(service.online()).toBe(false);
  });
});

function setNavigatorOnline(value: boolean): void {
  Object.defineProperty(globalThis.navigator, 'onLine', { value, configurable: true });
}
