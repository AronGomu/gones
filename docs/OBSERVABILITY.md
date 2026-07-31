# Observability and operational health

Gones emits OpenTelemetry traces, metrics, and structured logs. Export is vendor-neutral:

- `OTEL_EXPORTER_OTLP_ENDPOINT`: enable OTLP/gRPC export, for example `http://otel-collector:4317`.
- `GONES_OTEL_CONSOLE_EXPORTER=true`: enable local console traces, metrics, and logs.
- Standard `OTEL_*` resource/exporter variables remain supported by OpenTelemetry SDK.

ASP.NET Core, `HttpClient`, Npgsql, and .NET runtime instrumentation are enabled. Custom sources add notification producer/consumer spans plus API, outbox, and Worker signals. Telemetry uses route templates, status codes, safe IDs, template keys, and error codes. Raw IPs, recipients, email addresses, tokens, message bodies, rendered content, and template models are forbidden. Rate-limit keys must use `TelemetryRedaction.HashRateLimitKey` before logging or tagging.

## Local console and OTLP profiles

Default Compose enables console export. View output:

```bash
docker compose up -d --build
docker compose logs -f api worker
```

Optional collector profile receives OTLP then prints batches through collector `debug` exporter:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317 docker compose --profile observability up -d --build
docker compose logs -f otel-collector
```

Collector config lives at `deploy/otel-collector.yaml`. Replace `debug` exporter with any OTLP-compatible backend without app code changes.

## Correlated local delivery

Operational notification probe is absent unless `GONES_ALLOW_TEST_NOTIFICATION=true`. Compose enables it only for loopback-bound local stack. Probe accepts no recipient, token, or body input.

```bash
correlation_id="$(uuidgen | tr 'A-Z' 'a-z')"
curl -i -X POST -H "X-Correlation-ID: $correlation_id" http://127.0.0.1:5080/ops/probes/notification
docker compose logs api worker | grep "$correlation_id"
```

Expected chain: ASP.NET request span → Npgsql insert span → `notification.enqueue` producer → persisted W3C `trace_parent` → `notification.process` consumer → Npgsql acknowledgement. API response returns same `X-Correlation-ID`; API/Worker structured logs share correlation ID and trace ID. File transport writes one token-safe delivery marker.

## Health contract

- `GET /health/live`: process liveness only; always independent of PostgreSQL, Worker, providers.
- `GET /health/ready`: PostgreSQL failure → `Unhealthy`/503; missing or stale Worker heartbeat → `Degraded`/200; stale outbox or dead letters → `Degraded`/200; all current → `Healthy`/200.
- `GONES_WORKER_HEARTBEAT_DEGRADED_SECONDS`: stale threshold, default 45 seconds.
- `GONES_NOTIFICATION_BACKLOG_DEGRADED_SECONDS`: outbox lag threshold, default 300 seconds.

Quick inspection:

```bash
curl -fsS http://127.0.0.1:5080/health/live
curl -fsS http://127.0.0.1:5080/health/ready | jq
```

## Sample dashboard queries

OTLP backends commonly translate dots to underscores and append unit/total suffixes. Confirm backend names after ingestion.

| Panel | PromQL example |
|---|---|
| API 5xx rate | `sum(rate(gones_api_request_errors_total[5m]))` |
| API p95 latency | `histogram_quantile(0.95, sum by (le) (rate(gones_api_request_duration_seconds_bucket[5m])))` |
| DB p95 latency | `histogram_quantile(0.95, sum by (le) (rate(db_client_operation_duration_seconds_bucket{db_system_name="postgresql"}[5m])))` |
| Outbox oldest lag | `max(gones_outbox_lag_seconds)` |
| Outbox dead letters | `max(gones_outbox_dead_letters)` |
| Worker heartbeat age | `max(gones_worker_heartbeat_age_seconds)` |
| Runtime allocation rate | `sum(rate(process_runtime_dotnet_gc_collections_count_total[5m]))` |

Trace search examples:

```text
resource.service.name = "Gones.Api" AND status = error
resource.service.name = "Gones.Worker" AND name = "notification.process"
gones.correlation_id = "<uuid>"
```

## Sample alerts

```promql
# API server errors sustained for 10 minutes
sum(rate(gones_api_request_errors_total[5m])) > 0

# Notification delivery lag exceeds readiness objective
max(gones_outbox_lag_seconds) > 300

# Any retained dead letter
max(gones_outbox_dead_letters) > 0

# Worker missed three default heartbeat intervals
max(gones_worker_heartbeat_age_seconds) > 45
```

Alert `for: 10m` for API errors, `for: 2m` for Worker heartbeat, and route notifications to deployment operator. Provider, scheduler, auth, and migration alerts land with their owning slices.
