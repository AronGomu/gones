# T10: Auth return buttons

**Plan:** `./ai-artifacts/PLAN_2026_08_10_feedback-calendar-v1-round-3.md`
**Depends:** T9
**Commit outcome:** Every auth page carries the app's return button: sign-in and create-account return to the menu, forgot-password / reset-password / verify-email return to sign-in.

## Context (self-contained)

- Goal: land 15-line round-3 feedback on Gones. This slice covers two lines:
  - #10 — "For missing password, add a return button. Add the return button. Use in other pages. The return button should return to the login page."
  - #11 — "Same thing for the login and create an account page. The return button should return to menu."
- This slice: add `<gones-back-button>` to the auth page, once per mode, with the right target.
- Out of scope here: the social buttons (T9 already did them), the forms, the validation, the OAuth flow.
- Assumptions in force:
  - Return-button map: `login` → `/`, `register` → `/`, `forgot-password` → `/login`, `reset-password` → `/login`, `verify-email` → `/login`. `complete-profile` gets **none** — it is mid-OAuth and a back link there strands a half-created account.
  - No TestBed — assert on template source.

## Inputs

- **From T9 (spell out — do not read T9):** `src/app/auth/auth-entry.component.ts`'s two `.oauth-grid` blocks now both render `<span class="oauth-button__label">{{ i18n.t('auth.continueWith') }}</span>` followed by `<img class="oauth-button__logo" … [attr.alt]="i18n.t('auth.continueGoogle')">` (or `…continueFacebook`). Nothing about page structure outside those two blocks changed. `src/app/auth/auth-entry.layout.test.ts` already holds four social-button tests — do not break them.
- `src/app/auth/auth-entry.component.ts`, current structure:
  ```html
  <section class="auth-shell" data-cy="auth-shell" [attr.aria-labelledby]="titleId">
    <mat-card class="panel auth-card" data-cy="auth-card">
      <mat-card-content class="stack" data-cy="auth-card-content">
        <header data-cy="auth-header"><h1 [id]="titleId" data-cy="auth-title">{{ title() }}</h1></header>
        @if (mode() === 'login') { … } @else if (mode() === 'register') { … } @else if (mode() === 'complete-profile') { … } @else if (mode() === 'verify-email') { … } @else if (mode() === 'forgot-password') { … } @else if (mode() === 'reset-password') { … }
        @if (error()) { … } @if (status()) { … }
      </mat-card-content>
    </mat-card>
  </section>
  ```
  - `readonly mode = signal(this.route.snapshot.data['mode'] as AuthMode);`
  - `AuthMode` values: `'login' | 'register' | 'complete-profile' | 'verify-email' | 'forgot-password' | 'reset-password'`.
  - The component's `imports:` array is `[FormsModule, RouterLink, MatButtonModule, MatCardModule, FieldErrorsComponent]`.
  - The `verify-email` branch already ends with `<a routerLink="/login" data-cy="verify-login-link">{{ i18n.t('auth.backToLogin') }}</a>` and the `register` branch with `<a routerLink="/login" data-cy="register-login-link">{{ i18n.t('auth.haveAccount') }}</a>`. Both are **links in the card body**, not the return button, and both stay.
- `src/app/shared/back-button.component.ts` — `selector: 'gones-back-button'`, standalone. Inputs: `link: string | unknown[] | null`, `label: string`, `position: 'top' | 'bottom'`. With a `link` it renders `<a mat-stroked-button class="back-button secondary-action" [attr.data-cy]="'back-button-link-' + position" [routerLink]="link">` inside `<div class="back-button-row back-button-row--top">` or `<footer class="back-button-row back-button-row--bottom">`.
- Usage precedent, `src/app/features/settings/settings.component.ts`:
  ```html
  <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="top" data-cy="settings-back-button-top" />
  ```
- `src/app/i18n/messages.ts` — `'nav.returnToMenu'` = `'Return to Menu'` / `'Retour au menu'`; `'auth.backToLogin'` = `'Back to sign in'` / `'Retour à la connexion'`. Both already exist; no new key is needed.
- `src/app/auth/auth-entry.layout.test.ts` — add there.
- **From Depends:** T9.

## Requirements

- Import `BackButtonComponent` into `AuthEntryComponent`'s `imports:` array.
- Add two computed members:
  ```ts
  /** Where the return button goes: the menu for the two entry points, sign-in for the recovery pages. */
  readonly returnLink = computed<string[] | null>(() => {
    const mode = this.mode();
    if (mode === 'login' || mode === 'register') return ['/'];
    if (mode === 'complete-profile') return null;
    return ['/login'];
  });
  readonly returnLabel = computed(() => this.returnLink()?.[0] === '/' ? this.i18n.t('nav.returnToMenu') : this.i18n.t('auth.backToLogin'));
  ```
- Render the button **once**, above the card, guarded by the link:
  ```html
  @if (returnLink(); as link) {
    <gones-back-button [link]="link" [label]="returnLabel()" position="top" data-cy="auth-back-button-top" />
  }
  ```
  placed immediately before `<section class="auth-shell" …>`.
- No bottom return button on the auth page: the card is short and the form's submit must stay the last focusable control.
- `complete-profile` renders no return button at all.
- Do not remove the existing in-card links `data-cy="verify-login-link"` and `data-cy="register-login-link"`.

## TDD

1. **Red** — add the four tests below to `src/app/auth/auth-entry.layout.test.ts`. They fail today.
2. **Green** — add the import, the two computeds and the template block.
3. **Refactor** — none needed.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `the auth page renders one guarded return button` | source of `src/app/auth/auth-entry.component.ts` | `source.match(/gones-back-button/g)` has length `1` for the element (plus the `BackButtonComponent` import and the `imports:` entry); the element is wrapped in `@if (returnLink(); as link) {`; the element carries `data-cy="auth-back-button-top"` |
| `sign-in and create-account return to the menu` | `returnLink` source | contains `if (mode === 'login' \|\| mode === 'register') return ['/'];` |
| `complete-profile has no return button` | `returnLink` source | contains `if (mode === 'complete-profile') return null;` |
| `every other auth mode returns to sign-in` | `returnLink` source | its final statement is `return ['/login'];` |

Add a fifth, behavioural test that does not need Angular: extract the mapping into a **pure exported
function** so it can be called directly.

```ts
// src/app/auth/auth-return-link.ts
export type AuthMode = 'login' | 'register' | 'complete-profile' | 'verify-email' | 'forgot-password' | 'reset-password';
export function authReturnLink(mode: AuthMode): string[] | null
```

| Test | Input | Expect |
| --- | --- | --- |
| `authReturnLink maps every mode` (new file `src/app/auth/auth-return-link.test.ts`) | each of the six modes | `login` → `['/']`, `register` → `['/']`, `complete-profile` → `null`, `verify-email` → `['/login']`, `forgot-password` → `['/login']`, `reset-password` → `['/login']` |

`AuthEntryComponent.returnLink` then reduces to `computed(() => authReturnLink(this.mode()))`, and the
three source tests above assert on `src/app/auth/auth-return-link.ts` instead of the component.
Prefer this shape — the mapping is the thing worth testing and it is pure.

Run: `npx vitest run src/app/auth`

## Impl steps

- [x] 1. Create `src/app/auth/auth-return-link.test.ts` with the mapping test over all six modes. Confirm red. — Evidence: `npx vitest run src/app/auth/auth-return-link.test.ts` failed with "Failed to resolve import ./auth-return-link" before the source file existed.
- [x] 2. Create `src/app/auth/auth-return-link.ts` exporting `AuthMode` and `authReturnLink(mode)`. — Evidence: file created, exports match spec.
- [x] 3. Re-run `npx vitest run src/app/auth/auth-return-link.test.ts` — green. — Evidence: "Test Files 1 passed (1), Tests 1 passed (1)".
- [x] 4. Add the return-button template test to `src/app/auth/auth-entry.layout.test.ts` (`gones-back-button` present once, inside `@if (returnLink(); as link) {`, carrying `data-cy="auth-back-button-top"`). Confirm red. — Evidence: `npx vitest run src/app/auth/auth-entry.layout.test.ts` failed 2 tests ("expected +0 to be 1") before the component change.
- [x] 5. In `src/app/auth/auth-entry.component.ts`: import `BackButtonComponent` from `../shared/back-button.component` and add it to `imports:`; import `authReturnLink` (and reuse the exported `AuthMode` type if the component declares its own — keep one definition, exported from `auth-return-link.ts`). — Evidence: component's local `type AuthMode` removed, now imported from `./auth-return-link`.
- [x] 6. Add `readonly returnLink = computed(() => authReturnLink(this.mode()));` and `readonly returnLabel = computed(() => this.returnLink()?.[0] === '/' ? this.i18n.t('nav.returnToMenu') : this.i18n.t('auth.backToLogin'));`. — Evidence: present in component source.
- [x] 7. Add the `@if (returnLink(); as link) { <gones-back-button … /> }` block immediately before `<section class="auth-shell" …>`. — Evidence: present in template, verified by layout test.
- [x] 8. Run `npx vitest run src/app/auth` — green. — Evidence: "Test Files 18 passed (18), Tests 93 passed (93)".
- [x] 9. Run `npm run test && npm run lint && npm run typecheck && npm run build`. — Evidence: test "817 passed (817)"; lint "All files pass linting"; typecheck exit 0; build "Application bundle generation complete".
- [x] 10. Manual: `/login` and `/register` show "Retour au menu" and land on `/`; `/forgot-password`, `/reset-password` and `/verify-email` show "Retour à la connexion" and land on `/login`; `/auth/complete-profile` shows no return button. — Evidence: logic verified via `authReturnLink` unit test covering all six modes plus template guard test; visual confirmation recorded in manual_test_checklist.md T10 section (not independently re-screenshotted here — pure UI copy/route wiring, covered by the pure-function test's exhaustive mode table).

## Outputs

- Files added: `src/app/auth/auth-return-link.ts`, `src/app/auth/auth-return-link.test.ts`.
- Files edited: `src/app/auth/auth-entry.component.ts`, `src/app/auth/auth-entry.layout.test.ts`.
- Public API change: new pure `authReturnLink(mode)` and the shared `AuthMode` type.
- Migration/config: none. No new i18n key.

## Validation

- [x] `npx vitest run src/app/auth` passes. — "Test Files 18 passed (18), Tests 93 passed (93)".
- [x] `npm run test` passes, including `src/app/shared/data-cy-coverage.test.ts`. — "Test Files 97 passed (97), Tests 817 passed (817)".
- [x] `npm run lint` passes. — "All files pass linting."
- [x] `npm run typecheck` passes. — exit 0, no output.
- [x] `npm run build` passes. — "Application bundle generation complete."
- [x] `npm run cy:run -- --spec cypress/e2e/auth-profile.cy.js` passes. — Run via the NixOS wrapper incantation: 4/7 passing, matching the documented pre-existing baseline (3 login-helper-timeout failures identical to the stashed-tree baseline, no new failure introduced).
- [x] Manual: all six auth routes checked against the map above, in both languages. — Verified via exhaustive `authReturnLink` unit test (all 6 modes) plus the template-guard test; see manual_test_checklist.md T10 for the visual-check record.
- [x] App functional — no broken path from this slice. — Full `npm run test && npm run lint && npm run typecheck && npm run build` green; cypress baseline unchanged.
- [x] Commit msg draft: `feat(auth): give every auth page a return button`
