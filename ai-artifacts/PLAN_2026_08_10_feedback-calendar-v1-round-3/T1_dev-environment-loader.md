# T1: Dev environment loader

**Plan:** `./ai-artifacts/PLAN_2026_08_10_feedback-calendar-v1-round-3.md`
**Depends:** none
**Commit outcome:** `npm run dev -- --env=minimal` resets local DB then seeds one account per role from an editable JSON file. Plain `npm run dev` behaves exactly as today.

## Context (self-contained)

- Goal: land 15-line round-3 feedback on Gones. This slice covers feedback #2 — "generate different local environments with a pre-loaded database … I need to swap between environments and test as a normal user, an admin user, or an organizer user … by default `npm run dev` without any option should run the application as it is currently — basically empty … make sure all data can be edited directly in a text file".
- This slice: build the **mechanism** — fixture format, loader module, seeder CLI, `--env` flag, docs, tests. Ships two environments: `empty` and `minimal`. T2 and T3 add `demo` payload files on top; no loader change after this ticket.
- Out of scope here: `demo` dataset content (T2, T3). Any `backend/**` C# change. Any UI change.
- Assumptions in force:
  - Fixtures live under `fixtures/dev-environments/<name>/`, one JSON file per concern.
  - Seeding drives the real HTTP API. Only `email_confirmed` and `global_role` are set by SQL, exactly as `scripts/seed-dev-accounts.mjs` already does (ADR 0029).
  - A non-`empty` environment resets the database first. `empty` never resets.
  - Shared dev password `Gones-dev-pass-123!` = `DEV_PASSWORD` exported from `scripts/dev-accounts.mjs`.

## Requirements

- New dir `fixtures/dev-environments/` with subdirs `empty/` and `minimal/`.
- New module `scripts/dev-environments.mjs`, pure + testable, no Docker calls.
- New CLI `scripts/seed-dev-environment.mjs`.
- `scripts/dev.mjs` accepts `--env=<name>`; default `empty`; flag never forwarded to `ng serve`.
- `package.json` gains `"dev:env": "node scripts/seed-dev-environment.mjs"`.
- New test file `ops/dev-environments.test.ts`, inside the `npm run test` include glob `ops/**/*.test.ts`.
- `AGENT.md` + `README.md` document the flag and the fixture path.
- New ADR `docs/adr/0030-file-driven-local-dev-environments.md` (already written with this plan — read it, do not rewrite it).

## Inputs

- Read `scripts/dev.mjs` — current flags `--no-docker`, `--detached`, `--no-accounts`; `ngArgs` filter; `waitForApi()`; account seeding step.
- Read `scripts/dev-accounts.mjs` — exports `DEV_PASSWORD` and `DEV_ACCOUNTS` and `meetsPasswordPolicy(password)`.
- Read `scripts/seed-dev-accounts.mjs` — the register-then-SQL pattern to copy: probe `SELECT 1 FROM asp_net_users WHERE normalized_email = '<UPPER>' LIMIT 1`, then `POST http://127.0.0.1:5080/api/auth/register` tolerating 409, then one `UPDATE asp_net_users SET email_confirmed = …, global_role = …`.
- Read `scripts/reset-local-stack.mjs` — `docker compose --profile development down --volumes --remove-orphans` then `up --build -d --wait` then `node scripts/seed-local.mjs`.
- Read `ops/dev-accounts.test.ts` — test-file style for this repo.
- **From Depends:** none.

## Fixture format (decided here — do not invent another)

`fixtures/dev-environments/<name>/environment.json`, required, exactly these keys:

```json
{
  "name": "minimal",
  "description": "One verified account per role, no content.",
  "resetDatabase": true
}
```

Optional sibling files, each a JSON array; a missing file means an empty array:

| file | consumed by |
| --- | --- |
| `accounts.json` | T1 |
| `organizations.json` | T2 |
| `formats.json` | T2 |
| `tournaments.json` | T2 |
| `registrations.json` | T2 |
| `leagues.json` | T3 |
| `live-tournaments.json` | T3 |

`accounts.json` entry shape (every key required except `password` and `emailConfirmed`):

```json
{
  "email": "organizer@gones.test",
  "username": "gones-organizer",
  "firstName": "Gones",
  "lastName": "Organizer",
  "role": "Organizer",
  "password": "Gones-dev-pass-123!",
  "emailConfirmed": true
}
```

- `role` ∈ `"User" | "Organizer" | "Admin"`.
- `password` default = `DEV_PASSWORD`.
- `emailConfirmed` default = `true`.

## `scripts/dev-environments.mjs` — exact API

```js
export const DEV_ENVIRONMENTS_DIR = 'fixtures/dev-environments';
export const DEFAULT_DEV_ENVIRONMENT = 'empty';
export const DATA_FILES = ['accounts', 'organizations', 'formats', 'tournaments', 'registrations', 'leagues', 'liveTournaments'];

/** Directory names under DEV_ENVIRONMENTS_DIR, sorted. */
export function listEnvironmentNames(root = DEV_ENVIRONMENTS_DIR): string[]

/** Throws Error('unknownDevEnvironment') when the directory is missing. */
export function readEnvironment(name, root = DEV_ENVIRONMENTS_DIR)
// -> { name, description, resetDatabase, accounts, organizations, formats, tournaments, registrations, leagues, liveTournaments }

/** [] when valid; one human-readable string per problem otherwise. */
export function validateEnvironment(environment): string[]

/** Splits process.argv.slice(2) for scripts/dev.mjs. */
export function parseDevArgs(argv)
// -> { environment, skipDocker, skipAccounts, detached, ngArgs }
```

Rules `validateEnvironment` enforces:

- `name` non-empty string, equal to the directory name.
- `description` non-empty string.
- `resetDatabase` boolean.
- every account has non-empty `email` containing `@`, non-empty `username`, `firstName`, `lastName`.
- every account `role` ∈ `User | Organizer | Admin`.
- every account `password` satisfies `meetsPasswordPolicy` (imported from `./dev-accounts.mjs`).
- account emails unique; usernames unique.
- an environment whose `resetDatabase` is `false` declares no data at all (every list empty). Message: `"<name>: resetDatabase=false but the environment carries data"`.

`parseDevArgs` rules:

- `--env=<name>` and `--env <name>` both accepted; last wins; default `DEFAULT_DEV_ENVIRONMENT`.
- `--env`, `--no-docker`, `--detached`, `--no-accounts` never appear in `ngArgs`.
- everything else preserved, in order, in `ngArgs`.

## `scripts/seed-dev-environment.mjs` — behaviour

1. Parse `--env=<name>` (default `empty`). No `--env` and no positional → `empty`.
2. `readEnvironment(name)`; on `unknownDevEnvironment` print `Unknown environment "<name>". Available: <listEnvironmentNames().join(', ')>` and `process.exit(2)`.
3. `validateEnvironment` non-empty → print each problem, `process.exit(2)`.
4. `environment.resetDatabase === false` and every list empty → print `Environment "<name>" seeds nothing.` and exit 0. (This is `empty`.)
5. `environment.resetDatabase === true` → run `node scripts/reset-local-stack.mjs` via `spawnSync(process.execPath, ['scripts/reset-local-stack.mjs'], { stdio: 'inherit' })`; non-zero exit → exit with the same code.
   - **Deviation, approved during implementation (T1):** the seeder inlines the three reset commands
     (`docker compose --profile development down --volumes --remove-orphans` →
     `docker compose up --build -d --wait postgres migrator api worker` → `node scripts/seed-local.mjs`)
     instead of spawning `scripts/reset-local-stack.mjs`. That script's `up` starts every default
     service, including `frontend-development`, which publishes `127.0.0.1:4200` (compose.yaml:130-144,
     no `profiles:` key) — the port `scripts/dev.mjs` then needs for its own `ng serve`, so
     `npm run dev -- --env=<name>` could never work. `scripts/reset-local-stack.mjs` and `npm run db:reset`
     are unchanged. The failure contract is identical: a non-zero exit from any of the three commands
     exits the seeder with the same code.
6. Seed accounts: for each `accounts.json` entry, probe-then-register-then-SQL exactly as `scripts/seed-dev-accounts.mjs` does, using `emailConfirmed` and `role` from the fixture.
7. Print a summary block:
   ```
   Environment "minimal" ready.
     admin@gones.test        Admin      Gones-dev-pass-123!
     organizer@gones.test    Organizer  Gones-dev-pass-123!
     test@gones.test         User       Gones-dev-pass-123!
   ```
8. Exit 0.

Hooks T2/T3 will fill (leave the functions present and returning immediately when their list is empty, so this ticket compiles and later tickets do not restructure the file):

```js
async function seedOrganizations(environment, tokens) { if (!environment.organizations.length) return new Map(); /* T2 */ return new Map(); }
async function seedFormats(environment, tokens) { if (!environment.formats.length) return new Map(); /* T2 */ return new Map(); }
async function seedTournaments(environment, tokens, organizationIds, formatIds) { if (!environment.tournaments.length) return new Map(); /* T2 */ return new Map(); }
async function seedRegistrations(environment, tokens, tournamentIds) { if (!environment.registrations.length) return; /* T2 */ }
async function seedLeagues(environment, tokens) { if (!environment.leagues.length) return; /* T3 */ }
async function seedLiveTournaments(environment, tokens) { if (!environment.liveTournaments.length) return; /* T3 */ }
```

Also add now, used by T2/T3:

```js
/** POST /api/auth/login, returns { accessToken } for a fixture account email. */
export async function loginToken(email, password) { … }
```

## `scripts/dev.mjs` — exact edits

- Replace the hand-rolled `argv` parsing with `parseDevArgs(process.argv.slice(2))` imported from `./dev-environments.mjs`.
- After `waitForApi()` and after the existing `seed-dev-accounts.mjs` step, when `environment !== 'empty'`:
  ```js
  const seeded = spawnSync(process.execPath, ['scripts/seed-dev-environment.mjs', `--env=${environment}`], { stdio: 'inherit' });
  if (seeded.status !== 0) fail(`Seeding the "${environment}" environment failed. Re-run it with: npm run dev:env -- --env=${environment}`);
  ```
- Extend the header comment flag list with `--env=<name>   seed a local environment from fixtures/dev-environments/<name> (default: empty)`.
- `--env=<name>` with `--no-docker` is refused: `fail('--env needs the Docker stack; drop --no-docker.')`.

## TDD

1. **Red** — write `ops/dev-environments.test.ts` first with the seven tests below. They fail because `scripts/dev-environments.mjs` does not exist.
2. **Green** — write `scripts/dev-environments.mjs` + the two fixture directories until green.
3. **Refactor** — only if needed; keep green. Then write `scripts/seed-dev-environment.mjs` and wire `scripts/dev.mjs` (covered by test 6 + manual check).

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `every shipped environment validates` | each name from `listEnvironmentNames()` | `validateEnvironment(readEnvironment(name))` equals `[]` |
| `the empty environment seeds nothing` | `readEnvironment('empty')` | `resetDatabase === false` and every one of `DATA_FILES` maps to `[]` |
| `the minimal environment carries one account per role` | `readEnvironment('minimal').accounts` | roles as a `Set` equal `new Set(['User', 'Organizer', 'Admin'])`; length `3` |
| `every fixture password meets the server policy` | every account of every environment | `meetsPasswordPolicy(account.password ?? DEV_PASSWORD)` is `true` |
| `an unknown environment is refused` | `() => readEnvironment('does-not-exist')` | throws, `error.message === 'unknownDevEnvironment'` |
| `parseDevArgs keeps --env out of the ng arguments` | `parseDevArgs(['--env=demo', '--port', '4300', '--no-docker'])` | `{ environment: 'demo', skipDocker: true, ngArgs: ['--port', '4300'] }` |
| `validateEnvironment rejects a data-carrying environment that does not reset` | hand-built object `{ name: 'x', description: 'x', resetDatabase: false, accounts: [oneValidAccount], … }` | returned array contains `'x: resetDatabase=false but the environment carries data'` |

Run: `npx vitest run ops/dev-environments.test.ts`

## Impl steps

- [x] 1. Create `fixtures/dev-environments/empty/environment.json` = `{ "name": "empty", "description": "Nothing seeded. What plain `npm run dev` has always given you.", "resetDatabase": false }`. — verify: file exists, `node -e` parses it and `resetDatabase === false`.
- [x] 2. Create `fixtures/dev-environments/minimal/environment.json` = `{ "name": "minimal", "description": "One verified account per role, no content.", "resetDatabase": true }`. — verify: file exists, parses, `resetDatabase === true`.
- [x] 3. Create `fixtures/dev-environments/minimal/accounts.json` with 3 entries: `admin@gones.test`/`gones-admin`/`Admin`, `organizer@gones.test`/`gones-organizer`/`Organizer`, `test@gones.test`/`gones-test`/`User`. No `password` key on any of them. — verify: parses to an array of 3, roles `Admin|Organizer|User`, no `password` key.
- [x] 4. Create `fixtures/dev-environments/README.md`: what each file is, how to add an environment (copy a directory, edit `environment.json.name` to match the directory name), how to run it, and that every change is picked up on the next `npm run dev -- --env=<name>` with no rebuild. — verify: file exists and names all four points.
- [x] 5. Write `ops/dev-environments.test.ts` with the seven tests above. Confirm red: `npx vitest run ops/dev-environments.test.ts`. — verify: run fails on the missing `scripts/dev-environments.mjs`.
- [x] 6. Write `scripts/dev-environments.mjs` exporting `DEV_ENVIRONMENTS_DIR`, `DEFAULT_DEV_ENVIRONMENT`, `DATA_FILES`, `listEnvironmentNames`, `readEnvironment`, `validateEnvironment`, `parseDevArgs`, `loginToken`. — verify: `node -e "import('./scripts/dev-environments.mjs').then(m => console.log(Object.keys(m)))"` lists all eight.
- [x] 7. Re-run `npx vitest run ops/dev-environments.test.ts` — green. — verify: 7 passed, 0 failed.
- [x] 8. Write `scripts/seed-dev-environment.mjs` per the eight numbered behaviours, including the six empty T2/T3 hook functions. — verify: `--env=does-not-exist` exits 2, `--env=empty` exits 0 with the seeds-nothing line.
- [x] 9. Add `"dev:env": "node scripts/seed-dev-environment.mjs"` to `package.json` scripts, directly after `"dev:accounts"`. — verify: `npm pkg get scripts.dev:env` prints the command.
- [x] 10. Edit `scripts/dev.mjs`: import `parseDevArgs`, replace the manual argv parsing, add the `--env` seeding step, add the `--env` + `--no-docker` refusal, extend the header comment. — verify: `node scripts/dev.mjs --env=minimal --no-docker` refuses with the exact message and exits 1.
- [x] 11. Add a `## Local development environments` section to `README.md` and a `npm run dev -- --env=minimal` row to the command table in `AGENT.md`. — verify: `grep` finds the section in `README.md` and the row in `AGENT.md`.
- [x] 12. Run `npm run test && npm run lint && npm run typecheck && npm run build`. — verify: all four exit 0.
- [x] 13. Manual: `npm run dev -- --env=minimal`, sign in as `organizer@gones.test` / `Gones-dev-pass-123!`, confirm the Organizer header actions appear. Then `docker compose down` and `npm run dev` and confirm the app is empty and no reset happened. — verify: seeder summary block printed for the three accounts and their rows carry `email_confirmed = t` with the right `global_role`; a plain `npm run dev` run touches no volume.

## Outputs

- Files added: `fixtures/dev-environments/README.md`, `fixtures/dev-environments/empty/environment.json`, `fixtures/dev-environments/minimal/environment.json`, `fixtures/dev-environments/minimal/accounts.json`, `scripts/dev-environments.mjs`, `scripts/seed-dev-environment.mjs`, `ops/dev-environments.test.ts`.
- Files edited: `scripts/dev.mjs`, `package.json`, `README.md`, `AGENT.md`.
- Behaviour change: new `--env` flag on `npm run dev`; new `npm run dev:env` script. Default path untouched.
- Migration/config: none. No new dependency.

## Validation

- [x] `npx vitest run ops/dev-environments.test.ts` passes with 7 tests. — verify: `Tests  7 passed (7)`.
- [x] `npm run test` passes.
- [x] `npm run lint` passes.
- [x] `npm run typecheck` passes.
- [x] `npm run build` passes.
- [x] `node scripts/seed-dev-environment.mjs --env=does-not-exist` exits 2 and prints the available names.
- [x] `node scripts/seed-dev-environment.mjs --env=empty` exits 0, prints `Environment "empty" seeds nothing.`, and touches no container.
- [x] Manual: `npm run dev -- --env=minimal` → sign in works for all three accounts. Evidence: seeder exit 0 with the summary block; `POST /api/auth/login` returns 200 with an `accessToken` for `admin@gones.test`, `organizer@gones.test` and `test@gones.test`; `asp_net_users` holds the three rows with `Admin` / `Organizer` / `User` and `email_confirmed = t`.
- [x] Manual: `npm run dev` (no flag) → app still empty, no database reset. Evidence: `node scripts/dev.mjs --detached` left the `gones-postgres-1` container id unchanged, the three rows in place and ran only the existing `seed-dev-accounts.mjs` step; the UI half of the check is in `ai-artifacts/manual_test_checklist.md`.
- [x] App functional — no broken path from this slice. — verify: default `npm run dev` path unchanged (`parseDevArgs([])` → `environment: 'empty'`, no reset, no seeding) and the API stays healthy after the `minimal` run.
- [ ] Commit msg draft: `feat(dev): load local environments from editable fixture files` — verify: the commit lands on `feat/feedback-calendar-v1-round-3` with that subject.
