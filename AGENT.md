# AGENT.md

Single context initialisation file for every agent working in this repository.
`CLAUDE.md`, `AGENTS.md`, `GEMINI.md` and `.cursorrules` are pointers to this file — never a second source of truth.

## What Gones is

Angular single-page PWA with three surfaces: the public **Event** calendar people register for
(Calendar V1 — browse at `/events`, an event at `/events/:slug`, publish at `/events/new`), the
**League Archive** of past tournament results, and the browser-run **Live Tournament**. It also
exports Gones source-data backups and edits League source data. Backed by an ASP.NET API and
PostgreSQL.

Release state: Gones is unreleased and has no production environment. Local data may be reset or
reshaped without production migration guarantees until this statement is explicitly replaced.

The calendar record is an **Event**, never a "scheduled tournament" — that term is retired (ADR
0035). A tournament in this repository is either an archive result (ADR 0022) or a Live Tournament
(ADR 0021).

There is exactly one data authority and every build declares it (ADR 0020): `dataMode: server`.
The API database owns everything — Calendar V1, auth, organizer, admin, League. The browser
keeps only language, view preference, filters, the anonymous public read cache and one account-scoped
unsent Event-create recovery draft (ADR 0055; never canonical Event authority). The retired
`legacy-browser` authority is refused with `dataModeUnknown` at build time, container start and in
the browser.

**Two exceptions (ADR 0021, ADR 0028).** The Live port has two adapters, chosen by role once at
injection time: `Organizer` and `Admin` keep the server adapter; anonymous visitors and the plain
`User` role get `LocalLiveBackend`, a strictly offline IndexedDB store (`gones-live` /
`tournaments`). The League Archive has two adapters too, but they are **merged rather than
exclusive**: the list is the union of the server's leagues and the browser-local ones
(`gones-archive-local` / `leagues`), and every read and write routes on the `local-` id prefix.
Neither browser store ever synchronises, in either direction. The authoritative allowlist of files
permitted to touch IndexedDB is the one asserted by
`src/app/backend/server-authority-boundary.test.ts` (test `confines IndexedDB to the sanctioned
local adapters`) — read the list there; this file deliberately does not duplicate it. Do not delete
either adapter as an ADR 0020
violation — read `docs/adr/0021-role-scoped-browser-live-store.md` and
`docs/adr/0028-dual-source-league-archive.md` first.

## Repository layout

| path                                     | contents                                                                                                                                                                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`                                   | Angular app: standalone components, Signals, zoneless change detection, Material with the dark-metal / blood-red theme. Backend bridge in `src/app/backend/`, declared authority in `src/app/config/data-authority.ts` |
| `src/app/features/events/`               | Public Event calendar, organizer create/edit, registrations, admin deleted events                                                                                                                                      |
| `src/AGENT.md`                           | Frontend agent contract: data-cy rule, title/kicker rule, component style                                                                                                                                              |
| `backend/`                               | ASP.NET solution (`backend/Gones.sln`) and EF migrations                                                                                                                                                               |
| `ops/`                                   | runtime/host contract tests, `acceptance-matrix.json`                                                                                                                                                                  |
| `scripts/`                               | every dev, smoke, release and rehearsal script referenced below                                                                                                                                                        |
| `cypress/`, `fixtures/`                  | browser flows and their data                                                                                                                                                                                           |
| `deploy/`, `compose*.yaml`, `Dockerfile` | containerised release artifacts                                                                                                                                                                                        |
| `docs/`                                  | Project documentation. Contains CONTEXT.md, DESIGN.md, GLOSSARY.md, adr/                                                                                                                                               |
| `.dev/`                                  | Future implementation resources. Contains bugs.md, ideas.md, decisions/ (product feedback lives in root `feedback.md`)                                                                                                 |
| `artifacts/`                             | Documents generated by agents (not gitignored)                                                                                                                                                                         |
| `.agents/skills/`                        | project skills: `ship` (engineering pipeline), `start-gones-server`                                                                                                                                                    |
| repository root                          | `DEMO_ACCOUNTS.md` — every demo login and what it can do, generated from the demo fixtures by `npm run docs:demo-accounts`                                                                                             |

ADRs live in `docs/adr/` (lowercase — tests and cross-references point there). The five newest
(`ops/agent-rules.test.ts` derives the required newest four from `docs/adr/` and fails when it goes stale) bind the
next shape of the app: **0054** Event publication is direct with live local preview; **0055** one
account-scoped unsent Event-create draft may persist in `localStorage`; **0056** Event media is one
nullable owned image without author alt/order metadata; **0057** manual worldwide Event locations use
required address text plus backend-validated IANA timezone, without geocoding/provider APIs; **0058**
`/about` omits toolbar section nav and its breadcrumb/top back row, and keeps bottom back navigation.
Still binding for today's code:
**0047** the Archive rebuild has no migration path; **0048** archive catalogs use IndexedDB year
partitions; **0049** ratings are per-scope Glicko-2; **0050** legacy Archive surface retires without
aliases; **0038** `/calendar` routes
are deleted with no redirect (supersedes the redirect clause of ADR 0035); **0039** the one
TTL-cache contract — 24h, two stores, mutation-invalidates; **0040** materialized
`player_statistics` / `player_statistics_meta`; **0041** `OrganizationRoles` has one role
(`Organizer`); **0044** the back-button rule below.

## Commands

```bash
npm install
npm run dev                  # API stack in Docker + dev server on http://127.0.0.1:4200 (API :5080)
npm run dev -- --no-docker   # dev server only, against an API already running
npm run dev:accounts         # re-seed admin@gones.test / test@gones.test (password Gones-dev-pass-123!)
npm run dev -- --env=minimal # reset the local DB, then load fixtures/dev-environments/minimal (ADR 0030)
npm run build                # ng build
npm run lint
npm run typecheck
npm run test                 # vitest, also enforces the acceptance matrix
npm run cy:run               # cypress
npm run backend:test         # dotnet test backend/Gones.sln
```

Gates: `npm run e2e:ci`, `npm run acceptance:matrix`, `npm run release:rehearsal`,
`npm run backup:rehearsal`, `npm run images:verify`. Stop the stack with `docker compose down`.

## Rules for agents

- **Every page that reads server data joins the cache contract.** Load once on page load, cache for
  24 hours, show a "last synced" label and a Synchronize button (`gones-sync-bar`), and refetch
  automatically when the cached copy is older than 24 hours. Public data caches in `localStorage`
  through `src/app/shared/catalog-cache.ts`; private data caches in the per-user IndexedDB store
  through `ServerReadCacheService.readCached`, which logout purges. Every successful mutation
  invalidates its own cache entry and refetches — the TTL governs navigation, never correctness
  (ADR 0039).
- **Every routed page carries a back button at the top and at the bottom** (`gones-back-button`,
  `position="top"` and `position="bottom"`), except the two kinds of page that have nothing to go
  back to: the pages that _start_ a breadcrumb (`/` and `/admin`, which render none) and the auth exception
  pages (which keep the top one only). `/about` is the editorial-shell exception: bottom only, with
  no toolbar section nav and no breadcrumb (ADR 0058). Enforced by
  `src/app/shared/back-button-coverage.test.ts` (ADR 0044, amended by ADR 0058).
- **Logging out returns to sign-in, and signing in returns the user where they were.** Logout
  navigates to `/login?returnUrl=<page where logout was clicked>`; a successful sign-in navigates
  back to it. When the new session lacks the role that page needs, its route guard redirects as
  usual — no special case.
- Read `docs/CONTEXT.md` for the domain vocabulary and product rules before touching domain code —
  it is the language contract (Event, Draft Organization, Tournament, League, Round Import, Player
  Statistics, …).
- Read `docs/GLOSSARY.md` for the short words the user and agents use to name parts of the codebase.
- A capability is not proved without executable evidence: `ops/acceptance-matrix.json` maps every V1
  capability to a test or rehearsal that actually runs.
- Every mutation is an explicit intent command guarded by the document version. There is no
  whole-document save and no browser CalendarEvent store.
- One-way door: nothing can produce a new private migration bundle; the import CLI only applies
  bundles exported before ADR 0020.
- Write agent-generated documents to `artifacts/`, not to the repository root.
- Record future work in `.dev/` (`bugs.md`, `ideas.md`, `decisions/`). Product feedback lives in the
  user-authored root `feedback.md` — read and append there; never move, rename or regenerate it.

## Skills

Read and activate `/home/aron/projects/gones/.claude/skills/make-glossary-aron/SKILL.md`
(`make-glossary-aron`) — keep `docs/GLOSSARY.md` current whenever a new shared word appears.

Read and activate project-local `.agents/skills/graphify/SKILL.md` for claude, codex and pi.
`graphify-out/graph.json` holds the code knowledge graph (gitignored). Answer architecture /
"what calls what" questions with it before grepping:

```bash
graphify query "how does the calendar reach the API?"
graphify explain "TournamentScheduler"
graphify god-nodes
graphify extract . --code-only   # rebuild after large refactors (local AST, no API key)
```

## Backend bridge history

The MVP once ran fully in the Angular frontend with leagues persisted in browser `localStorage`
through `ApplicationBackend`. That path is retired: persistence, validation, imports/exports,
concurrency enforcement and auth/role checks now live in the ASP.NET API, and the ASP.NET adapter is
the only `APP_BACKEND` implementation. Gones Export / Gones Restore remains the user-facing backup
and portability path.
