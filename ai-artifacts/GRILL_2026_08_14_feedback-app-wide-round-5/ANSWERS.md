# Grill: app-wide feedback (round 5)

Source goal: `feedback.md` at repository root — ~45 asks across sync/cache, back buttons, logout,
test data, Home, About, Global Rankings, Player Stats, Calendar/Event, Event detail, Sign in, Admin,
Organizations.

## Facts (scouted from code, not asked)

- Public catalog cache = `src/app/features/calendar/all-events-cache.service.ts`: localStorage key
  `gones.calendar-v1.all-tournaments`, TTL `24 * 60 * 60 * 1000`, ETag revalidation, `load({force})`.
  Sync button + `calendar.syncedAt` label live in `public-calendar.component.ts` (ADR 0023).
- Private read cache = `src/app/backend/server-read-cache.service.ts`: IndexedDB `gones-cache/reads`,
  key `<userId>:<resource>`, purged by `SessionScopeService` at logout (ADR 0031). Conflicts with the
  "cache exactly like Calendar" ask for Registrations / Settings / admin pages.
- `indexedDB` is confined to 3 files and asserted by `src/app/backend/server-authority-boundary.test.ts`.
- First-visit About redirect already ships: `src/app/shared/first-visit.guard.ts` (`firstVisitHomeGuard`
  on `''`, `markVisitedGuard` on `about`), key `gones.first-visit.completed`.
- Global rankings endpoint `GET /api/leagues-archive/global-player-statistics`
  (`backend/src/Gones.Api/Leagues/PublicLeagueEndpoints.cs:77`) loads **every** completed
  `LeagueArchiveAggregates` row and calls `LeagueRules.CalculateGlobalPlayerStatistics` per request.
- Player page `src/app/features/players/player-detail.component.ts` calls `repo.listLeagues()` and
  runs `calculatePlayerStatistics` in the browser. `PlayerMatch`
  (`src/app/domain/player-stats.ts:4`) carries no archetype fields; `selectedArchetype()` exists at
  line 219 and reads `tournament.playerArchetypes`.
- Register button already renders for signed-out visitors (`showCardRegister()` returns true when
  `auth.profile() === null`); intent round-trips through `/login?returnUrl=` back to the **list**.
- Maps link already exists on Event detail (`venueMapsUrl` in `public-calendar.ts`), not on cards.
- Back button component `src/app/shared/back-button.component.ts` supports `position="top"|"bottom"`.
  Missing on: `global-stats`, `account-settings`, `admin-home`, `admin-users`, `admin-organizations`,
  `admin-audit`, `admin-notification-delivery`, `organization-detail`, `organization-list`,
  `organizer-organizations`, `admin-deleted-events`, `organizer-participants`,
  `organizer-event-create`, `organizer-event-list`, `tournament-archive-result`.
  Top-only on: `live-tournament-runner`, `auth-entry`, `player-detail` (two tops).
- Breadcrumbs (`src/app/app-breadcrumbs.ts`) have no `/admin` branch — `/admin`, `/admin/users` etc.
  currently fall through to the "not found" crumb.
- Organization ownership is domain-level: `OrganizationRoles.Owner`
  (`backend/src/Gones.Domain/Organizations/Organization.cs:10`), sole-owner transfer flow in
  `AdminAccountService.cs` + `OrganizationService.cs`, `ownerUserId` required by
  `POST /api/organizations`, `ownerEmail` required by `fixtures/dev-environments/demo/organizations.json`.
- Demo environment = 7 accounts, 2 organizations, 4 formats, 16 Events, 7 registrations, 2 League
  Archives, 2 Live tournaments — seeded through the real HTTP API (`scripts/seed-dev-environment.mjs`).
- Logout (`src/app/app.component.ts:185`) navigates to `/`.
- i18n: `globalStats.title` fr = `Classement mondial` (line 1382), `home.leagues` en =
  `Leagues (archive)` (line 199).

## Round 1 — whole feedback frontier

Doc: `round-1.html` — 15 questions.

| #   | Question | Answer | Precision |
| --- | -------- | ------ | --------- |
| 1   | Private-page cache store vs ADR 0031 | Same UX everywhere; **public → localStorage** like Calendar, **private → user-scoped store purged at logout**, same 24h TTL contract | |
| 2   | Stale cache on mutating pages | **Every successful mutation invalidates that page's cache entry and refetches**; TTL governs navigation only | |
| 3   | Player statistics storage | **Materialized `player_statistics` read-model table**, recomputed on archive commit/import/delete; Global Rankings **and** player page read it; browser caches like Calendar | |
| 4   | Match history delivery | **Flat server endpoint** returns full history + stats; browser keeps local filter/sort/paging; cached like Calendar | |
| 5   | Calendar → Event rename | **Full frontend rename**: `/calendar`→`/events`, `features/calendar`→`features/events`, file+class names, `calendar.*`→`event.*` i18n, `data-cy` prefixes, Cypress specs. Word "Calendar" survives only for the month-grid view | **Post-round correction: no redirect — `/calendar` is deleted outright, retro-compatibility explicitly not wanted** |
| 6   | Removing Organization ownership | **Remove Owner entirely**; every member is an Organizer; drop `ownerUserId`; closure removes membership, member-less org → Draft (ADR 0034); delete transfer flow + UI | |
| 7   | How 100× data is produced | **Generator script from seeded PRNG** (deterministic, gitignored output) + **bulk SQL insert** for leagues/events; accounts and organizations still via API | |
| 8   | What is multiplied | **Literal 100× of everything, including 700 accounts** | |
| 9   | ICS | **Drop `download`**, serve `text/calendar` with `Content-Disposition: inline`, OS handler takes it | |
| 10  | Player stat grid | **Keep loss cells.** Row1 `[Match played][Match Winrate][Match Win][Match Loss][Match Draws]`; Row2 `[Game played][Game Winrate][Game Win][Game Loss][Match Draw Percentage (new)]`; Row3 `[Most played archetype][Nemesis][Rival]` | 5/5/3 grid, not 4/4/3 |
| 11  | Logout return | **`/login?returnUrl={page where logout clicked}`**; sign-in returns there; guards arbitrate role mismatch | |
| 12  | "Starting Hour" | **Venue local time** in title line; viewer time stays on its own line | |
| 13  | Anonymous register landing | **Keep returning to the list with the intent, as today** | Overrides feedback.md's "redirect to event page" |
| 14  | `/organizations` pages | **Delete list route/component/admin button; keep `/organizations/:id`** and repoint "My organizations" links at it | |
| 15  | Back button | **Every routed page top+bottom, except auth pages which keep top only** | |

## Logged, not asked (mechanical — straight into tickets)

- Rename `Leagues (Archive)` → `Leagues Archive` (`home.leagues`, both locales).
- fr `Classement Mondial` → `Classement Global` (`globalStats.title`).
- Margin between Global Rankings title and filter; filter applies `onChange` (debounced), Apply
  button removed; back button added.
- Calendar grid week starts Monday, Sunday last column.
- Maps link on Event cards (reuse `venueMapsUrl`).
- Register button moved left of "Add to Calendar" on cards.
- Event detail: remove `event-detail-actions`, make `event-detail-kicker` a link to the
  organization website; add a small italic organizer row at the bottom of the hero.
- Sign-in / register pages: hide the header "Sign in" button.
- Admin: breadcrumb root becomes `admin` (no `menu`); admin menu entries become home-style cards.
- Admin Users: last admin cannot revoke or disable itself; cannot grant a role already held.
- Admin Organizations: owner text input → filtered user select (moot if Q6 removes ownership),
  inline validators (only `name` required), cancel button, `onInput` filter (no Apply), "New
  Organization" button moved below search with warning colours.
- Archetype row on match cards: `{player} vs {opponent}`, cyan = player, red = opponent, missing =
  "Archetype manquant" / English equivalent.

## Round 2 — consequences of round 1

Doc: `round-2.html` — 6 questions, all unblocked by (and only by) the round 1 answers.

| #   | Question | Answer | Precision |
| --- | -------- | ------ | --------- |
| 1   | Store backing the private 24h cache | **Extend `ServerReadCacheService`** with a TTL-primary read `(resource, ttl, force)` → `{value, fetchedAt, fromCache, stale}`; **ADR 0031 amended** fallback-only → fallback-plus-TTL; reuses per-user scoping, cross-tab lock, logout purge | |
| 2   | Catalog vs per-query cache | **Public read-mostly (Global Rankings, Leagues Archive) get full-catalog endpoints** mirroring `/api/events/all` (row cap + `truncated` flag), cached once, filtered/sorted/paged in browser. **Private + admin lists keep server paging**, cache keyed by query params | |
| 3   | Read-model scope | ⚠️ **"Only completed Tournaments"** — tournament-level, not league-level. No option matched; see round 3 Q1 (Archive Tournaments carry no completion field today) | Overrides both offered scopes |
| 4   | Browser-local leagues | **Keep the toggle.** Online-only ON = server table verbatim; OFF = compute local-league stats in browser, merge into totals **and** match history, local matches visually marked | |
| 5   | Rebuild timing | **Synchronous, in the same transaction** as archive commit/import/delete; measure against the 100× dataset, revisit only if over budget | |
| 6   | Stress bulk boundary | **Bulk SQL**: leagues, events, registrations, audit rows. **API**: accounts, organizations, formats. **Live tournaments capped ~10**, still seeded by real command replay | |

## Round 3 — the tournament-level completion rule

Doc: `round-3.html` — 2 questions. Round 2 Q3's answer landed on a granularity the domain does not
currently express, which opens exactly one new branch; Q5's answer opens one operational gap.

| #   | Question | Answer | Precision |
| --- | -------- | ------ | --------- |
| 1   | What makes an Archive Tournament "completed" | **Add an explicit completion flag to the Archive Tournament domain**, set by an organizer action, carried through export/import and fixtures; only completed tournaments feed the statistics table; existing rows backfilled as completed | |
| 2   | Read-model repair path | **Store a formula version alongside the table; the API rebuilds automatically at startup** when the stored version differs from the code's | |

### Facts scouted for round 3 (not asked)

- `TournamentDocument` (`src/app/domain/models.ts:67`) = `id`, `leagueId`, `name`, `tournamentDate`,
  `rounds`, `playerArchetypes`. **No status, no completedAt.**
- `LeagueStatus` (`'active' | 'completed'`) exists **only** on `LeagueDocument` (line 54–59).
- `MatchRoundEntry` scores are plain `number`s — an unscored match and a real 0–0 are the same bytes.
  `RoundEntry` also has an `invalid` variant carrying raw unparsed text.
- `/api/events/all` catalog contract to mirror for the new endpoints:
  `MaximumCatalogSize = 5000` (overridable via `Gones:Calendar:MaximumCatalogSize`), SHA-256 ETag over
  `total:lastUpdatedAt:lastId`, `Cache-Control: public, max-age=3600`, `truncated` flag in the body.
  (`backend/src/Gones.Api/Events/PublicEventEndpoints.cs:23`, `:166`)
- ICS endpoint sets `Content-Disposition: attachment` at
  `backend/src/Gones.Api/Events/PublicEventEndpoints.cs:300` — the one line R1 Q9 changes.

## Shared understanding

23 decisions settled over 3 rounds. Frontier empty.

### Goal

Turn the root `feedback.md` (~45 asks) into a sequential, commit-sized ticket plan. The app must
compile and stay functional after every ticket.

### Settled — architecture

1. **Cache contract, one UX, two stores.** Every listed surface gets: load once on page load, 24h
   TTL, top-right Synchronize button, "last synced" label, auto-refetch when the last fetch is over
   24h. Public data → `localStorage`, exactly like `AllEventsCacheService`. Private data →
   `ServerReadCacheService`, **extended** with a TTL-primary read
   `(resource, ttl, force) → {value, fetchedAt, fromCache, stale}`; per-user scoping, cross-tab lock
   and logout purge reused. **ADR 0031 is amended** from fallback-only to fallback-plus-TTL.
2. **Cache shape.** Public read-mostly pages (Global Rankings, Leagues Archive) get **full-catalog
   endpoints** mirroring `/api/events/all`, cached once, then filtered / sorted / paged in the
   browser. Private and admin lists keep server paging; their cache entry is keyed by query params.
3. **Every successful mutation invalidates its own cache entry and refetches.** TTL governs
   navigation only.
4. **`player_statistics` materialized read model.** One writer, three readers (Global Rankings, the
   player page, the flat match-history endpoint). Rebuilt **synchronously in the same transaction**
   as an archive commit / import / delete. A **formula version** is stored beside the table; the API
   rebuilds at startup when the stored version differs from the code's.
5. **Stats scope = completed Archive Tournaments.** `TournamentDocument` gains an explicit
   completion flag, set by an organizer, carried through export / import / fixtures. Existing rows
   backfill as completed.
6. **Browser-local leagues keep working.** The `Online only` toggle stays: ON = server table
   verbatim; OFF = local-league stats computed in the browser and merged into totals **and** match
   history, with local matches visually marked.
7. **Match history** ships flat from the server alongside stats; the browser keeps its existing
   filter / sort / paging / token-highlight behaviour and caches the payload like Calendar.
8. **Full frontend Calendar → Event rename.** `/calendar` → `/events`,
   `src/app/features/calendar` → `src/app/features/events`, file and class names,
   `calendar.*` → `event.*` i18n keys, `data-cy` prefixes, Cypress specs. The word "Calendar"
   survives only where it names the month-grid view and the ICS button.
   **No redirect.** `/calendar` and `/calendar/tournaments/:slug` are **deleted**; a stale bookmark
   gets the 404 page. Retro-compatibility is explicitly not wanted (user, post-round 3). This
   **supersedes the permanent-frontend-redirect clause of ADR 0035** for the calendar paths, which
   the new ADR must state.
9. **Organization ownership deleted from the domain.** Every member is an Organizer with equal
   rights; `ownerUserId` dropped from create; account closure just removes the membership and a
   member-less organization becomes Draft (ADR 0034); the ownership-transfer flow and its UI are
   deleted.
10. **Stress dataset.** Literal 100× of everything, including 700 accounts. Produced by a
    seeded-PRNG generator at run time, output gitignored. **Bulk SQL**: leagues, events,
    registrations, audit rows. **API**: accounts, organizations, formats. **Live tournaments capped
    at ~10**, still seeded by real command replay so the Live command path stays exercised.

### Settled — product / UI

11. Back button top **and** bottom on every routed page; auth pages keep top only.
12. Logout → `/login?returnUrl={page where logout was clicked}`; a successful sign-in returns there;
    route guards arbitrate a role mismatch.
13. ICS: drop the `download` attribute, serve `text/calendar` with `Content-Disposition: inline`.
14. Player stat grid is **5 / 5 / 3**:
    `[Match played][Match Winrate][Match Win][Match Loss][Match Draws]` /
    `[Game played][Game Winrate][Game Win][Game Loss][Match Draw Percentage]` /
    `[Most played archetype][Nemesis][Rival]`.
15. Event title line uses **venue local time**; viewer time keeps its own line.
16. The anonymous register intent **still returns to the list**, as today (this overrides the
    "redirect to event page" line in `feedback.md`).
17. `/organizations` list route, component and admin button deleted; `/organizations/:id` kept and
    the "My organizations" links repointed at it.

### Assumptions — decided here, not asked. Correct any before the plan is written.

- **A1** Completion field is `status: 'active' | 'completed'` on `TournamentDocument`, mirroring
  `LeagueStatus`. Reversible. New tournaments default `'active'`. A restored/imported document
  **lacking** the field reads as `'completed'` — the same rule as the backfill, so no existing export
  loses its statistics.
- **A2** Completing a League does **not** cascade to its tournaments; the two flags are independent.
- **A3** Setting the flag uses the same authority as every other Archive Tournament mutation:
  Organizer/Admin for server leagues, any Power User for browser-local ones, Power User mode on
  (ADR 0037, ADR 0028).
- **A4** Startup rebuild is an `IHostedService` that runs before traffic is served, behind
  `Gones:PlayerStatistics:RebuildOnStartup` (default `true`), with the formula version in a
  `player_statistics_meta` row. Its runtime against the 100× dataset is a validation step of that
  ticket — if it blows the boot budget, the fallback is the migrator container.
- **A5** New catalog endpoints copy `/api/events/all` verbatim: cap 5000 (config-overridable),
  SHA-256 ETag over `total:updatedAt:id`, `Cache-Control: public, max-age=3600`, `truncated` flag.
- **A6** The back-button rule is enforced by a unit test over routed components, with the auth pages
  as the single documented exception (top-only).
- **A7** `calendar.*` keys merge into the existing `event.*` namespace; on collision the existing
  `event.*` key wins and the calendar one is dropped.
- **A8** localStorage keys rename `gones.calendar-v1.*` → `gones.events.*` with **no** migration
  (unreleased, ADR 0020 reset allowed); stale keys are ignored, not read.
- **A16** The "no retro-compatibility" instruction is scoped to the **calendar** paths this plan
  renames. The unrelated legacy redirect families predating this feedback — `leagues/*` →
  `leagues-archive/*` (ADR 0022), `organizer/tournaments*` → `organizer/events*`,
  `tournament-requests/:token`, `admin/tournaments/deleted` — are **left alone**, since touching them
  is outside what the feedback asks. Say the word and they go in the same ticket.
- **A9** Filter-on-change inputs debounce at 300 ms, reusing the calendar's `SEARCH_DEBOUNCE_MS`.
- **A10** Stress environment is named `stress`, seeded deterministically from a `--seed` flag with a
  fixed default; audit rows capped at 10 000; its seed run may take minutes.
- **A11** With Owner gone, every organization member sees **Manage** on `/organizations/:id`.
- **A12** Admin menu cards reuse the existing `home-destination` card styling from the home menu.
- **A13** Missing archetype renders `Archetype manquant` (fr) / `Missing archetype` (en).
- **A14** Match Draw Percentage = `matchDraws / playedMatchCount`, rendered `common.na` when no
  matches were played.
- **A15** Private cache TTL is the same 24h constant as the public one.

### Out of scope

- Live Tournament keeps its role-scoped adapters (ADR 0021). Only its **list** page joins the cache
  contract; the runner is untouched.
- No new private migration bundles (one-way door, ADR 0020).
- No production migration guarantees — Gones is unreleased and the local DB may be reset.
- No redesign of the Live runner, the archive round editor, or the notification screens beyond the
  back-button and cache rules.
