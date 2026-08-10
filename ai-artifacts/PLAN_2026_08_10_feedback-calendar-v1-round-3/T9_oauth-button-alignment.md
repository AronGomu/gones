# T9: OAuth button alignment

**Plan:** `./ai-artifacts/PLAN_2026_08_10_feedback-calendar-v1-round-3.md`
**Depends:** none
**Commit outcome:** The Google and Facebook buttons on `/login` and `/register` carry the same label, in the same order, with the logo vertically centred against the text and real space between them.

## Context (self-contained)

- Goal: land 15-line round-3 feedback on Gones. This slice is feedback #9 — "On the login page, 'Continue with Google' or 'Continue with Facebook', the text and the icon are too close. Add a bit of margin to create normal spacing. Also, the icon and the text are not vertically aligned correctly; fix that and align them properly. Same thing for the Create an account section, and the text of each of those buttons should be updated to be exactly the same as the one on the login page."
- This slice: the two `.oauth-grid` blocks in the auth page and their stylesheet rules. T10 then adds return buttons to the same page.
- Out of scope here: the OAuth flow itself, `startOAuth()`, the login form, the register form, the auth links row.
- Assumptions in force:
  - Register adopts **login's** label shape, because the feedback says register's text must equal login's: label `auth.continueWith` first, then the brand logo image. `auth.continueGoogle` / `auth.continueFacebook` stay in `messages.ts` — they become the images' `alt` text, so nothing is orphaned.
  - No TestBed — assert on template source and on `src/styles.css`.

## Inputs

- `src/app/auth/auth-entry.component.ts`, current login block:
  ```html
  <div class="oauth-grid" data-cy="login-oauth-grid" [attr.aria-label]="i18n.t('auth.socialSignIn')">
    <button mat-stroked-button class="oauth-button" type="button" data-cy="oauth-google" (click)="startOAuth('google')">
      <span class="oauth-button__label" data-cy="oauth-google-label">{{ i18n.t('auth.continueWith') }}</span>
      <img class="oauth-button__logo" src="assets/brand/google.svg" alt="Google" data-cy="oauth-google-logo">
    </button>
    <button mat-stroked-button class="oauth-button" type="button" data-cy="oauth-facebook" (click)="startOAuth('facebook')">
      <span class="oauth-button__label" data-cy="oauth-facebook-label">{{ i18n.t('auth.continueWith') }}</span>
      <img class="oauth-button__logo" src="assets/brand/facebook.svg" alt="Facebook" data-cy="oauth-facebook-logo">
    </button>
  </div>
  ```
  and the current register block, which differs — logo first, and a **different** label key:
  ```html
  <div class="oauth-grid" data-cy="register-oauth-grid">
    <button mat-stroked-button class="oauth-button" type="button" data-cy="register-oauth-google" (click)="startOAuth('google')">
      <img class="oauth-button__logo" src="assets/brand/google.svg" alt="" aria-hidden="true" data-cy="register-oauth-google-logo">
      <span data-cy="register-oauth-google-label">{{ i18n.t('auth.continueGoogle') }}</span>
    </button>
    <button mat-stroked-button class="oauth-button" type="button" data-cy="register-oauth-facebook" (click)="startOAuth('facebook')">
      <img class="oauth-button__logo" src="assets/brand/facebook.svg" alt="" aria-hidden="true" data-cy="register-oauth-facebook-logo">
      <span data-cy="register-oauth-facebook-label">{{ i18n.t('auth.continueFacebook') }}</span>
    </button>
  </div>
  ```
- `src/app/i18n/messages.ts` — `'auth.continueWith'` = `'Continue with'` / `'Continuer avec'`; `'auth.continueGoogle'` = `'Continue with Google'` / `'Continuer avec Google'`; `'auth.continueFacebook'` = `'Continue with Facebook'` / `'Continuer avec Facebook'`; `'auth.socialSignIn'` = `'Social sign in'` / `'Connexion via réseau social'`.
- `src/styles.css`, current:
  - `.oauth-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; }`
  - `.oauth-button { display: inline-flex; align-items: center; justify-content: center; gap: .55rem; min-height: 2.75rem; line-height: 1; }`
  - `.oauth-button__label { display: inline-flex; align-items: center; line-height: 1; }`
  - `.oauth-button__logo { width: 20px; height: 20px; flex: 0 0 20px; }`
  - narrow-viewport override `.auth-name-grid, .oauth-grid { grid-template-columns: 1fr; }`
- `src/app/auth/auth-entry.layout.test.ts` — existing layout source tests for this component. Add there.
- **From Depends:** none.

## Requirements

- The register block becomes label-then-logo with the **same** key as login:
  ```html
  <div class="oauth-grid" data-cy="register-oauth-grid" [attr.aria-label]="i18n.t('auth.socialSignIn')">
    <button mat-stroked-button class="oauth-button" type="button" data-cy="register-oauth-google" (click)="startOAuth('google')">
      <span class="oauth-button__label" data-cy="register-oauth-google-label">{{ i18n.t('auth.continueWith') }}</span>
      <img class="oauth-button__logo" src="assets/brand/google.svg" [attr.alt]="i18n.t('auth.continueGoogle')" data-cy="register-oauth-google-logo">
    </button>
    <button mat-stroked-button class="oauth-button" type="button" data-cy="register-oauth-facebook" (click)="startOAuth('facebook')">
      <span class="oauth-button__label" data-cy="register-oauth-facebook-label">{{ i18n.t('auth.continueWith') }}</span>
      <img class="oauth-button__logo" src="assets/brand/facebook.svg" [attr.alt]="i18n.t('auth.continueFacebook')" data-cy="register-oauth-facebook-logo">
    </button>
  </div>
  ```
- The login block's two `<img>` get the same `[attr.alt]` bindings, replacing the hard-coded `alt="Google"` / `alt="Facebook"` — the accessible name must be translated and must match what the button means.
- Spacing: `.oauth-button` `gap` goes from `.55rem` to `.75rem`, and `padding-inline: 1rem` is added so the pair is not jammed against the button edges.
- Vertical alignment: the logo is an inline replaced element sitting on the text baseline today. Fix it by making the logo a flex item aligned to the centre of the line box:
  - `.oauth-button__logo { width: 20px; height: 20px; flex: 0 0 20px; display: block; align-self: center; object-fit: contain; }`
  - `.oauth-button__label { display: inline-flex; align-items: center; line-height: 1.2; }`
  - `.oauth-button { … min-height: 3rem; line-height: 1.2; }` (raise from `2.75rem` / `1` so a 20px logo fits inside the line box without clipping).
- The two blocks stay two-column at full width and one-column under the existing narrow-viewport override — do not touch `.oauth-grid`.

## TDD

1. **Red** — add the four tests below to `src/app/auth/auth-entry.layout.test.ts`. They fail today.
2. **Green** — edit the template, then the stylesheet.
3. **Refactor** — none needed.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `both social blocks use the same label key` | source of `src/app/auth/auth-entry.component.ts` | `source.match(/i18n\.t\('auth\.continueWith'\)/g)` has length `4`; the source contains no `{{ i18n.t('auth.continueGoogle') }}` and no `{{ i18n.t('auth.continueFacebook') }}` interpolation |
| `both social blocks put the label before the logo` | for each of the four button identifiers `oauth-google`, `oauth-facebook`, `register-oauth-google`, `register-oauth-facebook`: the source slice from that `data-cy` to the next `</button>` | the `<span` index is smaller than the `<img` index in every one of the four |
| `every social logo carries a translated accessible name` | same source | contains `[attr.alt]="i18n.t('auth.continueGoogle')"` twice and `[attr.alt]="i18n.t('auth.continueFacebook')"` twice; contains neither `alt="Google"` nor `aria-hidden="true"` on an `oauth-button__logo` |
| `the social button spaces and centres its parts` | `src/styles.css` | the `.oauth-button { … }` block contains `gap: .75rem` and `min-height: 3rem`; the `.oauth-button__logo { … }` block contains `align-self: center` |

Match stylesheet blocks with `stylesheet.match(/\.oauth-button\s*\{[^}]*\}/)?.[0] ?? ''` as
`src/app/features/menu/home-grid-rule.test.ts` already does. Note that `.oauth-button__label` and
`.oauth-button__logo` need their own anchored regexes, since `.oauth-button` is a prefix of both —
use `/\.oauth-button\s*\{/` with the trailing whitespace-or-brace guard.

Run: `npx vitest run src/app/auth`

## Impl steps

- [ ] 1. Add the four tests to `src/app/auth/auth-entry.layout.test.ts`. Confirm red with `npx vitest run src/app/auth`.
- [ ] 2. In `src/app/auth/auth-entry.component.ts`, rewrite the `data-cy="register-oauth-grid"` block to the label-then-logo shape above, including the `[attr.aria-label]="i18n.t('auth.socialSignIn')"`.
- [ ] 3. In the `data-cy="login-oauth-grid"` block, replace `alt="Google"` with `[attr.alt]="i18n.t('auth.continueGoogle')"` and `alt="Facebook"` with `[attr.alt]="i18n.t('auth.continueFacebook')"`.
- [ ] 4. In `src/styles.css`, set `.oauth-button` to `display: inline-flex; align-items: center; justify-content: center; gap: .75rem; padding-inline: 1rem; min-height: 3rem; line-height: 1.2;`.
- [ ] 5. Set `.oauth-button__label` to `display: inline-flex; align-items: center; line-height: 1.2;`.
- [ ] 6. Set `.oauth-button__logo` to `width: 20px; height: 20px; flex: 0 0 20px; display: block; align-self: center; object-fit: contain;`.
- [ ] 7. Run `npx vitest run src/app/auth` — green.
- [ ] 8. Run `npm run test && npm run lint && npm run typecheck && npm run build`.
- [ ] 9. Manual: `/login` and `/register` side by side — the four buttons read the same text, the logo is horizontally spaced from it and its centre lines up with the text's centre. Check both `fr` and `en`. Narrow the window: the grid drops to one column and the buttons still centre their content.

## Outputs

- Files edited: `src/app/auth/auth-entry.component.ts`, `src/styles.css`, `src/app/auth/auth-entry.layout.test.ts`.
- Behaviour change: social button labels and layout only. The OAuth flow is untouched.
- Migration/config: none.

## Validation

- [ ] `npx vitest run src/app/auth` passes.
- [ ] `npm run test` passes.
- [ ] `npm run lint` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.
- [ ] `npm run cy:run -- --spec cypress/e2e/auth-profile.cy.js` passes.
- [ ] Manual: `/login` and `/register` social buttons are identical in text, order, spacing and alignment, in both languages.
- [ ] App functional — no broken path from this slice.
- [ ] Commit msg draft: `fix(auth): align and space the social buttons and share one label`
