import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { Router, UrlTree } from '@angular/router';
import { firstVisitHomeGuard, markVisitedGuard } from './first-visit.guard';
import { FirstVisitService } from './first-visit.service';

interface FirstVisitStub {
  isFirstVisit: ReturnType<typeof vi.fn>;
  markVisited: ReturnType<typeof vi.fn>;
}

function makeFirstVisitStub(isFirstVisit: boolean): FirstVisitStub {
  return {
    isFirstVisit: vi.fn(() => isFirstVisit),
    markVisited: vi.fn()
  };
}

function createInjector(firstVisitStub: FirstVisitStub, routerStub: { createUrlTree: ReturnType<typeof vi.fn> }) {
  return Injector.create({
    providers: [
      { provide: FirstVisitService, useValue: firstVisitStub },
      { provide: Router, useValue: routerStub }
    ]
  });
}

const routeStub = {} as never;
const stateStub = { url: '/' } as never;

describe('firstVisitHomeGuard', () => {
  it('redirects on the first visit', () => {
    const firstVisitStub = makeFirstVisitStub(true);
    const fakeUrlTree = {} as UrlTree;
    const routerStub = { createUrlTree: vi.fn(() => fakeUrlTree) };
    const injector = createInjector(firstVisitStub, routerStub);

    const result = runInInjectionContext(injector, () => firstVisitHomeGuard(routeStub, stateStub));

    expect(result).toBe(fakeUrlTree);
    expect(routerStub.createUrlTree).toHaveBeenCalledWith(['/about']);
    expect(firstVisitStub.markVisited).toHaveBeenCalledTimes(1);
  });

  it('passes afterwards', () => {
    const firstVisitStub = makeFirstVisitStub(false);
    const routerStub = { createUrlTree: vi.fn() };
    const injector = createInjector(firstVisitStub, routerStub);

    const result = runInInjectionContext(injector, () => firstVisitHomeGuard(routeStub, stateStub));

    expect(result).toBe(true);
    expect(firstVisitStub.markVisited).not.toHaveBeenCalled();
    expect(routerStub.createUrlTree).not.toHaveBeenCalled();
  });
});

describe('markVisitedGuard', () => {
  it('always passes and marks the visit', () => {
    const firstVisitStub = makeFirstVisitStub(true);
    const routerStub = { createUrlTree: vi.fn() };
    const injector = createInjector(firstVisitStub, routerStub);

    const result = runInInjectionContext(injector, () => markVisitedGuard(routeStub, stateStub));

    expect(result).toBe(true);
    expect(firstVisitStub.markVisited).toHaveBeenCalledTimes(1);
  });
});
