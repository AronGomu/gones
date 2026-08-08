# T15: "Créer Tournoi" entry point

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T14
**Commit outcome:** Any user with a verified account sees a "Créer Tournoi" button next to "Synchroniser" and reaches the tournament creation form, which is now one page for every role.

## Context (self-contained)

- Goal: land the whole `feedback.md` list on Gones Calendar V1. This ticket covers Calendar §9 and Tournament Event Creation §1 ("Must be same page for all user type").
- This slice: the entry point and the route guard. The role-dependent submit behaviour (instant publish vs approval request) is T16/T18 — until then, a non-organizer reaching the page sees the form and a submit button that is disabled with an explanatory note.
- Out of scope here: the proposal entity, the approver dialog, emails.
- Assumptions in force: **A14** — "validated account user" means `auth.profile()?.emailVerified === true`. Anonymous visitors and unverified accounts see no button.

## Requirements

- `/calendar` shows a `Créer Tournoi` button immediately after `Synchroniser`, only when signed in with a verified email.
- The button navigates to `/tournaments/new`.
- `/tournaments/new` is a new route guarded by `userGuard` **and** `verifiedEmailGuard`, rendering the existing `OrganizerTournamentCreateComponent`.
- The old `/organizer/tournaments/new` path redirects to `/tournaments/new`; `/organizer/tournaments/:id/edit` keeps its organizer guard and its own component instance.
- On `/tournaments/new`, a user whose `globalRole` is neither `Organizer` nor `Admin` sees the whole form plus a notice that submission opens an approval request, and the submit button is disabled with `data-cy="tournament-submit-pending-approval"`.
- The `tournamentCreate.kicker` line is removed from the creation page header (T1's rule).
- Every element in the touched templates carries a unique `data-cy`; the touched files leave the retrofit allowlist.

## Inputs

- `src/app/app.routes.ts:16-22` — `const registrationAndOrganizerRoutes: Routes = [...]` contains
  ```
  { path: 'organizer/tournaments/new', canActivate: [organizerGuard], loadComponent: () => import('./features/calendar/organizer-tournament-create.component').then((m) => m.OrganizerTournamentCreateComponent) },
  { path: 'organizer/tournaments/:id/edit', canActivate: [organizerGuard], loadComponent: () => import('./features/calendar/organizer-tournament-create.component').then((m) => m.OrganizerTournamentCreateComponent) },
  ```
- `src/app/auth/auth.guards.ts` — `userGuard` (redirects to `/login?returnUrl=…`), `organizerGuard`, `adminGuard`, and `verifiedEmailGuard` which redirects to `/verify-email?email=…` when `profile()?.emailVerified` is false. All four already exist and are exported.
- `src/app/features/calendar/organizer-tournament-create.component.ts` — 439 lines.
  - `:22-26` the header: `<p class="kicker">{{ i18n.t('tournamentCreate.kicker') }}</p>` then `<h1 id="organizer-tournament-title">`, then `@if (editMode) { <a mat-stroked-button routerLink="/organizer/tournaments">…</a> }`.
  - `editMode` is derived from the route having an `:id` parameter; `editing()` toggles the form/preview panes.
  - The form is a `FormGroup` with controls `title`, `organizationId`, `summary`, `bodyHtml`, `streetAddress`, `postalCode`, `city`, `country`, `startsAtLocal`, `endsAtLocal`, `timeZoneId`, `capacity`, `formatIds`.
  - It loads references through the generated `Client`: `MyOrganizationResponse[]` and `PublicFormatResponse[]`.
  - Submission goes through `requestPreview()` → `POST /api/tournaments/preview` then a publish action → `POST /api/tournaments/`.
- `backend/src/Gones.Api/Tournaments/TournamentPublicationEndpoints.cs:28-39` — the publish group is `app.MapGroup("/api/tournaments")` with an Organizer authorization requirement; `preview` and `POST /` both sit behind it. **Leave the backend untouched in this ticket** — a non-organizer's submit is disabled client-side, and T16 adds the proposal endpoint that non-organizers actually call.
- `src/app/features/calendar/public-calendar.component.ts` — after T14 its header holds `<div class="calendar-header-actions" data-cy="calendar-header-actions">` with the view tabs, `[data-cy=calendar-sync]` and the `[data-cy=calendar-synced-at]` span.
- `src/app/auth/auth.service.ts` — `readonly profile = signal<UserProfileResponse | null>(null);` with `emailVerified: boolean` and `globalRole: string` on the response; `readonly enabled` reflects the `authV1` flag.
- `src/app/i18n/messages.ts` — `const en = {` line 5, `const fr` line 1000; both maps.
- `src/app/data-mode-routes.test.ts` — asserts route exposure per capability flag; extend it.
- Verified present, so none of these is a blocker: `userGuard` (`auth.guards.ts:5`), `organizerGuard` (`:18`),
  `verifiedEmailGuard` (`:20`), `AuthService.enabled` (`auth.service.ts:28`), and the existing spec files
  `src/app/features/calendar/organizer-tournament-create.test.ts` and
  `cypress/e2e/organizer-tournament-create.cy.js`.
- **Test harness — there is no Angular `TestBed` and no zone.js in this repo.** Component tests build a bare
  `Injector` with `runInInjectionContext` and stub `effect()` to a no-op — copy
  `src/app/features/settings/account-settings.component.test.ts` or the `public-calendar.component.test.ts` that
  T14 just added. Assert on component state and spy calls, never on rendered DOM.
- **Cypress cost: zero auth permits.** `cypress/e2e/organizer-tournament-create.cy.js:39` intercepts
  `POST **/api/auth/refresh` and fakes the session outright — it never calls a real auth endpoint, and neither does
  `public-calendar.cy.js`. Re-run these specs as often as needed; the 15-minute auth rate limit does not apply. Do
  not add a spec that performs a real login or registration.
- **From Depends (T14):** the calendar header actions container exists with that exact `data-cy`, and the calendar page is already out of `PENDING_DATA_CY_RETROFIT`.

## TDD

1. **Red** — add the routing assertions to `src/app/data-mode-routes.test.ts` and the button-visibility assertions to `src/app/features/calendar/public-calendar.component.test.ts`; both fail.
2. **Green** — add the route, the redirect, the button and the role notice.
3. **Refactor** — none.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `exposes tournaments/new when auth is on` | `buildRoutes({authV1:true, adminV1:true}).map(r => r.path)` | contains `'tournaments/new'` |
| `guards tournaments/new` | that route object | `canActivate` contains both `userGuard` and `verifiedEmailGuard` |
| `redirects the organizer create path` | the `organizer/tournaments/new` route object | `redirectTo === 'tournaments/new'` |
| `keeps the organizer edit path guarded` | `organizer/tournaments/:id/edit` | `canActivate` contains `organizerGuard` |
| `hides the create button when anonymous` | profile `null` | `[data-cy=calendar-create-tournament]` absent |
| `hides the create button when unverified` | profile with `emailVerified: false` | absent |
| `shows the create button when verified` | profile with `emailVerified: true`, `globalRole: 'User'` | present, `routerLink` is `/tournaments/new` |
| `disables submit for a plain user` | creation page with `globalRole: 'User'` | `[data-cy=tournament-submit-pending-approval]` present and disabled |
| `keeps submit enabled for an organizer` | `globalRole: 'Organizer'` | the normal submit button present and enabled |
| `data-cy coverage` | allowlist without the creation component | suite green |

Run: `npm run test -- data-mode-routes public-calendar organizer-tournament-create data-cy-coverage`

## Impl steps

- [ ] 1. In `src/app/app.routes.ts`, add to `registrationAndOrganizerRoutes`:
  ```
  { path: 'tournaments/new', canActivate: [userGuard, verifiedEmailGuard], loadComponent: () => import('./features/calendar/organizer-tournament-create.component').then((m) => m.OrganizerTournamentCreateComponent) },
  ```
- [ ] 2. Replace the existing `organizer/tournaments/new` entry with `{ path: 'organizer/tournaments/new', pathMatch: 'full', redirectTo: 'tournaments/new' }`.
- [ ] 3. Import `verifiedEmailGuard` from `./auth/auth.guards` at the top of `src/app/app.routes.ts`.
- [ ] 4. Add the four routing assertions from the Test plan to `src/app/data-mode-routes.test.ts`.
- [ ] 5. In `src/app/features/calendar/public-calendar.component.ts`, inject `readonly auth = inject(AuthService);` and add `readonly canCreateTournament = computed(() => this.auth.enabled && this.auth.profile()?.emailVerified === true);`.
- [ ] 6. Add inside `<div class="calendar-header-actions">`, immediately after the Synchroniser button:
  ```
  @if (canCreateTournament()) {
    <a mat-flat-button class="home-primary-action" routerLink="/tournaments/new" data-cy="calendar-create-tournament">{{ i18n.t('calendar.createTournament') }}</a>
  }
  ```
- [ ] 7. Add `calendar.createTournament` to BOTH maps in `src/app/i18n/messages.ts`: en `'Create tournament'`, fr `'Créer Tournoi'`.
- [ ] 8. Add Test plan rows 5-7 to `src/app/features/calendar/public-calendar.component.test.ts`.
- [ ] 9. In `src/app/features/calendar/organizer-tournament-create.component.ts`, delete the `<p class="kicker">…</p>` line from the header and give the header elements `data-cy` values prefixed `tournament-create-`.
- [ ] 10. Inject `readonly auth = inject(AuthService);` and add `readonly canPublishDirectly = computed(() => { const role = this.auth.profile()?.globalRole; return role === 'Organizer' || role === 'Admin'; });`.
- [ ] 11. Wrap the existing submit control:
  ```
  @if (canPublishDirectly()) {
    …existing submit button, unchanged…
  } @else {
    <p class="warning" role="status" data-cy="tournament-approval-notice">{{ i18n.t('tournamentCreate.approvalNotice') }}</p>
    <button mat-flat-button class="home-primary-action" type="button" disabled data-cy="tournament-submit-pending-approval">{{ i18n.t('tournamentCreate.submitForApproval') }}</button>
  }
  ```
- [ ] 12. Add to BOTH maps: `tournamentCreate.approvalNotice` (en `'Your account cannot publish directly. Submitting will send an approval request to the administrators and organizers you choose.'`, fr `'Votre compte ne peut pas publier directement. La soumission enverra une demande de validation aux administrateurs et organisateurs que vous choisirez.'`) and `tournamentCreate.submitForApproval` (en `'Submit for approval'`, fr `'Soumettre pour validation'`).
- [ ] 13. Delete `tournamentCreate.kicker` from BOTH maps if `grep -rn "tournamentCreate.kicker" src/` shows no remaining caller.
- [ ] 14. Change the `editMode` back-link target from `/organizer/tournaments` only if it breaks; it does not — organizers keep their list page.
- [ ] 15. Give every remaining element of `organizer-tournament-create.component.ts`'s template a unique `data-cy`, prefixed `tournament-`. The file is 439 lines; work field by field.
- [ ] 16. Delete `src/app/features/calendar/organizer-tournament-create.component.ts` from `PENDING_DATA_CY_RETROFIT` in `src/app/shared/data-cy-coverage.test.ts`.
- [ ] 17. Add Test plan rows 8-9 to `src/app/features/calendar/organizer-tournament-create.test.ts` (the existing spec file) or a new `organizer-tournament-create.component.test.ts` if the existing one only covers pure helpers.
- [ ] 18. Update `cypress/e2e/organizer-tournament-create.cy.js` to visit `/tournaments/new` and assert the redirect from `/organizer/tournaments/new`.
- [ ] 19. Run `npm run test && npm run lint && npm run typecheck && npm run build`.
- [ ] 20. Run `npm run dev` then `npm run cy:run -- --spec cypress/e2e/organizer-tournament-create.cy.js,cypress/e2e/public-calendar.cy.js`.

## Outputs

- Files touched: `src/app/app.routes.ts`, `src/app/data-mode-routes.test.ts`, `src/app/features/calendar/public-calendar.component.ts`, `src/app/features/calendar/public-calendar.component.test.ts`, `src/app/features/calendar/organizer-tournament-create.component.ts`, `src/app/features/calendar/organizer-tournament-create.test.ts`, `src/app/i18n/messages.ts`, `src/app/shared/data-cy-coverage.test.ts`, `cypress/e2e/organizer-tournament-create.cy.js`.
- Public API / behavior change: new route `/tournaments/new` open to any verified account; `/organizer/tournaments/new` redirects.
- Migrate / config: none.

## Validation

- [ ] `npm run test` passes
- [ ] `npm run lint && npm run typecheck && npm run build` pass
- [ ] `npm run cy:run -- --spec cypress/e2e/organizer-tournament-create.cy.js,cypress/e2e/public-calendar.cy.js` passes
- [ ] manual check: anonymous `/calendar` shows no create button; a verified plain user sees it, reaches the form, and finds the submit disabled with the approval notice; an organizer still publishes as before
- [ ] app functional — organizer edit and publish flows unchanged
- [ ] commit msg draft: `feat(calendar): open the tournament creation page to every verified account`
