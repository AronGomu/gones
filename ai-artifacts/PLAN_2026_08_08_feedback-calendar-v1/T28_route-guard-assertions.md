# T28: Make the route-guard wiring assertions capable of failing *(parent-added)*

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T27
**Commit outcome:** Unwiring any route guard fails the suite.

## Why this ticket exists

T27 found, empirically, that `src/app/data-mode-routes.test.ts` guards route wiring with assertions that **pass in
exactly the case they exist to catch**.

```ts
expect(homeRoute?.canActivate).toContain(firstVisitHomeGuard);
```

When the route has no `canActivate`, that expression is `expect(undefined).toContain(fn)`. On vitest 4.1.10 this
**silently succeeds** when the argument is a function. (With a *string* argument the same call throws
`"the given combination of arguments (undefined and string) is invalid"` — which is why the defect is not obvious.)

T27 proved the consequence: with `canActivate: [firstVisitHomeGuard]` deleted from `app.routes.ts`, both
`first-visit.guard.test.ts` and the whole of `data-mode-routes.test.ts` stayed green — 31/31 and 28/28. The guard
tests pass because they test the guard *function*; the wiring test passes because of this defect. Nothing at all
catches an unwired guard.

Five guards are affected, including two on authorization-bearing routes (`userGuard`, `organizerGuard`) where an
unwired guard means an unprotected route.

## Requirements

- Every route-guard wiring assertion fails when its guard is removed from the route.
- No assertion is deleted or weakened; each becomes capable of failing.
- If the same defective pattern exists anywhere else in the repo, it is fixed there too.
- `npm run test`, `lint`, `typecheck`, `build` stay green.

## Inputs

- `src/app/data-mode-routes.test.ts` — six assertions, all the same shape:
  - `:93` `expect(accountRoute?.canActivate).toContain(userGuard);`
  - `:130` `expect(route!.canActivate).toContain(userGuard);`
  - `:131` `expect(route!.canActivate).toContain(verifiedEmailGuard);`
  - `:141` `expect(route?.canActivate).toContain(organizerGuard);`
  - `:146` `expect(homeRoute?.canActivate).toContain(firstVisitHomeGuard);`
  - `:151` `expect(aboutRoute?.canActivate).toContain(markVisitedGuard);`
  Note `:130`/`:131` use `route!.` — the non-null assertion silences the type error but changes nothing at runtime,
  so those two are vacuous in the same way.
  T27's suggested fix: `expect(route?.canActivate ?? []).toContain(...)`. Any form that fails on a missing
  `canActivate` is acceptable — an explicit `toBeDefined()` first, or a helper — provided the failure message names
  the route and the guard.
- **Search the repo for the same pattern before fixing.** `toContain` on a possibly-`undefined` member is the general
  defect; `canActivate` is only where T27 happened to find it. Other optional arrays (`data`, `providers`,
  `resolve`, route `children`) may carry it too.
- `src/app/app.routes.ts` — the routes under assertion. **Do not change it** except to temporarily break a guard for
  the Red step, restoring it afterwards.

## Environment facts

- **No Angular `TestBed`, no zone.js**; `@angular/common/http/testing` is not installed. These are plain vitest
  assertions over the route array — no harness needed.
- The `data-cy` allowlist is empty and enforced repo-wide, but this ticket should touch no template.
- This ticket changes **no shipped behaviour**. If you find yourself editing `app.routes.ts` for anything other than a
  temporary Red, stop — a genuinely unwired guard is a security finding to report, not to quietly wire up.

## TDD

1. **Red** — remove one guard from its route and confirm the current assertion still passes. Do this for at least
   `userGuard` (authorization-bearing) and `firstVisitHomeGuard` (T27's original case).
2. **Green** — rewrite the assertions; the same removal now fails with a message naming the route and guard.
3. **Refactor** — restore `app.routes.ts` exactly, and confirm the suite is green with every guard wired.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `unwiring userGuard fails` | drop `userGuard` from the account route | assertion fails, message names route + guard |
| `unwiring organizerGuard fails` | drop it from the organizer route | fails |
| `unwiring verifiedEmailGuard fails` | drop it | fails |
| `unwiring firstVisitHomeGuard fails` | drop it from `''` | fails |
| `unwiring markVisitedGuard fails` | drop it from `/about` | fails |
| `all guards wired` | unmodified `app.routes.ts` | suite green |

Run: `npm run test -- data-mode-routes`

## Impl steps

- [x] 1. Reproduce the defect: drop `userGuard` from its route and confirm `data-mode-routes.test.ts` still passes — validate: record the passing count with the guard removed.
- [x] 2. Confirm the mechanism in this exact vitest version — validate: show that `expect(undefined).toContain(fn)` passes while `expect(undefined).toContain('x')` throws.
- [x] 3. Rewrite all six assertions so a missing `canActivate` fails, with a message naming the route and the guard — validate: the step-1 removal now fails.
- [x] 4. Grep the repo for the same possibly-undefined `toContain` shape and fix any other instance — validate: name what you searched and what you found, including "nothing else" if that is the answer.
- [x] 5. Restore `app.routes.ts` byte-for-byte — validate: `git diff src/app/app.routes.ts` is empty.
- [x] 6. Repeat the Red for `organizerGuard`, `verifiedEmailGuard`, `firstVisitHomeGuard` and `markVisitedGuard`, restoring each — validate: each fails, then the suite is green.
- [x] 7. Run `npm run test && npm run lint && npm run typecheck && npm run build`.

## Outputs

- Files touched: `src/app/data-mode-routes.test.ts`, plus any other file carrying the same pattern.
- Public API / behavior change: none.
- Migrate / config: none.

## Validation

- [x] `npm run test && npm run lint && npm run typecheck && npm run build` pass
- [x] each of the five guards was shown to fail the suite when unwired, and the report says so per guard
- [x] `git diff src/app/app.routes.ts` is empty at the end
- [x] app functional — no shipped behaviour changed
- [x] commit msg draft: `test(routes): fail when a route guard is unwired`
