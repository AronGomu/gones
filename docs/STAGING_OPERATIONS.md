# Staging operations

Repo contract for on-demand staging on a shared host. This document does not provision a host,
select a provider, apply firewall rules, or claim managed-DB suspension. `scripts/staging-operations.mjs`
operates fixed lifecycle project `gones-staging`; backup and restore procedures separately support
fixed production project `gones-prod`.

## On-demand window

Staging has no daily timer. An authorized operator or successful candidate deploy opens one explicit,
expiring window:

```bash
npm run staging:ops -- wake 60
npm run staging:ops -- status
```

`wake` uses immutable candidate images already present on host (`--no-build`) and starts `migrator`,
`permissions`, `api`, `worker`, and `frontend`. Compose dependency conditions enforce migration and
grants before application services. Duration is 1–4,320 minutes (maximum 72 hours). A second wake
is refused while window is active. CI must call `wake` only after candidate build, verification,
and budget checks succeed; arbitrary public reqs never wake staging.

Window state persists at `GONES_STAGING_STATE_DIR/window.json` (default
`/var/lib/gones/staging`) with mode `0600`. It records environment, start, expiry, and stop state.
State file is operator hint; DB data, scheduled work, and object data remain authoritative in
persistent environment stores.

## Expiry, maintenance, and drain

Host scheduler runs `expire` every minute. It stops only active windows whose persisted expiry passed:

```bash
npm run staging:ops -- expire
```

At expiry, switch staging hostname to edge maintenance mode, then drain:

```bash
npm run staging:ops -- stop
```

Maintenance mode closes staging ingress before app services stop. Production hostname and production
Compose project stay untouched. Stop sends SIGTERM with 30-second service timeout in order:
frontend, API, Worker. Worker shutdown drains committed work under configured host shutdown timeout.
Failed service stop records `drain-failed` and keeps window state for operator repair; it does not
claim clean stop. Command never runs `down`, `--volumes`, `prune`, or host-wide Docker operation, so
staging DB and object data survive windows and restarts.

Do not expire a window during migration, backup, restore, provider verification, or in-flight release
gate. Extend by stopping and opening a newly budget-checked bounded window; never run an unbounded
background schedule. Failed drain or extension budget blocks release and raises operator alert. Edge
maintenance config/reload remains host-owned and is not implemented by this repo.

## Budget monitor

Record provider usage in private JSON snapshot. Do not put DSNs, keys, account IDs, or other secrets
in this file:

```json
{
  "fixedEur": 8,
  "objectEur": 0,
  "telemetryEur": 0,
  "emailEur": 0,
  "networkEur": 0,
  "dbPriceEurPerCuHour": 0,
  "freeDbCuHours": 100,
  "stagingDbCuHours": 18,
  "productionDbCuHours": 18,
  "stagingActiveCuBudget": 80,
  "ceilingEur": 50
}
```

Evaluate before every wake and after each provider usage update:

```bash
GONES_BUDGET_USAGE_FILE=/run/gones/private/monthly-usage.json \
  npm run staging:budget
```

Monitor sums fixed host/network cost, object/telemetry/email cost, and chargeable DB compute above
each project's free quota. It reports `ok`, `notice` (70%), `warning` (85%), or `critical` (95%) and
exits non-zero when staging exceeds 80 CU-hours or combined projection exceeds €50. Passing
projection is not invoice cap; provider checkout, tax, quota, and production demand remain external
gates. Never stop production jobs to force quota compliance.

## Per-environment encrypted backup

Each environment has own Compose project, DB DSN, backup mount, encryption key, and retention policy.
Use environment-prefixed archive names so archives cannot be confused:

```bash
GONES_BACKUP_ENVIRONMENT=staging \
GONES_BACKUP_PROJECT=gones-staging \
GONES_BACKUP_NAME=staging-20260909T120000Z \
  npm run staging:ops -- backup

GONES_BACKUP_ENVIRONMENT=production \
GONES_BACKUP_PROJECT=gones-prod \
GONES_BACKUP_COMPOSE_FILE=compose.prod.yaml \
GONES_BACKUP_NAME=production-20260909T120000Z \
  npm run staging:ops -- backup
```

Compose injects `GONES_BACKUP_DSN`/`GONES_BACKUP_DSN_FILE` and `GONES_BACKUP_KEY_FILE` into each
private backup service. `gones-backup.sh` writes encrypted dump, checksum, HMAC, and metadata only
inside that env's mounted backup root. Keep backup keys separate from app keys; app containers cannot
delete backup archives. Off-host copy, retention, and provider billing are deferred host duties.

## Isolated restore

Restore is never run against source DB. It requires explicitly separate target DSN file and isolated
target flag. Target must use same env schema and object namespace, not production data or shared bucket:

```bash
GONES_BACKUP_ENVIRONMENT=staging \
GONES_RESTORE_PROJECT=gones-staging \
GONES_RESTORE_ISOLATED=true \
GONES_RESTORE_TARGET_DSN_FILE=/run/gones/private/staging-restore-dsn \
GONES_BACKUP_FILE=staging-20260909T120000Z.dump.enc \
  npm run staging:ops -- restore
```

Production restore uses `GONES_RESTORE_PROJECT=gones-prod`, `GONES_BACKUP_ENVIRONMENT=production`,
and production-only isolated target. Staging project is rejected for production, production project
is rejected by staging lifecycle commands. `gones-restore.sh` verifies checksum, HMAC, decryption
magic, and path containment before PostgreSQL is touched. Restore then requires migration idempotency
and app/object reference checks before traffic reopens.

Restore is destructive to isolated target. Operator must confirm target emptiness and recovery point
before running it. Never use `down --volumes`, volume deletion, `docker system prune`, or production
DSN in staging cleanup.

## Evidence and open gates

Focused contract coverage:

```bash
npx vitest run ops/staging-operations.test.ts
```

Local tests prove command bounds, staging project isolation, budget arithmetic, and source-level
volume-preserving stop behavior. They do not prove real managed DB suspension, host edge maintenance,
provider billing, off-host retention, or restore against live infrastructure. Those remain staging
acceptance gates, including continuous 72-hour window and cost comparison against equivalent
always-awake DB.
