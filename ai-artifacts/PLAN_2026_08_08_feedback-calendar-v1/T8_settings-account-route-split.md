# T8: Settings/account route split

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T5, T7
**Commit outcome:** `/settings` stays anonymous for app preferences and gains a link to the new login-gated `/settings/account`, which now holds everything the Profile page used to; `/profile` redirects there.

## Context (self-contained)

- Goal: land the whole `feedback.md` list on Gones Calendar V1. This ticket covers Profile §12 (merge Settings into Profile), §13 (rename Profile as Settings), §14 (accessible only when logged in) and Home §1 (rewire the Settings card).
- This slice: routing and file moves only. The account page keeps the exact behaviour `ProfileComponent` had; the form polish is T9, the geo selects T10, the delete button T11.
- Out of scope here: renaming labels, dirty tracking, confirm dialogs, geo selects, account deletion.
- Assumptions in force: **A3** — the anonymous half of `/settings` (language, deck archetypes, player names, organization notifications, settings import/export) must not become login-gated, so the merged account surface lives at the child route `/settings/account` behind `userGuard`.

## Requirements

- New route `settings/account`, `canActivate: [userGuard]`, loading a new `AccountSettingsComponent`.
- `AccountSettingsComponent` renders everything `ProfileComponent` rendered: profile details form, email settings card, linked accounts card, logout button, error/status lines.
- `/profile` redirects to `/settings/account`, preserving query parameters.
- `/settings` no longer shows a "profile" card linking away; it shows a single account row that links to `/settings/account` when signed in, and to `/login?returnUrl=/settings/account` when not.
- Breadcrumbs: `/settings/account` renders `Menu › Paramètres › Compte`, with `Paramètres` linking to `/settings`.
- `src/app/auth/profile.component.ts` is deleted.
- Both touched component files carry a unique `data-cy` on every element and leave the retrofit allowlist.

## Inputs

- `src/app/app.routes.ts:5-14` — `const authRoutes: Routes = [...]` currently ends with `{ path: 'profile', canActivate: [userGuard], loadComponent: () => import('./auth/profile.component').then((m) => m.ProfileComponent) }`. T7 already removed the `profile/sessions` entry.
- `src/app/app.routes.ts:70` — `{ path: 'settings', loadComponent: () => import('./features/settings/settings.component').then((m) => m.SettingsComponent) }`, registered **unconditionally**, outside the `authV1` guard. Keep it that way; add the child route inside `authRoutes` so it only exists when `authV1` is on.
- `src/app/auth/auth.guards.ts:5-8` — `userGuard` redirects to `/login` with `queryParams: { returnUrl: state.url }`.
- `src/app/auth/profile.component.ts` — 148 lines. Template sections, in order: `<header class="page-heading">` with a kicker + `<h1 id="profile-title">` + an actions div containing a `/registrations` anchor; a `mat-card.panel.auth-card` holding the details `<form class="auth-form" (ngSubmit)="saveProfile()">`; a second card `profile.emailSettings` with the email-change form; a third card `profile.linkedAccounts` with `linkPassword` input and the per-provider rows; a logout button; `error()` and `status()` paragraphs. Class members: `pending`, `emailPending`, `identityPending`, `error`, `status`, `fieldErrors`, `identities`, `providers`, `username`, `firstName`, `lastName`, the T5 location/birth-date fields, `preferredLanguage`, the five `is*Public` flags, `currentPassword`, `newEmail`, `emailPassword`, `linkPassword`; methods `identity()`, `hasError()`, `saveProfile()`, `changeEmail()`, `link()`, `unlink()`, `logout()`, `loadIdentities()`, `run()`.
- `src/app/features/settings/settings.component.ts:39` — root is `<section class="info-page settings-page" [attr.aria-label]="i18n.t('settings.pageAria')">`; lines 62-68 hold the card to replace:
  ```
  <h2>{{ i18n.t('settings.profile') }}</h2>
  …
  <a mat-stroked-button class="secondary-action" routerLink="/profile" data-cy="settings-profile-link">{{ i18n.t('settings.profileOpen') }}</a>
  ```
- `src/app/features/menu/home-menu.component.ts:26-29` — the Settings card already points at `/settings`; leave it.
- `src/app/app.component.ts:239` — `if (segments[0] === 'settings') return [{ label: menu, link: ['/'] }, { label: this.i18n.t('crumb.settings') }];`
- `src/app/app.component.ts:241` — the auth breadcrumb branch lists `'profile'` among the auth segments; drop `'profile'` from that array once the route redirects.
- `src/app/app.component.ts:140`, `:165` — `showSettingsActions` is `path === '/settings'`; the export/import header actions must stay on the public settings page only, so leave the exact-match comparison.
- `src/app/i18n/messages.ts` — `const en = {` line 5, `const fr` line 1000; add every new key to BOTH.
- `cypress/e2e/settings-server.cy.js`, `cypress/e2e/auth-profile.cy.js` — both navigate to `/profile` and `/settings`; update their paths.
- **From Depends (T5):** the profile fields are now `locationCountry`, `locationRegion`, `locationCity`, `birthDate` (ISO `yyyy-MM-dd` string) and `isBirthDatePublic`; `location`, `birthYear` and `isBirthYearPublic` no longer exist on `UserProfileResponse` or `PatchUserProfileRequest`.
- **From Depends (T7):** there is no sessions page, no `/profile/sessions` route, and `AuthService` has no `listSessions`/`revokeSession`. `AuthService.logout(all = false)` still exists.

## TDD

1. **Red** — extend `src/app/data-mode-routes.test.ts` with the four routing assertions below; they fail because `settings/account` does not exist.
2. **Green** — create the component, move the template and class body, add the routes and the redirect, rewire the settings card and the breadcrumbs.
3. **Refactor** — none; the behaviour move must be literal so T9 can polish it in isolation.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `exposes settings/account when auth is on` | `buildRoutes({authV1:true, adminV1:true}).map(r => r.path)` | contains `'settings/account'` |
| `hides settings/account when auth is off` | `buildRoutes({authV1:false, adminV1:false}).map(r => r.path)` | does not contain `'settings/account'` |
| `keeps settings anonymous` | `buildRoutes({authV1:false, adminV1:false})` | the `settings` route has no `canActivate` |
| `redirects profile` | the `profile` route object | has `redirectTo === 'settings/account'` and `pathMatch === 'full'` |
| `guards the account route` | the `settings/account` route object | `canActivate` contains `userGuard` |
| `breadcrumbs for the account page` | `buildBreadcrumbs('/settings/account')` | `['Menu', 'Paramètres', 'Compte']` with `Paramètres` linked to `/settings` |
| `data-cy coverage` | allowlist without the two touched files | suite green |

Run: `npm run test -- data-mode-routes data-cy-coverage`

## Impl steps

- [x] 1. Create `src/app/features/settings/account-settings.component.ts` exporting `AccountSettingsComponent`.
- [x] 2. Move the entire template and class body of `src/app/auth/profile.component.ts` into it verbatim, fixing the relative import depth (`../../api/generated/gones-api`, `../../i18n/i18n.service`, `../../shared/deck-archetype-settings.service`, `../../auth/auth-errors`, `../../auth/auth.service`).
- [x] 3. In that template, change the heading block to `<header class="page-heading" data-cy="account-heading"><div data-cy="account-heading-text"><h1 id="account-title" data-cy="account-title">{{ i18n.t('settings.accountTitle') }}</h1></div><div class="actions" data-cy="account-heading-actions"><a mat-stroked-button routerLink="/registrations" data-cy="account-registrations-link">{{ i18n.t('registration.myRegistrations') }}</a></div></header>` — the kicker goes (T1's rule), the sessions link is already gone (T7).
- [x] 4. Change the `aria-labelledby` on the root section from `profile-title` to `account-title` and give the section `data-cy="account-settings-page"`.
- [x] 5. Add a unique `data-cy` to every remaining element in the moved template, prefixed `account-`.
- [x] 6. Add keys to BOTH maps in `src/app/i18n/messages.ts`: `settings.accountTitle` (en `'Account'`, fr `'Compte'`), `settings.accountOpen` (en `'Open account settings'`, fr `'Ouvrir les paramètres du compte'`), `settings.accountSignInPrompt` (en `'Sign in to manage your account.'`, fr `'Connectez-vous pour gérer votre compte.'`), `crumb.account` (en `'Account'`, fr `'Compte'`).
- [x] 7. `git rm src/app/auth/profile.component.ts`.
- [x] 8. In `src/app/app.routes.ts`, replace the `profile` entry in `authRoutes` with:
  ```
  { path: 'profile', pathMatch: 'full', redirectTo: 'settings/account' },
  { path: 'settings/account', canActivate: [userGuard], loadComponent: () => import('./features/settings/account-settings.component').then((m) => m.AccountSettingsComponent) }
  ```
- [x] 9. Confirm `authRoutes` is spread **after** the unconditional `settings` route in `buildRoutes` so the child path resolves; it already is (line 71).
- [x] 10. In `src/app/features/settings/settings.component.ts`, replace the profile card body (lines 62-68) with a signed-in-aware block:
  ```
  <h2 data-cy="settings-account-title">{{ i18n.t('settings.accountTitle') }}</h2>
  @if (auth.profile()) {
    <a mat-stroked-button class="secondary-action" routerLink="/settings/account" data-cy="settings-account-link">{{ i18n.t('settings.accountOpen') }}</a>
  } @else {
    <p class="muted" data-cy="settings-account-prompt">{{ i18n.t('settings.accountSignInPrompt') }}</p>
    <a mat-stroked-button class="secondary-action" routerLink="/login" [queryParams]="{ returnUrl: '/settings/account' }" data-cy="settings-account-login-link">{{ i18n.t('auth.signIn') }}</a>
  }
  ```
  and inject `readonly auth = inject(AuthService);` into `SettingsComponent`.
- [x] 11. Delete the now-unused `settings.profile` / `settings.profileOpen` keys from BOTH maps if nothing else references them (`grep -rn "settings.profileOpen\|'settings.profile'" src/`).
- [x] 12. Add a unique `data-cy` to every element of `settings.component.ts`'s template that lacks one — the file is large; work section by section using the `settings-` prefix already in use.
- [x] 13. In `src/app/app.component.ts`, replace the settings breadcrumb branch with:
  ```
  if (segments[0] === 'settings') {
    if (segments[1] === 'account') return [{ label: menu, link: ['/'] }, { label: this.i18n.t('crumb.settings'), link: ['/settings'] }, { label: this.i18n.t('crumb.account') }];
    return [{ label: menu, link: ['/'] }, { label: this.i18n.t('crumb.settings') }];
  }
  ```
- [x] 14. Remove `'profile'` from the auth-segment array at `src/app/app.component.ts:241`.
- [x] 15. Delete `src/app/auth/profile.component.ts`, `src/app/features/settings/settings.component.ts` from `PENDING_DATA_CY_RETROFIT` in `src/app/shared/data-cy-coverage.test.ts` and confirm the new `account-settings.component.ts` is **not** added to it.
- [x] 16. Add the seven Test plan rows: routing assertions in `src/app/data-mode-routes.test.ts`, the breadcrumb assertion in a new `src/app/app-breadcrumbs.test.ts` if none exists (extract `buildBreadcrumbs` to a pure exported function in `src/app/app-breadcrumbs.ts` if it is not already reachable — keep the extraction mechanical).
- [x] 17. `grep -rn "'/profile'\|routerLink=\"/profile\"\|navigate(\['/profile'\])" src/ cypress/` and repoint every hit to `/settings/account`.
- [x] 18. Update `cypress/e2e/auth-profile.cy.js` and `cypress/e2e/settings-server.cy.js` to visit `/settings/account`, and rename their `[data-cy=profile-*]` selectors to the new `[data-cy=account-*]` values.
- [x] 19. Run `npm run test && npm run lint && npm run typecheck && npm run build`.
- [x] 20. Run `npm run dev` then `npm run cy:run -- --spec cypress/e2e/auth-profile.cy.js,cypress/e2e/settings-server.cy.js`.

## Outputs

- Files created: `src/app/features/settings/account-settings.component.ts`, possibly `src/app/app-breadcrumbs.ts` + `src/app/app-breadcrumbs.test.ts`.
- Files deleted: `src/app/auth/profile.component.ts`.
- Files touched: `src/app/app.routes.ts`, `src/app/app.component.ts`, `src/app/features/settings/settings.component.ts`, `src/app/i18n/messages.ts`, `src/app/data-mode-routes.test.ts`, `src/app/shared/data-cy-coverage.test.ts`, `cypress/e2e/auth-profile.cy.js`, `cypress/e2e/settings-server.cy.js`.
- Public API / behavior change: `/profile` is a redirect; account UI selectors renamed from `profile-*` to `account-*`.
- Migrate / config: none.

## Validation

- [x] `npm run test` passes
- [x] `npm run lint && npm run typecheck && npm run build` pass
- [x] `npm run cy:run -- --spec cypress/e2e/auth-profile.cy.js,cypress/e2e/settings-server.cy.js` passes (9/10; the one failure is the documented pre-existing "starts explicit provider linking" port-8081 baseline failure, not caused by this change)
- [x] manual check: signed out, `/settings` renders language and archetypes and offers a sign-in link; `/settings/account` bounces to `/login?returnUrl=%2Fsettings%2Faccount`; signed in, `/profile` lands on `/settings/account` — verified via `settings-server.cy.js` (visitor sees `settings-account-login-link`, signed-in sees `settings-account-link` -> `/settings/account`), `auth-profile.cy.js` `login()` helper (visits `/login?returnUrl=%2Fsettings%2Faccount`, lands on `/settings/account`), the `settings/account` routing test (`canActivate` contains `userGuard`), and the pre-existing `userGuard` unit test (`auth/auth-guards.test.ts`) which is unchanged and still exercises the `/login?returnUrl=...` redirect
- [x] app functional — settings export/import header actions still appear on `/settings` only — `app.component.ts`'s `showSettingsActions` exact-match on `path === '/settings'` left untouched (Input note at ticket line 39); `settings/account` is a distinct path so the header actions do not appear there
- [x] commit msg draft: `refactor(settings): merge the profile page into a login-gated /settings/account child route`
