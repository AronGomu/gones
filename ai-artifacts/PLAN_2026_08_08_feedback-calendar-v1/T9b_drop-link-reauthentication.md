# T9b: Drop the reauthentication requirement from external identity link/unlink

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T8
**Commit outcome:** Linking and unlinking an OAuth provider no longer demands the current password (or a 5-minute-fresh token); the request bodies, the client parameter and the UI password field are gone, and the remaining safeguards (session revocation, last-login-method guard, audit, rate limit) are proved intact.

## Context (self-contained)

- Goal: land the whole `feedback.md` list on Gones Calendar V1. This ticket covers Profile §10 —
  *"In « Comptes liés » : remove password requirement to link account. Remove input and conditions."*
- **Why this ticket exists (parent-added, like T6b).** T9 step 18 removes the password input and calls
  `startLink(provider)` / `unlink(provider)` with no password. The backend **hard-requires** it:
  `ExternalOAuthService.RequireReauthenticationAsync` (`backend/src/Gones.Api/Identity/ExternalOAuthEndpoints.cs:280-299`)
  throws `400 validation_failed` on `currentPassword` for any user who has a local password, and falls back to
  "token issued within the last 5 minutes" for password-less users. Shipping T9 alone would leave every
  password-holding user unable to link or unlink at all. The server side must go first.
- This slice is **backend + generated client + the two call sites**, nothing else. It deliberately performs
  T9 step 18's frontend edit (deleting the `linkPassword` field and its row) because leaving an unused field
  behind fails lint. T9 then only has to verify that step.
- Out of scope here: the rest of the account form (labels, dirty gate, dialog, email section) — that is T9.

## Requirements

- `POST /api/users/me/external-identities/{provider}/start` succeeds for an authenticated user with **no request body**.
- `DELETE /api/users/me/external-identities/{provider}` succeeds for an authenticated user with **no request body**.
- Neither endpoint accepts or reads `currentPassword` any more; the request DTOs are deleted, so the OpenAPI
  document and the regenerated TypeScript client no longer carry them.
- These safeguards stay and are proved by test: `AuthorizationPolicies.User` authorization, `AuthRateLimiting.IpPolicy`,
  `LastLoginMethodException` when unlinking the only remaining login method, `RevokeAllForIdentityChangeAsync` on both
  link-callback and unlink, and the `auth.external_identity.*` audit records with their existing redaction.
- `src/app/auth/auth.service.ts` exposes `startLink(provider: string)` and `unlink(provider: string)` — no optional
  password parameter.
- The "Comptes liés" card in `src/app/features/settings/account-settings.component.ts` has no password label,
  no password input and no `linkPassword` field.
- ADR `docs/adr/0027-external-identity-link-without-reauthentication.md` records the decision and the residual risk.

## Inputs

- `backend/src/Gones.Api/Identity/ExternalOAuthEndpoints.cs` — the whole surface lives in this one file:
  - lines 54-67, route registration:
    ```
    var identities = app.MapGroup("/api/users/me/external-identities").RequireAuthorization(AuthorizationPolicies.User);
    identities.MapGet("/", ListAsync).Produces<IReadOnlyList<ExternalIdentityResponse>>();
    identities.MapPost("/{provider}/start", LinkStartAsync)
        .RequireRateLimiting(AuthRateLimiting.IpPolicy)
        .AddEndpointFilter<DataAnnotationsValidationFilter>()
        …
    identities.MapDelete("/{provider}", UnlinkAsync)
        .RequireRateLimiting(AuthRateLimiting.IpPolicy)
        .AddEndpointFilter<DataAnnotationsValidationFilter>()
        …
    ```
  - lines 83-98, `LinkStartAsync(string provider, LinkExternalIdentityRequest request, ClaimsPrincipal principal, …)`
    calls `await service.RequireReauthenticationAsync(userId, request.CurrentPassword, principal, cancellationToken);`
    before `service.StartAsync(provider, OAuthAttemptPurpose.Link, userId, …)`.
  - lines 217-225, `UnlinkAsync(string provider, [FromBody] UnlinkExternalIdentityRequest request, ClaimsPrincipal principal, ExternalOAuthService service, …)`
    forwards `request.CurrentPassword` to `service.UnlinkAsync(...)`.
  - lines 280-299, `public async Task RequireReauthenticationAsync(Guid userId, string? currentPassword, ClaimsPrincipal principal, CancellationToken cancellationToken)` —
    has-password branch demands a valid `currentPassword`, else branch demands `HasRecentAuthentication`.
  - lines 453-473, `public async Task UnlinkAsync(Guid userId, string provider, string? currentPassword, ClaimsPrincipal principal, CancellationToken cancellationToken)` —
    row lock, `LastLoginMethodException` when `!hasPassword && identities.Count == 1`, then
    `RequireReauthenticationAsync`, then remove + `sessions.RevokeAllForIdentityChangeAsync` + audit.
  - lines 534-541, `private static bool HasRecentAuthentication(ClaimsPrincipal principal, Instant now)` — `iat` within 5 minutes.
    **Only** caller is `RequireReauthenticationAsync` line 294.
  - lines 589-590, `internal sealed record LinkExternalIdentityRequest([property: StringLength(128)] string? CurrentPassword);`
    and `internal sealed record UnlinkExternalIdentityRequest([property: StringLength(128)] string? CurrentPassword);`
  - `RequireReauthenticationAsync` has exactly **two** call sites (lines 94 and 468) and nothing outside this file
    references it, `LinkExternalIdentityRequest` or `UnlinkExternalIdentityRequest`. Verify with
    `grep -rn "RequireReauthenticationAsync\|LinkExternalIdentityRequest\|UnlinkExternalIdentityRequest\|HasRecentAuthentication" backend/` before deleting.
- `backend/tests/Gones.IntegrationTests/OAuthApiTests.cs` — the specs that pin the old behaviour:
  - `Authenticated_user_can_link_then_unlink_with_reauth_and_sessions_are_revoked` (from line ~220): asserts
    `new { currentPassword = "wrong-password-value" }` gives `400`, then links with
    `new { currentPassword = "valid-password-value" }`, then unlinks with the same body, and asserts both refresh
    cookies are dead afterwards and the audit rows are redacted.
  - `Browser_link_callback_redirects_to_profile_with_replacement_session` (from line ~261): link start with
    `new { currentPassword = "valid-password-value" }`.
  - Helpers used: `SendAuthorizedFakeAsync(HttpMethod, path, accessToken, body, scenario, subject, email)` and
    `SendAuthorizedAsync(HttpMethod, path, accessToken, body)`. Check their signatures in the test project before
    editing; if `body` is not nullable, pass `new { }`, otherwise pass `null`.
- `src/app/api/generated/gones-api.ts` — generated, never hand-edited. Current shapes:
  `startPOST(provider: string, body: LinkExternalIdentityRequest): Observable<OAuthStartResponse>` (interface line 235, impl 3611)
  and `externalIdentities(provider: string, body: UnlinkExternalIdentityRequest): Observable<void>` (interface 239, impl 3680).
  Regenerate with `npm run api:generate`; `npm run api:check` must then report no drift. The generator needs the API
  project to build (`scripts/generate-api.mjs`).
- `src/app/auth/auth.service.ts:134-140`:
  ```ts
  async startLink(provider: string, currentPassword?: string): Promise<string> {
    return (await firstValueFrom(this.client.startPOST(provider, { currentPassword }))).authorizationUrl;
  }
  unlink(provider: string, currentPassword?: string): Promise<void> {
    return firstValueFrom(this.client.externalIdentities(provider, { currentPassword }));
  }
  ```
- `src/app/features/settings/account-settings.component.ts` (created by T8 as a verbatim move of the old profile page):
  - line 62 — `<label for="link-password" data-cy="account-link-password-label">{{ i18n.t('profile.currentPasswordOptional') }}</label><input id="link-password" data-cy="account-link-password" type="password" autocomplete="current-password" [(ngModel)]="linkPassword">`
  - line 111 — `linkPassword = '';`
  - line 135 — `await this.run(this.identityPending, async () => { window.location.assign(await this.auth.startLink(provider, this.linkPassword || undefined)); });`
  - line 139 — `await this.run(this.identityPending, async () => { await this.auth.unlink(provider, this.linkPassword || undefined); await this.loadIdentities(); this.status.set(this.i18n.t('profile.unlinked')); });`
  - The file is already out of `PENDING_DATA_CY_RETROFIT`, so the `data-cy` coverage test scans it. Deleting the two
    `data-cy` attributes above is fine; do not leave an element without one.
- `docs/adr/` — existing numbering runs to `0026-structured-profile-location-and-birth-date.md`. Copy the front-matter
  and section layout of `docs/adr/0025-hard-account-deletion.md`.
- Backend build/test: `npm run backend:test`. `DOTNET_ROOT` must be set on this host.
- **From Depends (T8):** the account component lives at `src/app/features/settings/account-settings.component.ts`,
  routed at `settings/account` behind `userGuard`, selectors prefixed `account-`.

## TDD

1. **Red** — rewrite the two `OAuthApiTests` specs to send **no** body and expect success, and add
   `Link_start_rejects_an_anonymous_caller`; run `npm run backend:test` and capture the failure (link start returns
   `400 validation_failed` on `currentPassword` because the endpoint still reauthenticates).
2. **Green** — delete the reauthentication call sites, the request records and the now-dead helpers; re-run to green.
3. **Refactor** — regenerate the client, drop the frontend parameter and the password row, re-run the frontend suite.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `Authenticated_user_can_link_then_unlink_without_a_password_and_sessions_are_revoked` (rename of the existing spec) | link start with no body, complete the fake callback, then `DELETE` with no body | `200` on start, `204` on the callback and on the delete; both old refresh cookies then `401`; audit rows still redacted |
| `Browser_link_callback_redirects_to_profile_with_replacement_session` (edited) | link start with no body | unchanged redirect assertions still pass |
| `Link_start_rejects_an_anonymous_caller` (new) | `POST /api/users/me/external-identities/google/start` with no `Authorization` header | `401` |
| `Unlink_still_refuses_the_last_login_method` (new, or extend the existing coverage if a spec already asserts `LastLoginMethodException`) | OAuth-only account (no local password) unlinking its single identity | `409` / the existing `last_login_method` problem code, identity still present |
| `link sends no password` (frontend, T9 owns the component spec) | `auth.startLink('google')` | `client.startPOST` called with `('google')` only |

Run: `npm run backend:test` then `npm run test -- auth.service`

## Impl steps

- [x] 1. Confirm the call-site inventory before touching anything — validate: `grep -rn "RequireReauthenticationAsync\|LinkExternalIdentityRequest\|UnlinkExternalIdentityRequest\|HasRecentAuthentication" backend/` lists only `ExternalOAuthEndpoints.cs` (and test files); paste the output into the report.
- [x] 2. **Red:** edit `backend/tests/Gones.IntegrationTests/OAuthApiTests.cs` — rename `Authenticated_user_can_link_then_unlink_with_reauth_and_sessions_are_revoked` to `Authenticated_user_can_link_then_unlink_without_a_password_and_sessions_are_revoked`, delete the `badReauth` wrong-password block, and send no body on the link start and on the unlink. Edit `Browser_link_callback_redirects_to_profile_with_replacement_session` the same way — validate: `npm run backend:test` fails with a `400` on link start.
- [x] 3. **Red:** add `Link_start_rejects_an_anonymous_caller` and the last-login-method unlink assertion from the Test plan — validate: they appear in the failing/passing output of `npm run backend:test`.
- [x] 4. **Green:** in `LinkStartAsync` delete the `LinkExternalIdentityRequest request` parameter and the `await service.RequireReauthenticationAsync(...)` line — validate: `backend/src/Gones.Api/Identity/ExternalOAuthEndpoints.cs` no longer matches `RequireReauthenticationAsync` inside `LinkStartAsync`.
- [x] 5. **Green:** in `UnlinkAsync` (endpoint) delete the `[FromBody] UnlinkExternalIdentityRequest request` parameter and pass no password to `service.UnlinkAsync`; in `ExternalOAuthService.UnlinkAsync` delete the `string? currentPassword` and `ClaimsPrincipal principal` parameters and the `RequireReauthenticationAsync` call, keeping the row lock, the `LastLoginMethodException` guard, the removal, `RevokeAllForIdentityChangeAsync`, the audit row and the transaction commit in that order — validate: the method body still contains `LastLoginMethodException`, `RevokeAllForIdentityChangeAsync` and `NewAudit`.
- [x] 6. **Green:** delete `RequireReauthenticationAsync` and `HasRecentAuthentication` — validate: `grep -rn "RequireReauthenticationAsync\|HasRecentAuthentication" backend/src/` returns nothing.
- [x] 7. **Green:** delete the `LinkExternalIdentityRequest` and `UnlinkExternalIdentityRequest` records; leave the route registrations otherwise untouched (rate limit, authorization, `Produces`, and the `DataAnnotationsValidationFilter` registration all stay) — validate: `grep -rn "ExternalIdentityRequest" backend/src/` returns nothing.
- [x] 8. Run `npm run backend:test` — validate: green, and the renamed/new specs are in the passing list.
- [x] 9. Regenerate the API client: `npm run api:generate` — validate: `git diff --stat src/app/api/generated/gones-api.ts` shows the two signatures lost their body parameter and the two request interfaces are gone; then `npm run api:check` reports no drift.
- [x] 10. In `src/app/auth/auth.service.ts` change the two methods to `async startLink(provider: string): Promise<string>` / `unlink(provider: string): Promise<void>` calling `this.client.startPOST(provider)` and `this.client.externalIdentities(provider)` — validate: `npm run typecheck` passes.
- [x] 11. In `src/app/features/settings/account-settings.component.ts` delete the `link-password` label and input (line 62), delete the `linkPassword = '';` field (line 111), and drop the second argument from the `startLink` / `unlink` calls (lines 135 and 139) — validate: `grep -n "linkPassword\|link-password" src/app/features/settings/account-settings.component.ts` returns nothing.
- [x] 12. Check whether `profile.currentPasswordOptional` is still referenced anywhere; if it is not, leave both i18n maps untouched and record it as a residual risk for T25 rather than deleting the key here — validate: `grep -rn "currentPasswordOptional" src/` output pasted in the report.
- [x] 13. Write `docs/adr/0027-external-identity-link-without-reauthentication.md` following the shape of `docs/adr/0025-hard-account-deletion.md`: context (feedback Profile §10), decision (link/unlink require only a valid access token), consequences — **residual risk: a stolen access token can now attach an attacker-controlled provider identity or detach one without proving the password** — and the compensating controls that remain (short-lived access token, `AuthRateLimiting.IpPolicy`, full session revocation on both link callback and unlink, `LastLoginMethodException`, audit trail). Note that restoring a step-up check later should use a re-auth ceremony, not a password field in the settings form — validate: the file exists and names all five remaining controls.
- [x] 14. Add the ADR to any ADR index that lists the others — validate: `grep -rn "0026-structured-profile" docs/ | grep -v "^docs/adr/0026"` shows every index that must also list 0027 (if that returns nothing, no index exists and this step is a no-op; say so in the report).
- [x] 15. Run `npm run test && npm run lint && npm run typecheck && npm run build` — validate: all four green, output captured.
- [x] 16. Run the data-cy gate — validate: `npm run test -- data-cy-coverage` green with `account-settings.component.ts` still absent from `PENDING_DATA_CY_RETROFIT`.

## Outputs

- Files created: `docs/adr/0027-external-identity-link-without-reauthentication.md`.
- Files touched: `backend/src/Gones.Api/Identity/ExternalOAuthEndpoints.cs`, `backend/tests/Gones.IntegrationTests/OAuthApiTests.cs`, `src/app/api/generated/gones-api.ts`, `src/app/auth/auth.service.ts`, `src/app/features/settings/account-settings.component.ts`.
- Public API / behavior change: both external-identity endpoints lose their request body; linking and unlinking need only a valid access token.
- Migrate / config: none.

## Validation

- [x] `npm run backend:test` passes
- [x] `npm run api:check` reports no drift
- [x] `npm run test && npm run lint && npm run typecheck && npm run build` pass
- [x] `grep -rn "RequireReauthenticationAsync\|ExternalIdentityRequest\|linkPassword" backend/src/ src/` returns nothing
- [x] app functional — the account page still lists linked providers and both buttons compile and fire
- [x] commit msg draft: `feat(auth): link and unlink providers without re-entering the password`
