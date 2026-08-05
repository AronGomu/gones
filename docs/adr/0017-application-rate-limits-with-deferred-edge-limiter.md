# 17. Application rate limits in ASP.NET, edge limiter deferred

Date: 2026-08-05

## Status

Accepted (C40).

## Context

V1 must resist credential stuffing, scraping, and write floods before it can be called a release
candidate. The deployment target is deliberately platform-agnostic (C41/C42): no CDN, ingress
controller, or WAF is chosen yet, so no vendor-specific limiter configuration may ship.

## Decision

Every locked V1 limit is enforced **in-process** by `Microsoft.AspNetCore.RateLimiting`
(`backend/src/Gones.Api/Security/AuthRateLimiting.cs`). Two layers stack:

1. A **global limiter** partitions every `/api` request so a newly added route cannot silently ship
   unlimited: `/api/admin` per user, anonymous reads per client IP, authenticated writes per user.
2. **Endpoint policies** applied with `RequireRateLimiting` for the surfaces that need a tighter or
   differently-keyed bucket than the global default.

| Surface | Limit | Partition key | Policy |
| --- | --- | --- | --- |
| `auth` register / login / resend / reset | 5 / 15 min | client IP + path | `auth-ip` |
| same, per account | 5 / 15 min | normalized account | `AuthAccountRateLimitFilter` |
| `POST /api/auth/refresh` | 30 / 15 min | refresh session cookie | `refresh-session` |
| anonymous reads under `/api` | 120 / min | client IP | global + `public-read-ip` |
| authenticated writes under `/api` | 30 / min | user id | global + `write-user` |
| tournament self-registration | 10 / min | user id | `registration-user` |
| participant / league CSV export | 10 / hour | user id + client IP | `export-user-ip` |
| `/api/admin/**` | 60 / min | user id | global + `admin-user` |

**Partition keys are never stored in the clear.** Every key is hashed with
`TelemetryRedaction.HashRateLimitKey` before it reaches the limiter, so no IP, account, user id, or
refresh token appears in limiter state, metrics, or the audit trail.

**Rejections are uniform**: HTTP 429, the `rate_limited` problem code, a `Retry-After` header in
seconds, an `OperationalMetrics` rejection counter, and a redacted `auth.<operation>.rate_limited`
audit record (best-effort — a rejection raised before persistence is configured is not audited).

**Overrides.** Each bucket reads an optional environment key
(`GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT`, `GONES_RATE_LIMIT_REFRESH_PERMIT_LIMIT`,
`GONES_RATE_LIMIT_PUBLIC_READ_PERMIT_LIMIT`, `GONES_RATE_LIMIT_WRITE_PERMIT_LIMIT`,
`GONES_RATE_LIMIT_REGISTRATION_PERMIT_LIMIT`, `GONES_RATE_LIMIT_EXPORT_PERMIT_LIMIT`,
`GONES_RATE_LIMIT_ADMIN_PERMIT_LIMIT`). In `Development` and `Testing` the volume-shaped buckets
default to an effectively unlimited value so local suites are not throttled; explicit configuration
still wins, and the dedicated suites set exact tiny limits to prove 429 + `Retry-After`.

## Consequences

### Accepted limitations

- **In-process state.** Counters live in the API process. With more than one API replica the
  effective limit is `replicas x limit`. V1 ships a single API replica (see `compose.yaml`).
- **Client IP fidelity depends on the reverse proxy.** The API reads
  `HttpContext.Connection.RemoteIpAddress`. Behind a proxy that does not set forwarded headers, all
  anonymous traffic shares one partition. Forwarded-header configuration is C41 runtime work.
- **No protection before the application.** Volumetric floods, slow-loris, and TLS-level abuse still
  reach Kestrel.

### Deferred requirement (do not close V1's hardening on this alone)

A future hosting decision **must** add an edge/global limiter in front of the API providing, at
minimum: connection and request-rate caps per source IP, a global request ceiling independent of
application state, and forwarded-header configuration so the application limiter sees real client
IPs. That work is intentionally out of C40 because it requires choosing a vendor, which C42 defers.
