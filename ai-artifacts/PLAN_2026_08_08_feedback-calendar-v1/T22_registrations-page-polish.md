# T22: Registrations page polish

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T1
**Commit outcome:** Signed-in users find a "Mes inscriptions" card on the home menu, and the registrations page gains top and bottom return-to-menu buttons and loses its kicker.

## Context (self-contained)

- Goal: land the whole `feedback.md` list on Gones Calendar V1. This ticket is the "Registration page" section: §1 (home card when logged in), §2 (return-to-menu buttons top and bottom), §3 (remove the "Compte" kicker).
- This slice: two small components.
- Out of scope here: the `/register` sign-up page (that is T4), the settings merge, the calendar.
- Assumptions in force: **A12** — "Registration page" means `/registrations` (My Registrations), not `/register`.

## Requirements

- `/registrations` renders `<gones-back-button position="top">` before its content and `<gones-back-button position="bottom">` after it, both linking to `/`.
- The `Compte` kicker above the page title is removed.
- The home menu shows a "Mes inscriptions" card linking to `/registrations`, only when a profile is loaded.
- Every element in both touched components carries a unique `data-cy`; both files leave the retrofit allowlist.

## Inputs

- `src/app/features/calendar/my-registrations.component.ts` — 95 lines, `MyRegistrationsComponent`, route `registrations` guarded by `userGuard` (`src/app/app.routes.ts:17`).
  **Parent-verified reality (the ticket's original wording was wrong — use this):**
  - The page kicker is on **line 16**, inside `<header class="page-heading">`, and its key is
    `i18n.t('registration.accountKicker')` — **not** `auth.account`. That is the one to delete.
  - There is a **second** `<p class="kicker">` on **line 40**, inside `<ng-template #attemptCard>`, rendering
    `{{ attempt.organizationName }}`. It is a per-card organization label, **not** a page kicker.
    **Leave it exactly as it is.** Deleting it loses the organization name on every registration card.
  - After removing the header one, `registration.accountKicker` has no remaining reference. It exists at
    `src/app/i18n/messages.ts:525` (en `'Account'`) and `:1551` (fr `'Compte'`) — delete both, then prove it with
    `grep -rn "accountKicker" src/ cypress/` returning nothing.
  - The template already carries `data-cy` on several elements (`registrations-page`, `registrations-loading`,
    `registrations-error`, `registration-attempt`). Step 4 fills the gaps, it does not start from zero.
- `src/app/shared/back-button.component.ts` — `selector: 'gones-back-button'`, standalone, `@Input() link: string | unknown[] | null`, `@Input() label = ''`, `@Input() position: 'top' | 'bottom' = 'top'`. Usage example, from `src/app/features/calendar/public-calendar.component.ts:38` and `:110`:
  ```
  <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="top" />
  …page…
  <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="bottom" />
  ```
  Note both are rendered **outside** the page `<section>`, as siblings.
  `back-button.component.ts` is itself still on the retrofit allowlist, so its internals are not your problem —
  but the **usage tag** lives in your template and therefore needs a literal `data-cy`. Live precedent:
  `src/app/features/calendar/public-calendar.component.ts:41` and `:113`.
- `src/app/features/menu/home-menu.component.ts` — **62 lines as of `3c397b4`; T3 already did most of what steps 5 and 8
  ask for.** Parent-verified: it already has `readonly auth = inject(AuthService);` (line 48), already carries a unique
  `data-cy` on every element, already renders the `menu-login-card` `@if (auth.enabled && !auth.profile())` block, and
  was **already removed from `PENDING_DATA_CY_RETROFIT`**. Treat steps 5, 8 and the home-menu half of step 9 as
  *confirmations*: verify, do not redo. The calendar card you insert after is at lines 29-32.
- `src/app/i18n/messages.ts` — `registration.myRegistrations` exists in BOTH maps (`:531` en, `:1557` fr).
  `nav.returnToMenu` exists. **`home.registrationsDesc` does NOT exist in either map — step 7 is a real addition.**
  Follow the shape of the neighbouring `home.signInDesc` (`:157` en, `:1190` fr). There is no automated en/fr key-parity
  test in this repo, so a one-sided addition would ship silently — add to both maps and grep to confirm two hits.
- `src/app/auth/auth.service.ts` — `readonly profile = signal<UserProfileResponse | null>(null);` and `readonly enabled`.
- `src/app/shared/data-cy-coverage.test.ts` — `PENDING_DATA_CY_RETROFIT` starts at line 106 and holds **29** entries.
  `src/app/features/calendar/my-registrations.component.ts` is at **line 116**. `home-menu.component.ts` is **not** in the
  list (T3 removed it). Step 9 therefore deletes exactly **one** line.
- **From Depends (T1):** the `data-cy` rule, the "no default kicker" rule in `docs/DESIGN.md` and `src/AGENT.md`, and the coverage test with its allowlist.

### Environment facts inlined by the parent — these cost hours to rediscover

- **There is no Angular `TestBed` and no zone.js in this repo.** `@angular/common/http/testing` is not installed;
  `HttpTestingController` and `provideHttpClientTesting()` do not exist. **You cannot render a component's DOM in vitest.**
  Four earlier tickets tripped on this. Two working patterns:
  - component logic/state → `import '@angular/compiler'`, `vi.mock('@angular/core', …)` stubbing `effect()` to a no-op,
    then a bare `Injector.create` + `runInInjectionContext`. See `src/app/features/calendar/public-calendar.component.test.ts:1-20`.
  - **template-shape assertions** (which is what Test plan rows 1-2 need) → read the component source with
    `readFileSync` and assert on the template string. Precedent: `src/app/backend/server-authority-boundary.test.ts:1-30`
    and `src/app/shared/data-cy-coverage.test.ts`.
- **`cy.visit('/')` does not land on the home menu.** `firstVisitHomeGuard` (`src/app/shared/first-visit.guard.ts`)
  redirects a first-ever visit to `/about`. Cypress starts every spec with a clean profile, so **every** visit is a first
  visit. Seed the flag in `onBeforeLoad`: `win.localStorage.setItem('gones.first-visit.completed', 'true')`
  (key is `FIRST_VISIT_KEY`, `src/app/shared/first-visit.service.ts:3`). Precedent:
  `cypress/e2e/auth-session-persistence.cy.js:6-11`. `tournament-registration.cy.js`'s existing `visit()` helper already
  has an `onBeforeLoad` block (line 23) — add the flag there. T21 broke a spec exactly this way; do not repeat it.
- **Auth rate limit is the dominant constraint on this repo's Cypress.** `AuthRateLimiting.PermitLimit = 5` per
  15-minute **fixed** window, per IP *and* per account, buckets per endpoint. Raising it on the API container is blocked
  by the permission classifier. **Good news for this ticket:** both specs you must run are fully intercept-based
  (`cy.intercept('POST', '**/api/auth/refresh', …)` + `**/api/users/me`) and cost **zero permits**. Keep it that way —
  **do not add a real `cy.get('[data-cy=auth-submit]').click()` login anywhere.** Reuse the spec's `authenticated()` helper.
- **`cy.session()` does not work against this backend** (refresh tokens are single-use and rotate). Proved dead twice.
  Do not try it.
- **Cypress needs a NixOS library path** — a bare `npm run cy:run` dies with
  `libglib-2.0.so.0: cannot open shared object file`. This replaces step 14's `npm run dev`:
  ```sh
  export LD_LIBRARY_PATH="$(nix eval --raw --impure --expr 'with import <nixpkgs> {}; lib.makeLibraryPath [ glib gtk3 nss nspr dbus atk at-spi2-atk at-spi2-core cups cairo pango libx11 libxcomposite libxdamage libxext libxfixes libxrandr mesa libgbm expat libxcb libxkbcommon systemd alsa-lib ]'):$LD_LIBRARY_PATH"
  npm run dev:serve            # 127.0.0.1:4200 — the API is already up on 5080
  node node_modules/cypress/bin/cypress run \
    --spec cypress/e2e/tournament-registration.cy.js,cypress/e2e/accessibility.cy.js \
    --config baseUrl=http://127.0.0.1:4200,screenshotOnRunFailure=false
  ```
  `node scripts/seed-auth-e2e.mjs` is **not** needed here — neither spec performs a real login.
  **Never run all 17 specs under `ng serve`**: most only pass under the release Docker topology on 8081.

## TDD

1. **Red** — remove both files from `PENDING_DATA_CY_RETROFIT` and add the component tests below; the suite fails.
2. **Green** — add the buttons, the card and the identifiers.
3. **Refactor** — none.

## Test plan

**Parent correction: rows 1-4 said "mounted component" / "present" / "absent", which implies a rendered DOM. This repo
has no `TestBed` — see the environment facts above. Assert on the template source read with `readFileSync` instead.**

| Test | Input | Expect |
| --- | --- | --- |
| `renders a top and a bottom return button` | `my-registrations.component.ts` source | template contains a `<gones-back-button …position="top"…>` and a `<gones-back-button …position="bottom"…>`, both with `[link]="['/']"` |
| `renders no page kicker` | same | the `<header class="page-heading">` block contains no `class="kicker"` … and the `attemptCard` template still does (guards the line-40 organization label against collateral deletion) |
| `home shows the registrations card only when signed in` | `home-menu.component.ts` source | `data-cy="menu-registrations-card"` with `routerLink="/registrations"` appears inside an `@if (auth.profile()) {` block |
| `home hides it when anonymous` | same | covered by the `@if` assertion above — no separate DOM test is possible |
| `i18n key parity` | `messages.ts` | `home.registrationsDesc` resolves in both `en` and `fr` via `translate(...)`, and `registration.accountKicker` is gone from both |
| `data-cy coverage` | allowlist minus `my-registrations.component.ts` | suite green |

Run: `npm run test -- my-registrations home-menu data-cy-coverage`

## Impl steps

- [x] 1. In `src/app/features/calendar/my-registrations.component.ts`, add `BackButtonComponent` to the component `imports` array and import it from `../../shared/back-button.component`.
- [x] 2. Wrap the template: put `<gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="top" data-cy="registrations-back-top" />` before the page `<section>` and the `position="bottom"` twin (`data-cy="registrations-back-bottom"`) after it.
- [x] 3. Delete **only** the `<p class="kicker">{{ i18n.t('registration.accountKicker') }}</p>` element inside
  `<header class="page-heading">` (line 16). **Do not touch the `<p class="kicker">{{ attempt.organizationName }}</p>` on
  line 40 inside `<ng-template #attemptCard>`** — that is a card label, not a page kicker.
  - [x] 3b. Delete the now-orphaned `'registration.accountKicker'` key from BOTH maps in `src/app/i18n/messages.ts`
    (`:525` en, `:1551` fr) — validate: `grep -rn "accountKicker" src/ cypress/` returns nothing.
- [x] 4. Add a unique `data-cy` to every remaining element of the template, prefixed `registrations-`.
- [x] 5. **Confirmation only** — verify `src/app/features/menu/home-menu.component.ts:48` already reads
  `readonly auth = inject(AuthService);`. T3 added it. Do not re-add.
- [x] 6. Add, immediately after the calendar card:
  ```
  @if (auth.profile()) {
    <a class="home-destination home-destination--calendar" routerLink="/registrations" data-cy="menu-registrations-card">
      <strong data-cy="menu-registrations-card-title">{{ i18n.t('registration.myRegistrations') }}</strong>
      <p data-cy="menu-registrations-card-desc">{{ i18n.t('home.registrationsDesc') }}</p>
    </a>
  }
  ```
- [x] 7. Add `home.registrationsDesc` to BOTH maps in `src/app/i18n/messages.ts`: en `'Review the tournaments you signed up for and cancel a registration.'`, fr `'Consultez les tournois auxquels vous êtes inscrit et annulez une inscription.'`
- [x] 8. **Confirmation only** — `home-menu.component.ts` already has a unique `data-cy` on every element (T3).
  Your new card must keep that true: `menu-registrations-card`, `-title`, `-desc` are all unused so far.
- [x] 9. Delete the single line `'src/app/features/calendar/my-registrations.component.ts',` (line 116) from
  `PENDING_DATA_CY_RETROFIT` in `src/app/shared/data-cy-coverage.test.ts`. **`home-menu.component.ts` is not in the list**
  — T3 already removed it. The list goes 29 → 28 entries.
- [x] 10. Create `src/app/features/calendar/my-registrations.component.test.ts` with Test plan rows 1-2 —
  source-string assertions via `readFileSync`, **not** a rendered DOM (see environment facts).
- [x] 11. Create `src/app/features/menu/home-menu.component.test.ts` with rows 3-4 — same source-string technique.
  (No such file exists yet; `src/app/features/menu/` holds only `about.component.ts` and `home-menu.component.ts`.)
- [x] 12. Update `cypress/e2e/tournament-registration.cy.js` so the existing `My Registrations` describe block reaches
  `/registrations` through `[data-cy=menu-registrations-card]` at least once instead of `visit('/registrations')`.
  - [x] 12a. Add `win.localStorage.setItem('gones.first-visit.completed', 'true');` to the `visit()` helper's
    `onBeforeLoad` (line 23) — otherwise `visit('/')` redirects to `/about` and the card is never on screen.
  - [x] 12b. Use the existing `authenticated()` helper for the session. **Add no real login** — this spec currently
    costs zero auth permits and must stay that way.
- [x] 13. Run `npm run test && npm run lint && npm run typecheck && npm run build`.
- [x] 14. Run the two Cypress specs using the **NixOS recipe in the environment facts above** (not `npm run dev` /
  `npm run cy:run`, both of which fail on this host). **Ran: `tournament-registration.cy.js` 5/5 green,
  `accessibility.cy.js` 11/11 green, "All specs passed! 16 16".**
  - [x] 14a. The 4 earlier failures were a pre-existing defect in the spec itself, not in `src/`: its `visit()` helper
    seeded `gones.settings` with `language: 'en'`, but every text assertion in the spec is French
    (`'Vérifiez votre e-mail'`, `'complet'`, `'Annulée par vous'`, …). `loadSettingsLanguage()`
    (`src/app/shared/deck-archetype-settings.service.ts:252-255`) reads the `gones.settings` JSON first, so the UI
    rendered English and the assertions were unsatisfiable. Fixed by seeding `fr` in both
    `gones.settings.language` and the `gones.settings` JSON. No `src/` change was needed.

## Outputs

- Files created: `src/app/features/calendar/my-registrations.component.test.ts`, possibly `src/app/features/menu/home-menu.component.test.ts`.
- Files created: `src/app/features/menu/home-menu.component.test.ts` (does not exist yet).
- Files touched: `src/app/features/calendar/my-registrations.component.ts`, `src/app/features/menu/home-menu.component.ts`, `src/app/i18n/messages.ts` (add `home.registrationsDesc` ×2, remove `registration.accountKicker` ×2), `src/app/shared/data-cy-coverage.test.ts`, `cypress/e2e/tournament-registration.cy.js`.
- Public API / behavior change: a new home menu card for signed-in users.
- Migrate / config: none.

## Validation

- [x] `npm run test` passes
- [x] `npm run lint && npm run typecheck && npm run build` pass
- [x] `cypress/e2e/tournament-registration.cy.js` + `cypress/e2e/accessibility.cy.js` pass under the NixOS recipe —
  `tournament-registration.cy.js` **5/5**, `accessibility.cy.js` **11/11**, run finished "All specs passed! 16 16".
- [x] `grep -rn "accountKicker" src/ cypress/` returns nothing, and `grep -c "home.registrationsDesc" src/app/i18n/messages.ts` returns 2
- [ ] manual check: signed in, the home menu shows "Mes inscriptions"; the page has a return button above and below its
  content and no kicker — **left unchecked, no human observation yet.** Cypress covers only part of it: the
  `My Registrations` spec signs in, visits `/`, clicks `[data-cy=menu-registrations-card]` and lands on the
  registrations page, so the card exists and routes. The card's rendered label, the two return buttons and the
  absent kicker are asserted only against the template source in
  `src/app/features/calendar/my-registrations.component.test.ts` and
  `src/app/features/menu/home-menu.component.test.ts` — never in a real browser. Queued in
  `ai-artifacts/manual_test_checklist.md`.
- [ ] app functional — signed out, the card is absent and `/registrations` still bounces to `/login` —
  **left unchecked, not observed.** No spec exercises the signed-out home menu or the `userGuard` redirect.
  Queued in `ai-artifacts/manual_test_checklist.md`.
- [x] commit msg draft: `feat(registrations): add a home card and return-to-menu buttons, drop the kicker`
