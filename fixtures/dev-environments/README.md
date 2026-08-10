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

`empty` and `minimal` ship with this repository. Only `accounts.json` is consumed today; the other
files are read and validated, and the seeder's hooks for them are filled by the tickets that add the
`demo` dataset.

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
