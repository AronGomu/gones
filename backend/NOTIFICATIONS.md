# Notification outbox

C06 provides PostgreSQL-backed transactional email enqueueing plus a separate Worker delivery loop.

## Runtime contract

1. Application command calls `INotificationOutbox.Enqueue` before its shared `GonesDbContext.SaveChanges`.
2. PostgreSQL commits the application mutation and notification row together.
3. Worker claims bounded due rows with `FOR UPDATE SKIP LOCKED` and a lease.
4. Worker renders source-controlled FR/EN HTML and text templates in memory.
5. Configured transport accepts the message; Worker stores provider message ID/status only, then scrubs recipient/template model.
6. Transient failures retry after 1m/5m/30m/2h/12h; permanent failures or exhausted retries dead-letter and scrub payload.
7. Uncertain acceptance is held in Reconciliation. Recovery reuses stable provider idempotency + outbox correlation inside provider window; beyond it Worker never blindly resends.
8. Authenticated HTTPS webhooks dedupe by replay key, map provider events to neutral statuses, ignore recipient/content, then reconcile uncertain sends.

Unique dedupe keys prevent duplicate logical enqueueing. Development file transport uses an atomic dedupe-key marker. Brevo requests use one stable idempotency key/correlation per outbox row. Admin retry requires explicit operator approval, creates an audited new attempt, and scrubs the prior reconciliation payload.

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

Brevo Worker configuration:

```text
GONES_EMAIL_TRANSPORT=Brevo
GONES_BREVO_API_BASE_URL=https://api.brevo.com/v3/
GONES_BREVO_API_KEY=<secret> # or GONES_BREVO_API_KEY_FILE=/run/secrets/...
GONES_BREVO_SENDER_EMAIL=<verified sender>
GONES_BREVO_SENDER_NAME=Gones Calendar
GONES_BREVO_MAX_CONCURRENCY=4
GONES_BREVO_TIMEOUT_SECONDS=25
GONES_BREVO_IDEMPOTENCY_WINDOW_HOURS=24
```

API webhook configuration:

```text
GONES_BREVO_WEBHOOK_PATH_TOKEN=<rotated random 32+ base64url chars>
# or GONES_BREVO_WEBHOOK_PATH_TOKEN_FILE=/run/secrets/...
GONES_BREVO_WEBHOOK_RATE_LIMIT_PER_MINUTE=60
```

Configure Brevo URL as `https://<future-domain>/api/notifications/webhooks/brevo/<token>`. Rotate token by changing API secret plus provider URL together. Route logs use template, never token. Sender/domain DNS verification, production domain, real key, live deliverability remain deferred until hosting selection.

Send timeout must remain shorter than lease duration. File sink writes token-redacted previews with masked recipients; raw rendered bodies remain memory-only. Delivery events/provider IDs expire after 1y; cleanup records aggregate status metrics before deletion and scrubs stale reconciliation payloads.

## Evidence

Structured events go to Worker stdout:

- `notification.claimed`
- `notification.completed`
- `notification.retried`
- `notification.deadlettered`
- `notification.transport.failed`
- `notification.acknowledgement.failed`
- `notification.poll.failed`
- `notification.reconciliation_held`
- `notification.provider.circuit_opened`
- `notification.delivery_metadata.cleaned`

Events include outbox ID, template key, attempt/status, safe error code. Recipient, path token, API key, provider payload, template model, rendered content are excluded. Provider-neutral metrics cover latency, mapped delivery status, retries, dead letters, reconciliation holds, cleanup; scheduler metrics remain separate and vendor neutral.

Readiness JSON at `/health/ready` exposes safe backlog, dead-letter, reconciliation counts. Dead letters/stale reconciliation report Degraded while retaining HTTP 200. DB failure reports Unhealthy.

Local runtime proof:

```bash
docker compose up -d --build
npm run notification:smoke
```
