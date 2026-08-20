# Dual-Source League Archive

## Status

Accepted. Narrows ADR 0020 for the League Archive capability. Diverges deliberately from ADR 0021's
shape — read the Decision section for why "merged" and not "chosen by role".

## Context

ADR 0020 retired the browser data authority. The API database owns everything; the browser keeps
language, view preference, filters and the anonymous public read cache.

ADR 0021 then cut one hole in that for Live Tournaments: anonymous visitors and the plain `User` role
get `LocalLiveBackend`, an IndexedDB store the server never sees. The adapter is chosen **once, by
role, at injection time**. An `Organizer` gets the server and nothing else; an anonymous visitor gets
the browser and nothing else. Exclusive, either/or.

The product owner then asked for the same capability on the League Archive:

> When I am not connected and go to the leagues page, the archive league page, I don't see any option
> to create a new league or manage my archived league. Make sure it works exactly like the live
> tournament feature. […] Everything is saved locally in the local DB.

and, in the same breath, something ADR 0021's shape cannot deliver:

> However, for exports, if you export all of the leagues, that will include the locally saved leagues.

Those two sentences pull apart. An exclusive adapter means a signed-in Organizer's repository has no
handle on the browser store at all, so a "full data export" run while signed in cannot see the
leagues that were created while signed out. Under ADR 0021's shape they would be invisible and,
sooner or later, lost — the user would sign in, export "everything", wipe the browser, and discover
the local leagues were never in the file.

Three ways out were considered.

1. **Copy ADR 0021 exactly, and accept the loss.** Simplest, consistent with Live, and directly
   contradicts the export requirement. Rejected.
2. **Sync local leagues up on sign-in.** Solves visibility, and reintroduces exactly the two-way
   merge, conflict resolution and ownership-token problem ADR 0020 and ADR 0021 were both written to
   avoid. Rejected.
3. **Merge the two stores at read time; route every write by the league's own id.** No sync, no
   conflict resolution, no second authorization scheme — a league belongs to exactly one store for
   its whole life and never moves. Chosen.

## Decision

**The League Archive reads from both stores and writes to exactly one, decided per league by its id.**

- **Server store** — `AspNetApiBackend`, unchanged. Bound to `LEAGUE_ARCHIVE_BACKEND` as before.
- **Browser-local store** — `LocalLeagueArchiveBackend`, IndexedDB database `gones-leagues`, object
  store `leagues`, key path `id`. Strictly offline. No request is ever made. No sync, in either
  direction, ever.

**Origin is encoded in the id.** A browser-local league id is `local-<uuid>`. The local placeholder
league is `local-placeholder-league`, a distinct row from the server's fixed `placeholder-league`.
`isLocalLeagueId(id)` in `src/app/data/league-archive-origin.ts` is the entire routing rule; there is
no origin column, no lookup table, and no second source of truth about where a league lives.

**`LeagueArchiveRepository` is where the merge happens**, not the injection token:

- `listLeagues()` is `Promise.allSettled` over both stores, concatenated. A rejected server read —
  anonymous visitor, offline, 401, 403 — degrades to the local list alone and raises a
  `serverUnavailable` flag the list page renders. Both rejecting propagates.
- Every other read and write picks its port with `isLocalLeagueId(id)`.
- `createLeague(name)` is the one call with no id to route on. It uses the role:
  `createLeagueTarget(role)` returns `'server'` for `Organizer` and `Admin`, `'local'` for everyone
  else.

**Permission is per league, not per session.** `canManageLeague(leagueId, role)` returns true for any
`local-` league — the visitor owns everything in their own browser — and falls back to
`canManageLeagues(role)` for a server league. A plain `User` therefore reads server leagues and fully
edits their own local ones, in the same list, at the same time.

**A tournament never crosses the boundary.** `moveArchiveTournament` rejects with
`crossAuthorityMoveNotSupported` when source and target disagree on origin. Moving between stores
would be a sync path wearing a different hat.

**Export merges; import routes.** `exportFullData` is fed the merged list minus **both**
placeholders, so a bundle taken while signed in carries the browser's leagues too. Import goes to
whichever store `createLeagueTarget(role)` names, and rewrites incoming ids into that store's
namespace — a server bundle restored locally gets fresh `local-` ids and cannot collide.

**`LocalLeagueArchiveBackend implements LeagueArchiveBackendPort` in full**, all 21 methods, with no
`Partial`. That compiling is the parity proof: the local store is a drop-in for the server adapter,
so no feature can quietly become "server only" without a type error.

## Consequences

Accepted deliberately:

- **The two stores never converge.** A league created signed out stays in that browser forever unless
  the user exports it and imports it while signed in. That round trip is the only bridge, and it is
  explicit, user-driven and visible.
- **Clearing site data destroys local leagues.** There is no server copy. The list page says so;
  export is the backup.
- **The list is heterogeneous.** Two leagues in one grid can have different write rules. The
  `Local only` badge is not decoration — it is the user-facing form of the routing rule.
- **A cross-store move is refused, not emulated.** The user must export and re-import.
- **Archive Tournament edit batches and moves are atomic locally.** `requestResult()` and
  `runTransaction()` keep source/target reads, version checks, transforms, and puts in one IndexedDB
  `readwrite` transaction. A stale version, validation failure, request error, or action error aborts
  the transaction, leaving both rows unchanged. The server equivalent uses one DB transaction.
- **This is not what ADR 0021 does.** Live stays exclusive-by-role. Two capabilities, two shapes, and
  the difference is the export requirement. Do not "harmonise" one into the other without a new ADR.

Guardrails:

- `src/app/backend/server-authority-boundary.test.ts` allowlists exactly three files for IndexedDB:
  `indexed-db.ts`, `local-live-backend.service.ts`, `local-league-archive-backend.service.ts`.
  Adding a fourth is an ADR decision.
- `LeagueConcurrencyError` carries `status = 412` and message `staleLeagueDocument`, the exact shape
  `leagueCommandError` already classifies as `stale`, so both authorities produce identical conflict
  UX.
- `ops/acceptance-matrix.json` row `doc-league-local` maps this capability to gates that really run.

## "The database always prevails"

The product owner's general rule — "if there are any differences between the data in the database and
the data in the application, the data in the database always prevails" — is implemented as a command
discipline, not as a background reconciler:

- Every mutation is an explicit intent command guarded by `documentVersion`.
- Every command returns the store's own persisted document, and the caller replaces its in-memory
  state with that return value. There is no whole-document save and no optimistic local edit kept
  after the fact.
- A rejected command (412) is surfaced as "reload and reapply", never merged.

Both adapters already behaved this way; this ADR pins it as the rule rather than an accident.

## References

- ADR 0020 — Retire the legacy browser data authority
- ADR 0021 — Role-scoped browser Live store
- `docs/league-archive-authority.html` — the diagrammed version of this decision
- Plan `artifacts/PLAN_2026_08_09_feedback-calendar-v1-round-2.md`, tickets T12–T15
