# Gones Calendar runtime contract

What a host has to provide to run Gones Calendar V1, and nothing more. No hosting vendor, registry,
managed database, secret manager or IaC tool is chosen yet, so this document is the whole interface.
If a platform can run Linux OCI images, mount a volume, inject a file and terminate TLS, it can run
Gones Calendar.

Verified continuously by `ops/image-contract.test.ts`, `ops/host-contract.test.ts`,
`npm run images:verify`, `npm run release:rehearsal` and `npm run backup:rehearsal`.

What an operator *does* with that host — deploy ordering, rollback principles, secret rotation, the
provider webhook, backup and restore, schema migrations, the legacy-import CLI, Admin bootstrap and
observability — is [`OPERATIONS.md`](OPERATIONS.md).

## Artifacts

| Image | Shape | Runs as | Stop signal | Probe |
| --- | --- | --- | --- | --- |
| `gones-api` | long-running HTTP on `:8080` | uid 1654 | `SIGTERM` | `GET /health/live`, `GET /health/ready` |
| `gones-worker` | long-running singleton | uid 1654 | `SIGTERM` | observed via the API's `workerHeartbeat` readiness check |
| `gones-migrator` | run to completion | uid 1654 | `SIGTERM` | exit code |
| `gones-backup` | run to completion | uid 65532 | `SIGTERM` | exit code |
| `gones-frontend` | static files on `:8080` | uid 101 | `SIGQUIT` | `GET /health` |

All five are `linux/amd64` OCI images built from digest-pinned public base images, run happily with a
read-only root filesystem plus a writable `/tmp`, drop every Linux capability, and take no cloud SDK
dependency of any kind.

## Frontend data authority

The static frontend artifact declares one data authority at build time and never infers it
(ADR 0019). A host serving Gones Calendar V1 must serve a `server`-mode artifact:

| Build arg | Value for the V1 server stack |
| --- | --- |
| `GONES_FRONTEND_DATA_MODE` | `server` |
| `GONES_FRONTEND_API_BASE_URL` | the exact public API origin (also baked into the CSP `connect-src`) |
| `GONES_FRONTEND_AUTH_V1` / `GONES_FRONTEND_ADMIN_V1` | optional; admin requires auth |

The only other legal declaration is `GONES_FRONTEND_DATA_MODE=legacy-browser` with an **empty**
`GONES_FRONTEND_API_BASE_URL` and both capabilities off — the frozen static deployment. Anything else
fails `scripts/check-frontend-data-authority.mjs` during the image build; a hand-edited artifact
refuses to bootstrap rather than falling back to browser storage. In `server` mode the database is
the single authority and the browser holds only language, view preference, filters and the anonymous
public read cache.

## Generic host requirements

### TLS reverse proxy

The application never terminates TLS. The host must place a proxy in front of `gones-api` (and
`gones-frontend`) that terminates TLS and sets `X-Forwarded-For` and `X-Forwarded-Proto`.

The proxy's address must be listed in `GONES_FORWARDED_PROXIES` (IP addresses and/or CIDR networks,
comma separated) with `GONES_FORWARDED_PROXY_HOP_LIMIT` set to the number of proxies in front of the
API. **Until that list is populated, forwarded headers are ignored completely**: the API keeps using
the socket address, HSTS is not emitted, and every anonymous caller shares a single rate-limit
partition. That is the fail-closed default; see ADR 0017 and ADR 0018.

The proxy is also the only place a global/edge rate limiter can live. The in-process limits in
ADR 0017 are mandatory but not sufficient against volumetric abuse.

### Persistent PostgreSQL

PostgreSQL 17 with durable storage. Two roles are expected, created by
`deploy/postgres/init-roles.sql`: a migration role that owns the schema and an application role with
`SELECT/INSERT/UPDATE/DELETE` only and no `UPDATE`/`DELETE`/`TRUNCATE` on `audit_records`.

- API and Worker connect with the application role via `GONES_DB_CONNECTION` or
  `GONES_DB_CONNECTION_FILE`.
- The migration job connects with the migration role.

### Secret injection

Every secret may arrive as an environment variable or as a mounted file; **never both**, and
supplying both fails startup rather than picking one silently.

| Secret | Env | File |
| --- | --- | --- |
| Database DSN | `GONES_DB_CONNECTION` | `GONES_DB_CONNECTION_FILE` |
| Access-token signing key (32+ chars) | `GONES_AUTH_SIGNING_KEY` | `GONES_AUTH_SIGNING_KEY_FILE` |
| Google OAuth client secret | `GONES_GOOGLE_CLIENT_SECRET` | `GONES_GOOGLE_CLIENT_SECRET_FILE` |
| Facebook OAuth client secret | `GONES_FACEBOOK_CLIENT_SECRET` | `GONES_FACEBOOK_CLIENT_SECRET_FILE` |
| Brevo API key | `GONES_BREVO_API_KEY` | `GONES_BREVO_API_KEY_FILE` |
| Brevo webhook path token | `GONES_BREVO_WEBHOOK_PATH_TOKEN` | `GONES_BREVO_WEBHOOK_PATH_TOKEN_FILE` |
| Backup passphrase | `GONES_BACKUP_KEY` | `GONES_BACKUP_KEY_FILE` |

Non-secret runtime keys: `GONES_ALLOWED_ORIGINS` (exact origins, wildcards rejected),
`GONES_PUBLIC_APP_ORIGIN`, `GONES_FEATURES__*`, `GONES_AUTH_PROVIDER`,
`GONES_SHUTDOWN_TIMEOUT_SECONDS`, and the rate-limit overrides listed in ADR 0017.

A self-hosted or non-Google identity provider is supported without a code change through
`GONES_OAUTH_GOOGLE_AUTHORIZATION_ENDPOINT`, `GONES_OAUTH_GOOGLE_TOKEN_ENDPOINT`,
`GONES_OAUTH_GOOGLE_USERINFO_ENDPOINT` and the `FACEBOOK` equivalents. They accept absolute HTTPS
URLs only.

### Singleton Worker

Exactly one `gones-worker` replica. Leadership and work claiming are arbitrated inside PostgreSQL —
advisory locks for the scheduler, leases for the notification outbox — so no scheduler primitive is
required from the host, but running two replicas doubles polling load for no benefit and is not a
supported configuration. `GONES_NOTIFICATION_LEASE_SECONDS` (default 120) bounds how long a crashed
replica's claimed work stays unavailable, and must stay above
`GONES_NOTIFICATION_SEND_TIMEOUT_SECONDS`.

### Migration job

Run `gones-migrator database update` to completion **before** rolling out API or Worker, and treat a
non-zero exit as a failed rollout. Migrations are idempotent: re-running the job on an up-to-date
database applies nothing and exits 0, which the release rehearsal asserts on every run.

Data import from the legacy browser deployment is a separate, dry-run-first command on the same
image (`gones-migrator import --help`).

### Backup scheduler

Schedule `gones-backup` (any cron-like facility) with `GONES_BACKUP_ROOT` pointed at a mounted,
persistent directory and `GONES_BACKUP_DSN`/`GONES_BACKUP_KEY_FILE` injected. It writes exactly three
files per run and never touches anything outside that root:

```
<name>.dump.enc         AES-256-CBC(PBKDF2, 600k iterations) over a pg_dump custom-format archive
<name>.dump.enc.sha256  checksum of the ciphertext
<name>.meta.json        creation time, server/client versions, cipher, checksum algorithm
```

Restore with `gones-restore.sh <name>` from the same image. It refuses to touch the database when the
checksum fails (exit 10), when the passphrase is wrong (exit 11) or when the requested path escapes
the backup root (exit 2). `GONES_BACKUP_VERIFY_ONLY=true` runs both checks and stops.

**Deferred:** shipping archives to remote/offsite storage, retention and expiry sweeps, managed PITR,
and measured RPO/RTO. The host is responsible for retaining and replicating the mounted directory
until that decision is made.

### OTLP collector

Set `OTEL_EXPORTER_OTLP_ENDPOINT` (and optionally `OTEL_EXPORTER_OTLP_PROTOCOL`) on API and Worker to
any OpenTelemetry collector. Traces, metrics and logs are exported through it. Leaving it empty
disables export; the applications keep running and keep writing to stdout.

### Log retention

Both applications write structured records to stdout/stderr and nothing else — no log files, no log
shipping agent, no vendor SDK. The host is responsible for collection and retention. Retention
targets the applications are built for: security and admin audit records live in PostgreSQL
indefinitely, notification delivery metadata is pruned by the Worker after one year, and email bodies
are never persisted. Application logs are redacted at the source (`SensitiveDataRedactionProcessor`),
so no token, password, email body or raw rich HTML reaches the host's log store.

## What is deliberately not here

Hosting vendor, DNS, CDN, managed PostgreSQL, managed secret store, container registry, remote backup
storage and IaC are all deferred (see the implementation plan, §1). Nothing in this contract assumes
any of them, and nothing in the repository names one. The CI pipeline in
`.github/workflows/release-images.yml` builds, verifies and scans the artifacts but never publishes
them; the cosign step is an inert hook until a registry with OIDC trust is chosen.
