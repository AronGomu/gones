# Shared-host static runtime contract

**DEPLOYMENT BLOCKED.** `compose.staging.yaml` / `compose.prod.yaml` are config-only foundations, not deployed environments. Production remains unreleased. Do not start either stack until gates below pass. Existing local/fake release rehearsal remains unchanged.

## Config-only verification

V1. Run from repo root. Commands only parse Compose; they do not contact Docker daemon/providers, pull images, read mounted secret contents, create networks, or start containers. Fixtures contain reserved `.invalid` origins/image refs, nonexistent credential paths; never use fixtures for `up`, `run`, or `pull`.

```bash
env -i PATH="$PATH" HOME="$HOME" docker compose --env-file deploy/shared-host/config.fixture.env -p gones-staging -f compose.staging.yaml config --quiet
env -i PATH="$PATH" HOME="$HOME" docker compose --env-file deploy/shared-host/config.fixture.env -p gones-prod -f compose.prod.yaml config --quiet
node scripts/shared-host-config.mjs --fixture
npx vitest run ops/shared-host-contract.test.ts
```

V2. Direct fixture `config --quiet` success remains **UNAVAILABLE** in this agent harness (protected-path denial). Do not retry, rename the fixture, change protection policy, or bypass the guard. Passing parsed-Compose tests/validator does not discharge that separate gate; operator execution through an approved path must supply both exit codes. Missing required inputs fail Compose interpolation. Compose itself does **not** validate digest format or HTTPS origins: always follow with `scripts/shared-host-config.mjs`. Without `--fixture`, helper consumes exported non-secret config, uses `/dev/null` instead of implicit `.env`, validates both environments including profiled backup. Diagnostics omit substituted values. Static validator is not I4's privileged deployment-policy/provenance verifier.

V3. Required non-secret image slots: `GONES_RELEASE_API_IMAGE`, `GONES_RELEASE_WORKER_IMAGE`, `GONES_RELEASE_MIGRATOR_IMAGE`, `GONES_RELEASE_FRONTEND_IMAGE`, `GONES_RELEASE_BACKUP_IMAGE`, `GONES_COLLECTOR_IMAGE`. Values must be registry `repository@sha256:<64 lowercase hex>` refs, never tags/local image IDs. `pull_policy: never` requires host-controlled, signature-verified preload. Artifact names/provenance source: `scripts/release-images.mjs`; runtime UIDs/entrypoints: five Dockerfiles listed in `docs/RUNTIME_CONTRACT.md`. API/Worker provenance must include the integrated policy/private-wake/idle configuration contract at `b939447b8e36103b3ccd58ed11ed281635112468` or a verified compatible descendant. A syntactically valid digest does not attest that code is inside the image; older images may ignore these keys.

V4. For each `GONES_STAGING_` / `GONES_PROD_` prefix require `ORIGIN`, `OBJECT_ENDPOINT`, `OBJECT_BUCKET`, `GOOGLE_CLIENT_ID`, `FACEBOOK_CLIENT_ID`, `SENDER_EMAIL`. Origins must be distinct canonical HTTPS DNS origins, no port/path/query/credentials/trailing slash. This deliberately narrow contract avoids nginx/runtime JSON injection. No provider hostname is chosen. Object endpoint must be EU R2 `https://<account>.eu.r2.cloudflarestorage.com`; region fixed `auto`. Distinct bucket/OAuth apps/senders required. Endpoint account may match; scoped keys/buckets must not.

V5. Explicit offline nginx check (separate from config-only commands): requires Docker daemon, already-cached digest-pinned nginx base from `Dockerfile`, OpenSSL on PATH. `node scripts/shared-host-nginx-check.mjs` uses one disposable non-root container, `--network none`, no ports/pulls, only generated fixture mounts/tmpfs, temporary self-signed fixture cert; removes only its own UUID container/scratch directory. It parses both rendered edge templates plus frontend main/runtime config, serves synthetic token-bearing frontend requests, verifies stdout/stderr suppression on success/error paths. Actual host-wide TLS/routing/log-channel validation remains external.

## Secrets / host files

S1. Fixed host roots: `/etc/gones/staging/secrets/` vs `/etc/gones/prod/secrets/`. No configurable secret-directory root. Every listed filename is an individual read-only Compose secret bind to `/run/secrets/gones-<environment>/<filename>`. Frontend has no credentials. Runtime loaders already exist (`backend/src/Gones.Infrastructure/Configuration/GonesHostRuntime.cs`, `ExternalOAuthOptions.cs`, `BrevoEmailTransport.cs`, API `BrevoWebhookEndpoints.cs`, `deploy/backup/gones-backup.sh`); no new `_FILE` loader assumed.

| ID | Filename | Consumer / UID | Required private content / authority |
| --- | --- | --- | --- |
| S2 | `db-migration` | Migrator / 1654 | Npgsql DSN, environment DB, `gones_migration` schema owner |
| S3 | `db-permissions-service` | permissions / 65532 | libpq service file, `[gones]` section, same DB/migration role as S2; never Npgsql format |
| S4 | `db-app` | API, Worker / 1654 | Npgsql DSN, only environment `gones_app` role |
| S5 | `auth-signing` | API, Worker / 1654 | strong random signing key, 32+ chars; different per environment |
| S6 | `object-access`, `object-secret` | API, Worker / 1654 | private environment Event-image bucket keys; cannot access backup bucket |
| S7 | `google-secret`, `facebook-secret` | API / 1654 | corresponding environment OAuth app secrets |
| S8 | `webhook-token` | API / 1654 | environment Brevo webhook path token |
| S9 | `brevo-key` | Worker / 1654 | environment sender/API credential; I3 recipient enforcement mandatory |
| S10 | `db-backup` | backup / 65532 | libpq DSN, dedicated `gones_backup` read role, not migration owner |
| S11 | `backup-key` | backup / 65532 | independent encryption passphrase; controlled recovery custody |
| S12 | `otel-auth` | Collector / 10001 | I3-defined hosted credential format; separate environment tenant/write scope |
| S17 | `staging-policy` | staging API, Worker / 1654 only | immutable policy JSON from `STAGING_ACCESS.md`; no prod file/mount |
| S18 | `bootstrap-admin-email` | staging API, Worker / 1654 only | private owner mailbox, explicitly present in both policy lists; no account creation/promotion |
| S19 | `worker-wake-token` | API, Worker / 1654 | 64 hex characters encoding 32 random bytes; distinct private material per environment |

S13. Host operator owns directories/files, not CI or app. Example least-permission pattern: secret directory root-owned `0700`; individual files root-owned, group matching listed UID, `0440`. Compose file-backed secrets do not reliably implement requested uid/gid/mode remapping: host inode permissions are authoritative. Verify actual read access using pinned images/host user-namespace mapping before deployment. Never broaden directory mounts or make credentials world-readable to repair startup.

S14. Collector config is external `/etc/gones/<environment>/telemetry/collector.yaml`, individually mounted read-only at `/etc/otelcol-contrib/config.yaml`; `create_host_path: false` prevents creating missing directories as substitutes. Host config must reference only S12's mounted auth target through a supported Collector config provider/extension. I3 must validate pinned Collector image UID 10001, TLS endpoint, env/resource identity, credential loader, bounded memory/queue/batch/retry limits below 192 MiB, redaction, ingestion/alert delivery. No default/debug exporter or imaginary credential env key is supplied here. Config presence does not prove telemetry works.

S15. Backup output `/var/lib/gones/<environment>/backups` must preexist, writable by UID 65532, inaccessible to other environment/app. Only backup mounts it. Existing image writes encrypted DB archives; does **not** copy Event objects, upload remote checkpoints, manage retention, or supply coordinated restore. I5 owns separate private backup bucket, dedicated off-host upload credential, quiescence, retention, isolated restore target/credential. Never give app keys access to backup storage. Read-only backup role cannot restore: restore needs separate explicitly approved isolated-target authority, never this backup DSN.

S16. Secret contents remain unverified by static checks. Operator must prove distinct key material, separate PG17 projects, TLS hostname verification (`SSL Mode=VerifyFull` for Npgsql; `sslmode=verify-full` for libpq), trusted CA availability/root config, exact DB hosts/roles, bucket privacy/scopes. No transaction pooler for Worker advisory locks; use direct/session-safe connection. Do not weaken TLS or expose DSNs in logs/argv diagnostics. Existing backup tooling passes DSN to pg_dump internally; host root/Docker admin already lies outside container isolation boundary.

## Staging policy / private Worker wake

P1. Staging API/Worker fix `GONES_DEPLOYMENT_ENVIRONMENT=staging`; prod fixes `production`. Existing `ASPNETCORE_ENVIRONMENT=Production` / `DOTNET_ENVIRONMENT=Production` remain runtime-hardening settings, not staging bypasses. Staging requires `GONES_STAGING_POLICY_FILE=/run/secrets/gones-staging/staging-policy` and `GONES_BOOTSTRAP_ADMIN_EMAIL_FILE=/run/secrets/gones-staging/bootstrap-admin-email`. Both processes receive the same two individually mounted RO files; prod and all other services receive neither. Files are root:1654 `0440`, source secret directory root-owned `0700`; S13's actual engine mapping/readability gate applies. Never supply owner/policy contents through shell, frontend config, argv, logs, artifacts, or repository fixtures.

P2. [Staging access policy](STAGING_ACCESS.md) is authoritative for strict JSON shape/limits, owner membership, revision and whole-second UTC cutoff. Policy loads once per process; edits do not hot reload. Before reopening staging ingress, privileged deployment tooling must privately verify matching API/Worker policy bytes, revision, cutoff, owner, deployment marker and source provenance. Do not publish policy/owner contents or their fingerprints in reports. Configured eligibility does not create or promote the owner; bootstrap readiness remains a separate gate.

P3. Apply/revoke only through `STAGING_ACCESS.md`'s quiescent procedure: close staging ingress, drain/stop every old staging API/Worker and in-flight provider request; choose a new revision/cutoff strictly after final old issuance/drain and previous cutoff; wait until cutoff; start replacements with identical immutable policy; verify old credentials/removed recipients denied before reopening. No overlapping rolling update, old-policy rollback, timestamp rollback, or policy-disable recovery. Production/shared edge remain untouched. Removing a tester requires both lists; re-invitation needs another newer revision/cutoff. Provider-accepted email cannot be recalled.

P4. Both envs fix `GONES_WORKER_WAKE_SOCKET=/run/gones-worker-<environment>/wake.sock` and `GONES_WORKER_WAKE_TOKEN_FILE=/run/secrets/gones-<environment>/worker-wake-token` (`<environment>` is `staging` or `prod`). Host precreates `/var/lib/gones/<environment>/worker-wake`, mounted only into API/Worker at `/run/gones-worker-<environment>`: API RO, Worker RW, `create_host_path: false`. Dedicated directory owner `1654:1654`, mode `0700`; Worker creates socket and persistent `wake.sock.lock` mode `0600`. Source/container ancestors must be real trusted root/runtime-UID directories without group/other write or symlinks. Privileged host admission must reject source symlinks, hardlink/bind aliases, cross-env inode aliases and reused token material. Token is individual RO root:1654 `0440` secret outside writable wake directory; no secret-directory mount, edge/frontend/Collector token or socket access, root init service, TCP listener, or public wake route.

P5. [Worker scheduling](WORKER_SCHEDULING.md) freezes payload-free 36-byte authenticated hint / four-byte ACK. Commit precedes hint; DB remains authority; private wake only interrupts polling wait here. Existing status-only `worker.wake.listening` / `worker.wake.initialization_failed` events and `gones.worker.wake.received` outcome counter are runtime observability, not proof of host IPC. Host must verify actual UID/RO/RW boundaries, singleton startup/restart/stale-lock handling and private hint reception using verified images before adoption. Rotate token via coordinated API/Worker replacement with identical new private material, never overlapping mismatched peers or manually removing a live owner's socket/lock. No such host operation is authorized by this document.

P6. Both base configs fix `GONES_WORKER_IDLE_MODE="false"`; no `GONES_WORKER_HEALTH_PATH`, healthcheck, command or entrypoint override. API inherits image DB-free `/health/live`; Worker image has no healthcheck. Polling and DB heartbeat remain active; `/health/ready` is explicit deep diagnosis, never routine idle scraping. No shared-host idle override is supplied. Future opt-in requires separate reviewed API/Worker config under [Worker idle runtime](WORKER_IDLE.md): health snapshot in private socket parent, distinct from socket/lock/token paths and inode aliases, disabled DB keepalive, local-only health probe, external W12 correctness/cost acceptance. Hourly missed-hint recovery remains conditional on measured savings versus equivalent always-awake DB; no suspension/cost claim here.

## Ordering / resources

O1. Source pattern: `compose.release-test.yaml`. New ordering: Migrator `database update` exit 0 → permissions `psql --no-psqlrc` transaction exit 0 → API + singleton Worker → frontend after image `/health/live` probe. Permissions reuses backup image's PG17 client, never starts local DB. `deploy/shared-host/grants.sql` grants DB CONNECT/schema USAGE, app DML/sequence rights, audit append-only except existing `actor_id` anonymization, backup SELECT-only tables/sequences. No passwords, role creation, default broad app grants, owner bootstrap, or seed data.

O2. Host must precreate fixed roles, keep migration schema ownership, deny app/backup role memberships/admin/create privileges, verify no inherited/PUBLIC privilege bypass, preinstall/authorize `pgcrypto` required by `20260903174856_SingularEventImage.cs`. Grants file does not sanitize arbitrary legacy role grants. PostgreSQL audit triggers remain authoritative (`20260822145459_InitialCreate.cs`). Actual grant execution/idempotence/TLS remain integration gates, not static proof.

O3. Compose dependencies are initial-start ordering, not a rollout transaction. I4 must checkpoint, enter maintenance, serialize shared-host heavy operations, force fresh migration/grants jobs per candidate, prevent old app writes during incompatible migration, reject failure, verify readiness before serving. Never downgrade schema automatically. No default Compose operation is approved here.

| ID | Service | CPU ceiling | RAM / swap ceiling | PID cap |
| --- | --- | --- | --- | --- |
| O4 | API | 0.5 | 512 MiB / no extra swap | 128 |
| O5 | Worker | 0.35 | 384 MiB / no extra swap | 128 |
| O6 | frontend | 0.1 | 64 MiB / no extra swap | 128 |
| O7 | Collector | 0.15 | 192 MiB / no extra swap | 128 |
| O8 | Migrator | 0.5 | 384 MiB / no extra swap | 128 |
| O9 | permissions | 0.25 | 128 MiB / no extra swap | 128 |
| O10 | backup, manual tools profile | 0.5 | 384 MiB / no extra swap | 128 |

O11. Per-env steady cap 1152 MiB; dual steady cap 2304 MiB. One serialized 384 MiB job → 2688 MiB, nominal 1408 MiB of 4 GiB remains for kernel/Docker/edge/cache/headroom. Exited jobs must not consume resources. CPU aggregate steady ceilings 2.2 > provisional 2 vCPU; caps are limits, **not reservations or capacity proof**. Traffic, image processing, migrations, backup plaintext tmpfs, telemetry outages can exceed safe capacity. I4/I5 must measure overlap, protect prod headroom, reject rollout or resize if insufficient. No 4GB guarantee.

O12. Every container uses read-only rootfs, dropped capabilities, no-new-privileges, bounded tmpfs/PIDs/json-file logs (`5m × 2` per service). .NET 25s graceful shutdown fits 40s stop grace; migrations/draining still need lifecycle coordination. Frontend keeps UID-101 nginx cache/run tmpfs plus runtime-config `/tmp`; no frontend image rewrite. Shared-host-only `frontend-nginx.conf` mounts read-only at `/etc/nginx/nginx.conf`, suppresses downstream raw access/error logs (including pre-server errors), preserves image entrypoint plus rendered `/etc/nginx/conf.d/*.conf` runtime include. Image health checks are process-only. Worker still polls/writes DB heartbeat in current source; no polling knob changed.

## Host-owned edge / networks

N1. Host operator creates two distinct **internal** bridge networks, verifies no subnet conflict, attaches separately managed shared TLS edge with fixed IPs. App Compose declares these external → app lifecycle cannot create/remove them. Core networks are environment-local Compose bridges with provider egress. No app publishes any port; no Docker socket, host namespace, local DB/object fake, cross-environment mount, or edge config mount exists. Environment-private wake bind is API RO/Worker RW only (P4).

| ID | Network / subnet | Host edge | API | Frontend |
| --- | --- | --- | --- | --- |
| N2 | `gones-staging-edge` / `172.30.10.0/24` | `172.30.10.2` | `172.30.10.10:8080` | `172.30.10.20:8080` |
| N3 | `gones-prod-edge` / `172.30.20.0/24` | `172.30.20.2` | `172.30.20.10:8080` | `172.30.20.20:8080` |

N4. Static upstream IPs avoid ambiguous Docker DNS aliases (`api`/`frontend`) on multi-network shared edge. API trusts only corresponding edge `.2`, hop limit 1, never full subnet. Actual edge source IP, forwarding/firewall behavior, bridge isolation are host gates. External networks alone do not prove their internal/IPAM properties; inspect them before any deployment. Only host edge publishes 80/443; SSH restricted key-only; apps cannot administer Docker. Host compromise/Docker admin/kernel/disk failure can affect both environments: shared-host risk remains accepted, not separate-VM isolation.

N5. `deploy/shared-host/edge.staging.conf.template` / `edge.prod.conf.template` are **host-owned input assets**, not automatically installed. Operator derives `GONES_STAGING_HOST` / `GONES_PROD_HOST` from validated origins, substitutes only that named variable (not nginx `$variables`), installs independent TLS paths, validates whole nginx config before graceful reload. Host must reject unknown Host/SNI via default 80/443 servers, use safe fixed-host redirects, deny staging deploy identity write/reload access. No host renderer/reloader/bootstrap is implemented here.

N6. Staging response header `X-Robots-Tag: noindex, nofollow, noarchive` plus `/robots.txt` is crawler instruction, **not auth**. Production snippet contains neither staging rule. HTTP error/maintenance/redirect responses must retain correct environment indexing policy; host default listeners need matching policy. I5 owns staging maintenance/wake/drain routing. Never let public requests wake staging or acknowledge offline webhook delivery with false 2xx.

N7. Snippets explicitly override inherited access logs (`off`), nginx request error logs (`/dev/null crit`), built-in gzip (`off`) at server scope. Keep API `Content-Encoding`/`Vary` unchanged; no proxy compression plugin may re-enable compression. Ordinary API body cap 1048576 bytes; `/api/event-images` cap 5308416 bytes matches 5 MiB + 64 KiB multipart overhead (`ApiBoundaryMiddleware.cs`). Per-route app limits still enforce method-specific rules.

N8. Logging suppression intentionally trades edge request diagnostics for token safety. Host **http/main/default-server** configuration must also suppress raw request/error logs, debug logs, traces, module/WAF captures, including TLS/pre-server errors. Tokens can occur in webhook/invitation paths, OAuth/reset/setup queries; `access_log off` alone is insufficient. No `$request`, `$request_uri`, `$args`, Authorization, cookies, or request bodies in any exported record. Use status/count-only operational telemetry plus application redacted route logs. I3/live gate must send sentinels through successful/error/malformed/upstream-failure paths, verify every log channel; snippets alone do not prove secrecy. Module-enabled nginx requires whole-config review, including non-gzip compressors.

## Dependency gates / boundary matrix

| ID | Static foundation covers | Still deploy-blocking |
| --- | --- | --- |
| B1 | exact same-origin config, edge inputs | verified two HTTPS hostnames, TLS/default-host rejection, separate signing keys; JWT issuer/audience currently fixed in API |
| B2 | fixed projects/singleton/caps | VM capacity, prod headroom, actual UID/image startup |
| B3 | private app ports/networks/fixed proxy trust | firewall/SSH/edge IPAM/TLS/forwarding/runtime sentinel checks |
| B4 | separate mounts, migration/grants ordering | managed PG17 roles/TLS/advisory-lock/session behavior, grant execution |
| B5 | EU endpoint/region, scoped bucket/key inputs | private buckets, SDK/checksum compatibility, scoped credential proof |
| B6 | individual file targets, UID inventory | ACL/readability/rotation/provenance/secret-content separation |
| B7 | literal staging marker, private policy/owner file wiring to integrated runtime | hosted policy identity/quiescence/revocation/recipient proof; private owner bootstrap readiness |
| B8 | staging-only header/robots asset | actual host error/redirect/maintenance noindex, no prod leakage |
| B9 | separate mounts/networks/config | actual external credential/dataset separation; never copy prod data |
| B10 | API/Worker-only private wake; no Docker/edge mounts | I4 constrained host-owned deploy service, signed immutable manifest, approved prod authority |
| B11 | edge excluded; external env attachments | I4/I5 host-only reload/lifecycle, shared-host failure probes |

D1. I3 also owns safe empty-DB emailed owner setup, verified Admin promotion/redeploy invariants, release-version/hosted telemetry/alerts. Never embed owner email, default password, verification bypass, or unsupported bootstrap/invite env keys here. Bootstrap-pending blocks readiness.

D2. W10 private wake is wired to the integrated runtime, scoped per P4–P5. W10b/W11 idle/health implementation remains OFF in these base configs (P6); no automatic override. Host permissions, immutable compatible image provenance and actual private wake/startup/restart evidence remain deployment gates. W12 must prove 72h correctness + measured lower total cost before idle activation or conditionally approved hourly recovery. Polling/DB heartbeat prevents sleep; no DB-sleep claim from this Compose.

D3. I4 owns CI/provenance/signatures/immutable promotion/constrained deploy; I5 owns on-demand bounded windows, serialized backup/restore/drain, combined budget/host-level containment. No bootstrap/constrained deploy implementation or proof in I2a. Full I2/I2b remains incomplete; real staging/prod deployment not authorized.

## Assumptions

A1. Two explicit configs intentionally duplicate shape: separate environment ownership/evolution, no shared overlay that staging deploy can mutate into prod. Tests keep shared invariants aligned. Shared readonly grants/frontend policy assets must be installed into separate host-owned immutable environment release directories by I4, not one staging-writable checkout backing prod mounts.
A2. Fixed paths/subnets/UIDs are proposed host contract, not inspected live host facts. Operator must validate collision-free IPAM, readable secret inodes, supported pinned image startup before adoption.
A3. Static validation cannot verify secret contents, external provider scopes, live network isolation, memory capacity, or deployment authority. Successful fixture command is not release readiness.
