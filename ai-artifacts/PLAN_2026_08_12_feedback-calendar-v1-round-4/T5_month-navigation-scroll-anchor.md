# T5: Month navigation scroll anchor

**Plan:** `./ai-artifacts/PLAN_2026_08_12_feedback-calendar-v1-round-4.md`
**Depends:** T4
**Commit outcome:** clicking "Previous"/"Next" in the calendar view keeps the window scroll position exactly where it was, so the visible part of the grid does not jump back to the top.

## Context (self-contained)

- Goal: ship round 4 of `feedback.md` — calendar/detail polish, an admin organization workbench, a guard fix, generated demo docs, and a Tournament → Event rename.
- This slice: feedback item 10. Month navigation replaces the grid, the page briefly shrinks, and the router's scroll restoration lands the user at the top.
- Out of scope here: pagination in the list view, the view tabs, any layout redesign.
- Assumptions in force: the app configures `withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'enabled' })` in `src/main.ts`; the fix must be local to the calendar page and must not change that global configuration.

## Requirements

- Month navigation must not collapse the grid height mid-navigation: give the month grid a stable minimum height while a month change is in flight.
- `PublicCalendarComponent.moveMonth()` records `window.scrollY` before navigating and restores it after the navigation promise resolves, in a `requestAnimationFrame` callback.
- The same must apply to keyboard activation of the two buttons (they are real `<button>` elements, so the click handler covers it).
- Scroll restoration must be skipped when the user is at the top already (`scrollY === 0`) to avoid a pointless scroll call.
- Add `readonly gridMinHeight = signal<number | null>(null)` set from the grid's `offsetHeight` before navigating and cleared after restore, bound as `[style.min-height.px]="gridMinHeight()"` on `<section class="public-month-grid">`.

## Inputs

- `src/app/features/calendar/public-calendar.component.ts` — `moveMonth(amount: number): void { void this.navigate({ ...this.query(), month: shiftMonth(this.query().month, amount), page: 1 }); }`; `private navigate(query: CalendarQuery): Promise<boolean>`; month controls are `[data-cy=calendar-month-prev]` and `[data-cy=calendar-month-next]`; the grid is `<section class="public-month-grid" … data-cy="public-month-grid">`.
- `src/main.ts` — router scrolling configuration (read-only reference).
- **From Depends:** T4 added `highlightParts()` and span-based rendering inside the grid; keep it intact.

## TDD

1. **Red** — component test asserting the scroll position is restored after `moveMonth`.
2. **Green** — implement the capture/restore.
3. **Refactor** — none.

## Test plan

| Test | Input | Expect |
| ---- | ---- | ------ |
| `moveMonth restores the scroll position` | stub `window.scrollY = 800`, spy `window.scrollTo`, call `moveMonth(1)` | `window.scrollTo` called with `{ top: 800 }` (or `(0, 800)`), after navigation resolves |
| `moveMonth does not scroll when already at the top` | `window.scrollY = 0`, call `moveMonth(-1)` | `window.scrollTo` not called |
| `month grid keeps a min-height during navigation` | grid `offsetHeight = 640`, call `moveMonth(1)` | `gridMinHeight()` is `640` while pending, `null` after restore |
| cypress `next month keeps the scroll position` | scroll to the bottom of `/calendar`, click `[data-cy=calendar-month-next]` | `window.scrollY` within 10 px of the pre-click value |

## Impl steps

- [x] 1. Add `@ViewChild('monthGrid') private monthGrid?: ElementRef<HTMLElement>` and the `#monthGrid` template reference on `<section class="public-month-grid">`. — `public-calendar.component.ts:90` (`#monthGrid`) and `:153`.
- [x] 2. Add `readonly gridMinHeight = signal<number | null>(null)` and bind `[style.min-height.px]="gridMinHeight()"`. — `public-calendar.component.ts:164`, bound at `:90`.
- [x] 3. Rewrite `moveMonth` as an async method: capture `const top = window.scrollY;` and `this.gridMinHeight.set(this.monthGrid?.nativeElement.offsetHeight ?? null);`, `await this.navigate(...)`, then `requestAnimationFrame(() => { if (top > 0) window.scrollTo({ top }); this.gridMinHeight.set(null); });`. — `public-calendar.component.ts:215-223`. See the Amendment: the navigation also passes `scroll: 'manual'`.
- [x] 4. Keep the template call `(click)="moveMonth(-1)"` / `(click)="moveMonth(1)"` unchanged. — unchanged at `:88`; `npm run lint` reports `All files pass linting.`, so no `void` was needed.
- [x] 5. Add the three component tests to `src/app/features/calendar/public-calendar.component.test.ts`. — plus a fourth pinning `scroll: 'manual'` (Amendment); `npx vitest run src/app/features/calendar` → `Tests 198 passed (198)`.
- [x] 6. Add the Cypress assertion to `cypress/e2e/public-calendar.cy.js`. — two specs, content-heavy month and empty month, both clicking prev and next.
- [x] 7. Run `npx vitest run src/app/features/calendar`, `npm run lint`, `npm run typecheck`, `npx cypress run --spec cypress/e2e/public-calendar.cy.js`. — all green, output under Validation.

## Amendment — the rAF restore alone does not hold

Measured on the running dev server (Chrome, viewport 1024x500, `scrollY` sampled every 20 ms after
clicking Next) with the mechanism exactly as specified above:

```
before=950 docHeight=1450
samples: 25ms=950 52ms=447 61ms=447 226ms=0 241ms=0 … 1460ms=0
after=0
```

Root cause of the residual jump: `RouterScroller.scheduleScrollEvent`
(`node_modules/@angular/router/fesm2022/_router_module-chunk.mjs:883-894`) awaits a
`setTimeout`/`requestAnimationFrame` race and only then re-enters the zone to emit `Scroll`, so the
router's scroll-to-top lands at ~226 ms — long after `navigate()` resolves (~60 ms) and after the
restore in the `requestAnimationFrame` callback. The router always scrolls last and wins.

Fix: the month navigation passes `scroll: 'manual'`
(`NavigationExtras.scroll`, `node_modules/@angular/router/types/_router_module-chunk.d.ts:3176`),
which makes `consumeScrollEvents` return early for that one navigation. It is per-navigation, so
`withInMemoryScrolling` in `src/main.ts` stays untouched, as the ticket's assumptions require. The
capture/restore and the `gridMinHeight` pin stay: the pin is what stops the browser clamping the
restored position when the next month's grid is shorter (the `447 → 344` drift in the same-shape
measurement is exactly that clamp).

- [x] `scroll: 'manual'` is pinned by a unit assertion so a refactor cannot silently drop it and
      reintroduce the jump — `moving month opts the navigation out of the router scroll restoration`
      in `public-calendar.component.test.ts`.
- [x] Before/after in the browser, same spec, component fix stashed then restored:
      without the fix `AssertionError: expected 0 to be close to 267 +/- 10` in both the
      content-heavy and the empty month; with the fix both specs pass (`Passing: 12, Failing: 0`).

## Outputs

- Files touched: `src/app/features/calendar/public-calendar.component.ts`, `public-calendar.component.test.ts`, `cypress/e2e/public-calendar.cy.js`.
- Behaviour change: month navigation preserves scroll position; grid height is pinned during the switch.

## Validation

- [x] `npx vitest run src/app/features/calendar` passes — `Test Files 16 passed (16)`, `Tests 198 passed (198)`
- [x] `npx cypress run --spec cypress/e2e/public-calendar.cy.js` passes — `Tests: 12, Passing: 12, Failing: 0`, including
      `✓ keeps the window scroll position when changing month in a content-heavy month (1400ms)` and
      `✓ keeps the window scroll position when changing month in an empty month (1353ms)`
- [x] `npm run lint && npm run typecheck` pass — `All files pass linting.`; `tsc --noEmit` on both projects, no output
- [x] `npm run test` (full suite + acceptance matrix) — `Test Files 106 passed (106)`, `Tests 973 passed (973)`
- [x] `npx cypress run --spec cypress/e2e/accessibility.cy.js` — `Tests: 11, Passing: 11, Failing: 0` (unchanged gate)
- [x] browser measurement of the actual behaviour: `scrollY` recorded before and after clicking prev/next,
      unchanged within 10 px in a content-heavy month and in an empty month; red without the fix
      (`expected 0 to be close to 267 +/- 10`), green with it
- [ ] manual check: scroll to the bottom of `/calendar`, click Next repeatedly — the viewport does not jump
      (human-only, listed in `ai-artifacts/manual_test_checklist.md`)
- [x] app functional — the month label, day cells and query params still update: the existing spec
      `✓ navigates months over the cached catalog without re-querying the API (373ms)` still passes
- [x] commit msg draft: `fix(calendar): keep the scroll position when changing month`
