# Gones

Gones is an Angular single-page PWA for consulting tournament League results, exporting Gones source-data backups, and editing League source data.

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

An environment that carries data declares `"resetDatabase": true` and therefore wipes and rebuilds
the local Compose database (`scripts/reset-local-stack.mjs`) before seeding, so swapping environments
never leaves the previous dataset behind. Seeding drives the real HTTP API, which means a fixture the
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

```bash
npm run build
npm run build:pages
npm run lint
npm run test
npm run cy:run
```

Quality and release gates:

```bash
npm run e2e:ci             # full-stack browser suite, both data-authority profiles
npm run acceptance:matrix  # every V1 capability row and its executable evidence
npm run release:rehearsal  # isolated release-mode stack: infrastructure plus the V1 role journeys
npm run backup:rehearsal   # encrypted dump, safe failures, volume loss and restore
npm run images:verify      # runtime contract of each OCI image
```

The acceptance matrix (`ops/acceptance-matrix.json`) maps every capability in
`docs/tournament-inscription-calendar-architecture/00..09` to a test or rehearsal that actually runs.
A row cannot be marked proved without evidence that resolves, and `npm run test` enforces it.

## Data portability

Gones Export is JSON source-data backup only. League Export uses `kind: "league"`; Full Data Export uses `kind: "fullData"`.
