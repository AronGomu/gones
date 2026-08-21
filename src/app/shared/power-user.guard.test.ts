import '@angular/compiler';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { PowerUserSettingsService } from './power-user-settings.service';
import { powerUserGuard } from './power-user.guard';

function invoke(url: string, enabled: boolean): { result: boolean | UrlTree; createUrlTree: ReturnType<typeof vi.fn> } {
  const createUrlTree = vi.fn((commands: string[]) => ({ redirect: commands.join('/') }) as unknown as UrlTree);
  const injector = Injector.create({ providers: [
    { provide: PowerUserSettingsService, useValue: { enabled: signal(enabled) } },
    { provide: Router, useValue: { createUrlTree } }
  ] });
  const result = runInInjectionContext(injector, () => powerUserGuard(
    {} as ActivatedRouteSnapshot,
    { url } as RouterStateSnapshot
  )) as boolean | UrlTree;
  return { result, createUrlTree };
}

describe('powerUserGuard', () => {
  it('allows any signed-in or signed-out browser while mode is enabled', () => {
    expect(invoke('/events/new', true).result).toBe(true);
  });

  it.each([
    ['/events/new', '/events'],
    ['/organizer/events/event-1/edit', '/organizer/events'],
    ['/live-tournaments/new', '/live-tournaments']
  ])('redirects %s to %s while disabled', (url, fallback) => {
    const { result, createUrlTree } = invoke(url, false);

    expect(result).not.toBe(true);
    expect(createUrlTree).toHaveBeenCalledWith([fallback]);
  });
});
