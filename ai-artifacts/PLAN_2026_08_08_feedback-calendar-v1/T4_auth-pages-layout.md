# T4: Login/register page layout

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T1
**Commit outcome:** Login and register pages drop the "Compte" kicker, space their action rows, show official Google/Facebook logos, register asks for a password confirmation, and the unverified-email banner is centred.

## Context (self-contained)

- Goal: land the whole `feedback.md` list on Gones Calendar V1. This ticket covers Login §1–§4, Login §8 and Register §1–§2.
- This slice: presentation and one new client-side validation on the auth entry page. No API change.
- Out of scope here: the header menubar and post-login redirect (T3), the settings/account merge (T8).
- Assumptions in force: A1 (`data-cy`); the "no default kicker" rule was written into `docs/DESIGN.md` and `src/AGENT.md` by T1, this ticket applies it to the auth pages.

## Requirements

- `<p class="kicker">{{ i18n.t('auth.account') }}</p>` is removed from the auth entry page header.
- Vertical space separates: the submit button row from the OAuth row, and the OAuth row from the account-links row. Same spacing on both login and register modes.
- The OAuth buttons render the official Google "G" and Facebook "f" marks as inline `<img>` next to the label, not plain text.
- Register mode gains a "Confirmer le mot de passe" input; submitting with a mismatch shows a field error and does not call the API.
- The unverified-email banner in the app shell is horizontally centred on the page.
- Every element in the touched templates carries a unique `data-cy`; the touched files leave the retrofit allowlist.

## Inputs

- `src/app/auth/auth-entry.component.ts:24-27` — the header to strip:
  ```
  <header>
    <p class="kicker">{{ i18n.t('auth.account') }}</p>
    <h1 [id]="titleId">{{ title() }}</h1>
  </header>
  ```
- `src/app/auth/auth-entry.component.ts:29-48` — login mode: `<form class="auth-form">` … then `<div class="oauth-grid">` with `data-cy="oauth-google"` and `data-cy="oauth-facebook"` buttons whose content is `{{ i18n.t('auth.continueGoogle') }}` / `{{ i18n.t('auth.continueFacebook') }}`, then `<nav class="auth-links">` with `/register` and `/forgot-password` anchors.
- `src/app/auth/auth-entry.component.ts:49-66` — register mode: email, username, first/last grid, then `<input id="register-password" data-cy="auth-password" type="password" autocomplete="new-password" minlength="12" required [(ngModel)]="password" name="password" …>` and the submit button, then its own `oauth-grid` and a `/login` anchor.
- `src/app/auth/auth-entry.component.ts:130-135` — `submitRegister()` calls `this.auth.register({ email, username, password, firstName, lastName })` then navigates to `registrationDestination(profile)`.
- `src/app/auth/auth-entry.component.ts:175-183` — `private async run(action)` clears `error`, `status`, `fieldErrors`, sets `pending`, maps failures through `fieldErrorsFromProblem`.
- `src/app/auth/auth-errors.ts` — `AuthFieldErrors` is `Record<string, string[]>`.
- `src/app/auth/auth-entry.component.ts:14-15` — `FieldErrorsComponent` (`selector: 'gones-field-errors'`, input `messages: string[]`) already exists for rendering field errors.
- `src/styles.css:1071-1072` — `.oauth-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; }` and `.auth-links { display: flex; justify-content: space-between; flex-wrap: wrap; gap: .75rem; }`.
- `src/styles.css:512` — `.app-banner { margin: .75rem auto 0; width: min(1280px, calc(100vw - 32px)); box-sizing: border-box; }`.
- `src/styles.css:1049` — `.verification-banner { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: .75rem; margin: 0; }` — the `margin: 0` is what kills the `auto` centring inherited from `.app-banner`. That is the bug.
- `src/app/app.component.ts:104-110` — the banner element is `<aside class="warning app-banner verification-banner" role="status" aria-live="polite" data-cy="unverified-banner">`.
- `src/app/i18n/messages.ts` — `const en = {` line 5, `const fr: Record<MessageKey, string> = {` line 1000; add keys to BOTH.
- `angular.json` — `src/assets` is already declared as an asset folder, so files under `src/assets/**` ship as-is.
- **From Depends (T1):** `src/AGENT.md` mandates a unique `data-cy` on every element; `src/app/shared/data-cy-coverage.test.ts` exports `PENDING_DATA_CY_RETROFIT`, a sorted array of repo-relative paths still exempt.

## TDD

1. **Red** — write `src/app/auth/password-confirmation.test.ts` against a not-yet-existing `passwordConfirmationErrors()` helper, and add the `data-cy` coverage expectation by deleting `src/app/auth/auth-entry.component.ts` and `src/app/app.component.ts` from the allowlist first.
2. **Green** — add the helper, rewrite the templates, add the assets and the CSS rules.
3. **Refactor** — none.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `flags an empty confirmation` | `passwordConfirmationErrors('abcdefghijkl', '')` | `{ confirmPassword: ['…'] }` with one message |
| `flags a mismatch` | `passwordConfirmationErrors('abcdefghijkl', 'abcdefghijkm')` | `{ confirmPassword: [...] }` |
| `accepts a match` | `passwordConfirmationErrors('abcdefghijkl', 'abcdefghijkl')` | `{}` |
| `register blocks on mismatch` | component with `password='aaaaaaaaaaaa'`, `confirmPassword='b'`, call `submitRegister()` | `auth.register` stub not called; `fieldErrors()['confirmPassword']` non-empty |
| `data-cy coverage` | allowlist without `auth-entry.component.ts` and `app.component.ts` | suite green |

Run: `npm run test -- password-confirmation data-cy-coverage`

## Impl steps

- [x] 1. Create `src/assets/brand/google.svg` — the official four-colour Google "G" mark, 24×24 viewBox, no external references.
- [x] 2. Create `src/assets/brand/facebook.svg` — the official Facebook "f" mark on the `#1877F2` round field, 24×24 viewBox.
- [x] 3. Delete lines 24-27 of `src/app/auth/auth-entry.component.ts` and replace with `<header data-cy="auth-header"><h1 [id]="titleId" data-cy="auth-title">{{ title() }}</h1></header>`.
- [x] 4. Replace both `oauth-grid` blocks (login and register) with, per provider:
  ```
  <button mat-stroked-button class="oauth-button" type="button" data-cy="oauth-google" (click)="startOAuth('google')">
    <img class="oauth-button__logo" src="assets/brand/google.svg" alt="" aria-hidden="true" data-cy="oauth-google-logo">
    <span data-cy="oauth-google-label">{{ i18n.t('auth.continueGoogle') }}</span>
  </button>
  ```
  and the Facebook twin with `facebook` in every identifier. Give the register-mode grid `data-cy="register-oauth-grid"` and the login-mode grid `data-cy="login-oauth-grid"`.
- [x] 5. Add to `src/styles.css`: `.oauth-button { display: inline-flex; align-items: center; justify-content: center; gap: .55rem; }` and `.oauth-button__logo { width: 20px; height: 20px; flex: 0 0 20px; }`.
- [x] 6. Add to `src/styles.css`: `.auth-card .auth-form + .oauth-grid { margin-top: 1.5rem; }` and `.auth-card .oauth-grid + .auth-links, .auth-card .oauth-grid + a { margin-top: 1.5rem; display: inline-block; }`.
- [x] 7. Fix the banner: change `src/styles.css:1049` from `margin: 0;` to `margin: .75rem auto 0;` inside `.verification-banner`.
- [x] 8. Create `src/app/auth/password-confirmation.ts` exporting `export function passwordConfirmationErrors(password: string, confirmation: string, message = 'Les mots de passe ne correspondent pas.'): Record<string, string[]> { return password === confirmation && confirmation.length > 0 ? {} : { confirmPassword: [message] }; }`.
- [x] 9. Create `src/app/auth/password-confirmation.test.ts` with the first three Test plan rows.
- [x] 10. In `src/app/auth/auth-entry.component.ts`, add the field `confirmPassword = '';` next to `password = '';`.
- [x] 11. In register mode, immediately after the password input and its `gones-field-errors`, insert:
  ```
  <label for="register-confirm-password" data-cy="register-confirm-password-label">{{ i18n.t('auth.confirmPassword') }}</label>
  <input id="register-confirm-password" data-cy="auth-confirm-password" type="password" autocomplete="new-password" minlength="12" required [(ngModel)]="confirmPassword" name="confirmPassword" [attr.aria-invalid]="hasError('confirmPassword')" [attr.aria-describedby]="hasError('confirmPassword') ? 'register-confirm-password-error' : null">
  <gones-field-errors id="register-confirm-password-error" data-cy="register-confirm-password-error" [messages]="fieldErrors()['confirmPassword']" />
  ```
- [x] 12. Add keys `auth.confirmPassword` (en `'Confirm password'`, fr `'Confirmer le mot de passe'`) and `auth.passwordMismatch` (en `'Passwords do not match.'`, fr `'Les mots de passe ne correspondent pas.'`) to BOTH maps in `src/app/i18n/messages.ts`.
- [x] 13. In `submitRegister()`, insert before `await this.run(...)`:
  ```
  const mismatch = passwordConfirmationErrors(this.password, this.confirmPassword, this.i18n.t('auth.passwordMismatch'));
  if (Object.keys(mismatch).length) { this.fieldErrors.set(mismatch); this.error.set(this.i18n.t('auth.passwordMismatch')); return; }
  ```
- [x] 14. Add a unique `data-cy` to every remaining element of `auth-entry.component.ts`'s template — the `section`, `mat-card`, `mat-card-content`, every `form`, `fieldset`, `label`, `input`, `select`, `button`, `nav`, `a`, `p` — prefixed by mode (`login-`, `register-`, `complete-`, `verify-`, `forgot-`, `reset-`) so values stay unique across the whole file.
- [x] 15. Add a unique `data-cy` to every remaining element of `src/app/app.component.ts`'s template if T3 has not already run; otherwise leave it alone.
- [x] 16. Delete `src/app/auth/auth-entry.component.ts` (and `src/app/app.component.ts` if still listed) from `PENDING_DATA_CY_RETROFIT` in `src/app/shared/data-cy-coverage.test.ts`.
- [x] 17. Add `src/app/auth/auth-entry.register.test.ts` for the fourth Test plan row, stubbing `AuthService` with a `register` spy.
- [x] 18. Update `cypress/e2e/auth-profile.cy.js`: wherever it fills `[data-cy=auth-password]` during registration, also fill `[data-cy=auth-confirm-password]` with the same value.
- [x] 19. Run `npm run test && npm run lint && npm run typecheck && npm run build`.
- [x] 20. Run `npm run dev` then `npm run cy:run -- --spec cypress/e2e/auth-profile.cy.js,cypress/e2e/accessibility.cy.js`.

## Outputs

- Files created: `src/assets/brand/google.svg`, `src/assets/brand/facebook.svg`, `src/app/auth/password-confirmation.ts`, `src/app/auth/password-confirmation.test.ts`, `src/app/auth/auth-entry.register.test.ts`.
- Files touched: `src/app/auth/auth-entry.component.ts`, `src/styles.css`, `src/app/i18n/messages.ts`, `src/app/shared/data-cy-coverage.test.ts`, `cypress/e2e/auth-profile.cy.js`.
- Public API / behavior change: registration now requires a matching confirmation before the API is called; new selector `data-cy=auth-confirm-password`.
- Migrate / config: none.

## Validation

- [x] `npm run test` passes
- [x] `npm run lint && npm run typecheck && npm run build` pass
- [x] `npm run cy:run -- --spec cypress/e2e/auth-profile.cy.js,cypress/e2e/accessibility.cy.js` passes
- [x] manual check: `/login` has no kicker, clear gaps between the three rows, coloured provider marks; `/register` rejects a mismatched confirmation; the unverified banner sits centred under the header
- [x] app functional — OAuth start still navigates to `/api/auth/oauth/{provider}/start`
- [x] commit msg draft: `feat(auth): drop the account kicker, space the action rows, add brand logos and a password confirmation`
