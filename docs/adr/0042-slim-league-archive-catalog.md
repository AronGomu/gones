# Slim League Archive Catalog

## Status

Proposed. Planned by T9–T12 in `artifacts/PLAN_2026_08_20_feedback-app-wide-round-6.md`. Extends ADR
0039 (TTL cache contract) and lives alongside ADR 0028 (dual-source League Archive).

## Context

`GET /api/leagues-archive/all` shipped whole League documents — every Tournament, Round and Match —
so the list cards could print two numbers: `league.tournaments.length` and
`calculateLeagueResult(league).rows.length`. 201 Leagues × ~7.2 KB of document = **1.44 MB**, and the
list page caches that body in `localStorage` under the ADR 0039 contract: ~2.9 MB as UTF-16 against a
~5 MB quota.

Three fixes were proposed for the payload and all three treat the symptom:

- **Compression** — gzips to 103 KB, but compresses a body that should never have been that size.
- **A diff protocol** — the catalog already has an ETag, a 304 and a 24h browser copy, so a repeat
  visit costs zero bytes. A diff only helps the first load, where a diff *is* a full load. A request
  body would also kill HTTP caching and require a client-side merge store.
- **Server-side pagination** — would break the client-side name filter and the union with the
  browser-local Leagues (ADR 0028), and paged summary rows carried no counts anyway.

The real problem: the endpoint served documents to answer two integers.

A second, unrelated route was dead. `GET /api/leagues-archive` (paged, with search and status
filters) had zero frontend callers once the catalog route landed.

## Decision

**Denormalize the two numbers, serve summary rows, and give the export its own route.**

1. `LeagueArchiveAggregate` stores `TournamentCount`, `PlayerCount` and `CountsVersion`, written by
   `Create` and `Apply` from `LeagueCatalogCounts.From(document)`, which is
   `document.Tournaments.Count` and `LeagueRules.CalculateLeagueResult(document).Rows.Count` — the
   backend already computed the same number the browser did.
2. `CountsVersion` is a per-row formula version, the ADR 0040 idea at row granularity. A hosted
   service `LeagueArchiveCatalogCountsBackfill` repairs every row stamped with an older version at
   startup, gated by `Gones:Leagues:BackfillCatalogCountsOnStartup` (default `true`). `PlayerCount`
   is the Swiss standings row count and is not expressible in SQL, so the backfill is C#, not a
   migration script.
3. `GET /api/leagues-archive/all` returns `(id, name, status, updatedAt, documentVersion,
   tournamentCount, playerCount)` — roughly 150 bytes a row, projected in SQL, never deserializing a
   document. ~30 KB for 201 Leagues; ~150 KB at the `MaximumCatalogSize` ceiling of 1000.
4. `GET /api/leagues-archive/all/documents` returns the old whole-document body. The Settings export
   (`LeagueArchiveRepository.listLeagues()`) genuinely needs documents and is the one caller.
   A separate route, not `?documents=true`: a query flag on a `public, max-age=3600` route makes two
   different bodies share one ETag namespace and turns the OpenAPI response schema into a union.
   The two routes derive different ETags from the same stamp plus a distinct literal.
5. `GET /api/leagues-archive` (paged) is deleted with no alias.
6. **Pagination stays in the browser.** The slim catalog arrives whole and the page slices it, so the
   name filter and the ADR 0028 union with browser-local Leagues keep working.
7. **Response compression is enabled anyway**, brotli + gzip, because it is cheap and helps every
   public read — but only for GET requests carrying no `Authorization` header and no session cookie.

## Security note on compression

Compressing an HTTPS response that carries a session secret alongside attacker-influenced input is
the BREACH side channel: an attacker who can inject text into a response and observe its compressed
length can recover the secret byte by byte. So credentialed requests are answered uncompressed. Every
payload this ADR is about — the League catalog, the Event catalog, the global rankings — is an
anonymous public read and is compressed. That is a deliberate narrowing of "app-wide".

## Consequences

- The list page's server half moves from `PersistedLeague[]` to a `LeagueArchiveSummary`. Its
  `calculateLeagueResult` call disappears.
- Browser-local Leagues (ADR 0028) compute their own counts client-side through the same
  `calculateLeagueResult`, and the merged list is uniform.
- The TTL cache key is bumped to `gones.leagues-archive.catalog.v2`. A v1 entry holds fat documents
  and must never be read back as a v2 summary array; `clearLeagueCatalogCache()` clears both.
- The `localStorage` quota risk is gone: ~60 KB of UTF-16 instead of ~2.9 MB.
- `PublicLeagueCatalogApiTests`' assertion that a catalog item is byte-identical to the detail item
  no longer holds and is replaced.
- Changing how either count is derived is one `LeagueCatalogCounts.Version` bump; the backfill repairs
  exactly the stale rows.
- The counts are denormalized, so they can in principle disagree with the document. Three things stop
  that: they are written inside the same domain call that writes the document, they are never
  editable on their own, and the version-gated backfill re-derives them.
- No diff protocol was built, and none is planned. If a first load ever becomes the bottleneck again,
  the answer is a smaller row, not a merge store.
