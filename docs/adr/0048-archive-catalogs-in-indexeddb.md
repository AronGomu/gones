# Archive Catalogs in IndexedDB with Year Partitions

## Status

Accepted. Not yet implemented. **Amends ADR 0039** (one TTL cache contract for every data page):
public archive data no longer caches in `localStorage`. **Amends ADR 0023** (full-catalog calendar
cache), whose store this ADR abandons for the archive while keeping its catalog-plus-TTL shape.
**Amends ADR 0031** (authenticated offline read cache), which until now owned the only browser
database that was neither an ADR 0021 nor an ADR 0028 authority. Preserves ADR 0028 (dual-source
League Archive) and ADR 0042 (slim League Archive catalog) rather than replacing them.

## Context

The League Archive catalog is fetched whole and cached in `localStorage` under the key
`gones.leagues-archive.catalog.v2`
(`src/app/features/leagues-archive/league-archive-catalog-cache.service.ts:11`), through the helpers
in `src/app/shared/catalog-cache.ts` and the 24-hour `CATALOG_TTL_MS` declared at line 13 of that
file. ADR 0042 already fought this fight once: the endpoint used to ship whole League documents,
about 2.9 MB of UTF-16 against a roughly 5 MB quota, and slimming it to summary rows brought the
entry down to about 60 KB. The store survived because the row count did not grow — 201 Leagues then,
a `MaximumCatalogSize` ceiling of 1000 now
(`backend/src/Gones.Api/Leagues/PublicLeagueEndpoints.cs:30`).

The archive rebuild breaks that assumption at the root. A Tournament becomes a first-class top-level
record, so the catalog stops being one row per League and becomes one row per Tournament. Measured
against the frozen catalog schema, a Tournament row serializes to **282 characters** and a Season
row to **270**. `localStorage` stores UTF-16, so that is **564 bytes** and **540 bytes** per row on
disk. At 564 bytes the ~5 MiB quota holds **9,295 Tournament rows** if the archive owns the entire
origin, and about **4,600** at a realistic 50% share alongside the Events and rankings catalogs —
roughly 2,300 at a 25% share.

That ceiling is far below the size a public results archive reaches. Research into the public MTG
archives, measured on 2026-08-22 by direct id probes, found that mtgtop8.com alone has emitted about
**89,865 event ids** over roughly nineteen years, carrying about **880,000 decklists** at ~8.7 per
event, and that its intake is **accelerating rather than linear**: ~190 events a year in 2009,
~3,270 in 2019, ~17,500 a year annualised in 2026, roughly doubling every four years. Ninety
thousand rows at 564 bytes is 48.4 MiB of UTF-16, 9.7× the quota; the ×2 headroom figure of 180,000
rows is 96.8 MiB, 19.4×. At mtgtop8's current rate, a 4,600-row budget is about three months of
intake. So `localStorage` does not need to be optimised, it needs to be left.

Four alternatives were weighed and rejected.

- **Cap the catalog around 7,000 rows and render the truncation warning.** It fits, it is free, and
  it makes the archive quietly lie about how much history it holds. The cap is reached in a quarter.
- **Page the catalog server-side.** ADR 0042 already rejected this and the reasons still hold: it
  breaks the client-side name filter and the ADR 0028 union with browser-local records, which are
  merged in the browser and have no server page to join.
- **Compress the stored value.** Same shape as the compression ADR 0042 turned down — it shrinks a
  payload that should not be in that store at all, and buys a decode on every read for one order of
  magnitude when the gap is two.
- **Partition Seasons by year as well as Tournaments.** Measured, the whole Seasons catalog is 0.11–
  0.57 MiB for 200–1,000 Seasons at 270 characters a row; even the pessimistic mtgtop8-shaped
  projection of 9,000 Seasons is 5.15 MiB, which IndexedDB holds without complaint. Partitioning
  them would also force an answer to "which year does a December-to-March Season belong to".
  Complexity with no payoff.

## Decision

**Move the public archive catalogs to IndexedDB, partition only the Tournaments, and give the year
partitions exactly one writer.**

1. **Two databases, never one.** `gones-archive-local` (version 1; object stores `leagues`,
   `league-seasons`, `tournaments`) is the **authority** for browser-authored records under ADR
   0028. `gones-archive-cache` (version 1; object stores `leagues` and `league-seasons` each under
   the single key `'catalog'`, `year-partitions` keyed by the year as a number, and `meta` keyed by
   string) is the **cache** for public server reads under ADR 0039. They are separate because an
   authority and a cache have opposite disposability: "purge the cache" is a routine,
   user-triggered, one-click operation, and it must not be able to reach a record whose only copy is
   in this browser. Sharing a database makes that one mistaken `clear()`, one wrong store name in a
   `versionchange` handler, or one `deleteDatabase` away — and the failure is silent and total.
2. **Leagues and Seasons are fetched whole.** `GET /api/archive/leagues/all` and
   `GET /api/archive/league-seasons/all` each return the complete catalog, stored under one key, and
   the browser filters, sorts and pages it, exactly as ADR 0042 point 6 requires so the name filter
   and the ADR 0028 union keep working. This is the measured 0.11–0.57 MiB case; there is no
   partitioning of these two tiers and none is planned.
3. **Only Tournaments are year-partitioned.** `GET /api/archive/tournaments/all?year=YYYY` serves
   one year. `year` is required: a missing or non-integer value is a `400`, and there is
   deliberately no "all years" mode, because an all-years request is exactly the payload this ADR
   exists to avoid. The per-year row cap is 25,000, sized from the measured mtgtop8 peak of ~17,500
   tournaments in a single year plus headroom.
4. **One writer owns the year partitions.** Only `src/app/backend/archive-backfill-queue.ts` writes
   the `year-partitions` store. A partition is the record `{ year, completedAt, rowCount, items }`,
   and **`completedAt` absent means the year is not cached**. The items and the `completedAt` stamp
   are written in **one** IndexedDB transaction, so a year is atomically whole or atomically absent.
   A crash, a closed tab or a failed fetch mid-way therefore leaves **no record at all**, never a
   half one that a later read would mistake for a complete year.
5. **Expanding a Season is read-through and does not cache.** When a Season's year span —
   `year(firstTournamentDate)` through `year(lastTournamentDate)` — is not fully present, complete
   and locked in the cache, the expansion calls
   `GET /api/archive/league-seasons/{seasonId}/tournaments`, renders the result, and **deliberately
   writes nothing**. This is not an oversight to fix later: a Season's tournaments are a
   cross-cutting slice of several year partitions, so writing them back is precisely what would give
   the year store a second writer and destroy the invariant in point 4.
6. **Freshness is decided per year, not per catalog.** A cached year whose Tournaments are all
   locked is served locally and never refetched. A cached unlocked year is served locally under 24
   hours and refetched at or beyond it, on the existing `CATALOG_TTL_MS` from
   `src/app/shared/catalog-cache.ts:13` — one TTL constant for the whole app, not a second one. An
   uncached year is enqueued in the backfill queue rather than fetched inline, so opening a page
   never blocks on history nobody asked to see.
7. **Truncation is derived, not stored.** A partition's `rowCount` holds the server's uncapped
   `totalCount`, so a year served from the cache re-raises the row-cap warning through
   `items.length < rowCount`. There is no stored `truncated` flag to go stale.
8. **`localStorage` keeps no archive data.** After this, the archive's browser footprint is
   IndexedDB, and `localStorage` holds only the language and view preferences, the table
   filter/sort/page-size state, and the auth coordination keys already allowlisted in
   `src/app/backend/server-authority-boundary.test.ts`. No archive catalog, no archive document, no
   archive key of any kind.
9. **A manual "Resynchronize everything" control lands in Settings, collapsed by default.** It
   clears every store of `gones-archive-cache` and restarts the backfill queue. It is collapsed
   because it is not part of normal use, and it exists because point 6 accepts one concrete
   staleness risk: a locked year is never refetched, so an Admin edit to locked data is invisible to
   a browser that has already cached that year. This button is that risk's only escape hatch, and
   naming it as such is the point.
10. **The IndexedDB allowlist grows, and that is this ADR.**
    `src/app/backend/server-authority-boundary.test.ts:100-115` asserts an exact array of the files
    permitted to touch IndexedDB, and its own comment at lines 103-104 says "Adding a file here is
    an ADR decision." Three files are added: `src/app/backend/local-archive-backend.service.ts` (the
    ADR 0028 authority adapter), `src/app/backend/archive-cache.service.ts` and
    `src/app/backend/archive-backfill-queue.ts` (the ADR 0039 cache and its single writer).
    `src/app/backend/local-league-archive-backend.service.ts` leaves the list when the legacy
    surface is retired.

## Consequences

- Every archive catalog read becomes asynchronous. `readCatalogEntry` is a synchronous
  `localStorage.getItem`; an IndexedDB read is a promise, so the list components resolve their first
  paint through a loading state rather than a same-tick value. The Variant B table's loading
  skeleton is required for that reason, not for polish.
- IndexedDB removes the 5 MiB cliff; it does not promise permanence. Browsers evict best-effort
  origin storage under pressure, and a user can clear site data at any time. That is survivable
  precisely because of point 1: an evicted cache is a cache miss the backfill queue refills, and the
  authored records live in a different database that the same eviction would be a genuine data loss
  for. The residual exposure is unchanged from today and is not made worse here.
- Two databases mean two schema-version ladders and two `versionchange` handlers to keep correct.
  The cost is real and is accepted as the price of the authority/cache split.
- Locked years are never refetched, so a corrected result in an old Tournament stays wrong in an
  already-synced browser until someone presses Resynchronize. This is the accepted staleness risk,
  stated plainly so that a future reader does not treat a report of it as a new bug.
- `localStorage` is not emptied app-wide. The Calendar/Event catalog (`gones.events.catalog`) and
  the Global Rankings catalog (`gones.global-stats.catalog`) stay where they are, under ADR 0023 and
  ADR 0039 respectively; neither is an archive catalog and neither is in this ADR's scope. The
  `src/app/shared/catalog-cache.ts` helpers therefore stay, and `archive-cache.service.ts` imports
  `CATALOG_TTL_MS` from them rather than declaring a second 24-hour constant.
- The allowlist in `server-authority-boundary.test.ts` compares a literal array against a real
  directory walk, so it must be edited in the same commit as each file it names — never earlier,
  never in one lump. Naming a file before it exists turns the suite red for the wrong reason.
- No migration is written for the existing `gones.leagues-archive.catalog.v2` entry. Gones is
  unreleased and local data may be reset; the old key is simply abandoned along with the endpoint
  that filled it.
- The offline public read path (`cypress/e2e/offline-public-read.cy.js`) now exercises IndexedDB
  rather than `localStorage`, so its fixtures and its cache-priming steps change with the store.
- ADR 0039's sentence "public data caches in `localStorage`" is no longer universally true. The rule
  it was protecting — no private row ever reaches `localStorage` — is untouched, and the per-user
  ADR 0031 store remains the only place private data is cached.
