# Opt-in Worker idle runtime

State: repo implementation, local validation only. Production enablement requires external correctness/cost approval; no provider-suspension claim.

## Local use

1. L1 Apply normal migrations through existing local stack workflow. Additive migration `20260909214025_WorkerMaintenance` adds only `worker_maintenance`; existing rows/schema remain usable by polling Worker.
2. L2 For a **new isolated local project**, merge `compose.yaml` with `compose.worker-idle.yaml`. Do not add this override to an existing stack without its owner's approval. Base Compose supplies separate project-scoped wake/token volumes, owned `1654:1654` private directory, API RO mount, Worker RW mount. Example configuration inspection: `docker compose -p gones-idle-check -f compose.yaml -f compose.worker-idle.yaml config --quiet`.
3. L3 Routine probe: unauthenticated `GET /health/worker`, or Worker `dotnet Gones.Worker.dll --health`. Only Healthy returns success. `/health/live` stays process-only. `/health/ready` remains explicit DB/outbox/delivery/S3 diagnosis; never scrape it during idle windows.
4. L4 Rollback: stop isolated Worker; remove idle override from both API/Worker; restart through normal stack workflow. Keep additive table. Default polling/DB heartbeat code remains unchanged; never run old/new Workers concurrently.

## Configuration / private boundary

C1. `GONES_WORKER_IDLE_MODE` absent/`false` retains polling. Exact `true` requires configured W10a private wake plus `GONES_WORKER_HEALTH_PATH`. Partial, malformed, noncanonical, reserved paths fail startup. Health path must share private socket parent; socket, socket `.lock`, configured token-file path/inode aliases forbidden. Both API/Worker reject DB Keepalive/TCP keepalive settings in idle mode.

C2. File version1, maximum1024 bytes, regular file owned by runtime UID, mode0600; parent0700 with trusted nonsymlink ancestors. Worker uses owned temporary file + atomic rename, detects destination replacement, validates each read. Snapshot contains only state + timestamps; no job, user, secret, provider payload. Frozen36-byte wake frame/four-byte ACK unchanged. No new TCP listener or edge volume.

C3. `/health/worker` exists only in idle mode. Exact GET path terminates before DB-capable bearer-auth middleware; returns status only. Business auth + deep readiness remain unchanged. Missing/malformed/stale/future/stopped snapshot is Unhealthy; fresh failed work is Degraded. Observation/progress/deadline freshness budget45s. Busy progress cannot hide overdue work. Long individual operation beyond45s is reported stalled, even if process remains alive.

## Dispatcher

D1. PostgreSQL remains work authority. Each deadline/hint reloads existing due predicates; existing handlers own claims, locks, dedupe, eligibility,60s reminder expiry, retries, uncertainty holds. Earliest minima include planned reminders, Pending availability, Sending lease expiry, lifecycle start/end, pending plan markers, temporary/proposal image expiry, object-delete retry, daily cadence. Reconciliation notification rows never auto-resend.

D2. Startup, authenticated commit hints, fixed hourly missed-hint recovery request full reminder reconciliation. Registration lacks lifecycle planning marker. Busy passes consume buffered hints; one rerun latch preserves active keyset cursor. Only acquired committed page advances cursor. Outbox precedes planner; reminders/lifecycle run between every quantum-one outbox/image-provider operation. Legacy batch sizes unchanged.

D3. Each query/handler owns fresh scope; scopes dispose before wait. Independent kind failures preserve other work. Runtime failures back off5s→10s→20s→40s→60s; lock contention never records planner success. Daily handler failures persist1h retry; image-expiry failures retry15m. Hints never bypass floors. No-progress overdue work has1s floor. Existing provider-specific retry/lease/deletion dates remain durable authority.

D4. Four stable maintenance keys: `ReminderPlan`, `DeliveryMetadata`, `EmailHistory`, `Idempotency`. New rows start due immediately; batches drain before recording actual completion. Successful completion records `LastSucceededAt`, next UTC midnight, clears `HasFailed`. Failure preserves success, sets `HasFailed`, next1h retry. Restart restores failure/floor. Missed days collapse into one drain, not repeated daily replay. Images have exact timers, never daily cadence. Reminder time remains10:00 venue IANA/DST.

D5. Loop itself publishes private snapshot between work + every≤10s while waiting. No independent publisher, DB heartbeat, readiness scrape, checked-out connection/transaction/advisory lock during wait. Local observation renewal does not fabricate work progress.

## Executable evidence

1. T1 `dotnet restore backend/Gones.sln --locked-mode`.
2. T2 `dotnet test backend/Gones.sln --no-restore --filter 'FullyQualifiedName~WorkerDueRuntimeTests|FullyQualifiedName~WorkerRuntimeTests|FullyQualifiedName~WorkerWake|FullyQualifiedName~TournamentScheduler|FullyQualifiedName~TournamentReminderPlanner'`. Require nonzero executed tests. Real PostgreSQL + actual Worker, controllable clock/timers, intercepted commands/connections:≥10min idle, later scheduled send, independent private-socket committed wake, stale deadline requery, marker-free registration, delayed-provider fairness, failed cleanup/restart/batch drainage, auth-independent local health, deep readiness failures.
3. T3 `npx vitest run ops/worker-wake-contract.test.ts ops/worker-idle-contract.test.ts`.
4. T4 Existing `scripts/smoke-scheduler.mjs` is **polling-only**: synthetic SQL reminder dedupe is not planner-safe; idle equivalent is T2, including real planner/wake scenarios. Script rejects idle Worker before SQL fixtures.

## External gates / assumptions

A1. Exactly one Worker/environment. Host supervision, correct mount ownership, API/Worker clocks, no unapproved direct DB writers. Query minima are advisory, not atomic queue snapshots; post-commit hint bridges earlier-deadline scan/wait race; lost hints recover≤1h while process healthy.

A2. Fake scheduler time + EF connection evidence does not prove physical pooled sockets closed, TCP/network inactivity, Neon suspension/cold starts, S3/Brevo behavior, billing, host isolation,72h correctness/cost. Npgsql default Keepalive0 is validated; pooled physical sessions can outlive logical close. API startup rebuild, backups, exports, explicit deep readiness, telemetry/provider monitors remain independent cost sources.

A3. Hourly recovery permitted only if measured total cost beats equivalent always-awake DB. Production activation forbidden until external gate accepted. Existing account hard-delete queued-outbox privacy risk, lifecycle email-confirmation policy discrepancy remain separate unchanged residuals.
