# T1: Fix Ctrl-F5 Session Loss

**Plan:** `./ai_artefacts/PLAN_2026_08_13_feedback-calendar-v1-implementation.md`  
**Depends:** none  
**Commit outcome:** Ctrl-F5 at `http://127.0.0.1:4200` restores same signed-in profile from 30-day HttpOnly refresh cookie; no JS-readable auth secret exists.

## Context (self-contained)

- Goal: session survives normal reload + forced reload without reconnecting.
- This slice: reproduce reported manual Ctrl-F5 loss, fix only failing auth layer.
- Out of scope here: storing access/refresh token, email, pwd in `localStorage`/`sessionStorage`; changing release topology; unrelated auth UX.
- Assumptions in force: app local/unreleased. Existing Electron `cy.reload()` + temporary `cy.reload(true)` both pass 2/2. Nix-installed Brave is current default browser, but Cypress 15 cannot identify its binary by path. Manual Brave Ctrl-F5 report still fails → DevTools trace required before code change.

## Requirements

- Refresh session absolute lifetime stays 30 days; idle lifetime remains existing 7 days unless failing evidence proves bug there.
- Cookie stays `gones_refresh`, HttpOnly, path `/api/auth`, host-only, `SameSite=Lax`, `Secure=false` for local HTTP.
- Access token stays memory-only.
- Startup still awaits `AuthService.bootstrap()`; guards still await `whenSessionReady()`.
- Logout/account deletion still revoke + expire cookie.

## Inputs

- `src/app/auth/auth.service.ts` — `AuthService.bootstrap()`, `restoreSession()`, `establishProfile()`.
- `src/app/auth/auth-session-coordination.service.ts` — Web Locks/local generation metadata.
- `src/app/api/api-boundary.ts` — `withCredentials: true`.
- `backend/src/Gones.Api/Identity/RefreshSessionService.cs` — `RefreshCookie`.
- `backend/src/Gones.Domain/Identity/RefreshSession.cs` — `AbsoluteLifetime`, `IdleLifetime`.
- `compose.yaml` — local cookie env.
- `cypress/e2e/auth-session-persistence.cy.js` — existing normal reload proof.
- **From Depends:** none.

## TDD

1. **Red** — extend browser test first. Test name: `keeps the user signed in after Ctrl-F5-equivalent forced reload`. Assert cookie exists before reload; refresh req after `cy.reload(true)` returns 200; same profile remains; no `/login` link; storage lacks `accessToken`/refresh token. Electron is automation evidence. Brave manual DevTools trace is required because Cypress cannot launch current Nix Brave path.
2. **Green** — inspect failing manual trace: login `Set-Cookie`; browser cookie attrs; forced-reload `POST /api/auth/refresh`; console; profile req. Fix only proven layer. If Web Locks/cache coordination fails before refresh, change coordination fallback without persisting identity data. If cookie omitted, correct local host/config. If refresh 401, correct rotation/session flow.
3. **Refactor** — keep one bootstrap flight + one refresh flight. No speculative cookie rewrite when red test/manual trace is green.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| forced reload | login `cypress.user@example.test`, `cy.reload(true)` | refresh 200; profile visible |
| cookie attrs | login response/local browser cookie | HttpOnly, host-only, `/api/auth`, persistent, non-Secure local HTTP |
| no secret storage | local/session storage after reload | no token/credential values |
| failed restore | no cookie | signed-out, bootstrap settled |
| logout | valid cookie then logout/reload | refresh rejected; signed-out |

## Impl steps

- [x] 1. Add forced-reload case + cookie/storage assertions in `cypress/e2e/auth-session-persistence.cy.js`; criterion: named `keeps the user signed in after Ctrl-F5-equivalent forced reload` case asserts pre-reload cookie, refresh 200, same profile, no login link, no token/credential storage.
- [x] 2. Reproduce manually in same browser/profile user used: `npm run dev`, login, DevTools Preserve log, Ctrl-F5; criterion: supplied Brave trace shows app `http://localhost:4200`, API `http://127.0.0.1:5080`, login/refresh `credentials: omit`, ignored `Set-Cookie`, signed-out UI after Ctrl-F5.
- [x] 3. Record failing boundary in test: cookie storage, refresh request, rotation, coordination, or profile establishment; criterion: supplied trace records missing cross-site credential/cookie boundary before refresh rotation or profile establishment.
- [x] 4. Add smallest matching regression in `cypress/e2e/auth-session-persistence.cy.js`; criterion: forced-reload case runs from `http://localhost:4200` while configured API authority starts at `http://127.0.0.1:5080`, failing before host-boundary fix then passing after it.
- [x] 5. Change only failing credential-boundary impl; criterion: local loopback request host matches page host while port/path stay unchanged, avoiding cross-site cookie use without weakening cookie attrs.
- [x] 6. Keep `src/app/api/api-boundary.ts` `withCredentials: true`; criterion: boundary regression asserts credentialed clone behavior remains enabled.
- [x] 7. Run focused + full compile gates; criterion: every feasible command under Validation exits 0, with runtime/manual limits recorded.

## Outputs

- `cypress/e2e/auth-session-persistence.cy.js` updated.
- One proven auth impl path fixed; no mandatory speculative file.
- 30-day cookie session contract executable.

## Validation

- [x] `node scripts/seed-auth-e2e.mjs` → criterion: exit 0.
- [x] `npx cypress run --spec cypress/e2e/auth-session-persistence.cy.js --browser electron` → criterion: exit 0 with 3+ passing, including forced reload.
- [x] `npx vitest run src/app/auth/auth.service.bootstrap.test.ts src/app/auth/auth.interceptor.test.ts src/app/auth/auth-guards.test.ts` → criterion: exit 0.
- [x] `dotnet test backend/Gones.sln --configuration Release --filter FullyQualifiedName~RefreshCookieTests` → criterion: exit 0.
- [x] `npm run typecheck && npm run build` → criterion: both commands exit 0.
- [x] manual check: chosen browser login → Ctrl-F5 → criterion: same profile, no reconnect; supplied failing Brave trace plus automated forced reload may cover local evidence, with residual Brave recheck recorded if browser cannot launch.
- [x] app functional — criterion: auth/public routes load after reload in forced-reload Cypress spec.
- [x] commit msg draft: `fix(auth): preserve session across forced reload` → criterion: local commit subject matches exactly.
