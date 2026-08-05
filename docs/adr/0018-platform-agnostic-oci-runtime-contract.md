# 18. Platform-agnostic OCI runtime contract

Date: 2026-08-06

## Status

Accepted (C41). Extends ADR 0017 by closing its forwarded-header gap.

## Context

V1 must be releasable before a hosting vendor is chosen. Every earlier commit deferred hosting, DNS,
managed PostgreSQL, a registry, remote backup storage and IaC — but "deferred" only stays honest if
the artifacts themselves carry no vendor assumption. Left unchecked, the usual leaks appear one at a
time: a cloud SDK for secrets, a provider-specific health probe convention, a floating base tag whose
rebuild differs from the audited one, a container that quietly runs as root because a base image said
so.

ADR 0017 also left one hole open on purpose: the in-process rate limiter partitions anonymous traffic
by `HttpContext.Connection.RemoteIpAddress`, which behind any proxy collapses every caller into one
bucket. Fixing that requires deciding *whose* forwarded headers to believe, which is runtime work.

## Decision

**The deployment target is "a Linux host that can run OCI images".** Five images — API, Worker,
Migrator, backup/restore, frontend — built from digest-pinned public bases, each running as an
explicit non-root numeric account, compatible with a read-only root filesystem plus a `/tmp` tmpfs,
with all capabilities dropped and an explicit stop signal its process actually drains on.

**The complete host interface is written down** in `docs/RUNTIME_CONTRACT.md`: TLS reverse proxy,
persistent PostgreSQL, secret injection, singleton Worker, migration job, backup scheduler, OTLP
collector, log retention. Nothing else is assumed and nothing vendor-specific is named.

**Secrets are injectable as files.** Every secret accepts `<KEY>` or `<KEY>_FILE`, never both;
supplying both fails startup. The generic loader (`GonesSecretFiles`) covers the database DSN and the
signing key; secrets with existing bespoke handling keep it. The key list is closed on purpose — an
open "any key from any file" resolver would turn an environment variable into an arbitrary file read.

**Forwarded headers are opt-in and fail closed.** `GONES_FORWARDED_PROXIES` lists the trusted proxy
addresses and networks; with an empty list the forwarded-headers middleware is not installed at all,
so `X-Forwarded-*` is inert. Only `X-Forwarded-For` and `X-Forwarded-Proto` are honoured —
`X-Forwarded-Host` is not, because hostnames drive link generation and OAuth callbacks and those come
from explicit configuration. This is what makes the ADR 0017 rate-limit partitions accurate, and what
makes HSTS emit behind a TLS-terminating proxy.

**Identity provider endpoints are overridable.** Absolute-HTTPS-only overrides let a self-hosted or
fake OIDC provider be used with no code change, which is how the release rehearsal exercises the
External auth path with zero live credentials.

**A release rehearsal proves it locally.** `compose.release-test.yaml` runs the release-mode images
behind a TLS reverse proxy with a generated test CA, a fake OIDC provider, a fake Brevo API that
replays its own delivery webhook, an OTLP collector, mounted secret files, and an `internal: true`
network with no route off the host. `npm run release:rehearsal` asserts startup ordering, migration
idempotency, readiness, non-root read-only containers, secret-file injection, forwarded scheme,
graceful SIGTERM, restart, and blocked egress.

**Backups are portable and rehearsed.** `npm run backup:rehearsal` proves an encrypted `pg_dump`
lands only inside the mounted root, that a corrupt archive and a wrong key are both rejected *before*
the database is touched, and that the correct key restores data deleted after the dump.

**The build is registry-neutral.** CI builds `linux/amd64` images, records immutable digests, emits
SBOMs and checksums, and runs Trivy and Gitleaks. It never pushes, and the cosign step is an inert
hook gated on a repository variable until a registry with OIDC trust exists.

## Consequences

### Accepted limitations

- **Digest pinning is a maintenance cost.** Base image updates are now an explicit commit rather than
  a silent rebuild. That is the point, but it means CVE fixes in base images require action. The scan
  gate blocks on CRITICAL only; HIGH and below are reported and triaged. At the time of writing the
  static frontend base carries ten HIGH findings in packages nginx does not use to serve static files
  (curl, expat, libxml2, c-ares), fixed in an Alpine release the upstream tag has not adopted yet.
  Deliberately *not* patched with an unpinned `apk upgrade`, which would trade reproducibility for it.
- **Single architecture.** Only `linux/amd64` is built and scanned. `arm64` hosts are unproven.
- **The rehearsal is not a deployment.** It proves the artifacts and their contract on one machine.
  It says nothing about capacity, multi-node behaviour, rollback, or a real network.
- **Forwarded-header trust is only as good as the host's proxy.** If the host lets a client reach the
  API directly, bypassing the proxy, the trusted-proxy list does not help. Network isolation is the
  host's job.

### Deferred, with owner

- Registry, image signing and provenance attestation publication (hook exists, target does not).
- Remote/offsite backup storage, retention sweeps, managed PITR, measured RPO/RTO.
- Edge/global rate limiting, per ADR 0017.
- `arm64` images, multi-replica API, and any autoscaling story.

### Rejected alternatives

- **Vendor-managed secret SDKs.** Would have forced a vendor choice into application code for a
  problem a file mount already solves everywhere.
- **Baking TLS into the API.** Certificate lifecycle then becomes application code; every real host
  already has a proxy that does it better.
- **Trusting `X-Forwarded-For` unconditionally.** Simpler, and it hands every caller the ability to
  choose its own rate-limit partition and to fake HTTPS.
