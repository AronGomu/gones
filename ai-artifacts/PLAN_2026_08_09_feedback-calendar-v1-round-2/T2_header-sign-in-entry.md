# T2: Header sign-in entry point

**Plan:** `./ai-artifacts/PLAN_2026_08_09_feedback-calendar-v1-round-2.md`
**Depends:** T1
**Commit outcome:** A signed-out visitor sees a Sign in action in the top toolbar, right-justified in the same slot the Log out button occupies when signed in, and the home menu no longer carries a sign-in card.

## Context (self-contained)

- Goal: land round-2 feedback on Gones (Angular 21 standalone components, Signals, zoneless, Angular Material, dark-metal / blood-red theme).
- This slice: feedback line 2 — "On the home page, in the header menu bar, I don't see the button to log in or create an account, and I see it within the menu itself. Remove that card; it should be only in the header menu bar, justified to the right. It should be at the same position as the logout button."
- Out of scope here: the card-width rule for the remaining home cards (that is T3), the login page itself (T5, T6), any auth service or routing change.
- Assumptions in force: **A7** — removing the login card changes the home card count, and the width rule that follows from it is T3's problem, not this ticket's.

### Current state — read before editing

`src/app/app.component.ts` toolbar, lines 39–46:

```html
@if (auth.enabled) {
  <div class="auth-toolbar-actions" data-cy="auth-toolbar-actions">
    @if (auth.profile(); as profile) {
      <a class="toolbar-profile-link" routerLink="/settings/account" data-cy="profile-link">{{ profile.username }}</a>
      <button mat-stroked-button class="danger-ghost-action" type="button" data-cy="logout-button" (click)="logout()">{{ i18n.t('auth.logout') }}</button>
    }
  </div>
}
```

The `@if (auth.profile(); as profile)` block has no `@else`, so a signed-out visitor gets an empty `div` and no way in from the toolbar.

`src/app/features/menu/home-menu.component.ts` lines 15–20 render the card that must go:

```html
@if (auth.enabled && !auth.profile()) {
  <a class="home-destination home-destination--settings" routerLink="/login" data-cy="menu-login-card">
    <strong data-cy="menu-login-card-title">{{ i18n.t('auth.signIn') }}</strong>
    <p data-cy="menu-login-card-desc">{{ i18n.t('home.signInDesc') }}</p>
  </a>
}
```

CSS already in `src/styles.css`:
- line 38: `.spacer` pushes everything after it to the right of `mat-toolbar`; `.auth-toolbar-actions` already sits after it.
- line 1052: `.auth-toolbar-actions { display: inline-flex; align-items: center; gap: .35rem; }`
- line 1095–1096 (inside a narrow-viewport media query): `.auth-toolbar-actions { margin-left: auto; }` and a font-size reduction for its `a` and `button` children.

So the slot is already right-justified. Only the signed-out branch is missing.

Repo rules that apply: every rendered element needs a unique `data-cy` (`src/AGENT.md`, enforced by `src/app/shared/data-cy-coverage.test.ts`); every new i18n key must be added to **both** the `en` and `fr` maps in `src/app/i18n/messages.ts`.

- **From Depends (T1):** a working local login. `admin@gones.test` / `test@gones.test`, password `Gones-dev-pass-123!`, seeded by `npm run dev`. Used only for manual validation here.

## Requirements

- Signed out and `auth.enabled`: the toolbar shows a `Sign in` action linking to `/login`, inside `.auth-toolbar-actions`, in the same position the `data-cy="logout-button"` occupies when signed in.
- Signed in: the toolbar is unchanged — profile link plus Log out.
- `auth.enabled === false`: the toolbar shows neither, exactly as today.
- The `menu-login-card` anchor is deleted from the home menu template.
- No new i18n key is needed for the button label — `auth.signIn` already exists in both maps. A new key **is** needed for the toolbar's accessible label.

## Inputs

- `src/app/app.component.ts` — `AppComponent`, toolbar template.
- `src/app/features/menu/home-menu.component.ts` — `HomeMenuComponent` template.
- `src/app/features/menu/home-menu.component.test.ts` — existing component test (25 lines) to extend.
- `src/app/i18n/messages.ts` — `en` map starts at line 5, `fr` map at line 1042; `MessageKey` is `keyof typeof en`, so a key missing from `fr` is a compile error.
- `src/app/shared/data-cy-coverage.test.ts` — the coverage gate.

## TDD

1. **Red** — write both tests first: a new `src/app/app.component.auth-entry.test.ts` asserting the toolbar template's signed-out branch, and an added case in `home-menu.component.test.ts` asserting the login card is gone. Both fail.
2. **Green** — edit the two templates and add the i18n key.
3. **Refactor** — only if needed. Keep green.

## Test plan

These are template-source assertions, following the repo's existing no-TestBed style (`src/app/app.component.ts` is read as text and matched). That is deterministic and needs no DOM.

| Test | Input | Expect |
| --- | --- | --- |
| `the toolbar offers a sign-in action when signed out` | `app.component.ts` source | contains `data-cy="toolbar-sign-in-link"` and, on the same line, `routerLink="/login"` |
| `the sign-in action lives in the same slot as logout` | `app.component.ts` source | `data-cy="toolbar-sign-in-link"` appears between the `data-cy="auth-toolbar-actions"` opening tag and its `@if (auth.profile()` block's closing `}`, i.e. inside `.auth-toolbar-actions` |
| `the sign-in action is only rendered when there is no profile` | `app.component.ts` source | the `data-cy="toolbar-sign-in-link"` line is inside an `@else {` branch of `@if (auth.profile(); as profile) {` |
| `the home menu no longer carries a login card` | `home-menu.component.ts` source | does **not** contain `menu-login-card` |
| `the home menu still carries every other destination` | `home-menu.component.ts` source | contains `menu-running-tournaments-card`, `menu-leagues-archive-card`, `menu-calendar-card`, `menu-settings-link`, `menu-about-link` |
| `every rendered element still has data-cy` | whole `src/app` | `src/app/shared/data-cy-coverage.test.ts` stays green |

## Impl steps

- [x] 1. Create `src/app/app.component.auth-entry.test.ts`. Start it with `import '@angular/compiler';` (every component-touching vitest file in this repo does). Read the component source with `readFileSync(join(__dirname, 'app.component.ts'), 'utf8')` and assert the three toolbar cases above.
- [x] 2. Add the two home-menu cases to `src/app/features/menu/home-menu.component.test.ts`, reading `home-menu.component.ts` the same way.
- [x] 3. Run `npx vitest run src/app/app.component.auth-entry.test.ts src/app/features/menu/home-menu.component.test.ts` — both must fail. (Confirmed: 4 failed | 3 passed before impl.)
- [x] 4. In `src/app/i18n/messages.ts`, add to the `en` map next to the other `auth.*` keys: `'auth.signInAria': 'Sign in or create an account',`. Add the same key to the `fr` map: `'auth.signInAria': 'Se connecter ou créer un compte',`.
- [x] 5. In `src/app/app.component.ts`, replace the `.auth-toolbar-actions` block with:
      ```html
      @if (auth.enabled) {
        <div class="auth-toolbar-actions" data-cy="auth-toolbar-actions">
          @if (auth.profile(); as profile) {
            <a class="toolbar-profile-link" routerLink="/settings/account" data-cy="profile-link">{{ profile.username }}</a>
            <button mat-stroked-button class="danger-ghost-action" type="button" data-cy="logout-button" (click)="logout()">{{ i18n.t('auth.logout') }}</button>
          } @else {
            <a mat-stroked-button class="secondary-action" routerLink="/login" data-cy="toolbar-sign-in-link" [attr.aria-label]="i18n.t('auth.signInAria')">{{ i18n.t('auth.signIn') }}</a>
          }
        </div>
      }
      ```
- [x] 6. In `src/app/features/menu/home-menu.component.ts`, delete the whole `@if (auth.enabled && !auth.profile()) { … }` block (the `menu-login-card` anchor and its two children).
- [x] 7. In the same file, remove the now-unused (verified: `auth` field/import kept, still guards `menu-registrations-card`; lint/typecheck clean). `AuthService` import **only if** `auth` has no other template use. It still does — `@if (auth.profile())` guards `menu-registrations-card` on line 33 — so keep the `auth` field and the import. Do not touch them.
- [x] 8. Run `npx vitest run src/app/app.component.auth-entry.test.ts src/app/features/menu/home-menu.component.test.ts src/app/shared/data-cy-coverage.test.ts` — green. (Confirmed: 3 files, 15 tests passed.)

## Outputs

- New: `src/app/app.component.auth-entry.test.ts`.
- Changed: `src/app/app.component.ts`, `src/app/features/menu/home-menu.component.ts`, `src/app/features/menu/home-menu.component.test.ts`, `src/app/i18n/messages.ts`.
- Behaviour: signed-out visitors reach `/login` from the toolbar on every page, not only from the home menu. The home menu loses one card.
- New `data-cy` value: `toolbar-sign-in-link`. New i18n key: `auth.signInAria` (en + fr).

## Validation

- [x] `npm run test` passes (80 files, 532 tests passed)
- [x] `npm run lint` passes ("All files pass linting.")
- [x] `npm run typecheck` passes (no output, exit 0)
- [ ] Manual: `npm run dev`, open `http://127.0.0.1:4200/` signed out — the toolbar shows Sign in on the right; the home grid has no sign-in card. Left unchecked — no live browser run performed this pass; automated proxy exists (`app.component.auth-entry.test.ts` slot/else-branch assertions + `home-menu.component.test.ts` no-login-card assertion) but not equivalent to a rendered DOM/browser check. Logged in manual checklist.
- [ ] Manual: sign in as `admin@gones.test` — Sign in is replaced by the username link plus the red Log out button, in the same place. Left unchecked — same reason as above; no Cypress/browser run this pass.
- [ ] Manual: at a 400px viewport width the toolbar still fits and the Sign in action stays right-aligned. Left unchecked — CSS-only claim from ticket context (existing `.auth-toolbar-actions` rules), no automated viewport proof produced.
- [x] app functional — no broken path from this slice (full `npm run test` 532/532, `npm run lint`, `npm run typecheck` all clean)
- [x] commit msg draft: `feat(auth): put the sign-in entry point in the toolbar instead of the home menu`
