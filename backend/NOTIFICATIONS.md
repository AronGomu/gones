# Notification outbox

C06 provides PostgreSQL-backed transactional email enqueueing plus a separate Worker delivery loop.

## Runtime contract

1. Application command calls `INotificationOutbox.Enqueue` before its shared `GonesDbContext.SaveChanges`.
2. PostgreSQL commits the application mutation and notification row together.
3. Worker claims bounded due rows with `FOR UPDATE SKIP LOCKED` and a lease.
4. Worker renders source-controlled FR/EN HTML and text templates in memory.
5. Configured transport accepts the message; Worker marks it Sent or schedules retry/dead-letter.
6. Sent and DeadLetter rows retain safe IDs/status/timestamps only. Recipient and template model are scrubbed.

Delivery is at-least-once. Unique dedupe keys prevent duplicate logical enqueueing. Development file transport uses an atomic dedupe-key marker, so local fake acceptance remains idempotent across crash-after-write-before-ack.

## Local configuration

```text
GONES_DB_CONNECTION=<PostgreSQL connection>
GONES_EMAIL_TRANSPORT=File
GONES_EMAIL_SINK_PATH=/absolute/path
GONES_NOTIFICATION_BATCH_SIZE=25
GONES_NOTIFICATION_POLL_MILLISECONDS=5000
GONES_NOTIFICATION_LEASE_SECONDS=120
GONES_NOTIFICATION_SEND_TIMEOUT_SECONDS=30
GONES_NOTIFICATION_BACKLOG_DEGRADED_SECONDS=300
GONES_ALLOW_TEST_NOTIFICATION=true # local smoke command only
```

Send timeout must remain shorter than lease duration. File sink writes token-redacted previews with masked recipients; raw rendered bodies remain memory-only.

## Evidence

Structured events go to Worker stdout:

- `notification.claimed`
- `notification.completed`
- `notification.retried`
- `notification.deadlettered`
- `notification.transport.failed`
- `notification.acknowledgement.failed`
- `notification.poll.failed`

Events include outbox ID, template key, attempt/status, safe error code. Recipient, token, template model, rendered content are excluded.

Readiness JSON at `/health/ready` exposes safe backlog count, oldest lag, dead-letter count. Backlog/dead letters report Degraded while retaining HTTP 200. DB failure reports Unhealthy.

Local runtime proof:

```bash
docker compose up -d --build
npm run notification:smoke
```
