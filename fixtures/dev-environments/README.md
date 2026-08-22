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
| `leagues.json` | the League Archives to restore |
| `live-tournaments.json` | the running tournaments to create |

`empty`, `minimal` and `demo` ship with this repository. Every file above is seeded through the real
HTTP API and validated by `npm run test`. `stress` ships only its `environment.json`: its data files
are generated on demand and gitignored (see below).

## The `demo` environment

`npm run dev -- --env=demo` resets the local database and loads a populated Calendar: seven
purpose-named accounts (including one deliberately unverified), two organizations, four formats,
sixteen single-format published Events spread over past / today / future, and seven registrations. It is what makes `/calendar`,
`/organizer/tournaments` and the participants screen show content without creating anything by hand.

It also loads the two halves the Calendar does not cover: two **League Archives** (`Gones League 6`,
completed, three Archive Tournaments; `Gones League 7`, active, one) with real rounds and standings,
and two **running (Live) tournaments** — one caught mid-round with an unscored Round open, one sitting
at its standings. So `/leagues-archive`, a League Result, Player Statistics and `/live-tournaments`
show content too.

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

**Archive dates are absolute on purpose.** Every `tournamentDate` is a literal past `YYYY-MM-DD`: an
archive is history, and a rolling history would be a lie (ADR 0030). Only the Calendar and the
running tournaments below use relative offsets.

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
accounts, 200 clubs, 9 formats, ~3800 Events, ~2300 registrations, ~185 League Archives** (about 1800
Archive Tournaments and 168 000 Round Entries over a bounded cast of 2400 player names, so rankings
and player pages have depth), **10 running tournaments** and **10 000 audit rows**.

```bash
npm run dev:stress:generate -- --seed=1   # write the fixtures (a second, ~48 MB)
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
de France is split into `Jour 1` (the full Swiss) and `Jour 2 et annexes` (the cut plus the
satellites), because a thousand-player field with its pairings does not fit in one League document —
see the byte budget below.

### How it is built and loaded

The dataset is **generated, not committed**: about 48 MB of JSON that is reproducible from its seed is
not worth a diff. `fixtures/dev-environments/stress/` holds only `environment.json`; everything else
there is gitignored, and `npm run dev -- --env=stress` fails on an empty directory until the generator
has run. The same `--seed` produces byte-identical files on any machine — every draw goes through the
generator's own seeded PRNG, and nothing in it reads the clock — so `--seed=1` is the shared dataset
and any other seed is a private one.

`LeagueArchiveAggregate.MaximumDocumentBytes` refuses a League document over 1 MiB **on read**, and the
bulk loader below writes rows the domain never validated — so the generator enforces the limit itself
(`assertLeagueBudget`, 90% of it, gated by `npm run test`) and throws rather than trimming. That is
why a season is four months and a regional circuit is one League per season: two three-hundred-player
stages already carry more entries than a whole club season.

Seeding it is not the pure-API path the other environments take. Accounts, organizations and formats
still go through the real HTTP API, and the running tournaments are still replayed command by command,
but Events, registrations, League Archives and audit rows are **bulk-inserted as SQL**
(`scripts/bulk-load-stress.mjs`): thousands of Events through preview-then-publish would take hours.
That path is **test-only** — `fixtures/` is in no image, no release path reads it, and the
loader refuses to run unless Docker points at a local Unix socket with the Compose `postgres` service
up. It also bypasses the domain, so every generated row has to already be the shape a real write would
produce; `npm run test` checks that with the same `validateEnvironment` the seeder runs, and the seed
itself ends by rebuilding `player_statistics` from every stored League, which fails loudly if one of
those documents is not one the server can read back.

A seed takes roughly ten to twenty minutes on a warm image, most of it the seven hundred account
registrations, and the local API's auth and write rate limits are raised further for this environment
than for the others because of them. The archive is the other cost: 42 MB of League documents go in as
SQL, and the startup `player_statistics` rebuild then reads all of them back.

The knob to shrink it is `STRESS_VOLUMES.archiveSeasons` in the generator: each season dropped takes
about a third of the Archive Tournaments, the Round Entries and the megabytes with it. `clubs`,
`weeklyClubs` and `monthlyClubs` size the Calendar the same way.

### Editing it

Edit the JSON, then re-run `npm run dev -- --env=demo`. There is nothing to rebuild. The seeder
relaxes the local API's auth and write rate limits for the duration of the reset (a seven-account
environment plus Live command replay exceeds shipped limits); export
`GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT` or `GONES_RATE_LIMIT_WRITE_PERMIT_LIMIT` yourself to override
those local seed values.

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
