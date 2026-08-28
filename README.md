# Gones

Gones is an Angular single-page PWA for the public **Event** calendar people register for, for consulting tournament League results, for exporting Gones source-data backups, and for editing League source data.

The calendar record is an Event (`/events`, `/events/:slug`, `/events/new`, `/api/events`). "Scheduled tournament" is the retired name for it (ADR 0035), and `/calendar` is the retired route — it is gone with no redirect (ADR 0038). A tournament here is either an archived result or a browser-run Live Tournament.

## Data authority

There is exactly one data authority and every build declares it — it is never inferred (ADR 0020):

| `dataMode` | Who owns the data | Capabilities |
| --- | --- | --- |
| `server` | the API PostgreSQL database | everything: Calendar V1, auth, organizer, admin, League and Live. The browser keeps only language, view preference, filters and the anonymous public read cache. |

`server` is the only mode. The retired `legacy-browser` browser-store authority was removed with its
adapter, its pages and its migration-bundle export; a build or a host that still asks for it is
refused with `dataModeUnknown` at build time, at container start and in the browser, rather than
being served something that means anything else. A build that declares `server` without an API base
URL fails the same way. The repository default is already the modern API-connected declaration.

## Stack

- Angular standalone components, Angular Router, Signals, zoneless change detection
- Angular Material UI with Gones dark metal / blood-red theme tokens
- Backend bridge in `src/app/backend/`, bound to the ASP.NET API — the only adapter there is
- Declared data authority in `src/app/config/data-authority.ts`
- Vitest for domain/unit tests
- Cypress for browser flows
- GitHub Pages static hosting through GitHub Actions

## Local setup

```bash
npm install
npm run dev
```

`npm run dev` starts the API stack in Docker (`postgres`, `migrator`, `api`, `worker`), waits for
`/health/ready`, then serves the app against it. The app runs at `http://127.0.0.1:4200` and talks to
the API at `http://127.0.0.1:5080`. Stop the stack afterwards with `docker compose down`.

| Command | What it does |
| --- | --- |
| `npm run dev` | API stack in Docker + local dev server with hot reload |
| `npm run dev -- --no-docker` | dev server only, against an API that is already running |
| `npm run dev -- --detached` | bring the API stack up and exit |
| `npm run dev -- --no-accounts` | skip the dev-account seeding step |
| `npm run dev -- --env=minimal` | reset the local database and load a development environment before serving |
| `npm run dev:accounts` | re-seed the dev accounts on their own |
| `npm run dev:env -- --env=minimal` | load a development environment on its own, against a stack already up |
| `docker compose --profile release up --build` | everything containerised, SPA on `:8081` |

### Dev accounts

`npm run dev` seeds two fixed accounts once the API reports ready, so a fresh checkout can sign in
immediately (ADR 0029):

| Email | Role | Password |
| --- | --- | --- |
| `admin@gones.test` | Admin | `Gones-dev-pass-123!` |
| `test@gones.test` | User | `Gones-dev-pass-123!` |

They exist only in the local Compose database, which listens on `127.0.0.1` and is recreated from
scratch by `docker compose down -v`. No release image, deploy manifest or rehearsal script knows
about them — never add them to a networked environment.

## Local development environments

A development environment is a directory of JSON files under `fixtures/dev-environments/<name>/`,
and `npm run dev -- --env=<name>` loads it (ADR 0030). All of the data is editable text: change a
file, run the command again, and the next seeding picks it up — there is nothing to rebuild.

| environment | what it loads |
| --- | --- |
| `empty` (default) | nothing. Plain `npm run dev` behaves exactly as it always has: no reset, no seeding. |
| `minimal` | one verified account per role — `admin@gones.test` (Admin), `organizer@gones.test` (Organizer), `test@gones.test` (User), all with `Gones-dev-pass-123!`. |
| `demo` | a populated app: 7 accounts, 2 organizations, 4 formats, 16 Events, 7 registrations, 2 League Archives and 2 Live tournaments. What you want to look at any screen with real content. |
| `stress` | the French tournament circuit for a season, for judging pages under weight. Generated, not committed — see below. |

### The `stress` environment (the French circuit)

Two steps, because the fixtures are generated rather than committed:

```bash
npm run dev:stress:generate -- --seed=1   # write the fixtures (a second, ~48 MB)
npm run dev -- --env=stress               # reset the stack and load them (minutes)
```

It loads roughly 700 accounts, 200 clubs, 9 formats, 3800 Events, 2300 registrations and 185 League
Archives (~1800 Archive Tournaments and 168 000 Round Entries over 2400 player names, so rankings and
player pages have depth), plus 10 running tournaments and 10 000 audit rows.

The Events are four tiers at the cadence the real circuit runs them — a weekly local at every club
(8-30 players), a monthly Open at the busier ones (30-100), a Championnat Régional every two months in
each région (100-300) and one Championnat de France a year (1000+) — placed on the real map of French
cities. The sizes, cities, formats, archetypes and club-activity spread were read off 886 French paper
events published on mtgtop8.com between 2025-01 and 2026-08; every player name, score, account and
club name is synthetic. See `fixtures/dev-environments/README.md` for the full shape.

The same `--seed` produces byte-identical files on any machine — every draw goes through the
generator's own seeded PRNG and nothing reads the clock — so `--seed=1` is the shared dataset and any
other seed is a private one. `fixtures/dev-environments/stress/` holds only `environment.json`;
everything else there is gitignored, and `--env=stress` is refused until the generator has run.
Unlike the other environments, its Events, registrations, League Archives and audit rows are
bulk-inserted as SQL rather than driven through the HTTP API — thousands of Events through
preview-then-publish would take hours. That path is test-only and refuses to run unless
Docker points at a local Unix socket with the Compose `postgres` service up.

Go back to a normal dataset with `npm run dev -- --env=demo`.

An environment that carries data declares `"resetDatabase": true` and therefore runs a backend-only
inline Compose reset before seeding, so swapping environments never leaves the previous dataset
behind without taking the existing Angular dev server on port 4200 down. Seeding drives the real HTTP API, which means a fixture the
app would refuse cannot reach the database. `--env` needs the Docker stack and is refused together
with `--no-docker`.

`fixtures/dev-environments/README.md` documents every file of the format and how to add an
environment. `npm run test` validates each shipped environment, so a broken fixture fails there
rather than thirty seconds into a Docker reset.

## How it works

The ASP.NET API and its PostgreSQL database are the single authority. Every mutation is an explicit intent command guarded by the document version; there is no whole-document save and no browser CalendarEvent store. See `docs/RUNTIME_CONTRACT.md` for what a host must provide, and `DEPLOYMENT.md` for how the artifact is built.

The public domain, DNS, CDN, hosting vendor, container registry and live email/OAuth providers are all still deferred.

> **One-way door:** retiring the browser authority also removed the only producer of private
> migration bundles. The import CLI still applies bundles exported before this change; nothing can
> create a new one. See ADR 0020.

## Operating it

- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — the operator runbook: local environment, OpenAPI use,
  deploy and start ordering, rollback principles, secret rotation, the provider webhook, backup and
  restore, schema migrations, the bundle-import CLI, Admin bootstrap and observability. Every
  procedure names the committed script that rehearses it locally, and every step that would need real
  infrastructure is marked deferred.
- [`docs/RUNTIME_CONTRACT.md`](docs/RUNTIME_CONTRACT.md) — what a generic Linux host must provide.
- [`docs/RELEASE_NOTES_V1.md`](docs/RELEASE_NOTES_V1.md) — the V1 release candidate: the immutable
  artifact set, how to reproduce it with `npm run release:candidate`, the known residuals, and the
  live infrastructure that stays deferred.
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — how each frontend artifact is built.

## Commands

Every script in `package.json`, grouped by what you reach for it.

### Running it locally

| Command | What it does |
| --- | --- |
| `npm run dev` | API stack in Docker + dev server with hot reload, at `http://127.0.0.1:4200` |
| `npm run dev -- --env=<name>` | reset the database and load `empty` \| `minimal` \| `demo` \| `stress` first |
| `npm run dev -- --no-docker` | dev server only, against an API that is already running |
| `npm run dev -- --detached` | bring the API stack up and exit, without the dev server |
| `npm run dev -- --no-accounts` | skip the dev-account seeding step |
| `npm run dev:serve` | `ng serve` alone — no Docker, no seeding |
| `npm run dev:accounts` | re-seed the two dev accounts on their own |
| `npm run dev:env -- --env=<name>` | load an environment against a stack already up (no `ng serve`) |
| `npm run dev:stress:generate -- --seed=1` | write the generated `stress` fixtures |
| `npm run db:reset` | recreate the local Compose stack and its database from scratch |
| `npm run db:seed` | apply the deterministic V1 seed to a running stack |
| `docker compose --profile release up --build` | everything containerised, SPA on `:8081` |

`--env` needs the Docker stack, so it is refused together with `--no-docker`. Stop the stack with
`docker compose down`, or `docker compose down -v` to drop the data too.

### Checks

| Command | What it does |
| --- | --- |
| `npm run test` | Vitest domain and unit suite |
| `npm run lint` | Angular lint |
| `npm run typecheck` | `tsc --noEmit` over the app and spec projects |
| `npm run backend:build` | build the .NET solution, Release |
| `npm run backend:test` | .NET unit, architecture and integration suites (needs the Docker stack; ~4 minutes) |
| `npm run cy:run` | Cypress headless |
| `npm run cy:open` | Cypress interactive |
| `npm run api:check` | fail if the generated API client has drifted from the OpenAPI document |
| `npm run api:generate` | regenerate that client |

Run Cypress with `--config screenshotOnRunFailure=false`. On failure the default auto-screenshot times
out and reports `cy.screenshot() timed out waiting 30000ms` **in place of** the real assertion error,
which hides what actually broke.

### Smoke tests

| Command | What it covers |
| --- | --- |
| `npm run smoke` | full stack end to end |
| `npm run auth:smoke` | account lifecycle |
| `npm run notification:smoke` | notification delivery |
| `npm run scheduler:smoke` | scheduled jobs |
| `npm run migration:smoke` | the bundle-import CLI |

### Build and release gates

| Command | What it does |
| --- | --- |
| `npm run build` | production bundle |
| `npm run e2e:ci` | full-stack browser suite in Docker — the only way the auth specs can pass |
| `npm run acceptance:matrix` | every V1 capability row and its executable evidence |
| `npm run release:preflight` | pre-release checks |
| `npm run release:candidate` | reproduce the immutable V1 artifact set |
| `npm run release:rehearsal` | isolated release-mode stack: infrastructure plus the V1 role journeys |
| `npm run backup:rehearsal` | encrypted dump, safe failures, volume loss and restore |
| `npm run images:build` | build the OCI images |
| `npm run images:verify` | runtime contract of each image |
| `npm run images:scan` | vulnerability scan |
| `npm run audit:supply-chain` | dependency and supply-chain audit |

### Generators

| Command | What it writes |
| --- | --- |
| `npm run geo:generate` | the geography dataset |
| `npm run docs:demo-accounts` | `DEMO_ACCOUNTS.md` from the demo fixtures |

The acceptance matrix (`ops/acceptance-matrix.json`) maps every capability in
`docs/tournament-inscription-calendar-architecture/00..09` to a test or rehearsal that actually runs.
A row cannot be marked proved without evidence that resolves, and `npm run test` enforces it.

## Data portability

Gones Export is JSON source-data backup only. League Export uses `kind: "league"`; Full Data Export uses `kind: "fullData"`.
