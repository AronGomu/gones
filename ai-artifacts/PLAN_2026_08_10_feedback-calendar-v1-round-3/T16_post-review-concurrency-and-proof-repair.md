# T16: Post-review concurrency and proof repair

**Plan:** `./ai-artifacts/PLAN_2026_08_10_feedback-calendar-v1-round-3.md`
**Depends:** T15
**Commit outcome:** Close independently confirmed post-T15 auth/cache concurrency, catalog lock, error truth, stale-warning, partial-rename, IndexedDB proof and bookkeeping findings.

## Context (self-contained)

User authorized a fresh repair loop after T15 exhausted its original review budget. Independent post-fix reports are read-only inputs:

- `.tmp/post-review-correctness.md`
- `.tmp/post-review-security.md`
- `.tmp/post-review-tests.md`

Current pushed HEAD is `e8d8fb2`. Full gates at that commit are green: 104 Vitest files / 904 tests; lint; typecheck; build; serialized backend 198 unit + 366 integration + 17 architecture; acceptance 99/99 + 24/24; seeded wrapped Cypress 21 specs / 88 tests. Post-fix security/privacy review is clean at HEAD. This ticket repairs only newly confirmed correctness/proof gaps.

## Hard boundaries

- No browser-local League, Live, player or archetype value may be sent to server.
- No cache row may cross users. A session teardown that starts first must finish before a later session can establish/write private cache state.
- Preserve authoritative auth operation result: purge failure must not replace original refresh failure or report successful irreversible account deletion as failed. Purge failure must still block/retry before next session establishment; do not silently permit a next session over uncleared private state.
- Catalog replacement remains server → browser only. Current-session predicate must run inside Web Lock callback immediately before storage write.
- Local player rename remains sequential/non-atomic by prior plan; UI must preserve partial-change warning even when reload also fails.
- No `backend/**` C# change, new runtime dependency, release/deploy/compose change, production action, force-push or push to `main`.
- Do not kill existing `ng serve` on `127.0.0.1:4200`.
- Keep changes surgical. Do not redesign completed T1–T15 work.

## Required fixes

### R1 — serialize session teardown and establishment

- [x] Add red concurrency test: user-A teardown begins with cache purge deliberately unresolved; user-B login/session establishment starts; B must not publish profile or perform private cache-dependent work until A purge resolves.
- [x] Add red test: after A purge resolves, B establishes normally and B cache data is not erased by a late A deletion.
- [x] Implement one explicit auth-session transition gate/mutex or equivalent. All session-establishing paths (`bootstrap`, password login, OAuth completion, OAuth email verification, refresh success) and session-ending paths (`clear`, logout, account deletion, failed refresh/bootstrap) that mutate token/profile/private scope must obey it. Avoid nested-lock deadlocks by separating locked public boundaries from private unlocked helpers.
- [x] Keep UI/session state internally consistent: no profile/token from a stale transition may publish after a newer teardown.

### R2 — preserve auth errors while retaining purge safety

- [x] Add red test: refresh fails with error A and purge fails with error B; observer receives A.
- [x] Add red test: server account deletion succeeds and purge fails; caller must not receive a false account-deletion failure. Session remains locally signed out; next session establishment retries/awaits required purge before publishing.
- [x] Add red test for logout/server failure + purge failure truth: preserve primary server error when one exists; no unhandled rejection.
- [x] Log secondary purge failure through existing boundary logger. Never silently allow new private session state over uncleared cache.

### R3 — current-session check inside catalog Web Lock

- [x] Extend the deck-archetype adoption API with a current-session guard (or equivalent) executed inside `navigator.locks.request` callback immediately before `commitUnlocked`/storage replacement.
- [x] `SessionCatalogSyncService` passes the same expected-profile predicate through. Keep service acyclic; do not inject `AuthService` into it.
- [x] Add deterministic queued-lock tests: A HTTP response resolves and queues; A logs out or B signs in before lock callback; callback must not write A catalog. Current session still writes once.

### R4 — preserve partial-rename truth on reload failure

- [x] Add red test: first local League rename commits, second write fails, final local-player reload also fails. Partial-change/review/retry copy remains visible; generic load-failed copy must not overwrite it.
- [x] Allow normal standalone `loadLocalPlayers()` failure to keep existing generic load-failed behavior.
- [x] Keep sequential per-League writes and reload attempt; do not invent rollback/transaction.

### R5 — clear stale-detail signal after successful fresh mutation

- [x] Add repository tests: cached League/Live detail sets stale; successful fresh mutation/create then clears stale warning. Failed mutation must not falsely mark cached document fresh.
- [x] Clear `detailStale` only after successful repository mutation returning/creating/deleting fresh server/local state. Cover every repository mutation path that can replace currently rendered detail via a small helper, not ad-hoc component signal writes.
- [x] Keep list staleness semantics unchanged.

### R6 — browser-faithful IndexedDB schema proof

- [x] Strengthen production-store lifecycle fake/test without adding a dependency: track literal DB name, object-store creation name, `{ keyPath: 'key' }`, transaction store name and put key extraction. Wrong DB/store/keyPath must fail the test like browser IndexedDB (`NotFoundError`/`DataError` or equivalent).
- [x] Assertions use literal expected contract (`gones-cache`, `reads`, `key`) rather than importing production constants as both implementation and oracle.
- [x] Retain round-trip, second-connection version-change closure, deletion and recreation proof.

### R7 — truthful manual bookkeeping

- [x] Change only falsely checked manual/browser rows to unchecked, preserving automated substitute evidence as context: T1 lines/rows 13 and final two manual rows; T2 step 16 and two final manual rows; T3 step 12 and two final manual rows; T4 step 6 and final manual row; T5 steps 9–10 and final two manual rows.
- [x] Do not uncheck actual automated/source/test/build evidence. Do not claim API/source substitutes execute a browser/manual check.
- [x] Keep matching `ai-artifacts/manual_test_checklist.md` human rows unchecked.

## Validation

- [x] Focused auth/session/catalog/cache/settings/repository tests green. Evidence: 10 files / 130 tests passed.
- [x] `npm run test` green. Evidence: 104 files / 917 tests passed.
- [x] `npm run lint` green. Evidence: `All files pass linting.`
- [x] `npm run typecheck` green. Evidence: both TypeScript configs exited 0.
- [x] `npm run build` green. Evidence: production bundle generated.
- [x] `npm run acceptance:matrix` green. Evidence: 99/99 non-deferred + 24/24 final rows proved.
- [x] Seeded wrapped Cypress full suite remains 21 specs / 88 tests green. `node scripts/seed-auth-e2e.mjs` ran first. NixOS wrapper:
  ```sh
  NSS=$(ls -d /nix/store/*-nss-3*/lib | tail -1); NSPR=$(ls -d /nix/store/*-nspr-4*/lib | tail -1)
  LD_LIBRARY_PATH="$NSS:$NSPR" steam-run npx cypress run --config screenshotOnRunFailure=false
  ```
- [x] Backend not rerun because no `backend/**` change; T15 serialized 581/581 remains applicable.
- [x] `git diff --check e8d8fb2..HEAD` green; no secrets, env files, `.tmp`, Cypress artifacts or generated files staged. Evidence: pre-commit working-tree `git diff --check` exited 0; final committed range rechecked after commit; generated Cypress output removed before staging.
- [x] `ai-artifacts/manual_test_checklist.md` gains `## T16 post-review-concurrency-and-proof-repair`; human-only rows remain unchecked.
- [x] Commit exact subject `fix(auth): serialize session teardown and close review gaps`; push `origin/feat/feedback-calendar-v1-round-3`. Evidence: final commit uses the exact subject and is pushed to the named branch.

## Residuals

- T12 cross-League rename remains sequential/non-atomic; failure copy/reload behavior must be truthful.
- Visual/manual checklist rows remain human work.
- History privacy cleanup is parent-owned after accepted T16. `origin/main` itself contains donor-derived sample identities, so a clean feature-branch replacement alone cannot sanitize repository ancestry. Do not rewrite/delete branches in this worker.
