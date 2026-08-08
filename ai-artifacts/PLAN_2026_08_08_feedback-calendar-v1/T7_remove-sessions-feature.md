# T7: Remove the sessions feature

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T1
**Commit outcome:** The Sessions page, its route, its two API endpoints and their client methods are gone; sign-out and sign-out-everywhere still work.

## Context (self-contained)

- Goal: land the whole `feedback.md` list on Gones Calendar V1. This ticket is the "Sessions page — Remove feature" line, taken to the backend as well (user answer).
- This slice: pure removal. Nothing replaces it.
- Out of scope here: the settings/account merge (T8) — it will simply find no sessions link to migrate.
- Assumptions in force: `POST /api/auth/logout` and `POST /api/auth/logout-all` stay; only session *listing* and *individual revocation* go. `RefreshSessionService.ListAsync` / `RevokeAsync` become unused and are deleted with their tests.

## Requirements

- `src/app/auth/sessions.component.ts` and its route `profile/sessions` no longer exist.
- No link to `/profile/sessions` remains anywhere in `src/`.
- `GET /api/users/me/sessions` and `DELETE /api/users/me/sessions/{id}` return `404` (route removed).
- `RefreshSessionResponse`, `RefreshSessionService.ListAsync` and `RefreshSessionService.RevokeAsync` are deleted along with the tests that only covered them.
- `src/app/api/generated/gones-api.ts` is regenerated and no longer exports `sessionsAll` / `sessions`.
- All `sessions.*` i18n keys are removed from BOTH maps.

## Inputs

- `src/app/auth/sessions.component.ts` — 68 lines, `SessionsComponent`, uses `auth.listSessions()`, `auth.revokeSession(id)`, `auth.logout(true)`; template selectors `[data-cy=session-row]`, `[data-cy=logout-all]`.
- `src/app/app.routes.ts:13` — `{ path: 'profile/sessions', canActivate: [userGuard], loadComponent: () => import('./auth/sessions.component').then((m) => m.SessionsComponent) }` inside `const authRoutes: Routes = [...]`.
- `src/app/auth/profile.component.ts:17` — the header contains `<a mat-stroked-button routerLink="/profile/sessions">{{ i18n.t('profile.sessions') }}</a>`; remove that anchor.
- `src/app/auth/auth.service.ts:120-121` — `listSessions(): Promise<RefreshSessionResponse[]> { return firstValueFrom(this.client.sessionsAll()); }` and `revokeSession(id: string): Promise<void> { return firstValueFrom(this.client.sessions(id)); }`; also the `RefreshSessionResponse` import at line 16.
- `src/app/auth/auth.service.ts:85-91` — `logout(all = false)` calls `this.client.logoutAll()` when `all` is true; keep it, `logout(true)` is still reachable from T8's account page.
- `backend/src/Gones.Api/Identity/LocalIdentityEndpoints.cs:60-63` — the two registrations to delete:
  ```
  users.MapGet("/me/sessions", GetSessionsAsync).Produces<IReadOnlyList<RefreshSessionResponse>>();
  users.MapDelete("/me/sessions/{id:guid}", DeleteSessionAsync)
      .Produces(StatusCodes.Status204NoContent)
      .ProducesProblem(StatusCodes.Status404NotFound);
  ```
- `backend/src/Gones.Api/Identity/LocalIdentityEndpoints.cs:235-261` — the handlers `GetSessionsAsync` and `DeleteSessionAsync`.
- `backend/src/Gones.Api/Identity/LocalIdentityEndpoints.cs:468-475` — `internal sealed record RefreshSessionResponse(Guid Id, string DeviceLabel, Instant CreatedAt, Instant LastUsedAt, Instant IdleExpiresAt, Instant AbsoluteExpiresAt);`
- `backend/src/Gones.Api/Identity/RefreshSessionService.cs` — `ListAsync(Guid userId, string securityStamp, CancellationToken)` and `RevokeAsync(Guid userId, Guid sessionId, CancellationToken)`; `RevokeAllAsync` and `RevokeCurrentAsync` and `RotateAsync` and `CreateAsync` all stay.
- `src/app/i18n/messages.ts` — `sessions.help`, `sessions.lastUsed`, `sessions.expires`, `sessions.revoke`, `sessions.revoked`, `sessions.empty`, `sessions.logoutAll`, `sessions.loadFailed` and `profile.sessions` in BOTH the `en` map (from line 5) and the `fr` map (from line 1000). `MessageKey` is `keyof typeof en`, so deleting from `en` alone breaks the build — delete from both.
- `ops/acceptance-matrix.json` — search for any row whose `evidence[].target` mentions sessions; if one exists it must be repointed or its `detail` adjusted, since `npm run acceptance:matrix` refuses evidence that no longer runs.
- Regeneration: `npm run api:generate` (Postgres must be up: `docker compose up -d postgres`); `npm run api:check` verifies drift.
- **From Depends (T1):** `PENDING_DATA_CY_RETROFIT` in `src/app/shared/data-cy-coverage.test.ts` contains `src/app/auth/sessions.component.ts`; deleting the component means deleting that allowlist entry too, otherwise T1's "allowlist holds only files that still exist" test fails.

## TDD

1. **Red** — delete `src/app/auth/sessions.component.ts` and its allowlist entry, then run `npm run test`; the `data-cy-coverage` existence test and the route test are the failing signal that the removal is incomplete. Add `Sessions_endpoints_are_gone` to the backend integration tests; it fails while the routes exist.
2. **Green** — remove the routes, handlers, service methods, service wrappers, i18n keys and regenerate the client.
3. **Refactor** — none.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `Sessions_list_endpoint_is_gone` | `GET /api/users/me/sessions` with a valid token | `404` |
| `Sessions_revoke_endpoint_is_gone` | `DELETE /api/users/me/sessions/{guid}` with a valid token | `404` |
| `Logout_all_still_works` | `POST /api/auth/logout-all` | `204`, and a subsequent refresh with the old cookie returns `401` |
| `no route to profile/sessions` | `buildRoutes({authV1:true, adminV1:true}).map(r => r.path)` | does not contain `'profile/sessions'` |
| `no source references the sessions page` | grep `src/` for `profile/sessions` and `sessions.component` | zero hits |
| `allowlist holds only files that still exist` | T1's existence test | green |

Run: `npm run backend:test` and `npm run test -- data-mode-routes data-cy-coverage`

## Impl steps

- [ ] 1. `git rm src/app/auth/sessions.component.ts`.
- [ ] 2. Delete the `profile/sessions` route object from `authRoutes` in `src/app/app.routes.ts`.
- [ ] 3. Delete the `/profile/sessions` anchor from the header of `src/app/auth/profile.component.ts:17`.
- [ ] 4. Delete `listSessions()` and `revokeSession()` from `src/app/auth/auth.service.ts` and drop `RefreshSessionResponse` from the import list at the top of that file.
- [ ] 5. Delete `src/app/auth/sessions.component.ts` from `PENDING_DATA_CY_RETROFIT` in `src/app/shared/data-cy-coverage.test.ts`.
- [ ] 6. Delete the nine i18n keys (`sessions.*` and `profile.sessions`) from BOTH the `en` and `fr` maps in `src/app/i18n/messages.ts`.
- [ ] 7. Add an assertion to `src/app/data-mode-routes.test.ts`: `expect(paths(allCapabilities)).not.toContain('profile/sessions');`
- [ ] 8. In `backend/src/Gones.Api/Identity/LocalIdentityEndpoints.cs`, delete the two `MapGet`/`MapDelete` registrations at lines 60-63.
- [ ] 9. Delete the `GetSessionsAsync` and `DeleteSessionAsync` handlers (lines 235-261).
- [ ] 10. Delete the `RefreshSessionResponse` record (lines 468-475).
- [ ] 11. Delete `ListAsync` and `RevokeAsync` from `backend/src/Gones.Api/Identity/RefreshSessionService.cs`; keep `CreateAsync`, `RotateAsync`, `RevokeCurrentAsync`, `RevokeAllAsync`.
- [ ] 12. Run `dotnet build backend/Gones.sln` and delete every test that no longer compiles because it only covered the removed methods; `grep -rn "ListAsync\|RevokeAsync\|RefreshSessionResponse" backend/tests --include=*.cs`.
- [ ] 13. Add `Sessions_list_endpoint_is_gone`, `Sessions_revoke_endpoint_is_gone` and `Logout_all_still_works` to `backend/tests/Gones.IntegrationTests/LocalIdentityApiTests.cs`.
- [ ] 14. Run `npm run backend:test`.
- [ ] 15. Start Postgres (`docker compose up -d postgres`) and run `npm run api:generate`; confirm `sessionsAll` and `sessions(` no longer appear in `src/app/api/generated/gones-api.ts`.
- [ ] 16. `grep -rn "profile/sessions\|sessions.component\|listSessions\|revokeSession\|sessions\." src/ cypress/ --include=*.ts --include=*.js` and clean every remaining hit, including `cypress/e2e/auth-profile.cy.js`.
- [ ] 17. Check `ops/acceptance-matrix.json` for sessions evidence; repoint or reword any row that referenced it, then run `npm run acceptance:matrix`.
- [ ] 18. Run `npm run test && npm run lint && npm run typecheck && npm run build && npm run api:check`.
- [ ] 19. Run `npm run dev` then `npm run cy:run -- --spec cypress/e2e/auth-profile.cy.js`.

## Outputs

- Files deleted: `src/app/auth/sessions.component.ts`.
- Files touched: `src/app/app.routes.ts`, `src/app/auth/profile.component.ts`, `src/app/auth/auth.service.ts`, `src/app/i18n/messages.ts`, `src/app/shared/data-cy-coverage.test.ts`, `src/app/data-mode-routes.test.ts`, `src/app/api/generated/gones-api.ts`, `backend/src/Gones.Api/Identity/LocalIdentityEndpoints.cs`, `backend/src/Gones.Api/Identity/RefreshSessionService.cs`, `backend/tests/**`, `cypress/e2e/auth-profile.cy.js`, possibly `ops/acceptance-matrix.json`.
- Public API / behavior change: two endpoints removed; `data-cy=session-row` and `data-cy=logout-all` selectors no longer exist.
- Migrate / config: none. Refresh session rows are still created and rotated; only their listing UI is gone.

## Validation

- [ ] `npm run backend:test` passes
- [ ] `npm run test` passes
- [ ] `npm run lint && npm run typecheck && npm run build` pass
- [ ] `npm run api:check` reports no drift
- [ ] `npm run acceptance:matrix` passes
- [ ] `npm run cy:run -- --spec cypress/e2e/auth-profile.cy.js` passes
- [ ] manual check: `/profile/sessions` renders the not-found page; signing out still works
- [ ] app functional — session rotation and logout-all unaffected
- [ ] commit msg draft: `refactor(auth): remove the sessions page and its listing endpoints`
