# Retire the Legacy Archive Surface Without Aliases

## Status

Accepted. Not yet implemented. **Supersedes ADR 0022** (rename the archived League feature): the
surface ADR 0022 renamed is deleted, its "no API path aliases" ruling is carried forward as
precedent, and its "frontend redirects, yes" ruling is **reversed**. Depends on ADR 0048 (archive
catalogs in IndexedDB) and ADR 0049 (per-scope player ratings) landing first, since both build parts
of the replacement surface.

## Context

The archive rebuild replaces a flat `League` holding nested Tournaments with three tiers — League,
LeagueSeason, Tournament — where a Tournament is a top-level row that may stand alone. That is a new
domain, a new database schema, a new HTTP surface and a new set of pages. Nothing about it is a
rename, and the old code cannot be edited into the new shape.

The blast radius is the whole feature. `backend/src/Gones.Api/Leagues/PublicLeagueEndpoints.cs`
serves ten public routes under `/api/leagues-archive/**`;
`backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs:23-47` maps twenty organizer-gated command
routes under the same prefix; `LeagueArchiveAggregate` and the `league_archive_aggregates` table
hold the data; six Cypress specs, the frontend `leagues-archive` and `tournaments-archive` feature
folders and the archive half of `src/app/domain/models.ts` sit on top.

Two questions had to be settled: how to get from the old surface to the new one without a tree that
does not build, and what to leave behind for callers of the old one.

For the first, a **single big-bang commit** was rejected. ADR 0022 already recorded the cost of a
much smaller version of this: renaming the operation names changes the generated client's method
names, "`npm run api:generate` must run between the backend and frontend commits; the frontend does
not compile in between, which is why the two land as separate tickets in a fixed order." A rebuild
of this size does not have a two-commit non-compiling window, it has a dozen, across a
series of commits that is meant to be reviewable one commit at a time.

A **compatibility layer** — an adapter translating old routes and old document shapes onto the new
aggregates — was also rejected. It buys exactly what building side by side buys, and then has to be
specified, tested and deleted itself. It is a second surface pretending to be a bridge.

For the second question, ADR 0022 answered it once already and answered it two different ways for
the two halves of the stack, which is why both halves need arguing here rather than assuming.

## Decision

**Build the new surface beside the old one, delete the old one when nothing calls it, and leave
nothing behind on either side.**

1. **Expand, then contract — with no shim.** The `/api/archive/**` routes, the three new tables, the
   new aggregates, the new frontend files and the new Cypress specs are all **added beside** their
   legacy counterparts. Every new frontend file is created next to its old sibling rather than
   renamed in place. The legacy aggregate, its endpoints, its components, its specs and the
   `league_archive_aggregates` table are deleted in **one final commit**, when the last caller is
   gone. Nothing translates between the two: old code merely survives until it is unused. The
   property this buys is that **every commit in the series compiles and the app runs**, which is
   what makes a rebuild of this size reviewable at all. The accepted cost is that between the
   schema commit and the frontend commits the archive is empty and the legacy pages render an empty
   list. That is expected, and it is written here so a reviewer does not report it as a regression.

2. **No API path aliases.** The old routes return `404`. ADR 0022 set exactly this precedent for
   exactly this situation, and its wording is adopted verbatim rather than re-derived:

   > **No API path aliases.** The old routes return `404`. The only client is this repository's
   > frontend, renamed in the same series, and the OpenAPI snapshot is regenerated with it. An alias
   > would be dead weight that outlives its reason.

   Every clause of that still holds: the only client is this repository's frontend, it is rebuilt in
   the same series, and `npm run api:generate` regenerates the snapshot with it. This is continuity
   with ADR 0022, not a reversal of it.

3. **No frontend redirects either — and this *does* reverse ADR 0022.** ADR 0022 decided the
   opposite for the frontend: "Frontend redirects, yes. […] Bookmarks and old links are a real
   user's problem; a stale HTTP client is not." That reasoning was sound and its premise is now
   false. Gones is unreleased, has no production environment and has no users, so there is no
   bookmark to honour and no old link to keep alive — the asymmetry ADR 0022 relied on, between a
   real user and a stale HTTP client, has no real user on one side of it. `archiveRedirectRoutes()`
   at `src/app/app.routes.ts:63-75` holds five parameter-preserving redirects from `/leagues**` to
   `/leagues-archive**`; both those five sources and the five `/leagues-archive**` routes they point
   at are **deleted**, so every one of the ten hits the 404 page. Keeping the redirects alive would
   mean chaining `/leagues` → `/leagues-archive` → `/archive/league-seasons`: a two-hop redirect
   through a vocabulary that no longer exists, permanently, for nobody. If Gones
   ever ships and a route is renamed again, that decision gets made against a real audience; it is
   not owed in advance.

4. **Live Tournaments are re-pointed in the same commit that drops the table.** Planning found a
   cross-feature dependency nobody had listed:
   `backend/src/Gones.Api/Live/LiveCommandEndpoints.cs:358-364`, `RequireLeagueReferenceAsync`,
   validates a live tournament's `leagueId` by querying `database.LeagueArchiveAggregates` for a
   matching non-deleted row and throwing a `leagueId` validation error when it finds none. Live
   Tournaments are explicitly out of the rebuild's scope, but they read the legacy archive table, so
   retiring it without touching them breaks live seeding. That reference moves to
   `archive_league_seasons` — a live tournament's `leagueId` names what is now a LeagueSeason — in
   the **same commit** as the drop, never before and never after.

5. **The TypeScript↔C# parity corpus is re-pointed, not deleted.** `fixtures/league-domain/v1/`
   (`manifest.json` and `parity.json`) is not an export sample: it is a cross-stack
   **domain-parity** corpus, emitted by `src/app/domain/league-parity-fixtures.test.ts:24` and read
   back by `backend/tests/Gones.UnitTests/LeagueParityTests.cs:172` and
   `backend/tests/Gones.IntegrationTests/LeagueArchiveRouteTests.cs:183`, both of which walk up the
   tree for `fixtures/league-domain/v1` and throw `DirectoryNotFoundException` if it is missing. It
   proves that the TypeScript domain modules and `Gones.Domain` compute the same normalization, the
   same results and the same statistics from the same input — the guarantee that makes browser-local
   records under ADR 0028 trustworthy at all. Deleting it with the rest of the legacy surface would
   have left that parity unproven with nothing rebuilding it, and losing cross-stack parity proof
   was not an acceptable trade for a tidier deletion. The corpus is therefore **re-emitted from the
   three-tier shapes** and both C# readers are re-pointed at the new directory in the same commit.

## Consequences

- `npm run api:generate` must run between the last backend commit and the frontend commits that
  consume it, and `npm run api:check` gates the result. This is ADR 0022's ordering constraint,
  unchanged, and it is why backend and frontend land as separate tickets in a fixed order.
- Endpoint operation names must be **noun-first** — `Archive{Tier}{Verb}`, e.g.
  `ArchiveTournamentApplyEditBatch` — because two endpoints sharing a `.WithName()` throws at
  startup, and the legacy names survive until the final commit. `LeagueCommandEndpoints.cs:33`
  already owns `ApplyArchiveTournamentEditBatch`, so the naive ordering collides and the API does
  not boot.
- The `placeholder-league` row cannot be removed before this commit. `InitialCreate` re-seeds it,
  `LeagueArchiveAggregate.SoftDelete` throws "Placeholder League cannot be deleted."
  (`backend/src/Gones.Domain/Leagues/LeagueArchiveAggregate.cs:140`), `MigrationImportService` calls
  `SingleAsync` on it (`MigrationImportService.cs:139`), and `scripts/seed-local.mjs:13` throws
  `Fixed placeholder League missing or duplicated.` without it — which would break
  `npm run db:reset`. It is retired here, with everything else it belongs to, and `seasonId: null`
  replaces it.
- ADR 0022's other two deliberate non-renames are settled differently. Its
  `/api/maintenance/player-names*` carve-out stands: cross-league player-name maintenance is not the
  archive feature and is untouched. Its frozen export wire format does **not** stand — the v5 bundle
  is four flat collections and `SUPPORTED_IMPORT_DATA_VERSIONS` becomes `[5]`, closing the v1 import
  door ADR 0020 left open. That closure belongs to the export decision and is not made here; it is
  recorded so that no clause of ADR 0022 is left silently live after it is superseded.
- Old routes 404 with no redirect, so any link written during development — in a note, a commit
  message, a screenshot — is dead. `docs/CONTEXT.md` and `docs/GLOSSARY.md` keep the old words as
  "formerly" notes, the same mitigation ADR 0022 chose, so an agent reading an old commit message
  can still resolve the vocabulary even though the URL is gone.
- Building side by side means the repository briefly contains two archives: two domain modules, two
  sets of endpoints, two feature folders, two local IndexedDB adapters. That duplication is visible
  in every review during the series and is the direct price of the compiles-at-every-commit
  property. It is bounded only by actually performing the final deletion; a series that stops early
  leaves the worst of both surfaces in the tree.
- The Cypress specs that cover the legacy surface lose their subject when it is deleted, so the
  replacement specs on `/archive/**` must exist **before** the deletion commit, not after it.
  `cypress/e2e/archive-staged-edit.cy.js` is the sharp case: it covers the ADR 0037 power-user
  staged edit flow, which has to be rebuilt on the new surface or the deletion silently drops that
  coverage.
