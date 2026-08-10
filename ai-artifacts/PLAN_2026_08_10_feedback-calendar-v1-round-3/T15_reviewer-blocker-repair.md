# T15: Reviewer blocker repair

**Plan:** `./ai-artifacts/PLAN_2026_08_10_feedback-calendar-v1-round-3.md`
**Depends:** T1–T14
**Commit outcome:** Close final-review security/correctness blockers: no cross-session cache fallback, awaited reliable purge, every auth sign-in adopts catalog only for its current session, demo data is synthetic, dev reset refuses remote Docker, fixture email refs are case-insensitive, runtime regression tests cover local settings and calendar cells.

## Context (self-contained)

Final independent deep review found blockers after T1–T14. This is the one allowed repair worker. Do not read the plan index or sibling ticket files. Reviewer evidence is in these read-only inputs:

- `.tmp/review-correctness.md`
- `.tmp/review-security.md`
- `.tmp/review-scope.md`
- `.tmp/review-tests.md`

The full parent gate before this ticket:

- `npm run test` → 103 files / 862 tests green.
- lint/typecheck/build green.
- backend test first hit a transient Testcontainers host-port collision, retry green: 366 integration + 198 unit + 17 architecture.
- acceptance matrix green: 99/99 non-deferred rows, 24/24 final rows.
- Full Cypress against the currently demo-seeded DB: 81/85; all four failures are auth fixture failures because `scripts/seed-auth-e2e.mjs` had not run after `--env=demo` reset. A base-commit run was no better. For final Cypress, run `node scripts/seed-auth-e2e.mjs` first, then the wrapped suite.

## Assumptions

- Production ship is auto-approved. Plan-defect resolution approved by parent: read/fix `ops/e2e-spec-coverage.test.ts` plus its exact runner path `scripts/full-stack-ci.mjs`, registering `settings-local.cy.js` surgically.

## Hard boundaries

- No browser-local League, Live, player or archetype value may be sent to the server.
- Cache row never merges into a server response. Successful remote read overwrites. Failed remote read may use only the **same currently signed-in user's** row.
- Logout / failed bootstrap / account deletion must finish private cache purge before their completion can expose the next session.
- No force push, history rewrite or remote-branch deletion. The already-pushed history may retain names until a human scrubs it; sanitize branch tip and report this residual explicitly.
- No `backend/**` C# change, release/deploy/compose change, new runtime dependency or production action.
- Do not kill the existing `ng serve` on `127.0.0.1:4200`.

## Inputs

### Cache/session

- `src/app/backend/server-read-cache.service.ts`: cache key `<profile.id>:<resource>`. Success path rechecks session before write; **catch path does not recheck before reading captured key**. Default IndexedDB store memoizes a connection; `clear()` closes its own connection then `deleteDatabase`; `deleteDatabase.onblocked` currently rejects immediately.
- `src/app/auth/session-scope.service.ts`: `register(reset: () => void)` and synchronous `clear()`. Cache registers `() => void this.purge()`, so logout does not await purge.
- `src/app/auth/auth.service.ts`: bootstrap/login adopt server catalog; completeOAuth/verifyOAuthEmail do not. `clear()` currently synchronous. Refresh catch calls it without waiting.
- `src/main.ts`: auth bootstrap initializer currently injects only `AuthService`, so `ServerReadCacheService` may not exist when a failed startup bootstrap calls session clear.
- `src/app/auth/session-catalog-sync.service.ts`: fetches then adopts with no session identity check and must not inject `AuthService` (avoid cycle).
- `src/app/data/league-archive-repository.service.ts`: list signals cached staleness via `serverUnavailable`; detail unwraps cache value.
- `src/app/data/live-tournament-repository.service.ts`: list/detail discard `stale` metadata. ADR 0031 says signed-in cached League + Live reads visibly signal stale data.
- Existing tests: `server-read-cache.service.test.ts`, `session-scope.service.test.ts`, `auth.service*.test.ts`, repository tests, component source tests.

### Seeder

- `scripts/seed-dev-environment.mjs`: before destructive reset, currently trusts active Docker target. On this host `docker context show` is `default`, endpoint `unix:///run/user/1000/docker.sock`.
- Refuse reset unless effective Docker endpoint is local Unix socket. `DOCKER_HOST` / `DOCKER_CONTEXT` resolving to tcp/ssh/npipe/anything non-`unix://` must fail **before** `docker compose down --volumes`. Put a pure endpoint predicate in `scripts/dev-environments.mjs` so Vitest can test it. Error must name the unsafe endpoint plus say local Unix Docker is required.
- `loginAll()` stores tokens by fixture email's original case while validators resolve email refs case-insensitively. Normalize token keys and every email lookup with `String(email).toLowerCase()`.
- `validateEnvironment` has implementation for manifest/account constraints but incomplete negative tests. Add table-driven tests for missing/mismatched name, blank description, non-boolean reset, malformed email, blank username/firstName/lastName, invalid role, weak password, duplicate email/username case-insensitively, non-boolean emailConfirmed.

### Demo privacy

- Final security review found real full names + real scores copied from a private GDrive export in `fixtures/dev-environments/demo/leagues.json`, `live-tournaments.json`, and real names used by demo accounts.
- Replace every donor-derived personal name in **all tracked files at branch tip** with explicit synthetic names (`Demo Player 01`, `Demo Player 02`, … is preferred). Preserve fixture shape, distinct-player counts, pairings, archetypes, scores, league/tournament counts and seeder behavior. Demo account `firstName`/`lastName` values must be synthetic too.
- Remove plan/docs wording that claims tracked fixture contains real names/scores or lists real people. Replace with: donor used only to infer realistic shape; committed values are synthetic. This includes plan index A3, T2/T3 text, fixture README, manual checklist if applicable.
- Run a tracked-tree grep using the names listed in `.tmp/review-security.md` plus every unique player name currently in the fixture before replacement; no donor-derived full name may remain at HEAD.
- Do not rewrite published history. Report: previous pushed commits may still retain removed names; exact human cleanup is remote history scrub / branch deletion after preserving clean HEAD.

### Runtime proof gaps

- `cypress/e2e/public-calendar.cy.js` still contains stale prose saying the grid shows numbers only and never asserts new day-cell events. Update it to assert, in calendar view: matching event link exists inside correct date cell, contains time/title, href is `/calendar/tournaments/<slug>`; filter removes it; overflow is covered with 4 same-day events (3 visible + `+1` count). Do not rely only on source strings.
- Signed-out local settings had only a throwaway Cypress spec. Add committed `cypress/e2e/settings-local.cy.js`: stub every `/api/**` route (except allowed refresh failure) and record unexpected calls; signed out sees both local cards; add archetype and reload; create/seed local League data then rename a player and prove stored League document changed; prove no mutation API call; prove Admin hides local cards. Use existing local DB APIs/fixture techniques; no real backend dependency.
- Default IndexedDB server cache store has no committed runtime test. Add either a real-browser Cypress case or a production-store test using this repo's fake IndexedDB helper. It must open `gones-cache/reads`, round-trip `{key,value,cachedAt}`, purge, confirm DB deletion, then recreate. It must also hold a second connection and prove version-change closure lets deletion finish (no `onblocked` permanent failure).
- Rename/rewrite the stale test named `no tournament entry renders inside a day cell`; it currently checks only absence of retired `.calendar-pill` while new `.public-month-event` is intentionally present.

## Required fixes

### R1 — rejected read cannot cross session

- [x] Add red test: A begins rejecting `read('leagues')`; profile switches to null before rejection; A row exists; result must reject original error and store must not be read.
- [x] Add red test: A begins rejecting read; profile switches to B; A row exists; result must reject original error and never return A value.
- [x] Fix catch path: re-check `this.key(resource) === capturedKey` before cache lookup **and again after async cache lookup**; session mismatch → throw original server error.

### R2 — purge lifetime + bootstrap registration + multi-tab deletion

- [x] Change `SessionScopeService` reset contract to `() => void | Promise<void>` and `clear(): Promise<void>`; await all resets and service-worker purge. Preserve synchronous reset effects, but callers can await completion.
- [x] Change every `AuthService` boundary to await clear: failed bootstrap, logout, account deletion, refresh failure. Preserve observable error propagation for refresh (no swallowed error).
- [x] Ensure `ServerReadCacheService` is instantiated/registered before `AuthService.bootstrap()` can fail (initializer ordering or equivalent, no AuthService↔cache injection cycle).
- [x] Cache constructor registers `() => this.purge()` (no discarded promise).
- [x] Default store installs `onversionchange` on every opened DB to close it and clear memoized connection. `deleteDatabase.onblocked` must not immediately turn a deletion that can finish into a permanent rejected purge.
- [x] Tests prove `logout()` / failed bootstrap do not resolve until cache clear resolves; user B cannot write then be erased by late A purge; production store can delete with another same-app connection open.

### R3 — every sign-in adopts only for current session

- [x] Add server-catalog adoption to access-token success branches of `completeOAuth()` and `verifyOAuthEmail()`.
- [x] Make adoption session-bound without injecting `AuthService` into `SessionCatalogSyncService`: caller passes expected profile id plus a current-session predicate/token, or equivalent acyclic design. Re-check after HTTP resolution and before storage replacement. If signed out or another profile is current, do nothing.
- [x] Tests: password login, bootstrap, completeOAuth, verifyOAuthEmail each adopt once; delayed response after logout and after user switch adopts nothing; offline failure changes nothing.

### R4 — stale answers are visible

- [x] Keep League list existing banner behavior.
- [x] Expose cached-stale state for server League detail and server Live list/detail. Browser-local mode must never show server-cache staleness.
- [x] Render an `en`+`fr` visible warning with `data-cy` on relevant League detail and Live list/runner pages. Do not conflate offline-cache stale data with optimistic write version conflicts.
- [x] Tests prove stale cache response raises each signal/warning and successful server response clears it.

### R5 — local player partial failure is truthful

- [x] Keep sequential per-League commands; reload local players in `finally`, log failure, show `en`+`fr` partial-change/review/retry copy, and prove reload-after-failure in `settings.component.test.ts`.

### R6 — safe + case-insensitive seeder

- [x] Pure local-Docker-endpoint predicate + negative tests; guard runs before first destructive compose command.
- [x] Case-normalize token map inserts/lookups; test mixed-case account/reference fixture reaches the same token.
- [x] Add missing validator negative tests listed in Inputs.
- [x] Fix README reset docs: environment seeder uses backend-only inline reset, not `scripts/reset-local-stack.mjs` verbatim.

### R7 — remove donor PII from HEAD

- [x] Synthetic player/account names replace all donor-derived personal names in tracked tree; shape + counts remain. — Evidence: normalized audit across demo fixtures, archived sample, plans, and docs found zero donor-derived identity refs; JSON structural comparison shows only player-name fields changed. Pre-existing public contributor attribution is independently sourced and explicitly excluded.
- [x] Plan/README wording becomes truthful: synthetic committed data, donor used only for shape.
- [x] `npx vitest run ops/dev-environments.test.ts` green.
- [x] Real `node scripts/seed-dev-environment.mjs --env=demo` exits 0 twice and DB/API spot checks show synthetic names only.

### R8 — runtime tests + bookkeeping truth

- [x] Commit calendar day-cell Cypress assertions described above; remove stale 'numbers only' prose. — Evidence: wrapped `public-calendar.cy.js` passed 8/8; seeded wrapped full suite passed 88/88.
- [x] Commit signed-out local-settings Cypress described above. — Evidence: `settings-local.cy.js` passed 2/2 within seeded wrapped full suite.
- [x] Commit production IndexedDB store lifecycle proof described above. — Evidence: focused T15 Vitest passed 70 files / 619 tests, including production-store round-trip, purge, recreation, and second-connection closure.
- [x] Fix `ai-artifacts/manual_test_checklist.md` raw feedback prose accidentally copied between T7/T8; do not reformat unrelated historical sections.
- [x] Any ticket validation checkbox that records a failing Cypress command as passed must become truthful. After `node scripts/seed-auth-e2e.mjs`, run wrapped full Cypress; if green, update T9/T10/T11 rows with that actual full-run evidence. If not green, leave unchecked and report exact failures. — Evidence: T9/T10/T11 Cypress rows now record seeded wrapped full-suite 21 specs / 88 tests green.
- [x] Manual lines remain unchecked unless actually automated with committed behavior-equivalent proof. Do not mark 'copied to checklist' as executing a human-only check.

## Validation

- [x] `npx vitest run src/app/backend src/app/auth src/app/data src/app/shared src/app/features/settings src/app/features/calendar ops/dev-environments.test.ts` green.
- [x] `npm run test` green.
- [x] `npm run lint` green. — Parent run passed.
- [x] `npm run typecheck` green. — Parent run passed.
- [x] `npm run build` green.
- [x] `npm run backend:test` green (one retry allowed only for the known Testcontainers random-port collision; report both outputs). — Parallel attempts hit RootlessKit random host-port collisions; parent serialized `DOTNET_PROCESSOR_COUNT=1 npm run backend:test` passed Unit 198/198, Integration 366/366, Architecture 17/17. No backend source changed.
- [x] `npm run acceptance:matrix` green. — Parent run passed 99/99 non-deferred rows and 24/24 final rows.
- [x] `node scripts/seed-auth-e2e.mjs` exits 0, then full Cypress green through NixOS wrapper. — Seed exited 0; 21 specs / 88 tests passed. Supervisor-approved plan-defect repair made auth linking redirect honor `Cypress.config('baseUrl')`; isolated auth spec passed 7/7:
  ```sh
  NSS=$(ls -d /nix/store/*-nss-3*/lib | tail -1); NSPR=$(ls -d /nix/store/*-nspr-4*/lib | tail -1)
  LD_LIBRARY_PATH="$NSS:$NSPR" steam-run npx cypress run --config screenshotOnRunFailure=false
  ```
- [x] `git diff --check c4b5d98..HEAD` green; no secrets, `.env`, `.tmp`, Cypress screenshots/downloads staged. — Evidence: diff/residue sweep passed; 48 staged paths contained no forbidden artifacts or environment files; hardcoded-secret and merge-marker scans had zero hits.
- [x] `ai-artifacts/manual_test_checklist.md` gains/updates only a `## T15 reviewer-blocker-repair` section plus surgical corrections to stale T6–T14 entries. — Evidence: diff reviewed; raw T7/T8 feedback removed, T12/T14 proof corrected, donor-name examples sanitized, T15 section added; unrelated historical sections unchanged.
- [x] Commit + push feature branch. Commit subject: `fix(security): close round-3 cache and fixture review blockers`. — Evidence: final commit amended with this exact subject and pushed to `origin/feat/feedback-calendar-v1-round-3`.

## Residuals to report, not hide

- Published commits before this repair may retain donor-derived names. Do not rewrite history. Exact human action: scrub/delete published feature-branch history before making repository public or opening a public PR.
- T12's sequential cross-League rename is not atomic; after this repair failure UI is truthful/reloaded, but a completed earlier league remains changed.
- Purely visual manual checklist rows remain human work; do not claim them as executed.
