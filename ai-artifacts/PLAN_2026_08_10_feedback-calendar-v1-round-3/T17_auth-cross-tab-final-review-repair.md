# T17: Auth cross-tab final-review repair

**Plan:** `./ai-artifacts/PLAN_2026_08_10_feedback-calendar-v1-round-3.md`
**Depends:** T16
**Commit outcome:** Remove auth-lock re-entry deadlocks and make cache/session invalidation cross-tab safe, including in-flight stale reads and browsers without Web Locks.

## Context (self-contained)

T16 (`a3abb93`) closed its original findings and passed 917 Vitest tests + 88 Cypress tests. Final independent correctness/security review found three blockers in the new transition design. This ticket is the one allowed fix worker for that review.

Read-only reviewer inputs:

- `.tmp/t16-final-correctness.md`
- `.tmp/t16-final-security.md`
- `.tmp/t16-final-tests.md`

## Hard boundaries

- No protected HTTP request may hold a non-reentrant auth Web Lock while its 401 interceptor can call `refreshAccessToken()` and reacquire that lock.
- Teardown started first must complete purge before later session establishment publishes token/profile/private cache state.
- Other-tab in-flight user-A reads must become ineligible to read/write cache as soon as teardown invalidates A, even though that tab's in-memory profile signal remains A.
- Account deletion that fails server-side must not pre-supersede transitions, clear auth or require purge. Successful deletion must invalidate + purge before later session establishment.
- Purge failure stays marked cross-tab and blocks/retries before later establishment. Primary server error remains observable.
- Browser without `navigator.locks` cannot safely coordinate auth establishment cross-tab. Fail closed for **new session establishment** rather than claim per-tab Promise serialization. Local teardown/purge must still run and cross-tab-invalidate in-flight cache work.
- Catalog remains server → browser only. Browser-local League/Live/player/archetype data never syncs.
- No `backend/**` C# change, runtime dependency, deploy/release change, force push or push to `main`.
- Do not kill existing `ng serve` on `127.0.0.1:4200`.

## Approved design constraints

Exact implementation may vary, but must satisfy these ordering rules:

1. Use origin-wide Web Lock only around short state transitions, auth endpoints that cannot interceptor-refresh, purge, and account DELETE only if that request is explicitly non-refreshable. Never hold it around `meGET`, `mePATCH`, email-change or catalog HTTP that can enter interceptor refresh.
2. Add cross-tab session generation/epoch stored as non-domain coordination metadata. Teardown invalidation increments it before purge; cache reads capture and re-check it before/after async fallback lookup and before write. A stale other-tab profile alone is insufficient authority.
3. Successful account deletion performs invalidate + purge. Failed deletion changes no generation/profile/token. If DELETE is held under Web Lock, interceptor must not refresh that exact destructive request, preventing lock re-entry.
4. Session establishment checks coordination support before network, captures generation, performs network outside dangerous lock as needed, then re-enters lock to ensure pending purge is complete and generation/session guard still valid before publishing. A teardown that supersedes an earlier establishment makes it reject without stale publication.
5. Without Web Locks, new session establishment/bootstrap/refresh must fail closed before publishing. Teardown/clear still invalidates generation, marks purge required and performs local purge. Do not retain misleading per-instance `transitionTail` as cross-tab safety.
6. localStorage containment proof must allow only exact coordination keys/operations, not whole-file blanket exemption.

## Required fixes

### R1 — remove 401 refresh lock re-entry

- [x] Add integration-style interceptor test with real `authSessionInterceptor` wiring: protected profile update returns 401, refresh succeeds, replay succeeds; operation settles (no lock deadlock) and publishes updated profile.
- [x] Cover email-change similarly or prove same unlocked helper path.
- [x] Remove auth Web Lock from around protected HTTP requests that can refresh. Short pre/post critical sections may use lock.
- [x] Account DELETE under lock must be explicitly excluded from interceptor refresh; add exact interceptor test proving 401 DELETE rejects once without nested refresh.
- [x] Catalog fetch/adoption may not hold auth lock while network is pending; existing inside-deck-lock current-session write guard remains.

### R2 — safe establishment/teardown ordering

- [x] Tests: teardown starts first + purge unresolved; later B establishment cannot publish/call private follow-up until purge resolves.
- [x] Tests: establishment starts first; later teardown invalidates it before final publish; stale establishment rejects and cannot restore token/profile.
- [x] Tests: successful account DELETE blocks later B establishment until purge; failed DELETE leaves A authenticated and does not invalidate/purge.
- [x] Preserve refresh/logout primary errors when purge also fails; successful deletion must not be reported failed solely from purge failure.

### R3 — cross-tab epoch blocks stale cache recreation

- [x] Add cross-tab/session-generation seam accessible to `ServerReadCacheService` without creating an injection cycle. A cache scope token must include current profile id plus current cross-tab generation and reject while purge-required marker exists.
- [x] Red test: tab B starts user-A server read; tab A invalidates + purges; delayed tab-B response resolves after purge. Cache DB/store must remain absent/empty; old A row is not recreated.
- [x] Red rejected-read variant: delayed fallback lookup spanning generation change returns original server error, never stale row.
- [x] Existing same-tab before/after key guards remain.

### R4 — no-Web-Locks fail closed

- [x] Browser-mode test with `navigator.locks` absent: login/OAuth/bootstrap/refresh cannot publish token/profile and returns explicit coordination-unavailable failure. No auth network call should start when detectable at boundary.
- [x] Same mode: logout/clear still clear in-memory auth, increment cross-tab generation, set purge marker, await local resets and preserve primary error semantics.
- [x] Tests use a shared fake Web Locks implementation for normal auth flows. Do not hide missing production coordination with per-instance Promise queue.

### R5 — exact containment proof

- [x] Replace whole-file localStorage exemption with exact source assertions: only named auth coordination keys (`privatePurgeRequired`, session generation/epoch) and their marker/generation get/set/remove operations are permitted. Any additional `localStorage.setItem` in `auth.service.ts` must fail containment.
- [x] Coordination values contain no profile/domain data.

## Validation

- [x] Focused auth/interceptor/session/cache/boundary tests green.
- [x] `npm run test` green.
- [x] `npm run lint` green.
- [x] `npm run typecheck` green.
- [x] `npm run build` green.
- [x] `npm run acceptance:matrix` green.
- [x] `node scripts/seed-auth-e2e.mjs`; wrapped full Cypress 21 specs / 88 tests green.
- [x] Backend exempt: no `backend/**` diff; cite T15 serialized 581/581.
- [x] `git diff --check a3abb93..HEAD` green; no secrets/env/temp/Cypress/generated artifacts staged.
- [x] Add/update only `## T17 auth-cross-tab-final-review-repair` in manual checklist; real multi-tab/browser checks stay unchecked.
- [x] Commit exact subject `fix(auth): prevent lock reentry and invalidate cross-tab cache`; push current feature branch.

## Residuals

- T12 local multi-League rename remains sequential/non-atomic with truthful partial-failure state.
- Real-browser multi-tab behavior remains manual evidence in addition to deterministic shared-lock/generation tests.
- Privacy/history cleanup remains parent-owned after acceptance. `origin/main` itself retains donor-derived sample identities in history; worker must not rewrite/delete branches.
