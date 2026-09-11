# Authenticated production handoff

Repo-side verification only. **No production deployment or production readiness is claimed.**
The workflow emits a bounded digest handoff, never builds images, merges, pushes, calls a host,
or grants a future deploy permission.

## Trust contract

T1. `.github/workflows/promote-main.yml` accepts only `staging_run_id` and `staging_artifact_id`.
It runs only on a manual `main` dispatch, checks out that immutable dispatch SHA, and waits at the
`production` GitHub environment before retrieval or verification. Checkout credentials are not
persisted. `contents: read` and `actions: read` are the only token permissions.

T2. `scripts/production-handoff.mjs` uses `scripts/staging-evidence.mjs` and authenticated GitHub REST
responses, not caller-supplied JSON, to bind the selected artifact to this repository ID/name, exact
run ID/source SHA, and a successful manual `staging` run of `.github/workflows/finalize-staging.yml`.
Its single `finalize` job must have succeeded. The consumer then independently retrieves the chained
original `release-images.yml` staging `push` run, per-attempt jobs, commit tree and deployment artifact.
Every original quality, publish, matrix attestation, sign/verify and staging deploy job must have
succeeded. Both workflows accept only their exact path (optionally GitHub's `@staging` qualifier).
Skipped, missing, duplicated or failed jobs, different source trees/SHAs, changed deployment evidence,
or a chain ID/archive digest mismatch are refused.

T3. Only run attempt 1 qualifies. GitHub artifact metadata identifies a run, not its attempt; later
successful reruns cannot authenticate an earlier failed attempt's artifact. The exact artifact name
must be `staging-promotion-evidence-<source SHA>` for the finalizer and
`staging-deployment-evidence-<source SHA>` for the original release. Each ID must match, both must be
unexpired, and GitHub must supply their SHA-256 archive digests. The consumer recomputes that digest
and refuses any mismatch. No latest/name-only fallback, local evidence override or digest warning
bypass exists. Deleted, expired or legacy digest-less artifacts fail closed.

T4. GitHub's archive redirect is accepted only over HTTPS on `*.blob.core.windows.net` or
`*.actions.githubusercontent.com`, without userinfo, a non-default port or fragment. API tokens are
never forwarded to storage; further redirects are refused. Metadata requests are bounded to 1 MiB, archive/JSON to 17 MiB, network calls
to 30 seconds, ZIP reads to 10 seconds, and the workflow job to five minutes. ZIP must contain only
`evidence.json`; it is streamed from that member, never extracted or executed. Output contains only
allowlisted identity/digest fields, at most 8 KiB of compact JSON. Failures emit a sanitized refusal
and nonzero exit; only success uploads a handoff.

T5. The checked-out main tree must equal the independently resolved staged commit tree. The current
GitHub `main` ref must still equal the approved dispatch SHA at retrieval time; an advance while
approval was pending requires a new dispatch. `GONES_PRODUCTION_CONFIG_REVISION` is read independently
from GitHub environment/repository configuration, never copied from evidence. It is required and
must equal the staged public config revision. It identifies reviewed configuration, not secret
contents; the repository cannot prove that external mounted config matches this label.

## Evidence and output

E1. Exactly five ordered images (`api`, `worker`, `migrator`, `backup`, `frontend`) must reference
this repository's GHCR namespace and staged SHA tag, each with an immutable digest, verified
signature/provenance/SBOM flags and explicit zero CRITICAL scan count. The manifest digest is
recomputed using the exact pre-verification identity serialized by
`scripts/publish-release-images.mjs`: source SHA, tree, config revision and image entries with the
three verification booleans still false. `verify-published-images.mjs` changes those booleans later
without changing the published identity. Any ref/digest substitution invalidates this identity.

E2. Existing `evaluatePromotion` rechecks source/config/manifest equality, migration exit zero,
serialized staging deployment with zero active deployments, successful staging, explicit
`rebuild: false`/unchanged target, and the complete live [W12 gate](W12_LIVE_SOAK.md). W12 freshness
is reevaluated after environment approval; artifact retention does not extend its 24-hour deadline.
Signature/provenance/SBOM/scan assertions are authenticated records of the approved producer's
checks, not fresh registry scans performed by this consumer. Operator/provider measurements remain
attestations whose original private records need independent review.

E3. Successful output is `reports/production/handoff.json`, uploaded as
`production-handoff-<run ID>-<attempt>` with seven-day retention. Existing local output is never
overwritten; each workflow attempt gets a distinct artifact name. JSON includes staged identity,
main identity, finalizer and original release artifact IDs/archive digests/repository/run/attempt,
manifest digest, exact
`ghcr.io/.../gones-<image>@sha256:...` refs, handoff run identity, W12 digest/end/expiry, and fixed
`rebuild: false`, `deploy: false`, `productionApprovalRequired: true`. It excludes raw measurements,
credentials and deployment commands. Later main/config changes or W12 expiry invalidate reuse.
A future deploy must revalidate these identities/freshness and obtain its own explicit approval.

## Post-soak producer

P1. The immediate `release-images.yml` staging deploy validates source/config/manifest, verified image
identity, migration and serialization using `evaluateDeployment`. It emits create-only deployment
evidence marked `promotionStatus: pending-w12`, without W12. The impossible immediate promotion
check is removed; diagnostic upload remains `if: always()`. Only a successful first-attempt release
run qualifies for finalization. `evaluatePromotion` still always requires W12.

P2. After the live soak completes, manually dispatch `.github/workflows/finalize-staging.yml` on
`staging`, with only `candidate_run_id` and `candidate_artifact_id`. The checked-out dispatch SHA must
match the original release SHA. The five-minute, first-attempt-only job shares staging deployment
serialization, uses the `staging` environment, and has only `contents: read`/`actions: read` permissions.
It authenticates the original run/jobs/artifact and revalidates its immutable deployment evidence.
It never builds, deploys, runs a 72-hour Actions job, or accepts local/raw evidence.

P3. `scripts/finalize-staging.mjs` POSTs to the environment-owned secret
`GONES_STAGING_EVIDENCE_URL`, whose fixed path is `/v1/w12/evidence`. The URL must be HTTPS with a
public DNS-shaped hostname, no IP literal, userinfo, non-default port, query or fragment. No URL input
is exposed in workflow dispatch. `GONES_STAGING_EVIDENCE_TOKEN` is sent only to that fixed endpoint,
never GitHub/storage. The request contains `operation: gones-staging-w12-evidence-v1`, authenticated
`releaseArtifact` binding, source SHA/tree/config revision, manifest digest and `environment: staging`.
The read-only evidence operation must return HTTP 200 `application/json` containing the complete W12
report defined by `ops/w12-live-soak.schema.json`. No deployment command is sent. The service must
select the exact requested deployment, reject identity drift, and serve authoritative operator/provider
measurements, not caller-constructed evidence. DNS/endpoint ownership remains an external trust boundary.

P4. Redirects are refused, each request times out after 30 seconds, and W12 bodies are streamed with a
16 MiB bound before parsing. Existing `evaluatePromotion`/W12 checks bind all report identities and
reject incomplete, stale, synthetic, failed or mismatched measurements. Successful output preserves
original deployment fields, adds authenticated `releaseArtifact`, W12 and `promotionStatus: passed`,
and writes compact create-only `reports/staging-finalized/evidence.json` (17 MiB bound), uploaded only
on success as `staging-promotion-evidence-<source SHA>` with seven-day retention. Failures print only
a fixed redacted refusal. The immediate deploy transport also refuses redirects, uses a 30-second
timeout, bounds response JSON to 64 KiB and create-only output to 1 MiB, and redacts remote errors.

## Assumptions

I1. Staging stays on the candidate SHA through finalization. A new source/config/deployment invalidates
the live evidence; select a fresh successful release and fresh soak, not a rerun or old raw JSON.
Finalization must exist in the candidate source before that candidate is released.

## External activation prerequisites

A1. Administrators must configure the `production` environment with required reviewers, prevention
of self-review, appropriate no-bypass policy, main-only deployment restrictions, and trusted
`GONES_PRODUCTION_CONFIG_REVISION`. Environment declaration alone does not enforce human approval:
GitHub can create an unprotected environment when one is referenced. Main/staging branch protection,
workflow-change review, Actions permissions, artifact access/retention and protection-rule feature
availability remain external prerequisites. This change configures none of them.

A2. Administrators must provide the fixed HTTPS W12 evidence service from P3, provision its URL/token
as `staging` environment secrets, and protect staging dispatch/deploy access and workflow changes.
No live endpoint, credentials, provider capture or GitHub environment configuration is created by
this repo change. The repository producer is implemented and fixture-tested; a real successful
first-attempt release, live 72-hour soak and successful first-attempt finalizer remain activation
proof to collect. Failed runs, reruns, local `promotion.json`, manual artifact replacement or any
workflow outside the exact two-producer chain are not workarounds.

A3. After those prerequisites exist, an authorized reviewer selects the successful finalizer's
run/artifact IDs as `staging_run_id`/`staging_artifact_id`, dispatches the handoff workflow on main,
and reviews the production environment request. The resulting
artifact is a verified handoff only. Provider accounts, credentials, production host, DNS, migration
execution, rollback readiness and production activation require separate authorization and work.

## GitHub primary semantics

S1. [Workflow runs REST API](https://docs.github.com/en/rest/actions/workflow-runs?apiVersion=2022-11-28)
and [workflow jobs REST API](https://docs.github.com/en/rest/actions/workflow-jobs?apiVersion=2022-11-28)
define run identity, event/ref, attempt, status/conclusion and per-attempt job listing.

S2. [Artifacts REST API](https://docs.github.com/en/rest/actions/artifacts?apiVersion=2022-11-28)
defines artifact ID/name, `expired`, `digest`, `workflow_run` binding and the archive 302 redirect.
The implementation verifies archive bytes itself; it does not rely on a download action's warning.

S3. [Deployment environment protection](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
defines required reviewers and deployment branch restrictions. Referencing `environment: production`
is a gate declaration, not proof that those external rules are configured.
