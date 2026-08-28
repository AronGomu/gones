# Gones Calendar operator runbook

Everything an operator has to do to run, change, recover and roll back Gones Calendar V1 on a
generic Linux host. It is deliberately vendor-neutral: [`RUNTIME_CONTRACT.md`](RUNTIME_CONTRACT.md)
says what the host must provide, this document says what you do with it.

Every procedure below is rehearsed locally by a committed script. Where a step needs infrastructure
this repository does not have — a public domain, a real provider account, a scheduler, an offsite
bucket — the step is marked **deferred** and is *not* claimed to work.

| Procedure | Local rehearsal |
| --- | --- |
| Deploy / start ordering | `npm run release:rehearsal` |
| Migration operator run | `npm run migration:smoke`, `npm run release:rehearsal` |
| Backup, restore, volume loss | `npm run backup:rehearsal` |
| Admin bootstrap | `npm run release:rehearsal` |
| Provider webhook | `npm run release:rehearsal` |
| Image provenance | `npm run images:build`, `npm run images:verify`, `npm run images:scan` |
| Acceptance coverage | `npm run acceptance:matrix` |
| Release candidate assembly | `npm run release:preflight`, `npm run release:candidate` |

The candidate this runbook operates — the artifact set, the residuals and the deferred live
infrastructure — is described in [`RELEASE_NOTES_V1.md`](RELEASE_NOTES_V1.md).

---

## 1. Local environment

```bash
npm install
cp .env.example .env      # never commit .env; it is gitignored
docker compose up -d --build
npm run smoke
```

`compose.yaml` runs **mandatory server mode**: the API database is the single data authority
(ADR 0019). The API listens on `127.0.0.1:5080`, the development SPA on `127.0.0.1:4200`, the release
SPA (profile `release`) on `127.0.0.1:8081`.

The isolated release-test project (`compose.release-test.yaml`) is the one that mirrors a real host:
TLS reverse proxy, mounted secret files, fake identity and email providers, no route to the internet.
It publishes a single origin, `https://127.0.0.1:8443`, serving both the server-mode SPA and the API.

`.env.example` is the complete, vendor-neutral configuration surface;
`ops/host-contract.test.ts` fails if a required key stops being documented.

## 2. OpenAPI and the generated client

The API document is the contract, and the TypeScript client is generated from it — never hand-edited.

```bash
npm run api:generate    # regenerate src/app/api/generated/gones-api.ts
npm run api:check       # fail if the committed client has drifted
```

Any DTO change is therefore a two-step change: change the endpoint, then regenerate. `api:check` runs
in `G-FULL` and in CI, so a drifted client cannot merge.

## 3. Deploying a version

The deployment unit is a set of immutable image digests, never a tag.

1. Build and record: `npm run images:build` writes digests, SPDX SBOMs and checksums under
   `reports/images/`. `npm run images:verify` re-checks the runtime contract of each image;
   `npm run images:scan` runs Trivy and Gitleaks.
2. Start order is a hard requirement, not a preference:
   `postgres` (healthy) → `migrator` (exit 0) → grants → `api` and the singleton `worker`.
   The API must never serve against an unmigrated schema; the release rehearsal asserts the ordering
   from container timestamps.
3. The frontend artifact is served with its declaration injected at container start:
   `GONES_DATA_MODE=server` **and** `GONES_API_BASE_URL=<this deployment's API origin>` (plus the
   capability flags). The entrypoint renders the CSP `connect-src` from the same value, so the two
   cannot drift, and refuses to serve an incoherent pair. The image needs no rebuild to move origin.
   Verify the whole set with `npm run release:preflight` before starting anything.
4. Health: `GET /health/live` for liveness, `GET /health/ready` for readiness. Readiness includes the
   Worker heartbeat, so a dead Worker takes the instance out of rotation rather than failing silently.

**Deferred:** the registry, the image signing trust root, the orchestrator, DNS and the public
domain. Nothing in this repository assumes any of them.

## 4. Rollback principles

Rolling back application code is cheap. Rolling back a schema is not. The rules:

1. **Roll back to a digest, not a tag.** Re-deploy the previous `gones-api` / `gones-worker` digests
   recorded at build time. A tag can move; a digest cannot.
2. **Migrations are forward-only.** There is no `database downgrade` command and there will not be
   one: an automated down-migration is the fastest way to lose data during an incident.
3. **Therefore every migration must be backward-compatible with the previous application version**
   for at least one release. Add columns nullable, backfill separately, drop only after the version
   that stopped writing them has been running for a full release cycle. Rename by adding, dual-writing
   and removing — never by `ALTER ... RENAME` in one step.
4. **If a rollback needs the old schema, it is a restore, not a rollback.** Go to §7, accept the data
   loss window between the dump and now, and treat it as an incident.
5. **Roll the Worker back with the API.** They share the outbox and the scheduler tables; a version
   skew across a schema change is the one combination that has no test coverage.
6. Feature flags (`GONES_FEATURES__*`) are the cheap rollback: turning a capability off does not need
   a redeploy of a different digest, and the API refuses to serve a disabled capability's routes.

**Deferred:** blue/green or canary mechanics, traffic shifting and automated rollback triggers — all
of those belong to the hosting decision.

## 5. Secret rotation

Every secret is injected as a **file**, never as an environment value, so rotation is a file swap
plus a restart. The API asserts this: `GONES_DB_CONNECTION` is absent from its process environment in
the release rehearsal.

| Secret | File key | Rotation |
| --- | --- | --- |
| Database DSN | `GONES_DB_CONNECTION_FILE` | create the new role/password, write the new file, restart API and Worker, then drop the old role |
| Access-token signing key | `GONES_AUTH_SIGNING_KEY_FILE` | write the new key and restart; every existing access token becomes invalid at once, and clients recover through the refresh endpoint |
| Brevo API key | `GONES_BREVO_API_KEY_FILE` | write the new key and restart the Worker; in-flight sends retry through the normal ladder |
| Brevo webhook path token | `GONES_BREVO_WEBHOOK_PATH_TOKEN_FILE` | write the new token, restart the API, then update the provider's webhook URL; see §6 for the overlap window |
| OAuth client secrets | `GONES_GOOGLE_CLIENT_SECRET_FILE`, `GONES_FACEBOOK_CLIENT_SECRET_FILE` | write the new secret and restart the API |
| Backup encryption key | `GONES_BACKUP_KEY_FILE` | **keep the old key**: archives encrypted with it stay unreadable without it. Rotate forward only, and retain old keys for as long as the archives they cover |

Rules that hold for all of them:

- Rotating a secret is a restart, not a hot reload. The processes read secret files at startup on
  purpose — a hot reload path is an extra attack surface for no operational gain.
- Never put a secret in an environment variable, a compose file, an image layer or a log line.
  `npm run images:scan` runs Gitleaks over the tree and the images to keep that honest.
- The release rehearsal generates every secret inside the stack and destroys it with the volumes, so
  the repository never contains one.

**Deferred:** a managed secret store, automatic rotation schedules and per-environment key custody.

## 6. Provider delivery webhook

The email provider reports delivery events to
`POST /api/notifications/webhooks/brevo/{webhookToken}`.

- The path token is the authentication. It is a mounted secret, compared in constant time, and it
  never appears in a log line.
- The endpoint is idempotent: a replayed event for a message that already has that delivery status is
  accepted and changes nothing. Replay protection is asserted by the abuse-surface suite.
- It must be reachable from the provider through the same TLS edge as the rest of the API. The
  rehearsal proves the full loop locally: the fake provider replays its own delivery event back
  through the TLS proxy and the API answers `204`.
- Rotating the token (§5) needs a short overlap in a real deployment: change the provider URL first
  or accept that events sent between the restart and the provider update are lost. Lost delivery
  events degrade reporting only — they never lose the email itself, which the outbox already recorded.

**Deferred:** the real provider account, the real webhook registration and real deliverability. Every
local and CI run uses the fake provider by design.

### Failed sends

| State | Meaning | Operator action |
| --- | --- | --- |
| `Pending` / `Sending` | queued or in flight | none |
| `Sent` | the provider accepted it | none |
| `Reconciliation` | the provider's answer was unclear — it may or may not have been accepted | decide, then `POST /api/admin/notifications/dead-letters/{id}/retry` with `{"operatorApproved": true}`. Approval is explicit because a blind replay can double-send a real email |
| `DeadLetter` | the provider refused it past the whole retry ladder | investigate the provider; the message is not resent automatically |

The retry ladder is 1 min → 5 min → 30 min → 2 h → 12 h, then dead letter. A circuit breaker opens
after repeated transport failures so one broken provider cannot burn the whole queue.

## 7. Backup and restore

```bash
# inside the release-test stack, or on the host with the same image and mounts
gones-backup.sh            # writes <name>.dump.enc, .sha256, .hmac and .meta.json into GONES_BACKUP_ROOT
gones-restore.sh <archive> # verifies the checksum and the key before touching the database
```

- Archives are AES-encrypted (`Salted__` header) and written **only** inside the mounted backup root.
  A path outside it exits `2`.
- A corrupt archive exits `10`, a missing or failing HMAC exits `12`, and a non-archive payload exits
  `11` — all **before** the database is touched. A restore that fails is never a half-restored
  database.
- Every archive carries an `.hmac` sidecar (HMAC-SHA256 keyed from the backup passphrase). Restore is
  **strict**: an archive without a valid MAC is refused — archives taken before the MAC existed are
  not restorable, so take a fresh backup immediately after deploying this.
- The rehearsal destroys the PostgreSQL data volume outright and restores into an empty database,
  then re-runs the migration job to prove it applies nothing new and that the append-only audit
  trigger came back with the schema.
- The rehearsal prints a local wall-clock restore duration. That number is a **measurement on one
  developer machine**, not a recovery objective.

**Deferred:** offsite storage, retention sweeps, point-in-time recovery, a backup scheduler, and any
RPO/RTO commitment. Those need real hardware and a real hosting decision.

## 8. Running a schema migration

Migrations run as their own job, never from the API process.

```bash
docker compose -f compose.release-test.yaml run --rm migrator database update
```

1. Take a backup first (§7). Always.
2. Run the migration job and require exit `0`.
3. Re-running it must apply nothing new — idempotency is asserted by the release rehearsal against
   `__EFMigrationsHistory`.
4. Only then start the new API and Worker.
5. Any new EF migration must also be added to the allowlist in `scripts/smoke-full-stack.mjs`, or
   `npm run e2e:ci` fails. That is intentional: an unreviewed schema change should not slip through.
6. Follow the backward-compatibility rule in §4.3, because there is no down-migration.

### Membership heal migration

The membership heal was a one-shot data migration, not a schema change: it soft-deleted every
organization that had been left without members, and demoted every account holding the global
`Organizer` role without a membership row. It no longer exists as a separate step — the migration
history was collapsed into a single `InitialCreate` before release and the heal was squashed into it.
There is nothing left to run, and nothing to re-run.

The two invariants it healed are enforced on every runtime write path, so no repair job replaces it:
an organization with no members is a Draft, and the global `Organizer` role is derived from live
membership.

## 9. Importing legacy browser data (the cutover CLI)

Legacy `localStorage` is origin- and device-scoped, so the cutover is a per-origin operation.

```bash
# 1. Dry run. Writes nothing.
docker compose run --rm migrator import \
  --bundle /fixtures/origin-a.private.json --bundle /fixtures/origin-b.private.json \
  --manifest /fixtures/manifest.json --mapping /fixtures/mapping.json --dry-run

# 2. Read the report, then re-run with the hash it printed.
docker compose run --rm migrator import ... --accept-report-hash sha256:<hash from the dry run>
```

- **Dry-run first is enforced, not advised.** An import without `--accept-report-hash` exits `2`
  before any database work.
- The hash covers the exact bundle set. Change one byte in one bundle and the hash no longer matches,
  so a new dry run is required. This is what stops "approve one thing, import another".
- The whole batch is a single transaction across every store. A failure mid-import leaves zero rows;
  the smoke test injects a fault to prove it.
- Re-running an already-imported batch returns the stored result instead of duplicating anything.
- Bundle checksums are canonical JSON, computed identically by the browser exporter (TypeScript) and
  the importer (C#). `npm run migration:smoke` exercises both sides.
- The audit record carries a truncated batch hash — never the bundle contents.

**Deferred:** the live cutover itself. It needs an inventory of every legacy origin and browser, an
export from each, and a soak period before the legacy static build is retired (ADR 0019).

## 10. Admin bootstrap

There is no seeded administrator. The first Admin is created by a deliberate operator action:

1. Register the account normally and verify its email address.
2. Set `GONES_BOOTSTRAP_ADMIN_EMAIL` on the migrator job to that exact address.
3. `docker compose run --rm migrator admin bootstrap --email <that address>`.

The command refuses any address other than the configured one, refuses an unverified account, and is
guarded by a one-shot marker: a second run is a **safe no-op**, not a second promotion. Promotion
revokes the account's refresh sessions, so the new privileges require a fresh sign-in.

## 11. Observability

- Logs are structured JSON on stdout. The host collects them; the application does not write files.
- Traces and metrics go to `OTEL_EXPORTER_OTLP_ENDPOINT`. The rehearsal asserts that a single
  correlation spans `Gones.Api` → PostgreSQL → `Gones.Worker` → the provider call.
- Every response carries `X-Correlation-Id`, which is also the trace correlation.
- Telemetry is redacted: no email address, token or rendered email body reaches a span, a log line or
  an audit record.

**Deferred:** the collector backend, dashboards, alert routing and log retention windows.

## 12. What is explicitly not proved here

Repeating it once, plainly, because a runbook is exactly where an unearned claim would do damage:

- No live OAuth provider, no live email provider, no real deliverability.
- No public domain, DNS, CDN or hosting vendor.
- No measured recovery objective, no offsite backup, no point-in-time recovery.
- No production traffic, no load profile, no multi-region anything.

Everything above is rehearsed **locally**, against fakes, on one machine.
