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
HTTP API and validated by `npm run test`.

## The `demo` environment

`npm run dev -- --env=demo` resets the local database and loads a populated Calendar: seven accounts
(one per role, plus a deliberately unverified one), two organizations, four formats, nine published
tournaments spread over past / today / future, and twelve registrations. It is what makes `/calendar`,
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
`website`, `contactEmail`, `ownerEmail` (an `accounts.json` email; that account becomes the
organization owner, which is what lets it publish tournaments).

`tournaments.json` — `key`, `organizationKey`, `organizerEmail` (must be the organization's owner),
`title`, `summary` (50 characters maximum), `bodyHtml` (well-formed markup limited to
`p`, `br`, `strong`, `em`, `ul`, `ol`, `li`, `h2`, `h3`, `a`), `streetAddress`, `postalCode`, `city`,
`country`, `timeZoneId` (IANA), `startsAtLocalOffsetDays` / `startsAtLocalTime` and
`endsAtLocalOffsetDays` / `endsAtLocalTime`, `capacity` (positive integer or `null` for unlimited),
`formatKeys` (must contain `legacy` — V1 refuses a tournament without it).

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
`tournamentDate`, `rounds` and `playerArchetypes` (`playerName` + `archetype`, best taken from
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

`demo/leagues.json` is a trimmed derivative of a real Gones full-data export (real Lyon Player Names
and real Game Scores). The export itself is not committed; from here on this file is the source of
truth and is edited in place.

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

### Editing it

Edit the JSON, then re-run `npm run dev -- --env=demo`. There is nothing to rebuild. The seeder
relaxes the local API's auth rate limit for the duration of the reset (a seven-account environment
makes more login and registration calls than the shipped 5-per-15-minutes limit allows); export
`GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT` yourself to override that.

## Running one

```bash
npm run dev -- --env=minimal      # reset the local stack, seed the environment, then serve the app
npm run dev:env -- --env=minimal  # seed only, against a stack that is already up
```

`--env` needs the Docker stack, so it cannot be combined with `--no-docker`.

Any environment whose `environment.json` says `"resetDatabase": true` runs
`scripts/reset-local-stack.mjs` first (`docker compose --profile development down --volumes` → `up
--wait` → `scripts/seed-local.mjs`), so swapping environments never leaves the previous dataset
behind. An environment that declares `"resetDatabase": false` must carry no data at all —
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
