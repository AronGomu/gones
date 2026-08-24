# Local development environments

One directory per environment (ADR 0030). `npm run dev -- --env=<name>` loads the directory of that
name; plain `npm run dev` loads `empty` and behaves exactly as it always has.

```
fixtures/dev-environments/<name>/
  environment.json      required — { "name", "description", "resetDatabase" }
  accounts.json         optional
  organizations.json    optional
  formats.json          optional
  tournaments.json      optional
  registrations.json    optional
  leagues.json          optional
  archive-leagues.json        optional
  archive-league-seasons.json optional
  archive-tournaments.json    optional
  live-tournaments.json optional
```

Every optional file is a JSON array. A missing file means an empty list.

| file | what it holds |
| --- | --- |
| `environment.json` | `name` (must equal the directory name), `description`, `resetDatabase` |
| `accounts.json` | the users to register: `email`, `username`, `firstName`, `lastName`, `role` (`User` \| `Organizer` \| `Admin`), optional `password` (default `Gones-dev-pass-123!`), optional `emailConfirmed` (default `true`) |
| `organizations.json` | the organizations to create |
| `formats.json` | the tournament formats to create |
| `tournaments.json` | the calendar tournaments to publish |
| `registrations.json` | who is registered to which tournament |
| `leagues.json` | the legacy League Archives to restore |
| `archive-leagues.json` | the archive Leagues to restore (top tier) |
| `archive-league-seasons.json` | the archive League Seasons to restore (middle tier) |
| `archive-tournaments.json` | the archive Tournaments to restore (bottom tier, standalone ones included) |
| `live-tournaments.json` | the running tournaments to create |

`empty`, `minimal` and `demo` ship with this repository. Every file above is seeded through the real
HTTP API and validated by `npm run test`. `stress` ships only its `environment.json`: its data files
are generated on demand and gitignored (see below).

## The `demo` environment

`npm run dev -- --env=demo` resets the local database and loads a populated Calendar: seven
purpose-named accounts (including one deliberately unverified), two organizations, four formats,
sixteen single-format published Events spread over past / today / future, and seven registrations. It is what makes `/calendar`,
`/organizer/tournaments` and the participants screen show content without creating anything by hand.

It also loads the two halves the Calendar does not cover: the archive and two **running (Live)
tournaments** — one caught mid-round with an unscored Round open, one sitting at its standings. So
`/leagues-archive`, a League Result, Player Statistics and `/live-tournaments` show content too.

The archive comes in two shapes side by side, and both are loaded. The **legacy** one is
`leagues.json`: two flat League Archives (`Gones League 6`, completed, three Archive Tournaments;
`Gones League 7`, active, one) with real rounds and standings. It stays until the legacy surface is
retired, because `POST /api/live-tournaments` still resolves a `leagueId` against the legacy table and
`live-tournaments.json` points its `leagueKey` at a `leagues.json` `id`. The **three-tier** one is
`archive-leagues.json` / `archive-league-seasons.json` / `archive-tournaments.json`: eight archive
Leagues, twelve League Seasons and forty-eight Tournaments, five of them standalone. Both are dev-only
and they overlap: the `global` player-statistics scope folds the legacy table in as well as the new
one, so the four legacy Tournaments are counted twice in the global rankings until the legacy half
goes.

Seeding drives the real HTTP API as those accounts, so the fixtures reference each other by
human-readable **keys** — the GUIDs do not exist until the seed runs. `npm run test` checks every
reference (`ops/dev-environments.test.ts`), so a mistyped key fails there rather than thirty seconds
into a Docker reset.

### Fixture fields

`formats.json` — `key` (referenced by `tournaments[].formatKeys`), `name`, `slug` (an existing format
with the same slug is reused instead of created), `sortOrder`.

`organizations.json` — `key` (referenced by `tournaments[].organizationKey`), `name`, `description`,
`website`, `contactEmail`, `memberEmails` (an array of `accounts.json` emails; nobody owns an
organization, so each of those accounts joins it as an Organizer, which is what lets them publish
tournaments for it). The seeding admin creates the organization and is stepped back out, so the
roster is exactly this list — an empty array leaves the organization Draft.

`tournaments.json` — `key`, `organizationKey`, `organizerEmail` (must be one of the organization's `memberEmails`),
`title`, `summary` (50 characters maximum), `bodyHtml` (well-formed markup limited to
`p`, `br`, `strong`, `em`, `ul`, `ol`, `li`, `h2`, `h3`, `a`), `streetAddress`, `postalCode`, `city`,
`country`, `timeZoneId` (IANA), `startsAtLocalOffsetDays` / `startsAtLocalTime` and
`endsAtLocalOffsetDays` / `endsAtLocalTime`, `capacity` (positive integer or `null` for unlimited),
`formatKeys` (must contain exactly one format). Split Event keys use
`{source-key}-{format-slug}` while stored titles keep the shared base title.

Dates are **relative**: the offset is a signed number of days added to today, so a dataset committed
once still shows past, ongoing and upcoming tournaments a year later. `-90` is ninety days ago, `0`
is today, `+60` is in two months.

`registrations.json` — `tournamentKey` and `userEmail`. Only verified accounts can register, and the
API closes registration once a tournament has started, so keep these on tournaments with a positive
offset.

`leagues.json` — a JSON array of whole **`LeagueDocument`s**, the same shape a League Export carries,
because the seeder restores each one with `POST /api/leagues-archive/restore`. Per League: `id` (a
stable literal string, used as the fixture key and by `live-tournaments.json`), `name`, `status`
(`active` \| `completed`) and `tournaments`. Per Archive Tournament: `id`, `leagueId` (must equal the
parent League's `id` — the server refuses a Tournament claiming another League), `name`,
`tournamentDate`, `status` (`active` \| `completed`; unlike the League field this one defaults to
`completed` when absent, because an archive document that predates the field is finished history),
`rounds` and `playerArchetypes` (`playerName` + `archetype`, best taken from
`src/app/config/legacy-archetype-presets.ts` so the autocomplete recognises them). Per Round: `id`
and `entries`. A `kind: "match"` entry carries `table`, `player1Name`, `player2Name`, `player1Score`,
`player2Score`, `player1DeckArchetype`, `player2DeckArchetype`; a `kind: "bye"` entry carries
`table`, `playerName`, `deckArchetype`.

### Three-tier archive fixtures

Three optional files, each a JSON array, each missing-means-empty. The seeder sends all three as one
`POST /api/archive/restore-full` — restore rather than the interactive create route, because a fixture
archive is history and the create route refuses a non-Admin a Tournament older than the 365-day lock
window.

`archive-leagues.json` — the top tier. Per League: `id` (a stable literal string, unique across the
file, referenced by `archive-league-seasons.json`), `name`, `createdAt` (an ISO 8601 UTC instant) and
`sourceSeriesId`.

**`sourceSeriesId` is required and is always `null`.** Public MTG archives expose no series and no
season field at all — a real mtgtop8 event record carries a title, a venue, a format, a star rating, a
player count, a date and decklists, and nothing else. The League tier is this repository's own
construct, and the fixture says so in a machine-checkable way rather than in a comment. It is a
fixture-only provenance marker: `buildArchiveBundle` strips it before the wire, so it never reaches the
API or the database.

`archive-league-seasons.json` — the middle tier, what used to be called a League. Per Season: `id`,
`name`, `leagueId` (must name a League in the same environment) and `status` (`active` \| `completed`).

**A Season `name` is a free string and is never parsed as a year.** Real archives label seasons `2026`,
`2026-27`, `1996-97`, `Season 3`, `Season 5 - Round 2`, `2026/2` and `3ª Etapa Regular - 2026/2`; an
integer-year column would be wrong for most of them, and nothing sorts, groups or derives anything
from a Season name. The `demo` fixtures carry one of each style on purpose.

`archive-tournaments.json` — the bottom tier, now top-level: every Tournament is its own record. Per
Tournament: `id`, `name`, `seasonId` (a Season `id`, or `null`), `tournamentDate` (ISO `YYYY-MM-DD`),
`status` (`active` \| `completed`), `rounds` and `playerArchetypes` — the same Round and entry shapes
`leagues.json` uses, minus `leagueId`, which the tier does not have: a Tournament's League is derived
by joining through its Season.

**`"seasonId": null` is a standalone Tournament**, and most of a real public archive is standalone. The
degenerate names — `Series`, `1K`, `FNM`, `Weekly` — carry no series signal at all and must stay
standalone rather than becoming garbage Leagues; `demo` ships all four so a grouping heuristic that
invented series out of them would fail visibly. A standalone Tournament names no Season and therefore
no League, so it feeds the `global` player-statistics scope only.

The megabyte ceiling is **per Tournament** (`ArchiveTournament.MaximumDocumentBytes`), not per League
as it was in the legacy archive.

**Archive dates are absolute on purpose.** Every `tournamentDate` is a literal past `YYYY-MM-DD`: an
archive is history, and a rolling history would be a lie (ADR 0030). Only the Calendar and the
running tournaments below use relative offsets.

The whole fixture archive is dated against a declared anchor, **`2026-08-22`**. A Tournament locks 365
whole UTC calendar days after the day it was played — exactly 365 days old is still writable, 366 is
not — and at that anchor `demo` carries 24 locked and 24 unlocked Tournaments, so both sides of the
rule are reachable. The dataset therefore **ages**: past roughly mid-2027 every fixture Tournament is
inside the locked window and the unlocked path stops being reachable in dev. Refreshing it means
bumping the `tournamentDate` values forward, moving `ARCHIVE_ANCHOR_DATE` in
`scripts/generate-stress-environment.mjs` and `anchorDate` in
`fixtures/archive-domain/v5/manifest.json` with them, and regenerating the golden bundle (below).

Restoring mints new server ids, so the `id` values here never reach the database — they are keys the
fixtures use to point at each other. That is also why the seeder matches an already-restored League
by **name** before restoring again: two runs must not leave a `Gones League 6 (restored)` behind.

A donor export was used only to infer realistic dataset shape. Every committed player name and
score is synthetic; these fixture files are the source of truth and are edited in place.

`live-tournaments.json` — running (Live) tournaments, described declaratively rather than as
documents: the seeder replays the real Live commands (create → add players → start / score / validate
each Round), so what lands is a tournament that was actually run.

| field | meaning |
| --- | --- |
| `key` | fixture key; also the seeder's idempotency key |
| `organizerEmail` | an `accounts.json` email with role `Organizer` or `Admin` |
| `name` | the Live Tournament name; the seeder skips a name that already exists |
| `leagueKey` | a `leagues.json` `id`, or `null` for an unassigned running tournament |
| `tournamentDate` | `{ "offsetDays": 0 }` — relative like the Calendar, rendered against today |
| `roundCount` / `customRoundCount` | the Swiss Round count; `customRoundCount: true` keeps `roundCount` instead of deriving it from the roster |
| `paidTrackingEnabled` | whether the paid column shows |
| `players` | `name`, `initialWins`, `initialDraws`, `initialLosses`, `archetype`; at least 2 and an even count, so every Round pairs without a Bye |
| `scoredRounds` | how many Rounds the seeder starts, scores and validates (at most `roundCount`). Scores rotate 2-0, 2-1, 1-1 by table index |
| `leaveRoundOpen` | `true` starts one more Round and stops, leaving it unscored — that is the "caught mid-round" state |

## The `stress` environment

The French tournament circuit for a season, for judging page design under real weight: **~700
accounts, 200 clubs, 9 formats, ~3800 Events, ~2300 registrations**, a three-tier archive of **~62
archive Leagues, ~186 League Seasons and ~2200 Tournaments** (120 of them standalone, about 276 000
Round Entries over a bounded cast of 2400 player names, so rankings and player pages have depth),
**10 running tournaments** and **10 000 audit rows**.

`leagues.json` is no longer the archive here: it holds only the **legacy Live references**, one stub
League with no Tournaments per `live-tournaments.json` `leagueKey`. The whole legacy archive beside a
full three-tier one would be 44 MB of duplicate history and would double every `global`-scope ranking,
because that scope folds both tables in until the legacy surface is retired. `demo` keeps its legacy
archive in full because it is 22 KB and four Tournaments; the asymmetry is a size decision.

The Season sizes come from what the public archives actually report — a World Championship is one
event, a modern Pro Tour is three or four, a Spotlight Series is eight to eleven, a store league runs
seven to twenty weekly legs, and a late Grand Prix season is fifty to sixty. `SEASON_SIZE_CLASSES`
draws that spread and `SEASON_LABEL_STYLES` draws the free-string label, so no page is ever judged
against a single middling Season shape.

```bash
npm run dev:stress:generate -- --seed=1   # write the fixtures (a second, ~83 MB)
npm run dev -- --env=stress               # reset the stack and load them (minutes)
```

### What it simulates

Four tiers of event, at the cadence and the field size the real circuit runs them:

| tier | cadence | field | who runs it |
| --- | --- | --- | --- |
| local | weekly | 8-30 | every club, in its own weekly slot |
| monthly | monthly | 30-100 | the clubs with a monthly Open |
| regional | every 2 months | 100-300 | each région, host club rotating |
| national | yearly | 1000+ | one Championnat de France, with its satellites |

The cities and their postal codes, the field sizes, the format mix, the deck archetypes and the spread
of club activity were read off the real thing: 886 French paper events published on mtgtop8.com
between 2025-01-28 and 2026-08-20, over 264 venues and 172 cities. **Everything about a person is
synthetic** — no player name, score, account or club name comes from that survey, only public facts
about places, formats, deck archetypes and event sizes do, and the club names are generated from
French game-shop naming patterns rather than copied, so no real shop is named as the host of results
it never ran.

A club roster is a core, the regulars behind it and the occasional entrants: the core takes about half
the seats of a weekly and shows up on three nights in five, which is the recurrence the survey
measured. Weekdays are a **rhythm, not a day** — a Calendar offset is relative to whatever day the
seeding runs, so what the generator guarantees is that a club's local repeats every seven days, not
that it lands on a Thursday. Archive dates are absolute, so those do carry the weekday the tier uses.

The archive covers the clubs that run a real League and the regional circuits; the occasional clubs
show up on the Calendar and nowhere else, which is how the circuit looks in the wild. The Championnat
de France runs `Jour 1` (the full Swiss), `Jour 2` (the quarter of the field that survived it, cut on
record) and its satellites as separate Tournaments of one Season, and it has a child League whose name
embeds its parent's — `Championnat de France - 2nd Chance PTQ` — so a prefix-grouping heuristic breaks
visibly rather than quietly.

Archive dates are measured against the declared anchor `2026-08-22`, never the clock, because the
generator has to stay byte-deterministic. That is also why the generated dataset ages the same way the
committed one does — see the anchor-date note above.

### How it is built and loaded

The dataset is **generated, not committed**: about 48 MB of JSON that is reproducible from its seed is
not worth a diff. `fixtures/dev-environments/stress/` holds only `environment.json`; everything else
there is gitignored, and `npm run dev -- --env=stress` fails on an empty directory until the generator
has run. The same `--seed` produces byte-identical files on any machine — every draw goes through the
generator's own seeded PRNG, and nothing in it reads the clock — so `--seed=1` is the shared dataset
and any other seed is a private one.

`ArchiveTournament.MaximumDocumentBytes` refuses a Tournament document over 1 MiB **on read**, and the
bulk loader below writes rows the domain never validated — so the generator enforces the limit itself
(`assertTournamentBudget`, 90% of it, gated by `npm run test`) and throws rather than trimming. The
megabyte is per Tournament now rather than per League, which is why the Championnat de France no
longer needs splitting across two documents: what it does need is six Swiss rounds on Jour 1 rather
than the nine a thousand-player field would otherwise be paired for.

Seeding it is not the pure-API path the other environments take. Accounts, organizations and formats
still go through the real HTTP API, and the running tournaments are still replayed command by command,
but Events, registrations, the archive and audit rows are **bulk-inserted as SQL**
(`scripts/bulk-load-stress.mjs`): thousands of Events through preview-then-publish would take hours.

The archive goes in as three tables — `archive_leagues`, then `archive_league_seasons`, then
`archive_tournaments`, in that order, because the foreign keys are checked immediately rather than
deferred. The loader also writes the **denormalized counter columns itself** — a Season's
`tournament_count`, `player_count`, `first_tournament_date` and `last_tournament_date`, and a
Tournament's `player_count` — because it bypasses the domain that would otherwise have computed them
inside the write. `countArchiveTournamentPlayers` in `scripts/dev-environments.mjs` therefore mirrors
the Swiss standings rule byte for byte: a count that disagreed with its document would print a wrong
number on every catalog row. `updated_at` is always taken from the seeding clock, never from
`tournament_date`; the year-partitioned Tournament catalog stamps its ETag over `max(updated_at)`, so
a backdated write would make a stale cached partition servable.
That path is **test-only** — `fixtures/` is in no image, no release path reads it, and the
loader refuses to run unless Docker points at a local Unix socket with the Compose `postgres` service
up. It also bypasses the domain, so every generated row has to already be the shape a real write would
produce; `npm run test` checks that with the same `validateEnvironment` the seeder runs, and the seed
itself ends by rebuilding `player_statistics` from every stored League, which fails loudly if one of
those documents is not one the server can read back.

A seed takes roughly ten to twenty minutes on a warm image, most of it the seven hundred account
registrations, and the local API's auth and write rate limits are raised further for this environment
than for the others because of them. The archive is the other cost: 78 MB of Tournament documents go
in as SQL, and the startup `player_statistics` rebuild then reads all of them back.

The knob to shrink it is `STRESS_VOLUMES.archiveSeasons` in the generator: each season dropped takes
about a third of the archive Tournaments, the Round Entries and the megabytes with it.
`STRESS_VOLUMES.standaloneTournaments` and the `lateGrandPrix` weight in `SEASON_SIZE_CLASSES` are the
other two. `clubs`, `weeklyClubs` and `monthlyClubs` size the Calendar the same way.

### Editing it

Edit the JSON, then re-run `npm run dev -- --env=demo`. There is nothing to rebuild. The seeder
relaxes the local API's auth and write rate limits for the duration of the reset (a seven-account
environment plus Live command replay exceeds shipped limits); export
`GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT` or `GONES_RATE_LIMIT_WRITE_PERMIT_LIMIT` yourself to override
those local seed values.

## The golden v5 archive bundle

`fixtures/archive-domain/v5/bundle.json` is the frozen v5 archive bundle: exactly the body
`POST /api/archive/restore-full` takes, assembled from the `demo` environment by `buildArchiveBundle`.
It is **not authored** — the three `demo/archive-*.json` files are the one source of archive truth in
this repository, and the bundle is cut from them. `manifest.json` beside it stamps the bundle's
SHA-256 and its case counts, and `ops/archive-domain-fixtures.test.ts` is the gate that keeps both
honest: a mistyped count or a stale hash fails there.

Regenerate it after any edit to the `demo` archive fixtures:

```bash
node --input-type=module -e "
  import { writeFileSync } from 'node:fs';
  const { buildArchiveBundle, readEnvironment } = await import('./scripts/dev-environments.mjs');
  const bundle = buildArchiveBundle(readEnvironment('demo'));
  writeFileSync('fixtures/archive-domain/v5/bundle.json', JSON.stringify(bundle, null, 2) + '\n');
"
node -e "const{createHash}=require('node:crypto');const{readFileSync}=require('node:fs');console.log(createHash('sha256').update(readFileSync('fixtures/archive-domain/v5/bundle.json','utf8')).digest('hex'))"
```

Paste the 64 hex characters into `bundleSha256`, and correct `caseCounts` to whatever the test
recomputes — the manifest is the claim, the test is the measurement.

## Running one

```bash
npm run dev -- --env=minimal      # reset the local stack, seed the environment, then serve the app
npm run dev:env -- --env=minimal  # seed only, against a stack that is already up
```

`--env` needs the Docker stack, so it cannot be combined with `--no-docker`.

Any environment whose `environment.json` says `"resetDatabase": true` first runs the seeder's
backend-only inline reset (`docker compose --profile development down --volumes` → backend `up
--wait` → `scripts/seed-local.mjs`), so swapping environments never leaves the previous dataset
behind without starting or replacing the frontend container. An environment that declares `"resetDatabase": false` must carry no data at all —
`validateEnvironment` refuses that combination rather than stacking a dataset onto whatever was
already in the database.

## Adding one

1. Copy an existing directory: `cp -r fixtures/dev-environments/minimal fixtures/dev-environments/mine`.
2. Edit `mine/environment.json` — `name` must equal the directory name (`mine`), and set
   `resetDatabase` to `true` as soon as the environment carries any data.
3. Edit the JSON files. `npm run test` validates every shipped environment
   (`ops/dev-environments.test.ts`), so a broken fixture fails there rather than thirty seconds into
   a Docker reset.
4. Run it: `npm run dev -- --env=mine`.

These are plain text files read at seeding time. Editing one is picked up by the next
`npm run dev -- --env=<name>` — there is nothing to rebuild and no code to change.

Nothing here ships: `fixtures/` is not part of any image and no release path reads it. The passwords
in these files are public and exist only in the local Compose database.
