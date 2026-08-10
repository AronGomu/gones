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

`empty`, `minimal` and `demo` ship with this repository. `accounts.json`, `organizations.json`,
`formats.json`, `tournaments.json` and `registrations.json` are seeded today; `leagues.json` and
`live-tournaments.json` are read and validated, and their seeder hooks are filled by the ticket that
adds the League Archive and Live halves of the `demo` dataset.

## The `demo` environment

`npm run dev -- --env=demo` resets the local database and loads a populated Calendar: seven accounts
(one per role, plus a deliberately unverified one), two organizations, four formats, nine published
tournaments spread over past / today / future, and twelve registrations. It is what makes `/calendar`,
`/organizer/tournaments` and the participants screen show content without creating anything by hand.

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
