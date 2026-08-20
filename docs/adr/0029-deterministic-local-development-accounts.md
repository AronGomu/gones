# Deterministic Local Development Accounts

## Status

Accepted. Local development topology only. Changes nothing about release or production deployment.

## Context

`npm run dev` brings up PostgreSQL, the migrator, the API and the Worker in Docker and then serves the
Angular app at `http://127.0.0.1:4200` against the API on `http://127.0.0.1:5080`. A developer who
followed the README could not sign in. Two independent defects produced the same symptom, a 401.

**No account exists.** `scripts/dev.mjs` runs `docker compose up -d --wait` and `ng serve`, nothing
more. `npm run db:seed` runs `migrator database seed`, which writes an audit marker, the fixed
placeholder League, a demo Live Tournament and the catalog presets — no user rows. The only account
any script created was `cypress.user@example.test`, and only inside `scripts/seed-auth-e2e.mjs`,
which nothing in the dev path calls. `LoginAsync` therefore reached
`userManager.FindByEmailAsync(...) is null` and threw `AuthenticationFailedException` → 401
`invalid_credentials`. Correct behaviour against an empty user table.

**The refresh cookie is dropped.** `compose.yaml` runs the `api` service with
`ASPNETCORE_ENVIRONMENT: Production`, so `appsettings.Development.json` — the file that sets
`Gones:Auth:RefreshCookie:Secure = false` — is never loaded. `RefreshCookieOptions` defaults
`Secure = true`. Browsers refuse to store a `Secure` cookie delivered over plain HTTP, so
`gones_refresh` never landed, and `AuthService.bootstrap()`'s `POST /api/auth/refresh` answered 401 on
every reload. `.env.example` already documented the fix — "localhost/127.0.0.1 must set SECURE=false
or the cookie is never stored" — but `compose.yaml` never passed the variable through.

Fixing only the first defect gives a developer a login that silently signs them out on every reload.
Both had to go.

## Decision

**`npm run dev` seeds two fixed accounts, and the local API is told the truth about its own
transport.**

Accounts, defined once in `scripts/dev-accounts.mjs`:

| Email | Username | Global role | Password |
| --- | --- | --- | --- |
| `admin@gones.test` | `gones-admin` | `Admin` | `Gones-dev-pass-123!` |
| `test@gones.test` | `gones-test` | `User` | `Gones-dev-pass-123!` |

Both are created through the real `POST /api/auth/register` endpoint, so they carry a genuine Identity
password hash and exercise the same code path a real sign-up does. Verification and role assignment
are then applied with SQL against the local Compose database.

`scripts/seed-dev-accounts.mjs` is idempotent: it probes `asp_net_users` before registering, so a
re-run costs no auth rate-limit permit, and the SQL is written as an unconditional `UPDATE` that
converges rather than an `INSERT` that conflicts. `scripts/dev.mjs` runs it after the API reports
ready; `--no-accounts` skips it and `npm run dev:accounts` runs it alone.

Cookie topology, on the `api` service in `compose.yaml` only:

```yaml
GONES__AUTH__REFRESHCOOKIE__SAMESITE: ${GONES__AUTH__REFRESHCOOKIE__SAMESITE:-Lax}
GONES__AUTH__REFRESHCOOKIE__SECURE: ${GONES__AUTH__REFRESHCOOKIE__SECURE:-false}
```

`compose.release-candidate.yaml` and `compose.release-test.yaml` are untouched and keep the secure
default; a test asserts neither of them defaults `SECURE` to `false`.

**The Admin role is granted by SQL, not by `migrator admin bootstrap`.** `AdminBootstrapService` locks
a one-shot marker row: once consumed, every later call returns `AlreadyConsumed` and promotes nobody.
That is the right behaviour for a production installation — the first administrator is a one-time,
audited event — and exactly the wrong tool for an idempotent dev seeder that must survive a re-run and
must be able to target a second address. The bootstrap path stays untouched and remains the only way
to create the first administrator of a real deployment.

## Consequences

- **These credentials are public.** They live in the repository and in this document. They exist only
  in the local Compose database, which listens on `127.0.0.1` and is created from scratch by
  `docker compose down -v`. Nothing in the release images, the deploy manifests or the rehearsal
  scripts references them. Do not add them to any environment that is reachable from a network.
- **`npm run dev` now requires the API to be reachable before it serves.** It already waited on
  `/health/ready`; the seeding step runs in the same window and fails loudly with the command to
  re-run rather than leaving a half-seeded database.
- **The dev password satisfies the server's own policy** (≥ 12 characters, mixed case, digit, symbol),
  asserted by `ops/dev-accounts.test.ts` so a future tightening of the policy fails the unit test
  rather than the developer's first login.
- **The cookie relaxation is scoped to `compose.yaml`.** Both settings remain environment variables
  with secure defaults in the class itself, so a deployment that sets neither still gets
  `SameSite=Lax; Secure=true`.
- **No plain `Organizer` account is seeded.** `Admin` satisfies every `canManageLeagues` /
  `canManageLive` check an `Organizer` would, so a third account would prove nothing the first two do
  not. Add one only when a test needs to observe the difference between the two roles.

## References

- `scripts/dev-accounts.mjs`, `scripts/seed-dev-accounts.mjs`, `scripts/dev.mjs`
- `ops/dev-accounts.test.ts` — the gate
- `backend/src/Gones.Infrastructure/Identity/RefreshCookieOptions.cs`
- `backend/src/Gones.Infrastructure/Identity/AdminBootstrapService.cs` — the one-shot marker
- `docs/OPERATIONS.md` §"first administrator" — the production path, unchanged
- Plan `artifacts/PLAN_2026_08_09_feedback-calendar-v1-round-2.md`, ticket T1
