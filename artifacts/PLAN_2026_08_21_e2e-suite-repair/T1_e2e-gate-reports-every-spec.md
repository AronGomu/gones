# T1: Make the e2e gate report every spec

**Plan:** `./artifacts/PLAN_2026_08_21_e2e-suite-repair.md`
**Depends:** none
**Commit outcome:** A failing spec no longer hides the specs after it.

## Context (self-contained)

- `scripts/full-stack-ci.mjs` runs each cypress spec in its own `runCypress(...)` call, every one
  wrapped in `if (!process.exitCode) { … }`. The first non-zero exit therefore skips every remaining
  spec.
- Consequence, measured: the gate dies on spec #2 (`power-user-gating.cy.js`). Behind it sit **17
  failures across 12 specs** that the gate has never reported. They were only discovered by running
  cypress by hand against the release stack.
- The per-spec structure is deliberate and must be kept: specs are ordered (`first-visit.cy.js` runs
  first because it is the only one asserting on a browser that has never visited the app), and
  `scripts/seed-auth-e2e.mjs` runs between some of them. A separate browser per spec is also what
  keeps `testIsolation` honest. **Do not collapse this into one cypress invocation.**
- This slice changes only *when the script gives up*, not what it runs or in what order.

## Requirements

- Every spec runs, even when an earlier one fails.
- The script still exits non-zero if any spec failed.
- The end of the run prints a summary listing each spec and whether it passed, so a reader sees the
  whole picture without scrolling through the log.
- Ordering is unchanged, the seeding steps stay where they are, and each spec keeps its own cypress
  invocation.
- The smoke step (`scripts/smoke-full-stack.mjs`) keeps its current behaviour: if the stack itself is
  unhealthy, stopping immediately is correct — there is no point running browser specs against a
  broken stack. Only the *spec* phase becomes non-fail-fast.
- If a spec crashes rather than failing assertions, that must not abort the remaining specs either.

## Inputs

- `scripts/full-stack-ci.mjs` — the whole file. Note in particular:
  - `runCypress(spec)` returns the spawn result.
  - The `if (!process.exitCode)` chain from `first-visit.cy.js` onward.
  - `getCypressEnv()` builds the Nix `LD_LIBRARY_PATH`; leave it alone.
  - the `finally` block that runs `docker compose --profile release down --volumes --remove-orphans`.
- `ops/e2e-spec-coverage.test.ts` — asserts the spec list in `full-stack-ci.mjs` stays level with
  `cypress/e2e/`. Read it before restructuring, and keep it passing. If your refactor changes how the
  spec list is expressed, this test is what tells you it still enumerates the same specs.

## Suggested shape

Collect the specs into an ordered list and loop, recording results — rather than 20 guarded blocks:

```js
const specs = ['cypress/e2e/first-visit.cy.js', 'cypress/e2e/power-user-gating.cy.js', /* … */];
const results = [];
for (const spec of specs) {
  const result = runCypress(spec);
  results.push({ spec, ok: result.status === 0 });
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}
```

with the seeding steps kept at their current positions. Print `results` at the end. Any shape that
meets the Requirements is fine — this is a suggestion, not a mandate.

## TDD

`ops/e2e-spec-coverage.test.ts` already pins the spec list; keep it green. Beyond that this is a
script change verified by running it. No new unit test is required — but if the spec list moves into
a structure that test can read more directly, prefer that.

## Impl steps

- [ ] 1. Read `full-stack-ci.mjs` and `ops/e2e-spec-coverage.test.ts` together before editing.
- [ ] 2. Restructure the spec phase so every spec runs and failures accumulate.
- [ ] 3. Keep the smoke step fail-fast; keep seeding steps in their current order.
- [ ] 4. Add the end-of-run summary.
- [ ] 5. Confirm a crashing spec does not abort the rest (temporarily point one entry at a
      non-existent spec file, observe the others still run, then revert).
- [ ] 6. Run `npx vitest run ops/e2e-spec-coverage.test.ts` — green.
- [ ] 7. Run the full gate. It will still be RED (17 known failures) — that is expected and correct
      at this point in the plan. What matters is that it now reports **all 27 specs** and the summary
      lists them.

## Outputs

- `scripts/full-stack-ci.mjs`
- `ops/e2e-spec-coverage.test.ts` only if the spec list's shape changed
- No app change.

## Validation

- [ ] `npm run e2e:ci` runs all 27 specs — confirm by counting spec results in the output
- [ ] The run still exits non-zero while failures remain
- [ ] The summary at the end names every spec with its pass/fail state
- [ ] `npx vitest run ops/e2e-spec-coverage.test.ts` → exit 0
- [ ] Record the full list of failing specs from this run — it is the baseline T2–T5 work against
- [ ] commit msg draft: `test(e2e): run every spec before failing the gate`
