# T5: Login OAuth buttons and links row

**Plan:** `./ai-artifacts/PLAN_2026_08_09_feedback-calendar-v1-round-2.md`
**Depends:** T1
**Commit outcome:** The login page's Google and Facebook buttons read "Continue with" followed by the platform logo, all on one centred baseline, and the Create account / Forgot password links sit at the opposite edges of the login card.

## Context (self-contained)

- Goal: land round-2 feedback on Gones (Angular 21 standalone components, Angular Material, single global stylesheet `src/styles.css`).
- This slice: feedback lines 11 and 12.
  - 11 — "On the login page, for the Google and Facebook buttons, replace the actual content of the button with 'Continue with' followed by the logo of the platform. And make sure to align center so that everything is properly on the same line, with the same horizontal alignment."
  - 12 — "On the login page, the 'Create an account' and 'Password forgotten' links are stuck to each other. Please use justify-between and place them left and right of the login container."
- Out of scope here: the form validators and the submit button colour (that is T6), the register page's own OAuth row, the OAuth flow itself, any backend change.
- Assumptions in force: none specific to this ticket.

### Current state — read before editing

`src/app/auth/auth-entry.component.ts`, login branch, lines 45–58:

```html
<div class="oauth-grid" data-cy="login-oauth-grid" [attr.aria-label]="i18n.t('auth.socialSignIn')">
  <button mat-stroked-button class="oauth-button" type="button" data-cy="oauth-google" (click)="startOAuth('google')">
    <img class="oauth-button__logo" src="assets/brand/google.svg" alt="" aria-hidden="true" data-cy="oauth-google-logo">
    <span data-cy="oauth-google-label">{{ i18n.t('auth.continueGoogle') }}</span>
  </button>
  <button mat-stroked-button class="oauth-button" type="button" data-cy="oauth-facebook" (click)="startOAuth('facebook')">
    <img class="oauth-button__logo" src="assets/brand/facebook.svg" alt="" aria-hidden="true" data-cy="oauth-facebook-logo">
    <span data-cy="oauth-facebook-label">{{ i18n.t('auth.continueFacebook') }}</span>
  </button>
</div>
<nav class="auth-links" data-cy="login-links" [attr.aria-label]="i18n.t('auth.accountLinks')">
  <a routerLink="/register" data-cy="login-register-link">{{ i18n.t('auth.createAccount') }}</a>
  <a routerLink="/forgot-password" data-cy="login-forgot-link">{{ i18n.t('auth.forgotPassword') }}</a>
</nav>
```

So today the order is **logo then text**, and the text is the full "Continue with Google" (`auth.continueGoogle`, `src/app/i18n/messages.ts` line 236 in `en`, line 1268 in `fr`).

`src/styles.css`:

- line 1077: `.oauth-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; }`
- line 1078: `.auth-links { display: flex; justify-content: space-between; flex-wrap: wrap; gap: .75rem; }`
- line 1079: `.oauth-button { display: inline-flex; align-items: center; justify-content: center; gap: .55rem; }`
- line 1080: `.oauth-button__logo { width: 20px; height: 20px; flex: 0 0 20px; }`
- line 1081: `.auth-card .auth-form + .oauth-grid { margin-top: 1.5rem; }`
- **line 1082: `.auth-card .oauth-grid + .auth-links, .auth-card .oauth-grid + a { margin-top: 1.5rem; display: inline-block; }`**

**Line 1082 is the whole of defect 12.** `.auth-links` already declares `display: flex; justify-content: space-between`, but line 1082 is a more specific selector that overrides `display` back to `inline-block`, so the two anchors collapse into inline flow and sit shoulder to shoulder. The register page's `<a routerLink="/login">` — a bare anchor, not a `nav` — is the sibling that actually wants `inline-block`, so the fix is to split the selector, not to delete the rule.

Logo assets exist at `src/assets/brand/google.svg` and `src/assets/brand/facebook.svg`.

Repo rules: every rendered element needs a unique `data-cy` (`src/AGENT.md`, enforced by `src/app/shared/data-cy-coverage.test.ts`) — `img` is **not** in the exemption list, so the logos keep theirs. Every new i18n key goes in **both** the `en` and `fr` maps of `src/app/i18n/messages.ts`.

Accessibility: the button's accessible name today is "Continue with Google" because the visible span says so. Once the span reads only "Continue with", the platform name must come from the logo. Give each `img` a real `alt` (`Google` / `Facebook`) and drop its `aria-hidden`, so the computed name stays "Continue with Google".

- **From Depends (T1):** a working local login (`admin@gones.test` / `test@gones.test`, password `Gones-dev-pass-123!`, seeded by `npm run dev`). Used for manual validation of the page around the change.

## Requirements

- Both OAuth buttons render, in this order: the text "Continue with", then the platform logo.
- The text and the logo share one horizontal baseline and the whole content is centred within the button; the two buttons keep identical height.
- The accessible name of each button remains "Continue with Google" / "Continue with Facebook".
- One new i18n key `auth.continueWith` = `Continue with` / `Continuer avec`, in both maps. The old `auth.continueGoogle` / `auth.continueFacebook` keys stay in place — the **register** page still uses them and is out of scope.
- `.auth-links` renders as a flex row with the register link at the left edge and the forgot-password link at the right edge of the login card, at every viewport width down to 360px (wrapping is allowed below that).

## Inputs

- `src/app/auth/auth-entry.component.ts` — `AuthEntryComponent`, login branch only.
- `src/styles.css` — lines 1077–1082.
- `src/app/i18n/messages.ts` — `en` map from line 5, `fr` map from line 1042.
- `src/assets/brand/google.svg`, `src/assets/brand/facebook.svg`.
- `cypress/e2e/auth-profile.cy.js` — the browser auth spec, for the optional visual assertion.
- **From Depends:** see above.

## TDD

1. **Red** — write `src/app/auth/auth-entry.layout.test.ts` first. It reads the component source and the stylesheet as text and asserts the six contract points below. It fails on the current sources.
2. **Green** — edit the template, the stylesheet and the message maps.
3. **Refactor** — only if needed. Keep green.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `the google button shows the shared continue-with label` | component source | contains `data-cy="oauth-google-label"` on a line that also contains `i18n.t('auth.continueWith')` |
| `the facebook button shows the shared continue-with label` | component source | contains `data-cy="oauth-facebook-label"` on a line that also contains `i18n.t('auth.continueWith')` |
| `the logo follows the label in both buttons` | component source | within the `data-cy="login-oauth-grid"` block, the index of `oauth-google-label` is **less** than the index of `oauth-google-logo`, and likewise for facebook |
| `the logos name their platform for assistive tech` | component source | `oauth-google-logo` line contains `alt="Google"` and not `aria-hidden`; `oauth-facebook-logo` line contains `alt="Facebook"` and not `aria-hidden` |
| `the login links row is not forced back to inline flow` | `src/styles.css` text | no selector matching `/\.auth-card\s+\.oauth-grid\s*\+\s*\.auth-links[^{]*\{[^}]*display:\s*inline-block/` remains |
| `the login links row keeps its space-between layout` | `src/styles.css` text | the `.auth-links {` block contains `display: flex` and `justify-content: space-between` |
| `both catalogs define the shared label` | `messages.ts` text | `'auth.continueWith'` appears exactly twice (once in `en`, once in `fr`) |
| `the register page still uses the platform-specific labels` | component source | `register-oauth-google-label` line still contains `auth.continueGoogle` |

## Impl steps

- [x] 1. Create `src/app/auth/auth-entry.layout.test.ts`. Start with `import '@angular/compiler';`. Read the component with `readFileSync(join(__dirname, 'auth-entry.component.ts'), 'utf8')` and the stylesheet with `readFileSync(join(__dirname, '..', '..', 'styles.css'), 'utf8')`. Write all eight tests.
- [x] 2. Run `npx vitest run src/app/auth/auth-entry.layout.test.ts` — it must fail.
- [x] 3. In `src/app/i18n/messages.ts`, add `'auth.continueWith': 'Continue with',` to the `en` map beside `auth.continueGoogle`, and `'auth.continueWith': 'Continuer avec',` to the `fr` map beside its `auth.continueGoogle`.
- [x] 4. In `src/app/auth/auth-entry.component.ts`, replace the login branch's `.oauth-grid` block with:
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
      Leave the **register** branch's `.oauth-grid` (lines 78–87) untouched.
- [x] 5. In `src/styles.css`, split line 1082 so the register page's bare sibling anchor keeps `inline-block` and the login page's `nav` does not:
      ```css
      .auth-card .oauth-grid + .auth-links { margin-top: 1.5rem; }
      .auth-card .oauth-grid + a { margin-top: 1.5rem; display: inline-block; }
      ```
- [x] 6. In `src/styles.css`, strengthen the button rule so text and logo share one baseline and both buttons match height regardless of label length. Replace line 1079 and add one rule:
      ```css
      .oauth-button { display: inline-flex; align-items: center; justify-content: center; gap: .55rem; min-height: 2.75rem; line-height: 1; }
      .oauth-button__label { display: inline-flex; align-items: center; line-height: 1; }
      ```
      Leave `.oauth-button__logo` (line 1080) as it is — `flex: 0 0 20px` already stops the logo from stretching.
- [x] 7. Run `npx vitest run src/app/auth/auth-entry.layout.test.ts src/app/shared/data-cy-coverage.test.ts` — green.

## Outputs

- New: `src/app/auth/auth-entry.layout.test.ts`.
- Changed: `src/app/auth/auth-entry.component.ts` (login branch only), `src/styles.css`, `src/app/i18n/messages.ts`.
- New i18n key: `auth.continueWith` (en + fr). New `data-cy` values: none — `oauth-google-label` and `oauth-facebook-label` already existed and keep their names.
- Behaviour: the login page OAuth buttons read "Continue with" + logo; the two account links sit at opposite edges.

## Validation

- [x] `npm run test` passes
- [x] `npm run lint` passes
- [x] `npm run typecheck` passes
- [x] `npm run build` passes
- [ ] Manual: `npm run dev`, open `http://127.0.0.1:4200/login` — both OAuth buttons read "Continue with" then the logo, the two buttons are the same height, and the label/logo baselines line up.
- [ ] Manual: the Create account link is flush left and Password forgotten flush right inside the card, at 1440px and at 768px.
- [ ] Manual: at 360px the OAuth grid stacks to one column (existing media query at `src/styles.css` line 1097) and the two links wrap without overlapping.
- [ ] Manual: with the browser in French, the buttons read "Continuer avec" + logo.
- [ ] Manual: `/register` is unchanged — its OAuth buttons still read the full "Continue with Google" / "Continue with Facebook".
- [x] app functional — no broken path from this slice (`npm run test` 556/556, `npm run build` green)
- [x] commit msg draft: `fix(auth): align the login oauth buttons and unstick the account links`
