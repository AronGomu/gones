import '@angular/compiler';
import { Injector } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { SessionScopeService, isServiceWorkerDataCache } from './session-scope.service';

describe('SessionScopeService', () => {
  it('runs every registered reset so no user-scoped memory survives logout', () => {
    const service = create();
    const first = vi.fn();
    const second = vi.fn();
    service.register(first);
    service.register(second);

    service.clear();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('purges service worker API caches and keeps asset caches', async () => {
    const names = ['ngsw:/:1:data:dynamic:public-calendar-reads:cache', 'ngsw:/:db:control', 'ngsw:/:1:assets:app:cache'];
    const deleted: string[] = [];
    vi.stubGlobal('caches', {
      keys: () => Promise.resolve(names),
      delete: (name: string) => { deleted.push(name); return Promise.resolve(true); }
    });

    create().clear();
    await Promise.resolve();
    await Promise.resolve();

    expect(deleted).toEqual(['ngsw:/:1:data:dynamic:public-calendar-reads:cache']);
    vi.unstubAllGlobals();
  });

  it('recognises only service worker data caches', () => {
    expect(isServiceWorkerDataCache('ngsw:/:1:data:dynamic:public-league-reads:cache')).toBe(true);
    expect(isServiceWorkerDataCache('ngsw:/:1:assets:app:cache')).toBe(false);
    expect(isServiceWorkerDataCache('other-cache')).toBe(false);
  });
});

function create(): SessionScopeService {
  return Injector.create({ providers: [SessionScopeService] }).get(SessionScopeService);
}
