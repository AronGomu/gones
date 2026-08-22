# Grill: Archive rebuild — tournaments tab, table refont, rename

Target spec level: **5** (caller: `make-plan-v2`).

## Round 1 — Data model + Archive shell + Table contract

| #   | Question                                                          | Answer                                                                                   | Precision                                                                                                                              |
| --- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | How does a Tournament with no League get stored?                  | **A** — new top-level `ArchiveTournamentAggregate`; `leagueId` becomes `string \| null`   | —                                                                                                                                      |
| 2   | What does the Tournaments tab list?                               | **A** — every Tournament, attached and standalone, with a League column                  | —                                                                                                                                      |
| 3   | Row click: expand or navigate?                                    | **B** — row expands; the Name cell is the link that navigates                            | —                                                                                                                                      |
| 4   | Column 3 on the Tournaments tab                                   | **A** — parent League name                                                               | Standalone renders **empty**, not the word "Standalone"                                                                                |
| 5   | What is "Date last update"                                        | **B** + extra column                                                                     | **Six columns.** Keep `updatedAt` (any League/Tournament edit) **and** add most-recent `tournamentDate`. Both columns ship.             |
| 6   | Rename blast radius                                               | **C** — everything incl. API paths, `/api/leagues-archive` kept as alias                 | **Override ADR 0022.** New ADR supersedes its no-API-alias clause.                                                                     |
| 7   | Sorting / searching / paging                                      | **A** — client-side over the cached catalog                                              | Initial request fetches **all** leagues + tournaments; every filter/sort/page is client-side. Verify mutation→resync (see Facts below). |
| 8   | Placeholder "Unassigned Tournaments" League                       | **A** — retire it, migrate its Tournaments to standalone, hide from the Leagues tab      | —                                                                                                                                      |
| 9   | Tab in the URL                                                    | **A** — `/archive/leagues` + `/archive/tournaments`; `/archive` redirects to leagues     | —                                                                                                                                      |
| 10  | Browser-local standalone Tournaments                              | **A** — yes, same dual-source rule, `local-` prefix, `gones-leagues`                     | —                                                                                                                                      |
| 11  | UI prototype deliverable                                          | **B** — two or three HTML table variants, then one wins                                  | —                                                                                                                                      |

## Facts (repo inspection)

### Round 1 baseline

- `TournamentDocument.leagueId` required non-null string — `src/app/domain/models.ts:69`
- `PLACEHOLDER_LEAGUE_ID = 'placeholder-league'`, display name `'Unassigned Tournaments'` — `src/app/domain/models.ts:4`
- Slim catalog row already carries 4 of the 6 requested columns: `id · name · status · updatedAt · documentVersion · tournamentCount · playerCount` — `src/app/data/league-archive-summary.ts:16`
- List page already client-side pages at 25/row over the cached catalog — `src/app/features/leagues-archive/league-archive-list.component.ts:25`
- Archive catalog server route `/api/leagues-archive/all` → `PublicLeagueCatalogResponse(items, totalCount, truncated)`, ceiling 1000 — `PublicLeagueEndpoints.cs:29,55`
- Dual-source archive (ADR 0028): server ∪ browser-local, routed on `local-` prefix, never synced — `league-archive-repository.service.ts:13-21`
- Local store: db `gones-leagues`, object store `leagues` — `local-league-archive-backend.service.ts:35`
- Existing UI routes `/leagues-archive`, `/leagues-archive/:leagueId`, `/leagues-archive/:leagueId/tournaments-archive/:tournamentId[/result[/metagames]]` — `app.routes.ts:104-108`
- Breadcrumbs hardcode the `leagues-archive` / `tournaments-archive` segments — `app-breadcrumbs.ts:70-83`
- Bound Cypress specs: `cypress/e2e/league-local.cy.js`, `league-server.cy.js`, `archive-staged-edit.cy.js`

### Q7 verification — does a user mutation resynchronize? **Yes, already implemented.**

Two mechanisms, both verified by inspection:

1. **Public catalog** (`localStorage`, key `gones.leagues-archive.catalog.v2`). Mutation sites dispatch
   `window` event `gones-league-updated`; `app.component.ts:165` listens and calls
   `clearLeagueCatalogCache()`. Next visit to the list refetches. Covered sites:
   - League rename — `league-archive-detail.component.ts:145`
   - League create-tournament — `league-archive-detail.component.ts:169`
   - Tournament edit batch, both the move and non-move paths — `tournament-archive-detail.component.ts:467,471,520` via `notifyLeagueUpdated`
   - League create — `league-archive-list.component.ts:174` (direct clear)
   - League delete / Tournament delete from the header — `app.component.ts:380,399` (direct clear; they navigate away)
   - Live Tournament finalize — `live-tournament-runner.component.ts:662` (direct clear)
2. **Private export cache** (`'leagues'` resource, IndexedDB). `listLeagues()` uses
   `ServerReadCacheService.read()`, which is **fallback-only** (ADR 0031, kept unchanged by ADR 0039):
   the server is always tried first and the cache is served only when that read fails. No invalidation
   is needed and none exists — a stale copy can only surface offline, which is what the
   `offline.cachedServerRead` banner states.

**Residual risk carried into the plan, not a current bug:** the invalidation is a loose `window`-event
convention with **no test enforcing coverage** — nothing resembling
`src/app/shared/back-button-coverage.test.ts`. Q1-A adds a second aggregate and therefore a second
catalog cache key, and every existing mutation site must clear that one too. A ticket that forgets
fails silently for up to 24 hours. Round 2 Q11 decides whether to add the enforcement test.

### Round 2 sizing facts

- Tournament ids come from `defaultIdFactory()` = `crypto.randomUUID()` — `models.ts:234`. Unique in
  practice, but **not guaranteed** by schema: `createIdFactory(prefix)` yields `id-1`, `id-2`, and
  imported/legacy bundles carry whatever ids they were written with.
- Caps today: League catalog ceiling **1000** (`PublicLeagueEndpoints.cs:30`), and each League may hold
  up to **1000** Tournaments (`LeagueArchiveAggregate.cs:14`). Worst case is 10⁶ Tournaments against a
  Q7-A "fetch everything" contract. The stress fixture targets ~200 League Archives —
  `scripts/generate-stress-environment.mjs:56`.
- Global rankings catalog ceiling is **5000** (`PublicLeagueEndpoints.cs:35`) — the closest precedent
  for a Tournament catalog cap.
- `MaximumDocumentBytes = 1_048_576` per League document — `LeagueArchiveAggregate.cs:13`.

## Round 2 — Storage split, API contracts, migration

| #   | Question                                        | Answer                                                                          | Precision                                                                                                                                                                                          |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Do attached Tournaments move out too?           | **B** — every Tournament moves; `LeagueArchiveAggregate` becomes a header row     | —                                                                                                                                                                                                  |
| 2   | Tournament identity                             | **A** — globally unique id, migration rewrites collisions, DB unique constraint   | —                                                                                                                                                                                                  |
| 3   | API routes + catalog schema                     | **A** — `/api/archive/leagues/all` + `/api/archive/tournaments/all`, old aliased  | **Drop `leagueName` from the Tournament row.** Ship the key only; the leagues catalog is fetched in the same initial load, so the name is joined client-side.                                        |
| 4   | Canonical Tournament UI route                   | **A** — flat `/archive/tournaments/:tournamentId`                                | Back button must return to the **previous page in history**, not a fixed link.                                                                                                                     |
| 5   | Tournament catalog cap                          | **180,000** by the ×2 rule — but it does **not** fit `localStorage`. See below.  | Derive from real comparable sites over their whole lifetime, then **×2**. Research complete → `RESEARCH_archive_volumes.md`.                                                                          |
| 6   | Standalone Tournaments feed ratings?            | **A** — yes, identical treatment, rebuild walks both sources in date order        | Server ("global") Tournaments only. **Plus a new hierarchy tier** — see below.                                                                                                                      |
| 7   | Export bundle + data version                    | **C** — bump to v5 **and** drop v1–v3 import support                             | No retro-compatibility to support. Drop every previous version.                                                                                                                                     |
| 8   | Power-user create + move                        | **A** — create-standalone on the Tournaments tab; move accepts `null` both ends   | League must be created first. Tournament create/update picks from existing server **or** local Leagues, or `null`. Default is standalone; created from a League page → auto-attached to that League. |
| 9   | Expanded League row                             | **B** — compact children: date, name, players, status                            | Do **not** mirror the parent table's columns. One continuous line of text, the whole line is the link to the Tournament.                                                                            |
| 10  | Column order + default sort                     | **A** — `Name · Last played · Updated · #Tournaments\|League · Players · Status`; default Last played desc; all six sortable; state in query string | —                                                                                                                                                                                                  |
| 11  | Cache-invalidation enforcement                  | **B** — centralize first, then test                                              | Route every archive mutation through one repository method that invalidates, so there is one site instead of many.                                                                                 |

### Q6 opened a new branch — three-tier hierarchy

Verbatim from the answer: *"there will be a new data structure called leagues. There is also a new
data structure called league season, and a league can now refer to a group of leagues. Each league
season is equivalent to the current single league. The new league data structure is simply a group of
league seasons."* Plus: a League filter on Global Rankings, and inside it a season multi-select.

So the model becomes **League (group) → LeagueSeason (= today's League) → Tournament**. This is a new
design-tree branch that did not exist when rounds 1–2 were asked, and it invalidates parts of the Q10
column contract, which was settled for a two-tier model. Round 3 covers it.

### Q5 research result — and the decision it forces

Full brief: `RESEARCH_archive_volumes.md` (researcher subagent, measured 2026-08-22).

**Sizing anchor.** mtgtop8.com has emitted **89,865 event ids** over ~19 years (archive back-filled to
1994, site operating since 2007), carrying ~880,000 decklists at ~8.7 per event. Intake is
**accelerating, not linear**: ~190 events/yr in 2009 → ~3,270 in 2019 → ~17,500/yr annualised in 2026,
roughly doubling every 4 years. Source: live id probes, `https://www.mtgtop8.com/event?e=89865&f=ST`
and ~18 dated id anchors.

melee.gg bounds out higher (~290k–300k ids) but was **correctly excluded** as non-comparable — 3 of 5
sampled ids were Lorcana or Star Wars Unlimited, not Magic. Grand Prix as a whole series totals **702
events over 23 years**, which calibrates the group tier: a flagship worldwide circuit contributes under
a thousand rows in its entire life, so the League/Season tier is not a sizing risk at all.

**×2 rule → 180,000 rows.**

**This breaks the `localStorage` half of Q7-A.** The researcher computed against an assumed 180 B/row;
I measured the actual frozen schema instead — a real Tournament catalog row serializes to **282
characters**, a Season row to 270. `localStorage` stores UTF-16, so ~564 B per Tournament row:

| rows | UTF-16 payload | vs ~5 MiB quota |
| --- | --- | --- |
| 7,000 | 3.8 MiB | fits |
| 9,295 | 5.0 MiB | exactly the unshared ceiling |
| 14,500 | 7.8 MiB | **exceeds** |
| 90,000 (mtgtop8 today) | 48.4 MiB | **exceeds × 9.7** |
| 180,000 (×2 rule) | 96.8 MiB | **exceeds × 19.4** |

Realistic capacity, sharing the origin with the Events and rankings catalogs: **~4,600 rows at a 50 %
share, ~2,300 at 25 %**. That is roughly **3 months** of mtgtop8-rate intake.

So "fetch everything, cache it, filter client-side" survives only if the store changes. Client-side
filtering/paging is **not** what breaks — the 5 MiB `localStorage` cap is. Open decision for round 4:
move the public archive catalog to **IndexedDB** (no 5 MiB cap, stores structured clones rather than
UTF-16 strings), which amends ADR 0039's "public data caches in `localStorage`" rule and requires the
`indexedDB` allowlist in `src/app/backend/server-authority-boundary.test.ts` to grow; or cap at ~7,000
and accept visible truncation; or reverse Q7 and page server-side.

**Research gaps to carry into the plan, per the brief:** mtgtop8 id sparsity is unmeasured (some ids
are editorial articles, so 90,000 is an upper bound, true count possibly 5–15 % lower); MTGGoldfish
yielded no count at all (slug URLs, `robots.txt` disallows this agent class); the ~5 MiB
`localStorage` quota is assumed rather than probed per browser.

### Knock-ons recorded from round 2, not re-asked

- Q1-B consequence: today one `documentVersion` per League document guards every Tournament edit
  (ADR 0010 optimistic concurrency, ADR 0037 staged-edit batch). Splitting Tournaments into their own
  rows gives each its own version and changes what the edit-batch locks. Round 3 Q10 settles it.
- Q4 consequence: `gones-back-button` currently takes a fixed `[link]`. History-based back is a change
  to the ADR 0044 component and its coverage test.
- Q3 consequence: the Tournament catalog row carries `leagueId` only; `leagueName` is joined in the
  browser from the leagues catalog loaded by the same initial fetch.

## Round 3 — League/LeagueSeason hierarchy, ranking scope, concurrency

| #   | Question                          | Answer                                                                    | Precision                                                                                                                                                                                                                              |
| --- | --------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | One plan or phased?               | **B** — one plan, hierarchy included                                       | Implementation is sequential regardless; every ticket is implemented individually.                                                                                                                                                       |
| 2   | League tier mandatory?            | **B** — mandatory; every Season belongs to a League                        | Create League first, then attach a Season. Season page gets a **required** League select, defaulting to the latest League created by the same organizer/admin. The Seasons view shows one row per Season with a **League column**.        |
| 3   | Naming                            | **A** — "League" = the group; today's League → `LeagueSeason` everywhere    | Symbols, routes and docs all renamed.                                                                                                                                                                                                    |
| 4   | What the tabs list                | ticked **A**, but precision describes **C** → **arbitrated to C**           | *"don't list the league, but only the league seasons, and expanding a row shows the tournament from that league season"*                                                                                                                 |
| 5   | Tournament parent pointer         | **A** — `seasonId` only; League derived transitively                       | Do **not** add a league FK unless there is a real cost. (There is none — per-League ratings aggregate through the season join.)                                                                                                          |
| 6   | Migration                         | **none** — delete all current data, rebuild from scratch                   | No users; development stage only. Consistent with `AGENT.md`: Gones is unreleased, local data may be reset without migration guarantees.                                                                                                 |
| 7   | Scoped ranking                    | **B** — recomputed Glicko-2 per scope                                      | Compute **and store** per League Season **and** per League.                                                                                                                                                                             |
| 8   | Ranking filter UI                 | **A** — default "All leagues"; seasons pre-checked; query-string state      | —                                                                                                                                                                                                                                      |
| 9   | Routes for the league tiers       | ticked **A and C** (mutually exclusive) → **partially arbitrated**          | *"For now, there is no dedicated page to see leagues. You can only view league seasons."* → no `/archive/leagues/:id` page. Whether a separate leagues **catalog endpoint** survives is round 4 Q8.                                       |
| 10  | Concurrency                       | **A** — Tournament-scoped `expectedVersion`, returns the Tournament        | —                                                                                                                                                                                                                                      |
| 11  | Export v5 shape                   | **A** — four flat collections joined by id                                 | —                                                                                                                                                                                                                                      |

### Research follow-up answer

> *"Is it possible to only fetch by year? By default its the latest year. In any case: I allow to
> migrate locally stored data to indexDB"*

Yes on both, and together they close the storage problem. Year partitioning bounds an otherwise
unbounded catalog; IndexedDB removes the ~5 MiB `localStorage` cap. Exact contract = round 4 Q2 and Q3.

### Arbitrations carried into round 4

Three round-3 answers conflict with their own precisions. All three are re-confirmed in round 4 rather
than silently assumed:

1. **Q4** — ticked A (Leagues tab → Seasons → Tournaments, two expansion levels) but the Q4, Q2 and Q9
   precisions all describe **C** (one tab listing Seasons, League as a column, one expansion level).
   Taken as **C**; round 4 Q1 confirms.
2. **Q9** — ticked **A and C**, which are mutually exclusive on whether a separate leagues catalog
   exists. The precision kills the League *page* but not the *endpoint*; round 4 Q8 settles it.
3. **Q7 vs Q8** — ratings stored per Season and per League (bounded) versus a UI allowing arbitrary
   season *subsets* (2ⁿ combinations, no stored row). Round 4 Q4 settles what a subset displays.

### Measured facts added this round

- `player_statistics` is keyed on `PlayerName` alone —
  `backend/src/Gones.Infrastructure/Persistence/PlayerStatisticsReadModelConfigurations.cs:13`. Per-scope
  rows need a composite key.
- Scope row multiplication is mild: a player in 3 Seasons across 2 Leagues holds 1 global + 3 season +
  2 league = **6 rows**. Rebuild cost ~3×, since each Tournament replays into exactly three scopes.
- `server-authority-boundary.test.ts:107-111` allowlists `indexedDB` to exactly three files. A public
  catalog store makes a fourth and must be added deliberately.
- `catalog-cache.ts` is `localStorage`-only by construction; ADR 0039 states public data caches there.
  Moving the archive catalog to IndexedDB amends that clause.

## Round 4 — Year partitioning, scoped ratings, arbitrations

| #   | Question                              | Answer                                                                              | Precision                                                                                                                                                                                                                          |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Arbitration: tab 1 lists Seasons      | **A** — confirmed; one row per Season, League column, one expansion level, no League page | Rename API and URL routes to `leagueSeason`.                                                                                                                                                                                       |
| 2   | Year-partition fetch                  | **C** — rolling window                                                                | Initial load fetches **current year** synchronously, then **asynchronously backfills all other years**. After 365 days data **locks** — only admin may update it directly in the DB. Locked data never refetched in the same browser; locked years are excluded from sync requests. The async backfill must be independent of the 365-day live fetch. |
| 3   | Public catalog cache store            | **B** — move **every** public catalog to IndexedDB                                    | `localStorage` keeps only language, view preference and filters.                                                                                                                                                                    |
| 4   | Arbitration: season subsets           | **C** — single-select                                                                 | User picks **all** or **exactly one**. Update the select spec.                                                                                                                                                                      |
| 5   | Scoped read model                     | **A** — one table, composite PK `(scope_kind, scope_id, player_name)`                 | —                                                                                                                                                                                                                                  |
| 6   | Reset blast radius                    | **C** — squash the EF migration history too                                           | —                                                                                                                                                                                                                                  |
| 7   | League select default                 | **A** — most recent League by current user; empty+required when none; inline Create   | Must be **impossible** to reach the League Season page with no existing League to attach to.                                                                                                                                        |
| 8   | Arbitration: leagues catalog          | **A** — keep a separate `/api/archive/leagues/all`                                    | —                                                                                                                                                                                                                                  |
| 9   | League / Season fields                | **A** — status on the Season only; Season dates derived from Tournaments              | —                                                                                                                                                                                                                                  |
| 10  | Prototype variants                    | **B** — three Seasons-tab variants **plus** one filtered Global Rankings mockup       | —                                                                                                                                                                                                                                  |

### Resolved cleanly this round

- **Q4-C closed the combinatorial gap.** "All or exactly one" means every selectable scope is `global`,
  one `league` or one `season` — precisely the three `scope_kind` values Q5-A stores. No selectable
  scope lacks a stored rating; no on-demand replay anywhere. Q4 and Q5 fit exactly.
- **Q6-C tradeoff acknowledged.** Squashing rewrites committed migration files. It will be done as a
  new commit deleting the old set and adding the squashed one — never by rewriting git history (per J1).
  Flagged once in the option text; chosen twice.

### New mechanism introduced by Q2's precision: data locking

No lock, freeze or immutability concept exists anywhere in the domain or API layer — verified; the only
`locked` hits are unrelated Live-tournament pairing state (`LiveRules.cs:380-402`). So every part of it
is new and needs specifying. One part is a trap: **"locked data is never refetched" + "an admin can
still change it" → an admin edit can never reach a browser that already cached that year.** Round 5 Q4
is the escape hatch.

### Naming fact for round 5

Every route segment in this codebase is kebab-case — `/api/leagues-archive`, `/api/live-tournaments`,
`/api/event-proposals`, `/api/admin`, `/api/organizations`. A literal camelCase `leagueSeason` segment
would be the app's only exception. Round 5 Q6 settles it.

## Round 5 — Year locking, backfill, final naming

| #   | Question                          | Answer                                                                       | Precision                                                                       |
| --- | --------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| 1   | Unit of locking                   | ticked **A** (year partition), precision says **per Tournament** → arbitrated to per-Tournament | *"Per tournament. Tournaments become the new unit standard now."*                |
| 2   | Server meaning of locked          | **B** — API refuses locked writes for everyone **except Admin**, who keeps the normal endpoints | —                                                                               |
| 3   | Locking on browser-local rows     | **A** — no; local rows are never locked                                       | —                                                                               |
| 4   | Admin edit reaching a cached year | **C** — manual "Resynchronize everything", no automatic detection             | Button lives in **Settings**, hidden at the **bottom**.                          |
| 5   | Async backfill                    | **A** — newest-to-oldest, one year at a time, quiet sync-bar progress, retry next start | —                                                                               |
| 6   | Route naming                      | **A** — kebab-case segments, camelCase `LeagueSeason` symbols                 | —                                                                               |

### Q1 arbitration — per-Tournament locking, and why it still works

Ticked A, precision says per Tournament. **Taken as per-Tournament**, and it is the better answer:

- The flag is **derived, never stored**: `locked ≡ tournamentDate + 365 days < today`. No column, no
  scheduled job, no backfill — the same rule ADR 0043 already uses for the derived `inactive` flag.
- **The fetch optimisation survives intact.** Fetch granularity stays the year; the rule is *refetch a
  year iff it still contains at least one unlocked Tournament*. A year entirely older than 365 days is
  100 % locked and is therefore never refetched — exactly the behaviour asked for. Only the current and
  previous year are ever re-requested, and they are one year each.
- Locking applies to **Tournaments only**. A League or a League Season stays editable regardless of the
  age of the Tournaments inside it — renaming a 2019 season must not require a DBA. *(Assumption A4.)*

### Accepted risk from Q4-C, recorded deliberately

Manual-only resynchronisation means an Admin's correction to a locked Tournament is invisible to every
browser that already cached that year, until the user finds the Settings button. This was flagged in
round 5 Q4 as the permanent-divergence trap and manual resync was chosen with that stated. Recorded as
accepted, not overlooked. *(Assumption A5.)*

---

## Round 6 — Partial cache reads, backfill race

**Frontier reopened by a user question** after the round-5 shared understanding was drafted. A Season
spans years while Tournaments are partitioned *by* year, so expanding a Season can demand a partition
that has not landed. The spec had no answer, and a second fetch path writing the same partition as the
background backfill is a real race that can silently mark a year complete while holding part of it.

| #   | Question                                    | Answer                                                                                     |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | Seasons catalog partitioned?                | **A** — fetched whole, like Leagues. Only Tournaments are year-partitioned.                    |
| 2   | Opening a Season with unloaded Tournaments  | **C** — dedicated endpoint, **read-through**: render the result, never write it to IndexedDB   |
| 3   | Knowing which years a Season needs          | **B** — add `firstTournamentDate` alongside `lastTournamentDate`; client infers the year range |
| 4   | Year-partition write ownership              | **A** — exactly one writer, the backfill queue; one transaction; atomically whole or absent    |
| 5   | Already local → call the API?               | **A** — locked+cached → never; unlocked → 24h TTL decides                                      |

### Coherence check — these four fit together

Q2-C's read-through endpoint **never writes**, so Q4-A's single-writer rule holds: the backfill queue
remains the sole writer and the partition stays atomic. Q3-B's known weakness (a 2019–2026 Season
implying eight partitions) is **moot under Q2-C**, because an expand never demands partitions — it calls
the read-through endpoint. The year range is still needed, but only to answer Q5-A's question "do I
already hold these Tournaments locally?" before deciding whether to call at all.

Resolved read path for expanding a Season:

```
years = [year(firstTournamentDate) .. year(lastTournamentDate)]
all years cached && complete && locked   → render from IndexedDB, no request
otherwise                                → GET /api/archive/league-seasons/{id}/tournaments
                                           render, do not cache
```

### A5 refinement (user, after round 5)

The manual resync is an option in **Settings**, inside a **collapsed-by-default** menu that must be
expanded to reach it. Clicking it triggers the **async lazy fetch** to refetch and update **all** data —
it reuses the backfill queue rather than being a separate code path.

### A3 follow-up — research result

**No frozen contract breaks.** The brief validates three decisions already made and enriches the
fixture ticket. Key findings:

- **Public archives do not expose series/season as data.** mtgtop8's `meta` parameter is *not* a series
  taxonomy — it is a mixed-axis editorial slice list combining rolling windows (`Last 2 Weeks`), event
  tiers (`Large Events Last 2 Months`), calendar years (`All 2026 Decks`), **format eras**
  (`Standard 2017-2018 (Kaladesh to M19)`) and only four hardcoded history buckets for **defunct**
  series (`History - All Pro Tour`, `… All Grand Prix`, `… All Worlds`, `… All Nationals &
  Continentals`). Ids are **per-format** — `Last 2 Weeks` is `meta=50` in Standard, `54` in Modern, `194`
  in Pioneer — so it is not even a shared vocabulary. Modern merges PT and GP into one bucket
  (`meta=92`); Pioneer has no series buckets at all.
- **The event record carries no series or season field.** Verified on
  `https://www.mtgtop8.com/event?e=89767&f=LE`: title string, venue string, format, star rating, player
  count, date, decklists. No series id, no season, no organiser, no parent-event id. The star rating
  encodes *importance*, not series.
- **Event names follow no convention.** 25 real strings collected. Series appears as prefix, suffix,
  parenthetical, acronym, or not at all; season as a bare year, `Season 3`, `2026/2`, `1996–97`, a leg
  ordinal, a roman numeral, a week number, or absent. Multilingual (`Etapa`, `Liga`, `Hebdomadaire`).
  Worse: the names that *do* carry a season are mostly store leagues, while the ones that matter most
  (`Sunday 5k RCQ`) carry none.
- **Therefore the League tier is our own construct**, not something a source provides. Fixtures should
  reflect that with `sourceSeriesId: null`.

**Validated, no change needed:**

- `LeagueSeason.name` is already a **free string**, which is required — real labels include `2026-27`,
  `Season 5 - Round 2`, `2026/2`, `1996–97`. An integer-year column could not hold any of the first four.
- Round 6 Q1-A (Seasons **not** year-partitioned) is confirmed correct by real cross-year seasons.
- Round 4 Q9-A (Season dates **derived** from its Tournaments) survives Aug→Aug seasons unchanged.

**Fixture-generator requirements lifted from the brief** — the fixture ticket must produce: seasons with
and without explicit labels; at least one **cross-year** season (Aug→Aug or autumn→spring) so
date-bucketing bugs surface; **wildly varying** events-per-season (observed real spread: 1 for Worlds,
3–4 modern Pro Tour, 5–13 early GP, 6 Regional Championships, 8–11 Spotlight, 50–60 late GP, 7+ weekly
store legs); a child series whose name embeds its parent's (`Pro Tour Aetherdrift - 2nd Chance PTQ`) so
prefix-grouping heuristics visibly break; degenerate names carrying no series signal (`Series`, `1K`,
`FNM`, `Weekly`) that must land in a no-league bucket rather than creating garbage Leagues; and
non-ASCII names (`3ª Etapa Regular - 2026/2`, `Liga Sword`, `Gdańsk`).

**Environment issue, reported by the researcher:** `web_search` was unavailable for the entire run —
every call returned `Gemini API error: This model models/gemini-2.5-flash-lite is no longer available to
new users.` All findings came from direct page fetches only. That is why SCG Tour historical seasons,
Arena Championship cadence, Legacy European Tour and Eternal Weekend are marked **not found** — they
needed discovery search, not a known URL. None of them affects a contract.

### A3 follow-up — original dispatch note

User asked whether real tournament series beyond Grand Prix are identifiable in source datasets, and
stated the fallback: *"If you don't see any distinction between the league seasons, just cut by years —
just split by years."* This is a lookup, so it was dispatched to a researcher rather than put to the
user: which recurring MTG series exist, whether public archives expose series/season as **data** or only
inside event-name strings, and whether calendar-year is a defensible default season split. Output →
`RESEARCH_series_and_seasons.md`. It informs the **fixture generator** and the **default season
granularity**, not any contract already frozen.

### Measurement taken for this round

Season catalog row = **270 chars / 540 B UTF-16**; **300 / 600 B** with `tournamentYears` added.
Unpartitioned Seasons catalog payload:

| scale | seasons | payload |
| --- | --- | --- |
| mtgtop8, 10 tournaments/season | 9,000 | 5.15 MiB |
| mtgtop8, 20 tournaments/season | 4,500 | 2.57 MiB |
| mtgtop8, 30 tournaments/season | 3,000 | 1.72 MiB |
| Gones-realistic | 200–1,000 | 0.11–0.57 MiB |

All fit IndexedDB comfortably → Seasons probably should **not** be partitioned, which also deletes the
"which year does a Dec–Mar Season belong to" problem. Round 6 Q1.

---

# Shared understanding

**Spec level: 5 — target reached.** Every boundary below is a name, a signature, a schema or a route,
not a description. Ready for `make-plan-v2`.

## Goal

Rebuild the Gones Archive. Tournaments become first-class records that may stand alone; a three-tier
**League → League Season → Tournament** hierarchy replaces today's flat League; the card grid becomes a
paginated, sortable, expandable six-column table across two tabs; Global Rankings gains a scope filter
backed by stored per-scope Glicko-2 ratings. Success = a user can browse every archived Tournament,
attached or standalone, from one table, filter rankings to a single League or Season, and every page
loads from a year-partitioned IndexedDB cache without refetching settled history.

## Settled

### Data model

- Three tiers: **League** (group) → **LeagueSeason** (= today's League, renamed everywhere) →
  **Tournament** (own top-level aggregate).
- Every Tournament is its own row. `LeagueArchiveAggregate` becomes a header row; `LeagueDocument`
  no longer carries `tournaments[]`.
- A Season's League is **mandatory**. A Tournament's Season is **optional** (`null` = standalone).
- A Tournament points at `seasonId` only. No `leagueId` foreign key on a Tournament — the League is
  derived through the Season join.
- Tournament ids are **globally unique**, enforced by a DB unique constraint.
- The `placeholder-league` / "Unassigned Tournaments" concept is **retired**.

### Reset, not migration

- No data migration. All current archive data is deleted and rebuilt from scratch — no users exist.
- EF migration history for the archive tables is **squashed**: old migration files deleted, one
  squashed set added, as a **new commit** (never a git history rewrite).
- Dev fixtures regenerated. Browser-local archive stores cleared by an IndexedDB version bump.

### Archive UI

- Two tabs. **Tab 1 lists League Seasons** — one row each, with a **League** column, expanding one
  level to that Season's Tournaments. **Tab 2 lists every Tournament**, attached and standalone.
- **No League page exists.**
- Six columns, in this order: `Name · Last played · Updated · #Tournaments|League · Players · Status`.
  Column 4 is the Tournament count on tab 1 and the parent Season name on tab 2, **empty** when
  standalone. All six sortable. Default sort **Last played, descending**.
- Row expands; the **Name cell** is the link that navigates.
- Expanded child rows are **compact**: one continuous line of text (`date · name · players · status`),
  the whole line being the link to the Tournament. They do **not** mirror the parent column layout.
- Sort, page, search and year state live in the **query string**.
- Back buttons return to the **previous page in history**, not a fixed link.

### Fetching, caching, locking

- **Every public catalog moves to IndexedDB.** `localStorage` keeps only language, view preference
  and filters.
- **Only the Tournaments catalog is year-partitioned.** Leagues and League Seasons are fetched whole,
  so tab 1 always renders completely — the only thing that can ever be missing is a Season's children.
- On app start the **current year** of Tournaments is fetched synchronously; every other year is
  **backfilled asynchronously**, newest to oldest, one at a time, never blocking navigation, with quiet
  progress in `gones-sync-bar` and retry on next start.
- **Exactly one writer** owns year partitions: the backfill queue. A year is written in a single
  IndexedDB `readwrite` transaction and marked complete inside that same transaction, so a partition is
  **atomically whole or absent, never partial**.
- Expanding a Season whose Tournaments are not all cached calls a **read-through** endpoint that
  renders but **never writes** — preserving the single-writer rule and the atomic partition.
- A **Tournament** is locked when `tournamentDate + 365 days < today`. Derived, never stored.
- A year is refetched **iff it still contains at least one unlocked Tournament**. Fully locked years
  are never refetched in that browser.
- Locked Tournaments reject writes from everyone **except Admin**, who keeps the normal endpoints.
- Browser-local rows are **never** locked.
- Recovery from an Admin edit to locked data is a **manual "Resynchronize everything"** button, placed
  at the **bottom of Settings**. No automatic detection.

### Ratings

- Glicko-2 is **recomputed and stored per scope**: `global`, per `league`, per `season`.
- The Global Rankings filter is **single-select at both levels**: All leagues or exactly one; then All
  seasons or exactly one. Every selectable scope therefore has a stored rating — no on-demand replay.
- Server Tournaments only. Browser-local records never reach server rankings.

### Naming

- Feature renamed `leagues-archive` → `archive`. Today's League renamed to `LeagueSeason` in symbols,
  routes and docs. Supersedes ADR 0022.
- Route segments are **kebab-case**; TypeScript symbols are camelCase `LeagueSeason` / `seasonId`.

## Contracts

### UI routes

```
/archive                                             → redirect → /archive/league-seasons
/archive/league-seasons                              tab 1
/archive/league-seasons/:seasonId
/archive/tournaments                                 tab 2
/archive/tournaments/:tournamentId
/archive/tournaments/:tournamentId/result
/archive/tournaments/:tournamentId/result/metagames
/global-stats?league=<id|all>&season=<id|all>&sort=&dir=&page=&size=&search=
```

### API routes

```
GET /api/archive/leagues/all                              whole
GET /api/archive/league-seasons/all                       whole
GET /api/archive/tournaments/all?year=YYYY                partitioned
GET /api/archive/league-seasons/{seasonId}/tournaments    read-through, never cached
GET /api/archive/years
GET /api/archive/league-seasons/{seasonId}/result
GET /api/archive/tournaments/{tournamentId}
GET /api/archive/tournaments/{tournamentId}/result
GET /api/archive/global-player-statistics?scopeKind=&scopeId=&page=&pageSize=&sort=&direction=&search=
```

### Read path when expanding a Season

```
years = [year(firstTournamentDate) .. year(lastTournamentDate)]

all years cached && complete && locked  → render from IndexedDB, no request
otherwise                               → GET /api/archive/league-seasons/{id}/tournaments
                                          render, do NOT cache

cached && locked           → local, no request
cached && !locked && <24h  → local, no request
cached && !locked && ≥24h  → refetch the year
!cached                    → enqueue the year in the backfill queue
```

### IndexedDB year partition

```ts
interface ArchiveYearPartition {
  year: number;
  completedAt: string | undefined;  // set in the SAME transaction as items
  rowCount: number;
  items: ArchiveTournamentCatalogItem[];
}
// absent completedAt ⇒ treat the year as not cached
```

`/api/leagues-archive/**` retained as an alias (round 1 Q6-C). *See assumption A1.*

### Domain shapes

```ts
interface League        { id: string; name: string; createdAt: string; updatedAt: string; documentVersion: number }
interface LeagueSeason  { id: string; name: string; leagueId: string; status: 'active' | 'completed';
                          updatedAt: string; documentVersion: number;
                          tournamentCount: number; playerCount: number;
                          firstTournamentDate: string; lastTournamentDate: string }
interface Tournament    { id: string; name: string; seasonId: string | null; tournamentDate: string;
                          status: 'active' | 'completed'; updatedAt: string; documentVersion: number;
                          playerCount: number; rounds: RoundDocument[]; playerArchetypes: PlayerArchetypeDocument[] }
```

### Catalog rows

```ts
interface ArchiveLeagueCatalogItem       { id: string; name: string; seasonCount: number; updatedAt: string }
interface ArchiveLeagueSeasonCatalogItem { id: string; name: string; leagueId: string;
                                           status: 'active' | 'completed'; updatedAt: string;
                                           documentVersion: number; tournamentCount: number;
                                           playerCount: number;
                                           firstTournamentDate: string; lastTournamentDate: string }
interface ArchiveTournamentCatalogItem   { id: string; name: string; seasonId: string | null;
                                           tournamentDate: string; updatedAt: string;
                                           status: 'active' | 'completed'; playerCount: number;
                                           documentVersion: number; locked: boolean }

interface ArchiveCatalogResponse<T> { items: T[]; totalCount: number; truncated: boolean }
interface ArchiveYearsResponse { years: { year: number; locked: boolean; tournamentCount: number }[] }
```

### Read model

```sql
player_statistics
  scope_kind   text NOT NULL,   -- 'global' | 'league' | 'season'
  scope_id     text NOT NULL,   -- '' when scope_kind = 'global'
  player_name  text NOT NULL,
  -- every existing derived column unchanged:
  -- played_match_count, match_wins, match_losses, match_draws, match_winrate,
  -- played_game_count, game_wins, game_losses, game_winrate, nemesis, rival,
  -- most_played_archetype, rating, rating_deviation, rating_volatility,
  -- previous_rating, last_rating_delta, tournaments_played, last_played_date, decayed_rating
  PRIMARY KEY (scope_kind, scope_id, player_name)
```

### Mutation signatures (Tournament-scoped concurrency)

```ts
editArchiveTournament(tournamentId: string, expectedVersion: number,
                      name: string, tournamentDate: string): Promise<PersistedTournament>

applyArchiveTournamentEditBatch(tournamentId: string, expectedVersion: number,
                                command: ArchiveTournamentEditBatchCommand,
                                target?: { seasonId: string | null; expectedVersion: number }
                               ): Promise<{ tournament: PersistedTournament;
                                            sourceSeason?: PersistedLeagueSeason;
                                            targetSeason?: PersistedLeagueSeason }>

moveTournament(tournamentId: string, from: string | null, to: string | null): Promise<…>
```

Every archive mutation routes through one repository method that invalidates the affected caches, and
a coverage test enforces that no mutation site bypasses it.

### Errors

```
409  archiveTournamentLocked   non-Admin write to a Tournament older than 365 days
412  stale version             expectedVersion did not match
403  forbidden                 role or origin not permitted
404  not found
```

### Export bundle

```ts
interface GonesData {
  version: 5;
  leagues: LeagueDocument[];
  leagueSeasons: LeagueSeasonDocument[];
  tournaments: TournamentDocument[];   // seasonId nullable
  calendarEvents: CalendarEventDocument[];
}
```

v1–v4 import support is **dropped**. `SUPPORTED_IMPORT_DATA_VERSIONS = [5]`.

## Assumptions

- **A1.** The `/api/leagues-archive/**` alias is kept because round 1 Q6-C said so explicitly. It now
  serves no one — there are no users and no bookmarks — so it may be worth dropping. Flagged, not
  decided. UI redirects from `/leagues-archive/**` are **not** created, for the same reason.
- **A2.** `locked` is computed server-side and sent on the wire rather than derived in the browser, so
  a client with a skewed clock cannot disagree with the server about what it may edit.
- **A3.** The Leagues **and League Seasons** catalogs are fetched whole, never year-partitioned. Both
  are small — measured at 0.11–0.57 MiB for 200–1,000 Seasons — and the ranking filter must list every
  League regardless of the loaded year. This also removes the "which year does a Dec–Mar Season belong
  to" problem entirely.
- **A3b.** *Research complete → `RESEARCH_series_and_seasons.md`.* **Confirmed:** calendar year is the
  right default and must be **overridable**. mtgtop8's own generic buckets are literally `All 2026
  Decks`, `All 2025 Decks`, … so a year split mirrors the largest archive rather than inventing a rule.
  Known-wrong cases: Pro Tour 1996–2012 ran **Aug→Aug** seasons named `1996–97`; Grand Prix inherited the
  same keying; Face to Face Tour currently runs `2026-27`; Regional Championships run `Season N -
  Round M` windows that straddle New Year. Practical rule: default `season = calendar year of event
  date`; if the event name matches an explicit season token (`Season\s+(\d+)`, `\b(20\d\d)[-/](\d\d?)\b`,
  `\b(19|20)\d\d[-–](19|20)?\d\d\b`) prefer the parsed token; never *require* a season to exist.
- **A4.** Locking applies to Tournaments only. Leagues and League Seasons stay editable however old
  their Tournaments are.
- **A5.** Manual-only resync means an Admin edit to locked data stays invisible to already-cached
  browsers until the user presses the Settings button. Accepted with the tradeoff stated. The control
  lives in Settings inside a **collapsed-by-default** menu; clicking it **reuses the backfill queue** to
  refetch and update all data, rather than being a separate code path.
- **A9.** A Tournament **detail document** (rounds, entries, archetypes) is not a catalog row and is
  never stored in a year partition. It is fetched on demand through
  `GET /api/archive/tournaments/{tournamentId}` as **read-through**, consistent with the Q2-C pattern.
  Flagged because it follows from the read-through decision rather than having been asked directly.
- **A10.** Variant B pairs two values per header. Each paired header sorts on its **first** value by
  default (`Season`, `Last played`, `Tourn.`); clicking again toggles direction; the second value of a
  pair is reachable through the explicit sort control. All six fields remain sortable as promised.
- **A11.** The 🔒 lock marker is **visible** on rows whose Tournaments are all older than 365 days,
  rather than only surfacing when an edit is attempted. Round 5 Q3's precision box asked this and was
  left blank; visible was chosen so a user learns the rule before hitting it.
- **A12.** The per-year row cap is **not yet fixed**. The ×2 research answer (180,000) predates the
  year-partitioning decision, which changes the arithmetic entirely — a cap now bounds one year, not the
  whole archive. The plan sets it from the measured per-year figures in `RESEARCH_archive_volumes.md`
  (mtgtop8 peak ~17,500 tournaments/year) rather than from the whole-archive number.
- **A6.** `provisional` (<5 Tournaments) and `inactive` (12 months idle) are derived **per scope**, so a
  player may be provisional inside a League while ranked globally.
- **A7.** Tab 1 is labelled "League Seasons" in the UI.
- **A8.** A local (browser) Season may attach only to a local League; a server Season only to a server
  League. No cross-authority parenting, consistent with ADR 0028's no-sync rule.

## Out of scope

- Any League page or League detail view.
- Server-side paging for the archive tables.
- Cross-authority sync between the browser store and the server.
- Changes to Events, registrations, auth, organizations or the Live Tournament runner beyond the
  rename and the cache-store move.
- Retro-compatible import of v1–v4 bundles.

## Table treatment — chosen

**Variant B — two-line rows.** Prototype: `PROTOTYPE_archive_tables.html` (tab B).

- Name stacks over its League in one cell; Last played stacks over Updated; Tournament count stacks
  over Player count. **Four visual columns**, not six — all six values still present, paired.
- No horizontal scroll on mobile; the League name is never truncated.
- Accepted tradeoff: a single column cannot be scanned vertically, and sorting by a stacked field needs
  an explicit affordance — the header pairs are individually sortable (`Season / League`,
  `Last played / Updated`, `Tourn. / Players`), so the plan must specify which half each header click
  sorts on. *(Assumption A10.)*
- Everything behavioural is unchanged from the shared contract: Name cell links, row expands, children
  are one continuous clickable line, default sort Last played descending.

## Deliverables the plan must produce

- ~~Three HTML variants of the League Seasons tab~~ — **done**, `PROTOTYPE_archive_tables.html`.
  **Variant B selected.** The plan implements B; A and C stay in the file as rejected alternatives.
- The filtered Global Rankings mockup is likewise done and reviewed in the same file.
- New ADRs superseding or amending: **0022** (rename + API alias), **0028** (dual source under three
  tiers), **0037** (edit-batch versioning), **0039** (public catalogs move to IndexedDB),
  **0040 / 0043** (scoped read model), **0042** (catalog shape), **0044** (history-based back button).
- `docs/CONTEXT.md` and `docs/GLOSSARY.md` updated for the League / League Season vocabulary split.

