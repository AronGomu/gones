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

- `src/app/features/calendar/my-registrations.component.ts` — 95 lines, `MyRegistrationsComponent`, route `registrations` guarded by `userGuard` (`src/app/app.routes.ts:17`). Its header follows the same shape the other pages use: a `page-heading` div with `<p class="kicker">{{ i18n.t('auth.account') }}</p>` above the `<h1>`. Confirm the exact markup before editing — if the kicker uses a different key, remove whichever `<p class="kicker">` is present.
- `src/app/shared/back-button.component.ts` — `selector: 'gones-back-button'`, standalone, `@Input() link: string | unknown[] | null`, `@Input() label = ''`, `@Input() position: 'top' | 'bottom' = 'top'`. Usage example, from `src/app/features/calendar/public-calendar.component.ts:38` and `:110`:
  ```
  <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="top" />
  …page…
  <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="bottom" />
  ```
  Note both are rendered **outside** the page `<section>`, as siblings.
- `src/app/features/menu/home-menu.component.ts` — 54 lines. Its `<nav class="home-destinations">` holds `<a class="home-destination home-destination--…" routerLink="…" data-cy="…"><strong>…</strong><p>…</p></a>` cards for running tournaments, leagues, calendar, settings and about. T3 may have added a `menu-login-card` at the top; keep it.
- `src/app/i18n/messages.ts` — `registration.myRegistrations` already exists in BOTH maps (used by the account page's header link). `nav.returnToMenu` also exists. `const en = {` line 5, `const fr` line 1000.
- `src/app/auth/auth.service.ts` — `readonly profile = signal<UserProfileResponse | null>(null);` and `readonly enabled`.
- `src/app/shared/data-cy-coverage.test.ts` — `PENDING_DATA_CY_RETROFIT` lists both touched files unless T3 already removed `home-menu.component.ts`.
- **From Depends (T1):** the `data-cy` rule, the "no default kicker" rule in `docs/DESIGN.md` and `src/AGENT.md`, and the coverage test with its allowlist.

## TDD

1. **Red** — remove both files from `PENDING_DATA_CY_RETROFIT` and add the component tests below; the suite fails.
2. **Green** — add the buttons, the card and the identifiers.
3. **Refactor** — none.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `renders a top and a bottom return button` | mounted `MyRegistrationsComponent` | two `gones-back-button` instances, `position` `'top'` and `'bottom'`, both `[link]="['/']"` |
| `renders no kicker` | same | no element with class `kicker` |
| `home shows the registrations card when signed in` | `auth.profile()` non-null | `[data-cy=menu-registrations-card]` present with `routerLink="/registrations"` |
| `home hides it when anonymous` | `auth.profile()` null | absent |
| `data-cy coverage` | allowlist without both files | suite green |

Run: `npm run test -- my-registrations home-menu data-cy-coverage`

## Impl steps

- [ ] 1. In `src/app/features/calendar/my-registrations.component.ts`, add `BackButtonComponent` to the component `imports` array and import it from `../../shared/back-button.component`.
- [ ] 2. Wrap the template: put `<gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="top" data-cy="registrations-back-top" />` before the page `<section>` and the `position="bottom"` twin (`data-cy="registrations-back-bottom"`) after it.
- [ ] 3. Delete the `<p class="kicker">…</p>` element from that component's header.
- [ ] 4. Add a unique `data-cy` to every remaining element of the template, prefixed `registrations-`.
- [ ] 5. In `src/app/features/menu/home-menu.component.ts`, inject `readonly auth = inject(AuthService);` if it is not already injected (T3 adds it).
- [ ] 6. Add, immediately after the calendar card:
  ```
  @if (auth.profile()) {
    <a class="home-destination home-destination--calendar" routerLink="/registrations" data-cy="menu-registrations-card">
      <strong data-cy="menu-registrations-card-title">{{ i18n.t('registration.myRegistrations') }}</strong>
      <p data-cy="menu-registrations-card-desc">{{ i18n.t('home.registrationsDesc') }}</p>
    </a>
  }
  ```
- [ ] 7. Add `home.registrationsDesc` to BOTH maps in `src/app/i18n/messages.ts`: en `'Review the tournaments you signed up for and cancel a registration.'`, fr `'Consultez les tournois auxquels vous êtes inscrit et annulez une inscription.'`
- [ ] 8. Add a unique `data-cy` to every remaining element of `home-menu.component.ts`'s template if T3 has not already done it.
- [ ] 9. Delete `src/app/features/calendar/my-registrations.component.ts` and `src/app/features/menu/home-menu.component.ts` from `PENDING_DATA_CY_RETROFIT` in `src/app/shared/data-cy-coverage.test.ts`.
- [ ] 10. Create `src/app/features/calendar/my-registrations.component.test.ts` with Test plan rows 1-2, stubbing the registration service.
- [ ] 11. Create or extend `src/app/features/menu/home-menu.component.test.ts` with rows 3-4, stubbing `AuthService` and `LiveTournamentRepository`.
- [ ] 12. Update `cypress/e2e/tournament-registration.cy.js` to reach `/registrations` through `[data-cy=menu-registrations-card]` at least once, proving the card works.
- [ ] 13. Run `npm run test && npm run lint && npm run typecheck && npm run build`.
- [ ] 14. Run `npm run dev` then `npm run cy:run -- --spec cypress/e2e/tournament-registration.cy.js,cypress/e2e/accessibility.cy.js`.

## Outputs

- Files created: `src/app/features/calendar/my-registrations.component.test.ts`, possibly `src/app/features/menu/home-menu.component.test.ts`.
- Files touched: `src/app/features/calendar/my-registrations.component.ts`, `src/app/features/menu/home-menu.component.ts`, `src/app/i18n/messages.ts`, `src/app/shared/data-cy-coverage.test.ts`, `cypress/e2e/tournament-registration.cy.js`.
- Public API / behavior change: a new home menu card for signed-in users.
- Migrate / config: none.

## Validation

- [ ] `npm run test` passes
- [ ] `npm run lint && npm run typecheck && npm run build` pass
- [ ] `npm run cy:run -- --spec cypress/e2e/tournament-registration.cy.js,cypress/e2e/accessibility.cy.js` passes
- [ ] manual check: signed in, the home menu shows "Mes inscriptions"; the page has a return button above and below its content and no kicker
- [ ] app functional — signed out, the card is absent and `/registrations` still bounces to `/login`
- [ ] commit msg draft: `feat(registrations): add a home card and return-to-menu buttons, drop the kicker`
