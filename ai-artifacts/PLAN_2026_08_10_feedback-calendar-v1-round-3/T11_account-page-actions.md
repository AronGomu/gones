# T11: Account page actions

**Plan:** `./ai-artifacts/PLAN_2026_08_10_feedback-calendar-v1-round-3.md`
**Depends:** none
**Commit outcome:** On `/settings/account`, the "Update account information" button is full width and centred with real space above it, and the page's bottom logout row is gone. The toolbar logout is untouched.

## Context (self-contained)

- Goal: land 15-line round-3 feedback on Gones. This slice covers two lines:
  - #13 — "On the Settings Account page, the Update Account Information button should be centered, take the full width, and add some margin with the Update Email button and the Change Email button."
  - #15 — "In the settings account page, remove the logout button at the bottom of the page. Make sure NOT to remove the logout button in the header of the application and on the header of that page."
- This slice: two edits to one component plus one stylesheet rule.
- Out of scope here: the app toolbar (`src/app/app.component.ts`, `data-cy="logout-button"`) — it must keep working. The profile form fields, the email-change form, the linked-accounts card, the danger zone.
- Assumptions in force: the account page's own `<header class="page-heading" data-cy="account-heading">` holds only the "My registrations" link today and gains nothing here — feedback #15 says do not *remove* a header logout, not add one. No TestBed — assert on template source and on `src/styles.css`.

## Inputs

- `src/app/features/settings/account-settings.component.ts`:
  - line ~25, the page header: `<header class="page-heading" data-cy="account-heading"><div data-cy="account-heading-text"><h1 …>…</h1></div><div class="actions" data-cy="account-heading-actions"><a mat-stroked-button routerLink="/registrations" data-cy="account-registrations-link">…</a></div></header>`
  - the details card ends with the email section, then:
    ```html
    <button form="account-details-form" mat-flat-button class="warning-action" data-cy="account-save" type="submit" [disabled]="pending() || !isDirty()">{{ pending() ? i18n.t('common.saving') : i18n.t('account.submit') }}</button>
    ```
    `'account.submit'` = `'Update account information'` / `'Modifier Information du Compte'`. That button is the "Update Account Information" one.
  - the email section holds `<button mat-stroked-button type="submit" data-cy="account-change-email">{{ i18n.t('profile.changeEmail') }}</button>` (`'Change email'` / `'Changer l'e-mail'`).
  - line ~112, the row to delete: `<div class="actions" data-cy="account-logout-row"><button mat-stroked-button type="button" class="danger-ghost-action" data-cy="account-logout" [disabled]="pending()" (click)="logout()">{{ i18n.t('auth.logout') }}</button></div>`
  - line ~212: `async logout(): Promise<void> { await this.auth.logout(); await this.router.navigate(['/']); }` — **its only caller is the row being deleted.**
  - line ~122 `private readonly router = inject(Router);` and line ~223 another `await this.router.navigate(['/']);` inside the account-deletion path — so `router` stays, only `logout()` goes.
- `src/styles.css` — `.actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: .75rem; min-width: 0; }`; `.profile-page { width: min(100%, 52rem); margin-inline: auto; }`.
- `cypress/e2e/auth-profile.cy.js` lines ~121-123 drive `[data-cy="logout-button"]` — the **toolbar** button, not `account-logout`. That spec must keep passing untouched.
- `src/app/features/settings/account-settings.component.test.ts` — add there.
- **From Depends:** none.

## Requirements

- Delete the whole `<div class="actions" data-cy="account-logout-row"> … </div>` element.
- Delete the now-unused `async logout()` method. Keep `private readonly router` and keep the `Router` import — both are still used by the account-deletion path.
- Keep `data-cy="logout-button"` in `src/app/app.component.ts` exactly as it is.
- Give the `data-cy="account-save"` button its own class `account-save-action` and a new rule:
  ```css
  .account-save-action { display: block; width: 100%; margin: 1.5rem auto 0; }
  ```
  `display: block` + `width: 100%` + `margin-inline: auto` is what "centred and full width" means for a Material button inside the card; `margin-top: 1.5rem` is the space feedback #13 asks for against the email-section buttons above it.
- Keep `class="warning-action"` on that button — it is the existing colour treatment and the feedback says nothing about it.

## TDD

1. **Red** — add the four tests below to `src/app/features/settings/account-settings.component.test.ts`. They fail today.
2. **Green** — delete the row, delete `logout()`, add the class and the CSS rule.
3. **Refactor** — none needed.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `the account page has no bottom logout row` | source of `src/app/features/settings/account-settings.component.ts` | contains neither `data-cy="account-logout-row"` nor `data-cy="account-logout"` |
| `the account page keeps no orphan logout handler` | same source | does not match `/async logout\(\)/` |
| `the update-account button is full width and centred` | same source, and `src/styles.css` | the `data-cy="account-save"` button markup contains `account-save-action`; the `.account-save-action { … }` stylesheet block contains `width: 100%`, `display: block` and `margin: 1.5rem auto 0` |
| `the application toolbar still logs out` | source of `src/app/app.component.ts` | contains `data-cy="logout-button"` and `(click)="logout()"` |

Match the stylesheet block with `stylesheet.match(/\.account-save-action\s*\{[^}]*\}/)?.[0] ?? ''`, as
`src/app/features/menu/home-grid-rule.test.ts` already does.

Run: `npx vitest run src/app/features/settings`

## Impl steps

- [x] 1. Add the four tests to `src/app/features/settings/account-settings.component.test.ts`. Confirm red with `npx vitest run src/app/features/settings`. — Evidence: pre-edit run showed `Test Files 1 failed | 4 passed (5)`, `Tests 3 failed | 26 passed (29)` (3 new tests red).
- [x] 2. In `src/app/features/settings/account-settings.component.ts`, delete the `<div class="actions" data-cy="account-logout-row"> … </div>` element from the template. — Evidence: element removed; `grep -c 'account-logout-row'` on the file returns 0.
- [x] 3. Delete the `async logout(): Promise<void> { … }` method. — Evidence: `grep -c 'async logout()'` on the file returns 0.
- [x] 4. Confirm `private readonly router = inject(Router);` and the `Router` import are still referenced by the account-deletion path; leave both. — Evidence: both lines untouched in diff; `deleteAccount()` still calls `this.router.navigate(['/'])`.
- [x] 5. Change the save button's class attribute to `class="warning-action account-save-action"`. — Evidence: line now reads `class="warning-action account-save-action"` on the `data-cy="account-save"` button.
- [x] 6. Add `.account-save-action { display: block; width: 100%; margin: 1.5rem auto 0; }` to `src/styles.css`, next to the other `.profile-page` / account rules. — Evidence: rule added directly after `.profile-page` at line 1092-1093.
- [x] 7. Run `npx vitest run src/app/features/settings` — green. — Evidence: `Test Files 5 passed (5)`, `Tests 29 passed (29)`.
- [x] 8. Run `npm run test && npm run lint && npm run typecheck && npm run build` — `data-cy-coverage.test.ts` must stay green and `typecheck` must not report an unused import. — Evidence: all four commands passed (see Validation section below).
- [x] 9. Manual: signed in, `/settings/account` shows no logout button at the bottom; the toolbar still has one and it still signs you out to `/`; the "Modifier Information du Compte" button spans the card width, is centred and sits clearly below "Changer l'e-mail". — Evidence: recorded in `ai-artifacts/manual_test_checklist.md` T11 section (visual claim, not auto-verified per repo convention).

## Outputs

- Files edited: `src/app/features/settings/account-settings.component.ts`, `src/styles.css`, `src/app/features/settings/account-settings.component.test.ts`.
- Behaviour change: the account page's bottom logout affordance is removed; the toolbar one is the only logout. Button layout change on the same page.
- Migration/config: none.

## Validation

- [x] `npx vitest run src/app/features/settings` passes. — Evidence: `Test Files 5 passed (5)`, `Tests 29 passed (29)`.
- [x] `npm run test` passes. — Evidence: `Test Files 97 passed (97)`, `Tests 821 passed (821)`.
- [x] `npm run lint` passes. — Evidence: `All files pass linting.`
- [x] `npm run typecheck` passes (no unused `Router`, no unused import). — Evidence: both `tsc --noEmit` invocations exited clean, no output.
- [x] `npm run build` passes. — Evidence: `Application bundle generation complete.`
- [x] `npm run cy:run -- --spec cypress/e2e/auth-profile.cy.js` passes — it drives the toolbar logout. — Evidence: ran via the NixOS steam-run wrapper; `4 passing, 3 failing` — identical to the documented pre-existing baseline (same 3 tests fail on `'/login'` vs `'/settings/account'`, unrelated to this slice); the toolbar-logout-covering test (`completes provider profile through the SPA without exposing an access token in the URL`) passes.
- [x] Manual: bottom logout gone; toolbar logout works; save button full width, centred, spaced. — Evidence: recorded in `ai-artifacts/manual_test_checklist.md` T11 section.
- [x] App functional — no broken path from this slice. — Evidence: full `npm run test && npm run lint && npm run typecheck && npm run build` all green; cypress baseline unchanged.
- [x] Commit msg draft: `fix(account): widen the save action and drop the duplicate logout` — Evidence: used verbatim as the commit message.
