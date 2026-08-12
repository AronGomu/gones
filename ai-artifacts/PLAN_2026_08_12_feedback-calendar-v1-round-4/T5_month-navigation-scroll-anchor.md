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

- [ ] 1. Add `@ViewChild('monthGrid') private monthGrid?: ElementRef<HTMLElement>` and the `#monthGrid` template reference on `<section class="public-month-grid">`.
- [ ] 2. Add `readonly gridMinHeight = signal<number | null>(null)` and bind `[style.min-height.px]="gridMinHeight()"`.
- [ ] 3. Rewrite `moveMonth` as an async method: capture `const top = window.scrollY;` and `this.gridMinHeight.set(this.monthGrid?.nativeElement.offsetHeight ?? null);`, `await this.navigate(...)`, then `requestAnimationFrame(() => { if (top > 0) window.scrollTo({ top }); this.gridMinHeight.set(null); });`.
- [ ] 4. Keep the template call `(click)="moveMonth(-1)"` / `(click)="moveMonth(1)"` unchanged (returning a promise from a click handler is fine; mark it `void` in the template if lint complains — use `(click)="void moveMonth(1)"` only if required by the lint rule).
- [ ] 5. Add the three component tests to `src/app/features/calendar/public-calendar.component.test.ts`.
- [ ] 6. Add the Cypress assertion to `cypress/e2e/public-calendar.cy.js`.
- [ ] 7. Run `npx vitest run src/app/features/calendar`, `npm run lint`, `npm run typecheck`, `npx cypress run --spec cypress/e2e/public-calendar.cy.js`.

## Outputs

- Files touched: `src/app/features/calendar/public-calendar.component.ts`, `public-calendar.component.test.ts`, `cypress/e2e/public-calendar.cy.js`.
- Behaviour change: month navigation preserves scroll position; grid height is pinned during the switch.

## Validation

- [ ] `npx vitest run src/app/features/calendar` passes
- [ ] `npx cypress run --spec cypress/e2e/public-calendar.cy.js` passes
- [ ] `npm run lint && npm run typecheck` pass
- [ ] manual check: scroll to the bottom of `/calendar`, click Next repeatedly — the viewport does not jump
- [ ] app functional — the month label, day cells and query params still update
- [ ] commit msg draft: `fix(calendar): keep the scroll position when changing month`
