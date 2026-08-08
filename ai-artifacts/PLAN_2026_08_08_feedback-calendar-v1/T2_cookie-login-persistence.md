# T2: Cookie login persistence + auto-connect

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T1
**Commit outcome:** Signing in then reloading the browser keeps the user signed in, proved by a backend integration test and a Cypress reload test.

## Context (self-contained)

- Goal: land the whole `feedback.md` list on Gones Calendar V1. This ticket covers "Login is not saved. Update front & back to cache user connexion as cookie. On application startup, auto-connect user if cookie present."
- This slice: the refresh-cookie round trip. Everything else in the plan that depends on being signed in (settings, account deletion, tournament proposal) rests on this.
- Out of scope here: menubar markup, return-url redirect (T3), auth page layout (T4).
- Assumptions in force: A1 (`data-cy`).

## Requirements

- `POST /api/auth/login` sets a refresh cookie that the browser actually stores and replays for the configured deployment topology (same-origin and cross-origin dev).
- On application start, `AuthService.bootstrap()` calls refresh and, on success, populates `AuthService.profile()` before the first route renders.
- The `SameSite` and `Secure` attributes of the refresh cookie are configuration-driven, not hard-coded, so a cross-site frontend origin is supported.
- A regression test exists at both layers: backend integration (cookie issued on login, accepted on refresh, rotated) and Cypress (sign in, `cy.reload()`, still signed in).

## Inputs

- `backend/src/Gones.Api/Identity/RefreshSessionService.cs:258-283` — `internal static class RefreshCookie` with `Name = "gones_refresh"`, `Path = "/api/auth"` and `Options()` currently hard-coding `Secure = true`, `HttpOnly = true`, `SameSite = SameSiteMode.Lax`, no `Domain`.
- `backend/src/Gones.Api/Identity/LocalIdentityEndpoints.cs:164` — `RefreshCookie.Issue(...)` in `LoginAsync`; `:175-184` — `RefreshAsync` reads `httpContext.Request.Cookies[RefreshCookie.Name]` and re-issues; `:193`, `:204` — `RefreshCookie.Clear(...)`.
- `backend/src/Gones.Api/Security/ApiBoundaryMiddleware.cs:118-134` — CORS policy `gones-exact-origins`, built from configuration, already calls `.AllowCredentials()`.
- `src/app/api/api-boundary.ts:57` — the boundary interceptor already sets `withCredentials: true` on every request.
- `src/app/auth/auth.service.ts:33-43` — `bootstrap()` guards on `enabled` and `bootstrapped()`, calls `refreshAccessToken()` then `loadProfile()`, clears on failure, sets `bootstrapped` in `finally`.
- `src/main.ts:69` — `provideAppInitializer(() => inject(AuthService).bootstrap())` already wired.
- `src/environments/environment.ts` — `apiBaseUrl: 'http://127.0.0.1:5080'`; dev server is `ng serve --host 127.0.0.1` on port 4200 (`package.json` `dev:serve`).
- `cypress.config.js` — `baseUrl: "http://127.0.0.1:4200"`.
- `cypress/e2e/auth-profile.cy.js` — existing sign-up/profile spec; follow its bootstrap helpers.
- `backend/tests/Gones.IntegrationTests/LocalIdentityApiTests.cs` — existing register/verify/login integration tests; follow its fixture usage.
- **From Depends (T1):** `src/AGENT.md` exists and mandates `data-cy` on every element; `PENDING_DATA_CY_RETROFIT` in `src/app/shared/data-cy-coverage.test.ts` lists existing templates. This ticket adds no template markup, so leave the allowlist untouched.

## TDD

1. **Red** — add `backend/tests/Gones.IntegrationTests/RefreshCookieTests.cs` asserting login emits `Set-Cookie: gones_refresh=…` and that replaying only that cookie to `POST /api/auth/refresh` returns 200 with a new access token and a rotated cookie value. Add `cypress/e2e/auth-session-persistence.cy.js` asserting a reload keeps the header profile link. Both fail before the fix if the topology is broken; the backend test must be written so it fails when `SameSite`/`Secure` is misconfigured for the test host.
2. **Green** — make the cookie attributes configuration-driven and confirm `bootstrap()` runs before the first render.
3. **Refactor** — none beyond extracting the options record.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `Login_issues_refresh_cookie` | `POST /api/auth/refresh` after a verified `POST /api/auth/login` | response carries `Set-Cookie` named `gones_refresh`, `HttpOnly`, `Path=/api/auth` |
| `Refresh_accepts_only_the_cookie` | replay the cookie alone, no `Authorization` header | 200 with a non-empty `accessToken` |
| `Refresh_rotates_the_cookie_value` | two consecutive refreshes | second `Set-Cookie` value differs from the first |
| `Logout_clears_the_cookie` | `POST /api/auth/logout` | `Set-Cookie` with an expiry in the past |
| `Cookie_samesite_follows_configuration` | `Gones:Auth:RefreshCookieSameSite=None` | issued cookie contains `SameSite=None; Secure` |
| `auth-session-persistence.cy.js` | sign in, `cy.reload()` | `[data-cy=profile-link]` visible, `[data-cy=login-link]` absent |

Run: `npm run backend:test` and `npm run cy:run --spec cypress/e2e/auth-session-persistence.cy.js`

## Impl steps

- [x] 1. Add `backend/src/Gones.Infrastructure/Identity/RefreshCookieOptions.cs` with `public sealed class RefreshCookieOptions { public string SameSite { get; set; } = "Lax"; public bool Secure { get; set; } = true; }` in namespace `Gones.Infrastructure.Identity`.
- [x] 2. In `backend/src/Gones.Api/Program.cs`, bind it next to the other options registrations: `builder.Services.Configure<RefreshCookieOptions>(builder.Configuration.GetSection("Gones:Auth:RefreshCookie"));`
- [x] 3. In `backend/src/Gones.Api/Identity/RefreshSessionService.cs`, change `RefreshCookie` from `internal static class` to `internal sealed class RefreshCookie(IOptions<RefreshCookieOptions> options)` registered as a singleton; keep `public const string Name = "gones_refresh";` and `public const string Path = "/api/auth";` as statics.
- [x] 4. In `RefreshCookie.Options(...)`, replace `SameSite = SameSiteMode.Lax` with a parse of `options.Value.SameSite` (`"None"` → `SameSiteMode.None`, `"Strict"` → `SameSiteMode.Strict`, anything else → `SameSiteMode.Lax`) and `Secure = options.Value.SameSite == "None" || options.Value.Secure`.
- [x] 5. Register it: `builder.Services.AddSingleton<RefreshCookie>();` in `Program.cs`.
- [x] 6. Inject `RefreshCookie cookie` into `LoginAsync`, `RefreshAsync`, `LogoutAsync`, `LogoutAllAsync` in `backend/src/Gones.Api/Identity/LocalIdentityEndpoints.cs` and change the four call sites from `RefreshCookie.Issue(...)` / `RefreshCookie.Clear(...)` to `cookie.Issue(...)` / `cookie.Clear(...)`.
- [x] 7. Update every other `RefreshCookie.Issue`/`Clear` call site — run `grep -rn "RefreshCookie\." backend/src` and convert each (notably `backend/src/Gones.Api/Identity/ExternalOAuthEndpoints.cs`).
- [x] 8. Add to `backend/src/Gones.Api/appsettings.Development.json`: `"Gones": { "Auth": { "RefreshCookie": { "SameSite": "Lax", "Secure": false } } }` merged into the existing `Gones` section — dev serves the API over plain HTTP.
- [x] 9. Document the two keys in `.env.example` as `GONES__AUTH__REFRESHCOOKIE__SAMESITE` and `GONES__AUTH__REFRESHCOOKIE__SECURE`, with a comment that a cross-site frontend origin requires `None` + `true` + HTTPS.
- [x] 10. Write `backend/tests/Gones.IntegrationTests/RefreshCookieTests.cs` with the five backend rows of the Test plan, following the fixture pattern of `LocalIdentityApiTests.cs`.
- [x] 11. In `src/app/auth/auth.service.ts`, leave `bootstrap()` logic as is but add a `readonly bootstrapFailed = signal(false);` set to `true` in the `catch`, so T3 can distinguish "never signed in" from "session expired".
- [x] 12. Add `src/app/auth/auth.service.bootstrap.test.ts`: with a `Client` stub whose `refresh()` resolves and `meGET()` returns a profile, `await service.bootstrap()` leaves `profile()` non-null and `bootstrapped()` true; with a rejecting `refresh()`, `profile()` is null, `bootstrapFailed()` true, `bootstrapped()` still true.
- [x] 13. Write `cypress/e2e/auth-session-persistence.cy.js`: register+verify a user via the same helpers `auth-profile.cy.js` uses, sign in through `[data-cy=auth-email]` / `[data-cy=auth-password]` / `[data-cy=auth-submit]`, assert `[data-cy=profile-link]` exists, `cy.reload()`, assert `[data-cy=profile-link]` still exists.
- [x] 14. Run `npm run backend:test`.
- [x] 15. Run `npm run dev`, then `npm run cy:run -- --spec cypress/e2e/auth-session-persistence.cy.js`.
- [x] 16. Run `npm run test && npm run lint && npm run typecheck && npm run build`.

## Outputs

- Files created: `backend/src/Gones.Infrastructure/Identity/RefreshCookieOptions.cs`, `backend/tests/Gones.IntegrationTests/RefreshCookieTests.cs`, `src/app/auth/auth.service.bootstrap.test.ts`, `cypress/e2e/auth-session-persistence.cy.js`.
- Files touched: `backend/src/Gones.Api/Identity/RefreshSessionService.cs`, `backend/src/Gones.Api/Identity/LocalIdentityEndpoints.cs`, `backend/src/Gones.Api/Identity/ExternalOAuthEndpoints.cs`, `backend/src/Gones.Api/Program.cs`, `backend/src/Gones.Api/appsettings.Development.json`, `.env.example`, `src/app/auth/auth.service.ts`.
- Public API / behavior change: refresh cookie attributes are now configuration-driven; `AuthService.bootstrapFailed` is new.
- Migrate / config: two new configuration keys, defaulted so existing deployments behave exactly as before.

## Validation

- [x] `npm run backend:test` passes
- [x] `npm run test` passes
- [x] `npm run lint && npm run typecheck && npm run build` pass
- [x] `npm run cy:run -- --spec cypress/e2e/auth-session-persistence.cy.js` passes
- [x] manual check: `npm run dev`, sign in at `http://127.0.0.1:4200/login`, hard-reload, header still shows the username
- [x] app functional — anonymous browsing unaffected (no cookie, `bootstrap()` clears silently)
- [x] commit msg draft: `fix(auth): keep the session across reloads with a configurable refresh cookie`
