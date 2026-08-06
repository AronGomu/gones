# Explicit Legacy versus Server Data Authority

## Status

Accepted (C42). Amends ADR 0006 and ADR 0008; both stay in force for the legacy mode they describe.

## Context

Until C42 the frontend inferred where data lived. Each capability carried its own flag
(`apiBackend`, `calendarV1`, `leagueServer`, `liveServer`), and every one of them fell back to the
browser store when it was off:

```ts
if (!leagueServer) return 'frontend-local';
```

That produced three problems the V1 release candidate cannot carry:

1. **Two authorities at once.** `leagueServer=true` with `liveServer=false` was a legal build in
   which Leagues came from PostgreSQL while Live drafts came from `localStorage`. Nothing said which
   one owned a finalized tournament.
2. **Silent degradation.** A server build shipped without an API base URL kept working — against the
   browser store. Users would write real data into a store nobody backs up or migrates.
3. **Legacy paths reachable from a server build.** The ASP.NET adapter still carried
   `saveLeague`/`insertLeague`/`saveLiveTournament` (rejecting at runtime) and three
   `/calendar-events` methods pointed at routes the API has never implemented.

Hosting is still undecided and the existing static deployment must keep working, so removing the
legacy mode is not an option yet.

## Decision

The data authority is **declared, never inferred**, as a single typed value:

```ts
type DataMode = 'legacy-browser' | 'server';
```

`src/app/config/data-authority.ts` validates the declaration once at startup and memoizes it. There
is no third state, no per-capability fallback, and no way to switch authority after startup.

**`legacy-browser`** — the frozen static deployment. Browser `localStorage` owns League, Live and
CalendarEvent source data. The build must carry **no** API base URL and **no** auth or admin
capability; route exposure drops every auth, registration, organizer and admin route regardless of
what a flag claims. The mode is frozen: no new Calendar V1, auth or admin capability may be added to
it. Its one forward-looking capability is the private migration-bundle export.

**`server`** — the API database is the single authority. It requires an API base URL, refuses an
admin capability without auth, and binds *every* port to the ASP.NET adapter. The browser keeps
language, view preference, filters and the anonymous public read cache (C39) — nothing canonical.
The legacy browser adapter is not injectable at all: `LEGACY_BROWSER_BACKEND` resolves to `null`, so
`saveLeague`, `insertLeague`, `saveLiveTournament` and the CalendarEvent store fail closed instead of
writing a second source of truth. Those methods no longer exist on the server adapter.

**Fail closed, three times over.** An unsatisfiable declaration stops the image build
(`scripts/check-frontend-data-authority.mjs`, run in every Dockerfile stage that substitutes the
environment), then refuses to bootstrap the app and renders a stable failure message instead. It
never falls back to the browser store. `ops/frontend-data-authority.test.ts` keeps the build-time
checker and the runtime resolver in agreement.

**Local release Compose is mandatory server mode.** `compose.yaml` defaults
`GONES_FRONTEND_DATA_MODE=server` with the API base URL bound to the local API. The legacy profile
used by `npm run e2e:ci` sets the mode explicitly *and* clears the API base URL, so a legacy build
physically cannot reach a server mutation route.

## Consequences

- One authority per build, provable: `src/app/backend/server-authority-boundary.test.ts` fails if a
  canonical store key, a whole-document mutation, or the legacy CalendarEvent path becomes reachable
  from a server build, and `ServerAuthorityBoundaryTests` fails if the API grows such a route.
- The `apiBackend`, `calendarV1`, `leagueServer` and `liveServer` frontend flags are gone. `authV1`
  and `adminV1` remain, as genuine capability flags, and are only honoured in server mode.
- The cutover bundle UI, the Export v4/bundle schemas and the offline Migrator CLI all stay until a
  public cutover plus soak explicitly authorizes their removal. They are not dead code; they are the
  only path off the legacy origin.
- Legacy mode is a rehearsal target, not a growth target. Any new capability lands in server mode.
- The backend keeps its own `GONES_FEATURES__*` flags; they gate server capabilities, not the
  location of the data. The API has no browser store and no whole-document route to remove.

## Deferred

Public domain, DNS, CDN, hosting vendor, managed PostgreSQL, container registry and live provider
credentials remain undecided (ADR 0018, implementation plan §1). The **live cutover** itself — the
per-origin, per-device inventory of legacy browsers, the freeze window, the import run and the soak
before the legacy build is retired — is deferred with them. Nothing in this decision picks a date, a
domain or a provider; it only guarantees that when the cutover happens, exactly one authority is in
effect on either side of it.
