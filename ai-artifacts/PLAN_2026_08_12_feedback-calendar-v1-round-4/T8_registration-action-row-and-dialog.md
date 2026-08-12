# T8: Registration action row + success dialog

**Plan:** `./ai-artifacts/PLAN_2026_08_12_feedback-calendar-v1-round-4.md`
**Depends:** T7
**Commit outcome:** on the event detail page, "Add to calendar" and a green "Register" button sit on the same row; registering opens a confirmation dialog with a link to "My registrations"; the standalone "My registrations" button is gone.

## Context (self-contained)

- Goal: ship round 4 of `feedback.md` — calendar/detail polish, an admin organization workbench, a guard fix, generated demo docs, and a Tournament → Event rename.
- This slice: feedback item 16.
- Out of scope here: the unregister flow's existing confirm dialog (keep it), the participants list, the hero layout (done in T6/T7).
- Assumptions in force: the ICS anchor currently renders inside `TournamentDetailViewComponent`; this ticket moves it into the registration action row of `PublicTournamentDetailComponent` and passes `icsUrl` through so the organizer preview (which has no registration section) keeps its own ICS button. Concretely: keep the `icsUrl` input on the detail-view component but render the anchor there ONLY when the new input `showIcsAction` is true (default true); the public page passes `[showIcsAction]="false"` and renders ICS in its own action row.

## Requirements

- `TournamentDetailViewComponent` gains `readonly showIcsAction = input<boolean>(true)`; the ICS anchor renders under `@if (showIcsAction() && icsUrl())`.
- `PublicTournamentDetailComponent` passes `[showIcsAction]="false"`.
- In the registration section, wrap the actions in `<div class="registration-actions" data-cy="registration-actions">` containing, in order: the ICS anchor (`[data-cy=registration-ics]`, `[href]="service.icsUrl(item.slug)"`, `download`) and the register button (`[data-cy=registration-register]`, class `registration-register-button`).
- Register button is green: add `.registration-register-button { background: var(--verdigris, #1f7a4d); color: #fff; }` to `src/styles.css` — check `src/styles.css` for an existing success/green token first and use it if present; do not introduce a second green.
- Remove the `[data-cy=my-registrations-link]` anchor from the registration section.
- New component `src/app/features/calendar/registration-success-dialog.component.ts` exporting `RegistrationSuccessDialogComponent`: Material dialog with title `registration.successTitle`, message `registration.successMessage` (params `{ title }`), a close button (`[data-cy=registration-success-close]`) and a router link to `/registrations` (`[data-cy=registration-success-my-registrations]`, `mat-flat-button`, closes the dialog on click).
- After a successful `register()` (and only success — not unregister, not failure), open the dialog with `data: { title: tournament.title }`.
- New i18n keys in BOTH `en` and `fr` maps of `src/app/i18n/messages.ts`: `registration.successTitle`, `registration.successMessage`, `registration.successCta` (label for the my-registrations button), `common.close`. Reuse `registration.myRegistrations` if it already reads well for the CTA; check first with `grep -n "registration.myRegistrations" src/app/i18n/messages.ts`.

## Inputs

- `src/app/features/calendar/public-tournament-detail.component.ts` — registration section markup (`registration-section`, `registration-register`, `registration-unregister`, `my-registrations-link`, `registration-status`), `register()`, `confirmUnregister()`, `private async mutate(action, successKey)`, `private readonly dialog = inject(MatDialog)`.
- `src/app/features/calendar/tournament-detail-view.component.ts` — `readonly icsUrl = input<string>()`, actions row (moved to the end of the hero by T6).
- `src/app/shared/dialogs.ts` — `ConfirmDialogComponent` shows the project's dialog style (`mat-dialog-title`, `mat-dialog-content`, `mat-dialog-actions align="end"`, data-cy on every element).
- `src/app/features/calendar/tournament-registration.service.ts` — `register(tournamentId)`, `unregister(tournamentId)`, `capability(tournamentId)`.
- **From Depends:** T6 moved the hero actions to `.info-actions--end`; T7 added the maps link. Keep both.

## TDD

1. **Red** — component tests in `src/app/features/calendar/public-tournament-detail.component.test.ts` (create if absent) and a dialog test.
2. **Green** — implement.
3. **Refactor** — none.

## Test plan

| Test | Input | Expect |
| ---- | ---- | ------ |
| `ics and register share one action row` | signed-in user, `canRegister: true` | `[data-cy=registration-actions]` contains both `[data-cy=registration-ics]` and `[data-cy=registration-register]` |
| `my registrations button is gone` | same | `[data-cy=my-registrations-link]` does not exist |
| `successful registration opens the success dialog` | stub `register()` resolving | `MatDialog.open` called with `RegistrationSuccessDialogComponent` |
| `failed registration does not open the success dialog` | stub `register()` rejecting with an `ApiProblemError` | `MatDialog.open` not called with `RegistrationSuccessDialogComponent`; status message set |
| `unregister still uses the confirm dialog` | click unregister | `MatDialog.open` called with `ConfirmDialogComponent` |
| `success dialog links to my registrations` | render the dialog | `[data-cy=registration-success-my-registrations]` has `routerLink="/registrations"` |
| `detail view hides ics when showIcsAction is false` | `[showIcsAction]="false"` | `[data-cy=tournament-ics]` absent |

## Impl steps

- [x] 1. Add `showIcsAction` input and the `@if` guard in `tournament-detail-view.component.ts`; add its test to `tournament-detail-view.component.test.ts`. — `readonly showIcsAction = input<boolean>(true)` + `@if (showIcsAction() && icsUrl(); as url)`; test `the ics anchor is on by default and opt-out for hosts that render their own` passes.
- [x] 2. Create `src/app/features/calendar/registration-success-dialog.component.ts` following `src/app/shared/dialogs.ts` style, with `data-cy` on every element. — file exists; `data-cy-coverage.test.ts` green in `npm run test` (108 files / 995 tests passed).
- [x] 3. Add the four i18n keys to both maps in `src/app/i18n/messages.ts`. — `registration.successTitle`, `registration.successMessage`, `common.close` in en (l.24, 554-555) and fr (l.1088, 1607-1608); the CTA reuses the existing `registration.myRegistrations` as the ticket allows, so no `registration.successCta` was added.
- [x] 4. In `public-tournament-detail.component.ts`: pass `[showIcsAction]="false"`, add the `registration-actions` row with the ICS anchor and the register button, delete `my-registrations-link`. — test `ics and register share one action row` + `my registrations button is gone from the registration section` pass.
- [x] 5. Change `register()` to await `this.mutate(...)` and, when `mutationStatus()` corresponds to success, open `RegistrationSuccessDialogComponent`. Make `mutate` return a boolean success flag instead of `void` and branch on it — do not infer success from a translated string. — `mutate(): Promise<boolean>`; `if (registered) await firstValueFrom(this.dialog.open(RegistrationSuccessDialogComponent, ...))`; tests `successful registration opens the success dialog` / `failed registration does not open the success dialog` / `a second submit while one is in flight neither registers nor confirms twice` pass.
- [x] 6. Add `.registration-register-button` and `.registration-actions { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center; }` to `src/styles.css`. — added at `src/styles.css:1173-1178`, reusing the existing green tokens (no second green introduced). The resting background is `--create-green-hot`, not `--create-green`: the Material label is 14px, so it needs 4.5:1, and `--forge` on `--create-green` measures 4.04:1 while `--forge` on `--create-green-hot` measures 5.65:1 (computed from the OKLCH values in `src/styles.css:5,15,16`). Hover/focus adds a glow instead of shifting the background, so both states stay above the AA bar.
- [x] 7. Create/extend `src/app/features/calendar/public-tournament-detail.component.test.ts` with the six tests. — 7 tests in that file (six from the plan plus the double-submit case), all green.
- [x] 8. Update `cypress/e2e/tournament-registration.cy.js` for the new selectors and the success dialog. — spec now 6 passing / 0 failing (was 5); `cypress/e2e/public-calendar.cy.js:199` also moved from `tournament-ics` to `registration-ics`, still 12 passing.
- [x] 9. Run `npx vitest run src/app/features/calendar`, `npm run lint`, `npm run typecheck`, `npx cypress run --spec cypress/e2e/tournament-registration.cy.js`. — all four green, output captured below.

## Outputs

- Files touched: `public-tournament-detail.component.ts` (+ test), `tournament-detail-view.component.ts` (+ test), `registration-success-dialog.component.ts` (new), `src/app/i18n/messages.ts`, `src/styles.css`, `cypress/e2e/tournament-registration.cy.js`.
- Behaviour change: register success dialog; action row layout; `mutate()` now returns a success flag.

## Validation

- [x] `npx vitest run src/app/features/calendar` passes — `Test Files 18 passed (18) / Tests 220 passed (220)`
- [x] `npx cypress run --spec cypress/e2e/tournament-registration.cy.js` passes — `6 passing (4s)`, `All specs passed! 6 6 - - -`
- [x] `npm run lint && npm run typecheck` pass — `All files pass linting.`; `tsc --noEmit` on both projects with no output
- [x] `npm run test` (full suite, acceptance matrix + data-cy + e2e spec coverage) — `Test Files 108 passed (108) / Tests 995 passed (995)`
- [x] a11y gate re-run: `npx cypress run --spec cypress/e2e/accessibility.cy.js` — `11 passing`, 0 failing, unchanged count
- [x] dialog is not an a11y trap: e2e asserts focus lands on `[data-cy=registration-success-close]` (cdkFocusInitial), `{esc}` closes the dialog, focus returns to `[data-cy=registration-status]`, and `mat-dialog-container[aria-labelledby]` resolves to `[data-cy=registration-success-title]` ("Vous êtes inscrit")
- [x] registration is a real mutation — proved in `tournament-registration.cy.js`: no dialog while the 150ms POST is in flight and none on a 500 (status reads "échoué"), `dblclick` yields exactly 1 POST and exactly 1 `mat-dialog-container`, dialog only after `cy.wait('@register')`
- [x] manual check: register on an event → dialog appears → "My registrations" navigates to `/registrations` — automated equivalent green (`confirms only what the server accepted and routes to My Registrations` asserts `location.pathname === '/registrations'`); human steps appended to `ai-artifacts/manual_test_checklist.md`
- [x] app functional — unregister, capacity status, offline warning and error retry unchanged: `tournament-registration.cy.js` (unregister confirm dialog, capacity reasons, offline 375px) and `public-calendar.cy.js` (12 passing), `offline-public-read.cy.js` (3), `abuse-surface.cy.js` (4), `organizer-tournament-create.cy.js` (7, preview keeps its own ICS path) all green
- [x] commit msg draft: `feat(calendar): pair register with add-to-calendar and confirm success`
