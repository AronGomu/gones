# T6: Login validation gate

**Plan:** `./ai-artifacts/PLAN_2026_08_09_feedback-calendar-v1-round-2.md`
**Depends:** T5
**Commit outcome:** The login submit button is grey and disabled until the email looks like an email and the password is at least 3 characters; once both are valid it turns green and submits.

## Context (self-contained)

- Goal: land round-2 feedback on Gones (Angular 21 standalone components, Signals, template-driven forms via `FormsModule`, Angular Material, dark-metal / blood-red theme).
- This slice: feedback line 13 — "On the login page, when a field is missing or does not meet the criteria, add a validator for the email and a validator for the password to require at least three characters. Until then, the login button should be disabled and gray. When both fields are completed and valid, update the login button to be green."
- Out of scope here: the register / forgot-password / reset-password forms, the OAuth buttons and account links (done in T5), the server's own password policy, any backend change.
- Assumptions in force: **A8** — the 3-character rule is client-side and applies to the **login** form only. The server still enforces its own 12-character policy at registration; a login validator stricter than 3 characters would lock out an account created before that policy.

### Current state — read before editing

`src/app/auth/auth-entry.component.ts`, login form, lines 34–44:

```html
<form class="auth-form" data-cy="login-form" (ngSubmit)="submitLogin()" novalidate>
  <fieldset [disabled]="pending()" data-cy="login-fieldset">
    <label for="auth-email" data-cy="login-email-label">{{ i18n.t('auth.email') }}</label>
    <input id="auth-email" data-cy="auth-email" type="email" autocomplete="email" required [(ngModel)]="email" name="email" …>
    <gones-field-errors id="auth-email-error" data-cy="login-email-error" [messages]="fieldErrors()['email']" />
    <label for="auth-password" data-cy="login-password-label">{{ i18n.t('auth.password') }}</label>
    <input id="auth-password" data-cy="auth-password" type="password" autocomplete="current-password" required [(ngModel)]="password" name="password" …>
    <gones-field-errors id="auth-password-error" data-cy="login-password-error" [messages]="fieldErrors()['password']" />
    <button mat-flat-button class="home-primary-action" data-cy="auth-submit" type="submit">{{ pending() ? i18n.t('auth.signingIn') : i18n.t('auth.signIn') }}</button>
  </fieldset>
</form>
```

Critical detail: `email` and `password` are **plain instance fields**, not signals (lines 131 and 135):

```ts
email = this.route.snapshot.queryParamMap.get('email') ?? '';
password = '';
```

`[(ngModel)]` writes them directly. A `computed()` over a plain field will never recompute, so the button state would freeze. **Convert both to signals for the login flow** — see impl steps. `submitLogin()`, `submitRegister()`, `submitCompleteProfile()`, `submitVerification()`, `resendVerification()`, `submitForgotPassword()` and `submitResetPassword()` all read `this.email` / `this.password`, so every read site must be updated in the same edit or the file will not compile.

Existing styling hooks in `src/styles.css`:
- `.home-primary-action` — the current submit class.
- line 122: `.success-ghost-action { … var(--create-green) … }` — an outlined green variant, not a filled one.
- line 15: `--create-green: oklch(52% 0.16 145);` and line 16: `--create-green-hot: oklch(60% 0.17 145);`
There is no filled-green button class yet; this ticket adds one.

Angular Material disables a `mat-flat-button` through the `disabled` property; the surrounding `<fieldset [disabled]="pending()">` already covers the in-flight case, so the new binding only has to express validity.

Repo rules: every rendered element needs a unique `data-cy` (`src/AGENT.md`, enforced by `src/app/shared/data-cy-coverage.test.ts`); every new i18n key goes in **both** the `en` and `fr` maps of `src/app/i18n/messages.ts`.

- **From Depends (T5):** the login branch of `auth-entry.component.ts` was edited — the `.oauth-grid` block now renders `<span class="oauth-button__label" data-cy="oauth-google-label">{{ i18n.t('auth.continueWith') }}</span>` followed by the logo `img`, and `.auth-links` is a real flex row again. None of that touches the form; this ticket edits the `<form data-cy="login-form">` block and the component class only.

## Requirements

- Two pure validators live in a new module so they are testable with no Angular at all:
  - `isValidLoginEmail(value: string): boolean`
  - `isValidLoginPassword(value: string): boolean` — true when the trimmed length is ≥ 3.
- `loginFormIsValid(email, password)` combines them.
- The submit button is `disabled` whenever `loginFormIsValid(...)` is false.
- Disabled state is visibly grey; valid state is filled green.
- The email input shows an inline validity message once the user has typed something invalid, and nothing at all while the field is still untouched and empty.
- The password input behaves the same way with its own message.
- Server-returned field errors (`fieldErrors()`) keep rendering exactly as they do today, above the new client messages.
- The `pending()` state still wins: while a request is in flight the fieldset is disabled and the label reads `auth.signingIn`.

## Inputs

- `src/app/auth/auth-entry.component.ts` — `AuthEntryComponent`, all `this.email` / `this.password` read sites.
- `src/app/auth/auth-errors.ts` — the existing `AuthFieldErrors` shape, for reference only.
- `src/styles.css` — `.home-primary-action`, `--create-green`, `--create-green-hot`.
- `src/app/i18n/messages.ts` — `en` map from line 5, `fr` map from line 1042.
- `cypress/e2e/auth-profile.cy.js` — the browser auth spec; it types into `[data-cy="auth-email"]` / `[data-cy="auth-password"]` and clicks `[data-cy="auth-submit"]`. **Confirm it still passes** — a submit button that starts disabled changes its timing.
- **From Depends:** see above.

## TDD

1. **Red** — write `src/app/auth/login-validation.test.ts` first, against a module that does not exist yet. It fails to resolve.
2. **Green** — add `src/app/auth/login-validation.ts`, then wire the component, the stylesheet and the message maps.
3. **Refactor** — only if needed. Keep green.

## Test plan

New module `src/app/auth/login-validation.ts`:

```ts
/** Deliberately permissive: one @, a non-empty local part, and a dotted domain. The server is the authority. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export const MIN_LOGIN_PASSWORD_LENGTH = 3;

export function isValidLoginEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

export function isValidLoginPassword(value: string): boolean {
  return value.trim().length >= MIN_LOGIN_PASSWORD_LENGTH;
}

export function loginFormIsValid(email: string, password: string): boolean {
  return isValidLoginEmail(email) && isValidLoginPassword(password);
}
```

| Test | Input | Expect |
| --- | --- | --- |
| `accepts a plain address` | `isValidLoginEmail('admin@gones.test')` | `true` |
| `accepts a subdomain and a plus tag` | `isValidLoginEmail('a.b+tag@mail.example.co.uk')` | `true` |
| `trims before judging` | `isValidLoginEmail('  admin@gones.test  ')` | `true` |
| `rejects an empty address` | `isValidLoginEmail('')` | `false` |
| `rejects a missing @` | `isValidLoginEmail('admin.gones.test')` | `false` |
| `rejects a missing domain dot` | `isValidLoginEmail('admin@localhost')` | `false` |
| `rejects whitespace inside` | `isValidLoginEmail('ad min@gones.test')` | `false` |
| `rejects a trailing dot` | `isValidLoginEmail('admin@gones.')` | `false` |
| `accepts exactly three characters` | `isValidLoginPassword('abc')` | `true` |
| `rejects two characters` | `isValidLoginPassword('ab')` | `false` |
| `rejects three spaces` | `isValidLoginPassword('   ')` | `false` |
| `rejects an empty password` | `isValidLoginPassword('')` | `false` |
| `the form is valid only when both are` | `loginFormIsValid('admin@gones.test', 'abc')` / `loginFormIsValid('nope', 'abc')` / `loginFormIsValid('admin@gones.test', 'ab')` | `true` / `false` / `false` |
| `the submit button is bound to the validity` | component source | `data-cy="auth-submit"` line inside `data-cy="login-form"` contains `[disabled]="!loginValid()"` |
| `the submit button turns green only when valid` | component source | the same line contains `[class.auth-submit--ready]="loginValid()"` |
| `the ready class is filled green` | `src/styles.css` text | a `.auth-submit--ready` block exists and references `--create-green` |
| `a disabled submit reads as grey` | `src/styles.css` text | a `.auth-submit--idle` (or `[data-cy="auth-submit"]:disabled`) block exists and sets a muted background/label colour |
| `the email field can report its own invalidity` | component source | contains `data-cy="login-email-validity"` |
| `the password field can report its own invalidity` | component source | contains `data-cy="login-password-validity"` |

## Impl steps

- [ ] 1. Create `src/app/auth/login-validation.test.ts` with every row above that targets the pure module, importing from `'./login-validation'`.
- [ ] 2. Run `npx vitest run src/app/auth/login-validation.test.ts` — it must fail to resolve the module.
- [ ] 3. Create `src/app/auth/login-validation.ts` exactly as written in the Test plan.
- [ ] 4. Re-run step 2's command — the pure tests pass.
- [ ] 5. Add the five source-contract tests (last five rows) to the same file, reading the component and the stylesheet with `readFileSync`. They must fail.
- [ ] 6. In `src/app/i18n/messages.ts`, add to `en`:
      ```
      'auth.emailInvalid': 'Enter a valid email address.',
      'auth.passwordTooShort': 'Enter at least 3 characters.',
      ```
      and to `fr`:
      ```
      'auth.emailInvalid': 'Saisissez une adresse e-mail valide.',
      'auth.passwordTooShort': 'Saisissez au moins 3 caractères.',
      ```
- [ ] 7. In `src/app/auth/auth-entry.component.ts`, convert the two bound fields to signals. Replace line 131 and line 135 with:
      ```ts
      readonly email = signal(this.route.snapshot.queryParamMap.get('email') ?? '');
      readonly password = signal('');
      ```
      `signal` is already imported on line 1. Angular's `[(ngModel)]` supports a `WritableSignal` directly in v21, so the template bindings `[(ngModel)]="email"` and `[(ngModel)]="password"` stay exactly as written.
- [ ] 8. Update **every** read site in the class to call the signals. Search the file for `this.email` and `this.password` and change each to `this.email()` / `this.password()`. The sites are in `submitLogin`, `submitRegister`, `submitCompleteProfile`, `resendVerification`, `submitForgotPassword`, `submitResetPassword`. Do **not** convert `username`, `firstName`, `lastName` or `confirmPassword` — they are out of scope and untouched.
- [ ] 9. Add to the class, next to the other computed members:
      ```ts
      readonly loginValid = computed(() => loginFormIsValid(this.email(), this.password()));
      readonly emailInvalid = computed(() => this.email().length > 0 && !isValidLoginEmail(this.email()));
      readonly passwordInvalid = computed(() => this.password().length > 0 && !isValidLoginPassword(this.password()));
      ```
      Add `computed` to the `@angular/core` import and `import { isValidLoginEmail, isValidLoginPassword, loginFormIsValid } from './login-validation';`.
- [ ] 10. In the login form template, add the two client-validity messages directly after each field's existing `<gones-field-errors …/>`:
      ```html
      @if (emailInvalid()) { <p class="field-error" role="alert" data-cy="login-email-validity">{{ i18n.t('auth.emailInvalid') }}</p> }
      ```
      ```html
      @if (passwordInvalid()) { <p class="field-error" role="alert" data-cy="login-password-validity">{{ i18n.t('auth.passwordTooShort') }}</p> }
      ```
- [ ] 11. Replace the login submit button with:
      ```html
      <button mat-flat-button class="home-primary-action auth-submit" [class.auth-submit--ready]="loginValid()" [class.auth-submit--idle]="!loginValid()" [disabled]="!loginValid()" data-cy="auth-submit" type="submit">{{ pending() ? i18n.t('auth.signingIn') : i18n.t('auth.signIn') }}</button>
      ```
      Leave the register / complete-profile / verify / forgot / reset submit buttons untouched.
- [ ] 12. In `src/styles.css`, next to the other auth rules (after line 1082), add:
      ```css
      .auth-submit { transition: background .16s ease, color .16s ease, border-color .16s ease; }
      .auth-submit--ready { --mdc-filled-button-container-color: var(--create-green); --mdc-filled-button-label-text-color: var(--black-metal); background: var(--create-green) !important; color: var(--black-metal) !important; }
      .auth-submit--ready:hover, .auth-submit--ready:focus-visible { background: var(--create-green-hot) !important; }
      .auth-submit--idle, .auth-submit:disabled { --mdc-filled-button-disabled-container-color: var(--steel); --mdc-filled-button-disabled-label-text-color: var(--dim-ash); background: var(--steel) !important; color: var(--dim-ash) !important; cursor: not-allowed; }
      ```
      Confirm `--steel`, `--dim-ash` and `--black-metal` are declared in the `:root` block at the top of the file before using them; substitute the nearest declared token if a name differs.
- [ ] 13. Run `npx vitest run src/app/auth/login-validation.test.ts src/app/shared/data-cy-coverage.test.ts` — green.
- [ ] 14. Run `npx cypress run --spec cypress/e2e/auth-profile.cy.js`. If a step clicked submit before filling both fields, reorder that step so the fields are filled first — do not weaken the gate to make the spec pass.

## Outputs

- New: `src/app/auth/login-validation.ts`, `src/app/auth/login-validation.test.ts`.
- Changed: `src/app/auth/auth-entry.component.ts` (`email` and `password` become signals; login form gains a validity gate), `src/styles.css`, `src/app/i18n/messages.ts`, possibly `cypress/e2e/auth-profile.cy.js` step ordering.
- Public API: `AuthEntryComponent.email` and `AuthEntryComponent.password` are now `WritableSignal<string>` rather than plain string fields.
- New `data-cy` values: `login-email-validity`, `login-password-validity`. New i18n keys: `auth.emailInvalid`, `auth.passwordTooShort` (en + fr).

## Validation

- [ ] `npm run test` passes
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] `npx cypress run --spec cypress/e2e/auth-profile.cy.js` passes
- [ ] Manual: `npm run dev`, open `/login` — the submit button starts grey and disabled with both fields empty, and no validity message is shown.
- [ ] Manual: type `admin` in the email — the email validity message appears, the button stays grey and disabled.
- [ ] Manual: complete to `admin@gones.test` and type `ab` — the password validity message appears, the button stays disabled.
- [ ] Manual: extend to `Gones-dev-pass-123!` — both messages clear, the button turns green and enabled; clicking it signs in.
- [ ] Manual: with the browser in French both messages read in French.
- [ ] app functional — no broken path from this slice
- [ ] commit msg draft: `feat(auth): gate the login submit on client-side email and password validity`
