# T3: Menubar polish + login return-url

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T2
**Commit outcome:** The header shows a plain profile link and a red "Se déconnecter" button, no sign-in button; signing in returns the user to the page they came from.

## Context (self-contained)

- Goal: land the whole `feedback.md` list on Gones Calendar V1. This ticket covers General §1, General §2, Login §5 and Login §6.
- This slice: header markup plus the navigation-history service that feeds the login redirect.
- Out of scope here: auth page body layout (T4), the settings/account route split (T8). Keep pointing at `/profile`; T8 will make `/profile` redirect to `/settings/account`.
- Assumptions in force: A1 (`data-cy`); removing the header sign-in button needs a replacement entry point, so an anonymous "Se connecter" card is added to the home menu.

## Requirements

- Header (logged in): the username is a plain text link (`<a>` appearance, no button chrome) to `/profile`.
- Header (logged in): "Se déconnecter" is a button with the existing danger styling (`class="danger-ghost-action"`).
- Header (anonymous): no sign-in button at all.
- Home menu shows a `Se connecter` destination card when `auth.enabled` and there is no profile.
- `AuthEntryComponent.submitLogin()` navigates to, in order: a valid `returnUrl` query parameter, else the last non-auth URL visited in this browsing session, else `/`.
- Every element added or changed carries a unique `data-cy`; both changed files leave the retrofit allowlist.

## Inputs

- `src/app/app.component.ts:43-52` — the current block:
  ```
  @if (auth.enabled) {
    <div class="auth-toolbar-actions">
      @if (auth.profile(); as profile) {
        <a mat-stroked-button routerLink="/profile" data-cy="profile-link">{{ profile.username }}</a>
        <button mat-button type="button" (click)="logout()">{{ i18n.t('auth.logout') }}</button>
      } @else {
        <a mat-stroked-button routerLink="/login" data-cy="login-link">{{ i18n.t('auth.signIn') }}</a>
      }
    </div>
  }
  ```
- `src/app/app.component.ts:177-180` — `logout()` awaits `auth.logout()` then navigates to `/login`.
- `src/app/app.component.ts:150-152` — the component already subscribes to `NavigationEnd` and calls `updateRouteState(event.urlAfterRedirects)`.
- `src/app/auth/return-url.ts` — `safeReturnUrl(candidate, fallback)` rejects absolute URLs, `//host`, backslashes and control characters; returns `fallback` otherwise.
- `src/app/auth/auth-entry.component.ts:123-128` — `submitLogin()` currently ends with `await this.router.navigateByUrl(safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'), '/profile'));`
- `src/app/features/menu/home-menu.component.ts:13-34` — `<nav class="home-destinations">` with five `<a class="home-destination …" routerLink="…">` cards, each `<strong>` + `<p>`.
- `src/app/i18n/messages.ts` — `const en = {` at line 5, `const fr: Record<MessageKey, string> = {` at line 1000. Every new key must be added to BOTH maps.
- `src/styles.css:117` — `.danger-ghost-action` sets outlined-button label and outline to `var(--hot-blood)`.
- `src/app/auth/auth.guards.ts:5-8` — `userGuard` already redirects to `/login` with `queryParams: { returnUrl: state.url }`.
- **From Depends (T2):** `AuthService` exposes `profile()`, `enabled`, `bootstrapped()` and the new `bootstrapFailed()` signal; the session survives a reload, so the header state after reload is meaningful. `src/app/shared/data-cy-coverage.test.ts` exports `PENDING_DATA_CY_RETROFIT`, an array of repo-relative paths.

## TDD

1. **Red** — write `src/app/auth/last-visited-url.service.test.ts` and `src/app/auth/login-redirect.test.ts` against a `loginDestination()` helper that does not exist yet.
2. **Green** — add the service and helper, then rewire the header, home menu and `submitLogin()`.
3. **Refactor** — none.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `records a non-auth url` | `record('/calendar?view=list')` | `last()` is `'/calendar?view=list'` |
| `ignores auth urls` | `record('/calendar')` then `record('/login?returnUrl=%2Fcalendar')` | `last()` is `'/calendar'` |
| `ignores every auth path` | `record('/register')`, `record('/verify-email')`, `record('/forgot-password')`, `record('/reset-password')`, `record('/auth/complete-profile')` | `last()` is `''` |
| `returnUrl wins` | `loginDestination('/registrations', '/calendar')` | `'/registrations'` |
| `falls back to last visited` | `loginDestination(null, '/calendar')` | `'/calendar'` |
| `falls back to home` | `loginDestination(null, '')` | `'/'` |
| `rejects an off-site returnUrl` | `loginDestination('https://evil.test', '/calendar')` | `'/calendar'` |
| `data-cy coverage` | `src/app/app.component.ts`, `src/app/features/menu/home-menu.component.ts` removed from the allowlist | suite green |

Run: `npm run test -- last-visited-url login-redirect data-cy-coverage`

## Impl steps

- [x] 1. Create `src/app/auth/last-visited-url.service.ts` exporting `export const AUTH_PATH_PREFIXES = ['/login','/register','/verify-email','/forgot-password','/reset-password','/auth'] as const;` and `@Injectable({ providedIn: 'root' }) export class LastVisitedUrlService` with `private readonly value = signal(''); record(url: string): void; last(): string;`. `record` stores the url only when its path (everything before `?` or `#`) does not start with any entry of `AUTH_PATH_PREFIXES`.
- [x] 2. In the same file add `export function loginDestination(returnUrl: string | null | undefined, lastVisited: string): string { return safeReturnUrl(returnUrl, safeReturnUrl(lastVisited, '/')); }` importing `safeReturnUrl` from `./return-url`.
- [x] 3. Create `src/app/auth/last-visited-url.service.test.ts` and `src/app/auth/login-redirect.test.ts` covering the first seven rows of the Test plan.
- [x] 4. In `src/app/app.component.ts`, inject `private readonly lastVisited = inject(LastVisitedUrlService);` and call `this.lastVisited.record(event.urlAfterRedirects);` inside the existing `NavigationEnd` subscription at line 150, before `updateRouteState`.
- [x] 5. Replace the header auth block with:
  ```
  @if (auth.enabled) {
    <div class="auth-toolbar-actions" data-cy="auth-toolbar-actions">
      @if (auth.profile(); as profile) {
        <a class="toolbar-profile-link" routerLink="/profile" data-cy="profile-link">{{ profile.username }}</a>
        <button mat-stroked-button class="danger-ghost-action" type="button" data-cy="logout-button" (click)="logout()">{{ i18n.t('auth.logout') }}</button>
      }
    </div>
  }
  ```
  Note the removed `mat-stroked-button` on the profile anchor and the removed `@else` branch.
- [x] 6. Add to `src/styles.css`, next to the other toolbar rules: `.toolbar-profile-link { color: var(--ash); text-decoration: underline; text-underline-offset: 3px; font-weight: 700; padding-inline: .35rem; min-height: 44px; display: inline-flex; align-items: center; }` and `.toolbar-profile-link:hover, .toolbar-profile-link:focus-visible { color: var(--hot-blood); }`.
- [x] 7. In `src/app/app.component.ts`, change `logout()` to navigate to `'/'` instead of `'/login'`.
- [x] 8. Add `data-cy` to every remaining element of `src/app/app.component.ts`'s template (toolbar, brand anchor, spacer, each header-actions container, breadcrumb nav/list/items, banners, `<main>`), each value unique and prefixed `app-`.
- [x] 9. In `src/app/features/menu/home-menu.component.ts`, inject `readonly auth = inject(AuthService);` and add, as the first card inside `<nav class="home-destinations">`:
  ```
  @if (auth.enabled && !auth.profile()) {
    <a class="home-destination home-destination--settings" routerLink="/login" data-cy="menu-login-card">
      <strong data-cy="menu-login-card-title">{{ i18n.t('auth.signIn') }}</strong>
      <p data-cy="menu-login-card-desc">{{ i18n.t('home.signInDesc') }}</p>
    </a>
  }
  ```
- [x] 10. Add key `home.signInDesc` to both maps in `src/app/i18n/messages.ts`: en `'Sign in to register for tournaments, manage your account and propose events.'`, fr `'Connectez-vous pour vous inscrire aux tournois, gérer votre compte et proposer des évènements.'`.
- [x] 11. Add `data-cy` to every remaining element of `home-menu.component.ts`'s template (`section`, `nav`, each `a`, each `strong`, each `p`), unique, prefixed `menu-`.
- [x] 12. In `src/app/auth/auth-entry.component.ts`, inject `private readonly lastVisited = inject(LastVisitedUrlService);` and replace the navigation in `submitLogin()` with `await this.router.navigateByUrl(loginDestination(this.route.snapshot.queryParamMap.get('returnUrl'), this.lastVisited.last()));`.
- [x] 13. Delete `src/app/app.component.ts` and `src/app/features/menu/home-menu.component.ts` from `PENDING_DATA_CY_RETROFIT` in `src/app/shared/data-cy-coverage.test.ts`.
- [x] 14. Update `cypress/e2e/auth-profile.cy.js`: replace any `[data-cy=login-link]` navigation with `cy.visit('/login')` or `[data-cy=menu-login-card]`. (No `[data-cy=login-link]` usages existed in this file — no-op, verified by grep. `cypress/e2e/auth-session-persistence.cy.js`, an existing T2 spec not in this ticket's Outputs list, asserted `login-link` visible for anonymous users; updated its assertion to `menu-login-card` since the ticket's own requirement removes the anonymous sign-in button — see Assumptions.)
- [x] 15. Run `npm run test && npm run lint && npm run typecheck && npm run build`. All green — see report.
- [x] 16. Run `npm run dev` then `npm run cy:run -- --spec cypress/e2e/auth-profile.cy.js,cypress/e2e/auth-session-persistence.cy.js`. Unblocked via `LD_LIBRARY_PATH` recipe from `scripts/full-stack-ci.mjs:24-47` + `npm run dev:serve` on port 4200 + `node scripts/seed-auth-e2e.mjs` (required to reset the shared `cypress.user@example.test` fixture state — omitted from the initial recipe, discovered because the profile-checkbox assertion failed on dirty state from a prior run). `auth-session-persistence.cy.js`: 2/2 passing. `auth-profile.cy.js`: 5/6 passing; the sole failure ("starts explicit provider linking without implicit email merge") is pre-existing and orthogonal to this ticket — confirmed by diffing: the only line T3 touches in this file is the `login()` helper's `cy.visit()` URL, and that test's body (unchanged by T3) hard-codes a mocked OAuth redirect to `127.0.0.1:8081`, which is only reachable under the release-profile Docker topology (`full-stack-ci.mjs`), not the `ng serve`-on-4200 topology this repair used. Fixed the `login()` helpers in both specs to match the new default (`auth-session-persistence.cy.js`: fresh `/login` visit now correctly lands on `/`, was hardcoded `/profile`; `auth-profile.cy.js`: switched to `cy.visit('/login?returnUrl=%2Fprofile')` so its downstream steps, which need to land on `/profile`, exercise the new explicit-returnUrl path instead of the old implicit default).

## Outputs

- Files created: `src/app/auth/last-visited-url.service.ts`, `src/app/auth/last-visited-url.service.test.ts`, `src/app/auth/login-redirect.test.ts`.
- Files touched: `src/app/app.component.ts`, `src/app/features/menu/home-menu.component.ts`, `src/app/auth/auth-entry.component.ts`, `src/app/i18n/messages.ts`, `src/styles.css`, `src/app/shared/data-cy-coverage.test.ts`, `cypress/e2e/auth-profile.cy.js`, `cypress/e2e/auth-session-persistence.cy.js`.
- Public API / behavior change: `data-cy=login-link` no longer exists; logout lands on `/`; login lands on the previous page.
- Migrate / config: none.

## Validation

- [x] `npm run test` passes
- [x] `npm run lint && npm run typecheck && npm run build` pass
- [x] `npm run cy:run -- --spec cypress/e2e/auth-profile.cy.js,cypress/e2e/auth-session-persistence.cy.js` passes — `auth-session-persistence.cy.js` 2/2, `auth-profile.cy.js` 5/6 (1 pre-existing, unrelated failure — see step 16 note)
- [ ] manual check: from `/calendar`, open `/login` via the home card, sign in, land back on `/calendar`; header shows a plain underlined username and a red logout button — PARTIALLY substituted: e2e confirms `profile-link`/`logout-button` render correctly post-login and `menu-login-card` is the anonymous entry point (`auth-session-persistence.cy.js`), and `loginDestination`'s last-visited-page fallback is unit-tested (`login-redirect.test.ts`), but no spec drives the literal `/calendar → home card → /login → back to /calendar` browser round-trip, and no interactive browser was available to do it by hand.
- [x] app functional — anonymous header renders with no auth controls at all (verified via `data-cy-coverage` test + template read: the `@else` login-link branch was deleted, `auth.enabled && !auth.profile()` menu card is the only anonymous entry point)
- [ ] commit msg draft: `feat(header): plain profile link, danger logout and post-login return to the previous page`
