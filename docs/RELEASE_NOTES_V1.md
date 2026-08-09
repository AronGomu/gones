# Gones Calendar V1 — release candidate notes

**Status: local release candidate.** Every claim below is backed by a command in this repository that
anyone can re-run on a clean machine with Docker and no account anywhere. Nothing here has been
deployed, and nothing here validates a live provider, real email deliverability, a public domain or a
cutover. Those are listed in [Deferred live infrastructure](#deferred-live-infrastructure) and are
*not* part of this candidate.

## What the candidate is

Five `linux/amd64` OCI images built from digest-pinned public bases, plus the provenance to identify
them:

| Artifact | Contents | Runs as |
| --- | --- | --- |
| `gones-api` | ASP.NET Core HTTP API | uid 1654, read-only rootfs |
| `gones-worker` | singleton notification/scheduler Worker | uid 1654, read-only rootfs |
| `gones-migrator` | run-to-completion schema, admin bootstrap and migration CLI | uid 1654, read-only rootfs |
| `gones-backup` | encrypted `pg_dump` / `pg_restore` commands | uid 65532, read-only rootfs |
| `gones-frontend` | Angular single-page application on nginx | uid 101, read-only rootfs |

`npm run images:build` records, for each: the immutable digest, an SPDX SBOM, a line in
`reports/images/checksums.txt`, and the git revision the artifact was built from.
`npm run images:scan` adds the Trivy and Gitleaks reports.

A build from a working tree that is not clean records its revision with a `-dirty` suffix, and the
preflight refuses any candidate whose recorded revision is not the current one. A definitive release
set is therefore built from a clean checkout of the terminal commit, and rebuilding it there is what
turns "the artifacts I happen to have" into "the artifacts this commit produces".

## How to reproduce the candidate

```bash
npm run release:candidate
```

That single command builds the artifacts, verifies their runtime contract, scans them, runs the
release preflight, starts a clean environment in which **every release service is pinned to its
immutable digest** (`pull_policy: never`), migrates a fresh database, registers and verifies the
bootstrap User through the local email sink, promotes the Admin, runs the V1 role journeys, replays
the private migration bundle rehearsal, performs an encrypted backup and restore, and finishes by
re-running the preflight over everything it observed.

`npm run release:preflight` runs the gate on its own. It refuses a candidate on nine mismatch
classes — image digest, migration, OpenAPI, config schema, health, backup, fake provider, authority
mode, feature flag — and needs no credential, registry account or public domain to decide.
`ops/release-preflight.test.ts` proves each of those classes really rejects.

## What is new in V1

- Public tournament calendar (month and list), filters, ICS export, offline stale public reads.
- Local accounts with mandatory email verification, plus Google/Facebook OAuth adapters exercised
  against a local fake identity provider.
- Organizer tournament lifecycle: preview → publish → edit → cancel → delete, with Admin restore.
- Registrations with capacity, blocking, idempotent replay and optimistic concurrency; Organizer
  participant management, manual add/remove and CSV export.
- Organizations with membership roles and ownership transfer; Admin users, roles, formats,
  archetypes, audit trail and account closure.
- Reminder ladder (Monthly, Saturday, J-2, J-1) plus major-update, cancellation and registration
  messages, with a retry ladder, dead letter, operator replay and delivery webhook.
- League/Result/Live behaviour preserved against the TypeScript golden fixtures under PostgreSQL.
- Public Export v4 and the private migration bundle with an atomic, dry-run-first offline CLI.

## The feedback release

The `feedback-calendar-v1` plan worked through the `feedback.md` list on top of the V1 candidate.
Everything below is user-visible unless it says otherwise.

### Accounts and profile

- **A reload no longer signs you out.** The refresh session moved into an HttpOnly cookie, so the
  browser keeps the session without the single-page application holding a token it could leak.
- **You can delete your own account.** The deletion sits behind a password confirmation, removes the
  row rather than tombstoning it, clears the refresh cookie and nulls the audit actor so the trail
  survives without naming a deleted person (ADR 0025).
- **Location and birth date are structured.** Location is a country → region → city selection instead
  of free text, and the birth date is validated (ADR 0026).
- **Linking or unlinking an external identity no longer asks for the password again.** This is a
  deliberate trade-off, not an oversight: read ADR 0027 before changing it, because it lowers the bar
  for an attacker who already holds a live session.

### Calendar

- **The calendar loads once.** One anonymous full-catalog endpoint feeds a client-side cache, so
  changing month or filter is instant and does not re-query the API (ADR 0023). Offline stale reads
  keep working.

### Tournaments

- **Anyone can propose a tournament.** A non-organizer submits a proposal; the chosen approver gets a
  mail carrying a single-use signed link that lets them publish it or decline it with a reason, with
  no account needed to act on the link (ADR 0024).

### Live Tournaments

- **Anonymous visitors and plain users get a working Live Tournaments surface** backed by a strictly
  offline browser-local store. Organizer and Admin sessions keep the server adapter, so no local
  store can ever become the authority for shared data (ADR 0021).

### Navigation and naming

- **The first ever visit lands on the About page**, so a newcomer meets the association before the
  calendar. Every later visit goes straight to the normal landing surface.
- **The retired League feature now reads as an archive** everywhere — routes, breadcrumbs, page
  titles and component names all say `leagues-archive` / `tournaments-archive` (ADR 0022).
- The home menu carries a card into a **My Registrations** page.

### Testing (not user-visible)

- **Every element rendered by a component template now carries a unique `data-cy`.** The retrofit
  allowlist in `src/app/shared/data-cy-coverage.test.ts` is empty, and `npm run test` fails if a new
  untagged element appears. Identifiers already asserted by `cypress/e2e/**` kept their exact values:
  the sweep was purely additive.
- `ops/acceptance-matrix.json` gained a row per capability above, so `npm run acceptance:matrix`
  proves the feedback release and not only the original V1 surface.

### Decisions recorded

Seven ADRs carry this release: `docs/adr/0021-role-scoped-browser-live-store.md`,
`0022-rename-the-archived-league-feature.md`, `0023-full-catalog-calendar-cache.md`,
`0024-tournament-proposal-signed-token-approval.md`, `0025-hard-account-deletion.md`,
`0026-structured-profile-location-and-birth-date.md` and
`0027-external-identity-link-without-reauthentication.md`.

### Known gaps in the feedback release

These were found while shipping it, are deliberately **not** fixed here, and each needs its own
ticket.

1. **Dead read-only Live UI.** After the browser-local Live store landed (ADR 0021), `readOnly()`,
   the `live.readOnly` message and the `live-read-only` / `live-list-read-only` elements became
   unreachable — no session can now reach a read-only Live surface. They were left in place because
   deleting unreachable UI is a behaviour change, and the `data-cy` sweep that found them was
   explicitly identifier-only. `cypress/e2e/live-server.cy.js` asserts `live-list-read-only` does not
   exist, which stays true either way, so nothing is hiding a regression.
2. **`npm run notification:smoke` is not re-runnable.** `scripts/smoke-notification.mjs` deletes the
   outbox row but not its `notification_history` child, so the **second** run against any given
   database fails on the foreign key. First run on a fresh database is unaffected.
3. **The tournament proposal flow has never been proved end to end against the live stack.** The two
   proposal tables carry no grants for the local `gones_app` role, because the compose `permissions`
   service ran before those tables existed; re-running `docker compose up -d permissions` is the
   likely fix. The committed Cypress coverage is intercept-based precisely because of this, so the
   flow's server path is proved by the backend integration tests
   (`TournamentProposalTests`, `TournamentProposalDecisionTests`) and **not** by a live-stack journey.

## Portability

- No cloud SDK, no vendor runtime, no managed service is required or referenced.
- All configuration is environment variables and mounted secret files; no secret is ever passed to
  the API or Worker as a plain environment value.
- **The frontend artifact is not bound to a domain or a CDN.** The API origin, the data mode and the
  capability flags are injected at container start; the candidate is deliberately built with a
  *different* default origin from the one it is served on, and the preflight refuses the candidate if
  those two are ever the same. See `docs/RUNTIME_CONTRACT.md` → *Runtime injection*.
- Rollback is to a digest, and migrations are forward-only. See `docs/OPERATIONS.md` §4.

## Known residuals

These are known, accepted and **not** fixed in this candidate.

1. **Worker acknowledgement defect (pre-existing).** On the release-test/candidate stack, once
   earlier journeys have given the Worker real scheduler work, a reminder send can complete at the
   provider while the acknowledgement save throws `DbUpdateConcurrencyException`
   (`notification.acknowledgement.failed`): the outbox row reaches `Sent` with `sent_at` and a
   provider message id, and **no `notification_history` row is written**. Suspected cause: the
   Worker's poll shares one DI scope and `GonesDbContext` across the reconciler, the reminder
   dispatcher and the notification processor. Reproduced twice on clean runs; does not reproduce on a
   bare stack or the development stack. The at-most-once history guarantee is therefore proved by
   `TournamentSchedulerTests` and `npm run scheduler:smoke`, and is **not** claimed for reminders on
   the release stack.
2. **Reminders for a new registration are planned by the Worker's 24-hour reconcile pass.**
   Registration and unregistration raise no lifecycle event; cancellation and date change do, and
   propagate within one poll. A product decision is needed before launch on whether a new
   registration should plan its reminders immediately.
3. **10 HIGH CVEs in the nginx-alpine base of the frontend image** (ADR 0018). The scan gate blocks
   on CRITICAL only. Base images are digest-pinned, so a base CVE fix needs an explicit commit.
4. `linux/amd64` only. No arm64 artifact is produced or tested.
5. The Cosign signing hook is inert: it stays gated on `vars.GONES_SIGN_IMAGES` until a registry with
   OIDC exists.
6. Remote/offsite backup storage, retention sweeps and point-in-time recovery are absent.
7. No edge or global rate limiter; the application-level limiter is the only one (ADR 0017).
8. Material Icons are still loaded from `fonts.googleapis.com` / `fonts.gstatic.com`, so a fully
   air-gapped deployment would render without icons.
9. Two sanitizer allowlists (client and server) can drift; only tests hold them together.
10. Three moderate **development-only** advisories remain; clearing them needs an Angular major.

## Deferred live infrastructure

None of the following is done, and nothing in this repository implies it is. This is the checklist a
future hosting ticket has to work through — it is not a release blocker for the candidate, it is the
boundary of what the candidate claims.

- [ ] Choose a host, an orchestrator and a container registry; publish the digests to it.
- [ ] Establish an image signing trust root and turn the Cosign hook on (`vars.GONES_SIGN_IMAGES`).
- [ ] Public domain, DNS, TLS certificate issuance and renewal, and CDN/edge configuration.
- [ ] Managed or self-hosted PostgreSQL with real backups, retention, offsite copies and PITR.
- [ ] Measure real recovery objectives. The local restore rehearsal prints a wall-clock number on one
      machine and is explicitly **not** a recovery objective.
- [ ] Real Google and Facebook OAuth applications: client credentials, redirect URI registration,
      consent screens and a live sign-in smoke. Every local and CI run uses a fake provider.
- [ ] A real Brevo (or other provider) account: API key, verified sender domain, SPF/DKIM/DMARC, and
      a real deliverability check. Every local and CI run uses a local sink.
- [ ] Register the delivery webhook with the real provider and rotate its path token.
- [ ] A secret store and the rotation runbook against it (`docs/OPERATIONS.md` §5).
- [ ] An OTLP collector endpoint, log retention and alerting in the chosen environment.
- [ ] Edge/global rate limiting in front of the API (ADR 0017).
- [ ] **The legacy cutover.** Legacy `localStorage` is origin- and device-scoped: inventory every
      legacy origin/browser, export a private migration bundle from each, dry-run the Migrator CLI,
      approve the report hash, import, then soak before retiring the legacy build. The bundle UI,
      the export schemas and the CLI stay in the repository until that soak authorizes removal
      (ADR 0019).

## Evidence index

| Claim | Command |
| --- | --- |
| Artifacts build with digests, SBOMs and checksums | `npm run images:build` |
| Artifacts honour the runtime contract | `npm run images:verify` |
| No CRITICAL vulnerability, no detected secret | `npm run images:scan` |
| The candidate is releasable | `npm run release:preflight` |
| The candidate runs from those exact artifacts | `npm run release:candidate` |
| The platform-agnostic stack runs end to end | `npm run release:rehearsal` |
| Encrypted dump → volume loss → restore | `npm run backup:rehearsal` |
| Every V1 capability has an executable local gate | `npm run acceptance:matrix` |
| Reminder clock simulation and at-most-once history | `npm run scheduler:smoke` |
| Private bundle import parity | `npm run migration:smoke` |
| Dependency, licence and bundle audit | `npm run audit:supply-chain` |
