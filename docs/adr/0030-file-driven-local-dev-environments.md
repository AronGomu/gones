# File-Driven Local Development Environments

## Status

Accepted. Local development topology only. Changes nothing about release or production deployment.

Historical paths: the `/api/tournaments*` routes quoted below are now `/api/events*` per ADR 0035.
The text is left as it was written; only the names moved.

## Context

ADR 0029 gave `npm run dev` two fixed accounts, so a developer can sign in. It stops there. Behind
those accounts the database is empty: no organization, no published tournament, no registration, no
League Archive, no running tournament. Every screen that renders a list renders its empty state.

That makes three kinds of work expensive. Reviewing a layout change on the Calendar means hand-creating
tournaments through the UI first. Reproducing a role bug means promoting an account by hand. Checking
that an Organizer sees something an anonymous visitor does not means building two datasets by hand and
remembering which one is loaded.

The existing seeding scripts do not close the gap:

- `scripts/seed-local.mjs` runs `migrator database seed` — an audit marker, the fixed placeholder
  League, one demo Live Tournament and the catalog presets. It is a schema smoke test, not a dataset,
  and its content lives in C# where a developer cannot edit it.
- `scripts/seed-auth-e2e.mjs` creates exactly one Cypress fixture user.
- `scripts/seed-dev-accounts.mjs` creates the two ADR 0029 accounts and nothing else.

A fourth constraint comes from the user: plain `npm run dev` must keep behaving exactly as it does
today. Whatever is added has to be opt-in, and the data has to be editable in a text file without
rebuilding anything.

## Decision

**A local development environment is a directory of JSON files, and `npm run dev -- --env=<name>`
loads it.**

### Layout

```
fixtures/dev-environments/<name>/
  environment.json      required — { name, description, resetDatabase }
  accounts.json         optional
  organizations.json    optional
  formats.json          optional
  tournaments.json      optional
  registrations.json    optional
  leagues.json          optional
  live-tournaments.json optional
```

A missing optional file means an empty list. `environment.json.name` must equal the directory name —
a mismatch is a validation error, not a silent rename.

Three environments ship:

| name | contents |
| --- | --- |
| `empty` | nothing. `resetDatabase: false`. What plain `npm run dev` has always given. |
| `minimal` | one verified account per role, no content. |
| `demo` | seven accounts (including one deliberately unverified), two organizations, four formats, nine calendar tournaments spread across past / today / future, twelve registrations, two League Archives, two running tournaments. |

Adding a fourth is copying a directory and editing JSON. No code change.

### Seeding goes through the HTTP API

`scripts/seed-dev-environment.mjs` drives the same endpoints the browser drives:
`POST /api/auth/register`, `POST /api/admin/formats`, `POST /api/admin/organizations`,
`POST /api/tournaments/preview` + `POST /api/tournaments`,
`POST /api/tournaments/{id}/registrations`, `POST /api/leagues-archive/restore`,
`POST /api/live-tournaments` and its command endpoints.

The one exception is the pair `email_confirmed` / `global_role`, written with SQL — there is no
endpoint for either, and ADR 0029 already established that exact exception for the same reason.
`migrator admin bootstrap` remains unusable here: its one-shot marker row makes it non-re-runnable.

Consequences of choosing the API over SQL inserts: every seeded row goes through real validation,
real domain rules and real idempotency handling, so a fixture that the app would refuse cannot exist
in the database. The cost is that seeding needs the stack up and is slower than `COPY`.

### A data-carrying environment resets first

Any environment with `resetDatabase: true` runs `scripts/reset-local-stack.mjs`
(`docker compose --profile development down --volumes` → `up --wait` → `scripts/seed-local.mjs`)
before it seeds. Swapping from `demo` to `minimal` must not leave `demo`'s tournaments behind.

`empty` sets `resetDatabase: false` and is the default, which is what preserves today's `npm run dev`
behaviour byte for byte: no reset, no seeding, no containers touched beyond the existing `up -d`.

`validateEnvironment` rejects the incoherent combination — `resetDatabase: false` together with any
data — rather than silently stacking a dataset onto whatever was already there.

### Dates are relative, except in the archive

A calendar tournament fixture declares `startsAtLocalOffsetDays` (a signed integer) and
`startsAtLocalTime`, and the seeder renders `YYYY-MM-DDTHH:mm` against today. A dataset checked in
today still shows past, ongoing and upcoming tournaments a year from now.

League Archive fixtures keep **absolute** `tournamentDate` values. An archive is history; a rolling
history would be a lie.

### Validation is a test, not a runtime surprise

`scripts/dev-environments.mjs` exports `validateEnvironment(environment): string[]`, and
`ops/dev-environments.test.ts` runs it over every shipped environment inside `npm run test`. It checks
shape, role vocabulary, password policy (`meetsPasswordPolicy` from `scripts/dev-accounts.mjs`),
unique keys and every cross-reference: a tournament's organization and formats, a registration's
tournament and user, a running tournament's league and organizer.

A broken fixture therefore fails in CI, not thirty seconds into a Docker reset.

## Consequences

- A developer gets a populated app in one command and can test as Visitor, `User`, `Organizer` and
  `Admin` against the same dataset.
- Test data is reviewable: it is JSON in the repository, and changing it shows up in a diff.
- Seeding is slower than SQL and needs the API healthy. Accepted: the dataset is validated by real
  endpoints in exchange.
- `--env` requires the Docker stack. Combining it with `--no-docker` is refused explicitly.
- The real donor data (`gones-full-data.gones.json`, a real Gones export) is not committed wholesale.
  Only a trimmed derivative lands in `fixtures/dev-environments/demo/leagues.json`, and from that
  point the fixture — not the export — is the source of truth.
- Nothing here ships. `fixtures/` is not part of any image, and no release path reads it.
