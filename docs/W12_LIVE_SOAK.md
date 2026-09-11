# W12 live soak evidence gate

Repo-side validation only. **No live W12 run has been performed or proved by this change.**
The CLI records operator/provider-produced JSON; it never starts a provider, deploys services,
provisions accounts, sends jobs, reads credentials, or changes fake-provider preflight.

## External prerequisites

E1. Authorized staging host, immutable verified images, fixed source SHA/tree, config revision,
registry manifest digest, private telemetry access, approved provider accounts and recipient policy.
Follow [staging foundation](STAGING_FOUNDATION.md) and [Worker idle runtime](WORKER_IDLE.md).
No production activation follows from a successful local validator.

E2. Independently approved workload plan: clustered and sparse traffic, delayed jobs, restarts,
provider uncertainty, duplicate protection and missed wake recovery. Exercise notification, reminder,
lifecycle, image expiry, image deletion and maintenance jobs. Hash the sanitized plan with SHA-256;
use the same plan and compute size for the measured always-awake comparison.

E3. Authorized external collector must observe the entire continuous 72-hour window. Capture real
provider effects, expected/completed obligations, deadlines, DB suspension, active-time union and
compute usage. Include API startup, Worker wake/recovery, health/readiness probes, backups, exports,
telemetry and overlapping wake tails. Summing overlapping active periods is not an active-time union.
Repo tests cannot prove provider suspension, pooled physical connections, cost or live correctness.

E4. Obtain account/checkout/billing evidence for both environments, taxes, shared host, IPv4,
DB compute/storage/history/network, object operations/storage, telemetry, email and registry/CI.
No paid auto-upgrade. Eligibility for the 100 CU-hour free quota is an external prerequisite,
not something the JSON validator discovers. No purchase or deployment is authorized here.

E5. Keep raw private evidence outside the repository. Export only aggregate counts, timestamps,
release identities and SHA-256 evidence digests. Never include secrets, credentials, DSNs, email
addresses, account IDs, URLs, query strings, provider payloads or job/user IDs. Unknown fields are
rejected; opaque identifiers are not a secret detector. Independently review sanitized evidence.

## Operator flow

The following commands write local evidence files only. Run them in a private operator-owned
0700 directory, not a shared writable directory. All output paths must be new; existing files,
including symlinks, are never overwritten. Files use mode 0600. One capture owner is required.

1. O1. Prepare `input.json` using `$defs.input` in
   [`ops/w12-live-soak.schema.json`](../ops/w12-live-soak.schema.json). Set `kind` to
   `gones.w12-input`, `version` to `1`, `durationHours` to `72`, and `identity` to the published
   `sourceSha`, `tree`, `configRevision`, `manifestDigest`, `environment: "staging"`, and sanitized
   plan `workloadDigest`. Use registry manifest identity, not a mutable image tag or local image ID.
   Begin capture at the externally coordinated staging measurement start:

   ```bash
   npm run release:w12 -- start --live --input=/private/w12/input.json --out=/private/w12/state-0.json
   ```

   `startedAt` comes from the local UTC clock; `endsAt` is exactly 72 hours later. There is no clock,
   duration, environment or deadline override. This command does not wake staging. Coordinate the
   approved host window and collector against these timestamps; any observation gap requires a
   new capture, not an extension. The existing staging window has a 72-hour maximum: deployment
   warmup, drain and capture alignment remain external scheduling duties.

2. O2. Export each observed interval as `$defs.segment`. Repeat the exact identity. Set canonical
   UTC `startedAt`/`endedAt` (`YYYY-MM-DDTHH:mm:ss.sssZ`), `origin: "live-provider"`, private source
   `evidenceDigest`, exercised `workloadClasses`/`jobClasses`, `jobs`, `providerEffects` and `db`.
   Intervals must adjoin exactly, never overlap, run backwards, extend beyond `endsAt` or report
   future observations. Resume into a new checkpoint after each export:

   ```bash
   npm run release:w12 -- resume --live --state=/private/w12/state-0.json --input=/private/w12/segment-1.json --out=/private/w12/state-1.json
   ```

   Subsequent calls read the last checkpoint and append the next interval. Restart resumes from
   persisted JSON; no process, timer or in-memory capture needs to survive. Maximum 4,320 segments,
   maximum 16 MiB per JSON file. Interrupted/partial outputs are invalid; retain the previous valid
   checkpoint and choose a new output path. No stop command is needed: CLI starts no background work.

3. O3. After the entire window, prepare `$defs.cost` as `cost.json`. Bind the same identity/window,
   live-provider origin, source digest, fixed `computeUnits`, `monthlyOtherCuHours`, all monthly EUR
   categories and equivalent `baseline`. Finalize within 24 hours of capture end:

   ```bash
   npm run release:w12 -- finalize --live --state=/private/w12/state-final.json --input=/private/w12/cost.json --out=/private/w12/w12.json
   ```

   Output is `gones.w12-evidence`, not an assertion generated by a live probe. Exit 0 means supplied
   evidence validated; exit 2 means capture/schema/correctness/cost refusal. Structured stdout names
   operation, `capture-pending` or `validated-operator-evidence`, and `providerCalls: 0`. Diagnostics
   never echo input values. Missing or failed evidence produces no successful output report.

4. O4. Recheck the original immutable deployment context with the finalized report:

   ```bash
   npm run release:promotion-check -- --evidence=/private/w12/deployment.json --w12=/private/w12/w12.json
   ```

   Promotion revalidates all measurements and freshness, never trusts a stored `ok`/`passed` flag.
   `--w12` supplies the same top-level `w12` field accepted by `evaluatePromotion`. To prepare a
   local review context (not workflow input), create a new file without replacing the original:

   ```bash
   node --input-type=module -e 'import {readFileSync,writeFileSync} from "node:fs"; const [deployment,w12,out]=process.argv.slice(1); const e=JSON.parse(readFileSync(deployment,"utf8")); e.w12=JSON.parse(readFileSync(w12,"utf8")); writeFileSync(out,JSON.stringify(e)+"\n",{flag:"wx",mode:0o600});' /private/w12/deployment.json /private/w12/w12.json /private/w12/promotion.json
   npm run release:promotion-check -- --evidence=/private/w12/promotion.json
   ```

5. O5. Independently review original provider records, their sanitized digests, candidate identity,
   equivalent workload and complete cost accounting. The [manual handoff](PRODUCTION_HANDOFF.md)
   accepts only authenticated successful finalizer run/artifact IDs, never local `promotion.json`.
   Dispatch `finalize-staging.yml` with original release run/artifact IDs after the fixed staging
   evidence service has the complete report. Its live endpoint/token configuration remains external.
   Promotion must occur no later than 24 hours after capture end; finalizing again does not refresh
   that deadline. Any source/config/manifest change requires a fresh soak. Production approval
   remains separate; this flow performs no merge, push or deploy.

## Measurement semantics and acceptance

M1. Schema is strict at every nested boundary: required fields, exact enums/types, finite nonnegative
numbers, integer counts, canonical timestamps, no extra properties. `configRevision` is a public
path-safe revision label, not configuration content. All segments and cost evidence repeat identity;
baseline repeats workload digest and compute size. Only `staging` and declared `live-provider`
measurements qualify. Local/synthetic/fake-provider fixtures never qualify under their true origin.

M2. Each interval accounts for all eligible obligations due in that interval: `jobs.expected` equals
`completed`; `lost`, `duplicates`, `deadlineMisses` and unrecovered `failures` are zero. Delayed work
not yet due is not counted as lost; unresolved due work blocks finalization. Preserve private trace
proof for each workload/job class, not just a list of labels. `maxImmediateLatencyMs` is the maximum
per-job latency after subtracting that job's measured DB cold start; limit 5,000 ms.
`maxDbColdStartMs` separately records observed cold-start maximum, not a blanket latency allowance.
`maxRecoveryLatencyMs` is at most 3,600,000 ms; normal deadlines are never relaxed for recovery.
Injected restart/uncertainty scenarios must finish with correct reconciled outcomes.

M3. `providerEffects.expected` equals `observed`; duplicate and unresolved effects are zero. At least
one job and provider effect must be observed overall. All seven workload classes and six job classes
must occur across the full window. DB must have measured suspension and positive active/compute use,
less than 72 active hours. Segment `cuHours` must equal union `activeHours * computeUnits` for the
fixed-size comparison; variable compute sizes require a new reviewed schema, not invented averages.

M4. Both `monthlyCosts` objects are measured/quoted 31-day projections in EUR, not 72-hour bills.
Required categories: `sharedHostEur`, `ipv4Eur`, `taxEur`, `dbEur`, `dbStorageEur`, `dbHistoryEur`,
`networkEur`, `objectEur`, `telemetryEur`, `emailEur`, `registryCiEur`, `otherEnvironmentEur`.
Count shared costs exactly once; `otherEnvironmentEur` covers the second environment's incremental
costs without duplicating shared categories. Explicit zero requires external evidence of free use.
Baseline is a real equivalent 72-hour always-awake measurement (72 active hours, same compute size,
same workload digest), with its own billing projection and source digest. Both totals are recomputed;
measured combined total must be strictly lower than baseline and at most EUR50.

M5. Staging compute projection is `sum(segment.db.cuHours) / 72 * 744 + monthlyOtherCuHours`.
The latter covers additional staging monthly compute not represented by the soak; do not double
count the extrapolated workload. Projection must not exceed 80 CU-hours, leaving at least 20 of
100 free CU-hours. Reserve exhaustion blocks the gate; it never drops jobs or extends recovery.
Production account usage/eligibility remains independently verified under the external budget gate.

## Trust boundary and workflow compatibility

T1. This is validation of trusted operator attestations, not verification of provider signatures.
A SHA-256 digest binds a private source record only when the reviewer independently obtains and
checks that record. Relabeling fabricated measurements `live-provider` cannot be detected from
JSON alone. CLI does not manufacture live evidence; synthetic test fixtures are test-only.

T2. `scripts/deploy-staging.mjs` validates immediate deployment evidence, marks it `pending-w12`,
and can succeed without claiming promotion. The workflow retains that deployment artifact with
`if: always()`; failed releases remain ineligible. After capture, `finalize-staging.yml` accepts only
successful first-attempt release run/artifact IDs, authenticates their GitHub provenance, and fetches
W12 from the fixed HTTPS staging evidence service using environment secrets. Existing promotion/W12
validation produces a final promotion artifact only on success. Main handoff authenticates that
successful first-attempt finalizer plus the original release run/jobs/artifact chain. See
[production handoff](PRODUCTION_HANDOFF.md) for the exact endpoint contract and activation prerequisites.
Use original evidence in O4 for local review only; neither finalizer nor main accepts local combined
JSON. No 72-hour Actions job, provider runner, host auto-wake, preflight bypass, optional W12 switch,
failed-run exception, rerun workaround or arbitrary workflow trust is introduced.

T3. Capture failures preserve prior checkpoints. Correct an invalid export from authoritative source
records; never erase real failed jobs, observation gaps or provider discrepancies. Failed live
correctness requires repair and a fresh 72-hour run. Rollback to polling remains separately approved
and restores higher DB cost; changing configuration invalidates the report.

## Local validation

```bash
npx vitest run ops/w12-live-soak.test.ts ops/promotion-check.test.ts
npm run typecheck
npm run lint
```

These tests exercise malformed/missing input, fixed duration, resume, identity/freshness, continuous
coverage, job deadlines/loss/duplicates, provider effects, cost arithmetic, free-quota reserve,
create-only files and promotion refusal. They do not prove provider suspension, live correctness,
provider invoices, account eligibility, host isolation, continuous staging uptime or production safety.
