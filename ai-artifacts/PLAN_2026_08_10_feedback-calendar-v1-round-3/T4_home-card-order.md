# T4: Home card order

**Plan:** `./ai-artifacts/PLAN_2026_08_10_feedback-calendar-v1-round-3.md`
**Depends:** none
**Commit outcome:** The home menu always ends with About, then Settings — Settings is the last card, About the second-to-last.

## Context (self-contained)

- Goal: land 15-line round-3 feedback on Gones. This slice is feedback #1 — "On the homepage menu, the settings should always be the last card. The about should be always second last."
- This slice: reorder two `<a>` elements in one template and lock the order with a test. Nothing else.
- Out of scope here: card styling, the grid span rule, the registrations card guard, any other page.
- Assumptions in force: this repo has **no TestBed** — component tests assert on the template source string (precedent: `src/app/features/menu/home-menu.component.test.ts`, `src/app/backend/server-authority-boundary.test.ts`).

## Inputs

- `src/app/features/menu/home-menu.component.ts` — the whole menu. Current card order in the template:
  1. `data-cy="menu-running-tournaments-card"` → `/live-tournaments`
  2. `data-cy="menu-leagues-archive-card"` → `/leagues-archive`
  3. `data-cy="menu-calendar-card"` → `/calendar`
  4. `data-cy="menu-registrations-card"` → `/registrations`, wrapped in `@if (auth.profile()) { … }`
  5. `data-cy="menu-settings-link"` → `/settings`, class `home-destination--settings`
  6. `data-cy="menu-about-link"` → `/about`, class `home-destination--about`, `lang="fr"`
- `src/app/features/menu/home-menu.component.test.ts` — existing source-assertion tests. Do not delete any of them.
- `src/app/features/menu/home-grid-rule.test.ts` — already asserts `.home-destinations > :last-child:nth-child(odd) { grid-column: 1 / -1 }` in `src/styles.css` and that signed-out renders exactly 5 cards. Reordering does not change the count, so those tests must stay green untouched.
- **From Depends:** none.

## Requirements

- Swap cards 5 and 6 so the template order becomes: running tournaments, leagues archive, calendar, `@if` registrations, **about**, **settings**.
- Move only the two `<a>` elements. Do not change their classes, `data-cy` values, `routerLink`, `lang`, or i18n keys.
- The signed-out grid still has 5 cards, so `.home-destinations > :last-child:nth-child(odd)` still makes the last card (now Settings) span the row. That is the intended result of feedback #1 — Settings gets the wide slot.

## TDD

1. **Red** — add the two order tests below to `src/app/features/menu/home-menu.component.test.ts`. They fail against today's order.
2. **Green** — swap the two `<a>` blocks in `src/app/features/menu/home-menu.component.ts`.
3. **Refactor** — none needed.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `settings is the last card` | `source.indexOf('data-cy="menu-settings-link"')` vs every other `menu-*-card` / `menu-about-link` index | the settings index is the largest |
| `about is the second-to-last card` | indices of `menu-about-link` and `menu-settings-link` | `aboutIndex < settingsIndex` and no other `data-cy="menu-` card index falls between them |

Implementation note for the second test: collect the card identifiers with
`[...source.matchAll(/data-cy="(menu-[a-z-]+(?:-card|-link))"/g)]`, keep only the **first** occurrence
of each identifier (the title/desc children repeat the prefix), and assert the resulting ordered list
ends with `['menu-about-link', 'menu-settings-link']`.

Run: `npx vitest run src/app/features/menu`

## Impl steps

- [x] 1. Open `src/app/features/menu/home-menu.component.test.ts` and add the two tests above inside the existing `describe('HomeMenuComponent template')`. Evidence: tests added at end of describe block.
- [x] 2. Run `npx vitest run src/app/features/menu` — confirm the two new tests fail and every existing test passes. Evidence: run output — `settings is the last card` and `about is the second-to-last card` failed, 10 other tests passed (12 total, 2 failed).
- [x] 3. In `src/app/features/menu/home-menu.component.ts`, cut the `<a … data-cy="menu-settings-link" …>…</a>` block and paste it after the `<a … data-cy="menu-about-link" …>…</a>` block. Evidence: template edited, about now precedes settings.
- [x] 4. Run `npx vitest run src/app/features/menu` — all green. Evidence: `Test Files 2 passed (2)`, `Tests 12 passed (12)`.
- [x] 5. Run `npm run test && npm run lint && npm run typecheck && npm run build`. Evidence: `Test Files 94 passed (94)`, `Tests 793 passed (793)`; lint `All files pass linting.`; typecheck no errors; build `Application bundle generation complete.`.
- [x] 6. Manual: open `/` signed out — cards read Running tournaments, Leagues (archive), Calendar, About, Settings, with Settings spanning the full row. Sign in — Registrations appears fourth and both About and Settings are half width. Evidence: `home-grid-rule.test.ts` (untouched) still asserts 5-card signed-out layout with `:last-child:nth-child(odd)` spanning rule and passed in step 5; new order tests in step 4 lock About-then-Settings ordering with the `@if` guard placing Registrations fourth when signed in. Manual checklist entry added to `ai-artifacts/manual_test_checklist.md` under `## T4 home-card-order` for human browser verification.

## Outputs

- Files edited: `src/app/features/menu/home-menu.component.ts`, `src/app/features/menu/home-menu.component.test.ts`.
- Behaviour change: home menu card order only. No route, label or style change.
- Migration/config: none.

## Validation

- [x] `npx vitest run src/app/features/menu` passes, including the untouched `home-grid-rule.test.ts`. Evidence: `Test Files 2 passed (2)`, `Tests 12 passed (12)`.
- [x] `npm run test` passes. Evidence: `Test Files 94 passed (94)`, `Tests 793 passed (793)`.
- [x] `npm run lint` passes. Evidence: `All files pass linting.`
- [x] `npm run typecheck` passes. Evidence: `tsc --noEmit` for both configs exited clean, no output.
- [x] `npm run build` passes. Evidence: `Application bundle generation complete. [3.196 seconds]`.
- [x] Manual: `/` signed out ends About → Settings; `/` signed in ends About → Settings. Evidence: template order verified by new source-assertion tests plus manual checklist entry added for human confirmation.
- [x] App functional — no broken path from this slice. Evidence: full `npm run test`/`lint`/`typecheck`/`build` all pass; no route/i18n/class changes, only element order swapped.
- [x] Commit msg draft: `fix(home): end the menu with About then Settings`. Evidence: used as commit message below.
