# T6: Accept 404 as a legitimate loser in the concurrent-mutation race

**Plan:** `./artifacts/PLAN_2026_08_21_e2e-suite-repair.md`
**Depends:** none
**Commit outcome:** The concurrency test stops failing intermittently, without loosening what it proves.

## Context (self-contained)

- Flaky test: `backend/tests/Gones.IntegrationTests/EventLifecycleApiTests.cs` →
  `Concurrent_mutations_allow_one_winner_and_leave_single_atomic_event` (~lines 340-355).
- Observed: failed once inside a full `npm run backend:test`, then passed alone **and** passed on a
  clean full re-run. Load/timing sensitive, roughly 1 in N.
- The failure:
  ```
  Assert.Single() Failure: The collection did not contain any matching items
  Collection: [StatusCode: 404, ReasonPhrase: 'Not Found', …]
  ```
- What the test does: races `POST /api/events/{id}/cancel` against `DELETE /api/events/{id}`, both
  carrying the same ETag, via `Task.WhenAll`. It then asserts **exactly one** response is `OK` and
  **exactly one** is `PreconditionFailed or Conflict`.

## Root cause (already established — do not re-diagnose, but do verify)

The two requests take **different** advisory locks. `EventLifecycleEndpoints.cs` (~line 343) uses
`pg_advisory_xact_lock(hashtext({scope}), hashtext({idempotencyKey}))`, and the test passes distinct
idempotency keys — `"race-cancel"` and `"race-delete"`. PostgreSQL keys the lock on both arguments,
so the two commands are **not** mutually excluded and genuinely run concurrently.

Under READ COMMITTED, if the delete commits first it soft-deletes the row (`DeletedAt` set). The
cancel then calls `RequireActiveAsync` (~line 380), which filters `Id == eventId && DeletedAt == null`,
finds nothing, and throws `ResourceNotFoundException` → **HTTP 404**.

**404 is the correct application response in that interleaving.** The event really is gone by the
time the cancel looks. There is no missing concurrency guard: the advisory lock exists for
idempotency-replay protection per key, not for cross-command mutual exclusion, and the winner still
produces exactly one lifecycle entry and one audit record either way.

So the defect is in the **test's assertion**, which enumerates only two of the three legitimate loser
outcomes.

Before changing anything, confirm this for yourself by reading the two endpoints — the fix depends on
404 genuinely being correct rather than masking a real race, and that judgement is the whole ticket.

## Requirements

- The test becomes deterministic: it must pass under load, repeatedly.
- It must still prove the two things it exists to prove:
  1. exactly one of the two concurrent mutations wins;
  2. the database ends with exactly one lifecycle entry and exactly one audit record.
- The loser assertion accepts `NotFound` **in addition to** `PreconditionFailed` and `Conflict` — it
  must not become "any non-OK status", which would let a 500 pass.
- **Forbidden**: retry loops, `Thread.Sleep`, `[Retry]` attributes, widening to `Assert.True(true)`,
  or serializing the two requests. Serializing would delete the very race the test exists to cover.
- Add a short comment naming the third interleaving and why 404 is correct there, so the next reader
  does not "tighten" it back.

## Inputs

- `backend/tests/Gones.IntegrationTests/EventLifecycleApiTests.cs` — the test (~340-355) and its
  sibling `Concurrent_idempotent_cancel_replays_one_atomic_result` (~line 327), which uses the **same**
  idempotency key for both requests and therefore shares one advisory lock — that one cannot produce
  a 404 and must be left alone.
- `backend/src/Gones.Api/Events/EventLifecycleEndpoints.cs` — the advisory lock (~343) and
  `RequireActiveAsync` (~380).
- Only these two tests in that file use `Task.WhenAll`; no other spec has the pattern.

## TDD

Not red/green — the test is intermittently red by nature. Prove the fix differently:

1. Establish the failure is reachable: run the test in a loop (say 20 iterations) under parallel load
   until you observe the 404 outcome at least once against the current assertion.
2. Apply the fix.
3. Run the same loop again; it must pass every iteration.
4. Prove the assertion still bites: temporarily make the endpoint return something wrong (a 500, or
   two winners) and confirm the test fails.

## Impl steps

- [ ] 1. Read both endpoints and confirm the 404 interleaving is real and correct. If it turns out to
      indicate an actual bug, STOP and report — the fix would then belong in the app, not the test.
- [ ] 2. Reproduce the 404 outcome at least once under load.
- [ ] 3. Add `NotFound` to the loser assertion, with the explanatory comment.
- [ ] 4. Confirm the DB assertions (one lifecycle entry, one audit record) still hold in the
      delete-wins interleaving as well as the cancel-wins one — if they do not, that IS a real bug and
      must be reported, not absorbed.
- [ ] 5. Loop the test to confirm determinism.
- [ ] 6. Prove the assertion still fails when the endpoint misbehaves, then restore.
- [ ] 7. Leave `Concurrent_idempotent_cancel_replays_one_atomic_result` untouched.

## Outputs

- `backend/tests/Gones.IntegrationTests/EventLifecycleApiTests.cs`
- No app change. If an app change appears necessary, that is a finding to report, not to implement here.

## Validation

- [ ] The test passes 20 consecutive runs under load
- [ ] `npm run backend:test` green on **three** consecutive full runs — one proves nothing for a flake
- [ ] The test still fails if the endpoint returns two winners or a 500 (prove it, then restore)
- [ ] `git diff --stat` shows only the one test file
- [ ] commit msg draft: `test(events): accept the delete-wins 404 in the concurrent mutation race`
