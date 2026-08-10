# T3: Demo league + live dataset

**Plan:** `./ai-artifacts/PLAN_2026_08_10_feedback-calendar-v1-round-3.md`
**Depends:** T2
**Commit outcome:** `npm run dev -- --env=demo` also seeds two League Archives with real rounds and standings, plus two server-side running (Live) tournaments — one mid-round, one at standings — from editable JSON files.

## Context (self-contained)

- Goal: land 15-line round-3 feedback on Gones. This slice covers the rest of feedback #2 — "a pre-loaded database containing tournaments, **running tournaments**, and calendar events … If you need ideas for test information, you can find the DBGONDB.json file that has a lot of real data that can be used to extrapolate mock data".
- This slice: the League Archive + Live halves of the `demo` environment. Calendar tournaments and registrations already ship (T2).
- Out of scope here: any UI change; any `backend/**` C# change; the `empty` and `minimal` environments.
- Assumptions in force:
  - `DBGONDB.json` is not on this machine. Donor data may be used only to infer realistic fixture shape. Every committed name and value is synthetic; fixture files are the source of truth.
  - Seeding drives the real HTTP API. `demo` sets `resetDatabase: true`.

## Inputs

- **From T1 + T2 (spell out — do not read them):**
  - `fixtures/dev-environments/demo/` already holds `environment.json` (`{ "name": "demo", "description": …, "resetDatabase": true }`), `accounts.json` (7 accounts: `admin@gones.test` Admin, `organizer@gones.test` + `organizer2@gones.test` Organizer, `test@gones.test` + `player1@gones.test` + `player2@gones.test` User, `unverified@gones.test` User unverified), `formats.json`, `organizations.json`, `tournaments.json`, `registrations.json`.
  - `scripts/dev-environments.mjs` exports `DEV_ENVIRONMENTS_DIR`, `DEFAULT_DEV_ENVIRONMENT`, `DATA_FILES`, `listEnvironmentNames`, `readEnvironment(name)` (throws `Error('unknownDevEnvironment')`), `validateEnvironment(environment) -> string[]`, `parseDevArgs(argv)`, `loginToken(email, password)`, `localDateTime(offsetDays, time, today?) -> 'YYYY-MM-DDTHH:mm'`.
  - `readEnvironment` returns `{ name, description, resetDatabase, accounts, organizations, formats, tournaments, registrations, leagues, liveTournaments }`; `leagues` reads `leagues.json`, `liveTournaments` reads `live-tournaments.json`; a missing file means `[]`.
  - `scripts/seed-dev-environment.mjs` already: resets the stack, seeds accounts (register + SQL for `email_confirmed` / `global_role`), builds `tokens` = `Map<email, accessToken>` in `loginAll(environment)`, seeds formats, organizations, tournaments and registrations, prints a counts summary, and declares two still-empty hooks:
    ```js
    async function seedLeagues(environment, tokens) { if (!environment.leagues.length) return; }
    async function seedLiveTournaments(environment, tokens) { if (!environment.liveTournaments.length) return; }
    ```
  - `validateEnvironment` already enforces: name/description/resetDatabase types, account shape + role + unique email/username, password policy via `meetsPasswordPolicy` from `scripts/dev-accounts.mjs`, `resetDatabase: false` ⇒ no data, and the T2 cross-reference rules for organizations / tournaments / formats / registrations.
  - `ops/dev-environments.test.ts` exists and is inside the `npm run test` glob `ops/**/*.test.ts`. It currently holds 12 passing tests; add to it, delete none.
  - Local-stack facts established by the T1/T2 real runs, rely on them:
    - The seeder inlines its own reset (`docker compose --profile development down --volumes --remove-orphans` → `docker compose up --build -d --wait postgres migrator api worker` → `node scripts/seed-local.mjs`) instead of spawning `scripts/reset-local-stack.mjs`, because that script also starts `frontend-development` on port 4200 and collides with `ng serve`. Keep it that way.
    - `devComposeEnv()` in `scripts/dev-environments.mjs` holds the `GONES_FEATURES__*` block the API needs (without it `/api/auth/register` answers 404) **and** `GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT=1000`, because the default auth limit is 5 per 15 min per IP and the seeder makes far more login calls than that. Reuse it; do not re-declare the flag list.
    - Every tournament write in T2 sends a fixture-derived `Idempotency-Key`. Do the same for both endpoints below — the header is mandatory and re-running the seeder must stay exit 0.
    - `localDateTime` returns `'YYYY-MM-DDTHH:mm'`; the seeder appends `:00` where the API wants seconds.
- API endpoints this ticket calls (all exist, base `http://127.0.0.1:5080`, Organizer or Admin token):
  - `POST /api/leagues-archive/restore` — header `Idempotency-Key` **required**; body `{ "kind": "league", "gonesDataVersion": 2, "league": <LeagueDocument> }` → `201`.
  - `POST /api/live-tournaments` — header `Idempotency-Key` **required**; body `{ "name": string|null, "leagueId": string|null, "tournamentDate": string|null, "roundCount": number|null, "customRoundCount": bool|null, "paidTrackingEnabled": bool|null }` → `201` `{ document, documentVersion, eTag }`.
  - `POST /api/live-tournaments/{id}/players` — header `If-Match: <eTag>`; body `{ "name": string, "initialWins": number, "initialDraws": number, "initialLosses": number, "archetype": string }`.
  - `POST /api/live-tournaments/{id}/rounds/start` — header `If-Match`.
  - `POST /api/live-tournaments/{id}/rounds/{roundId}/entries/{entryId}/score` — header `If-Match`; body `{ "player1Score": number, "player2Score": number }`.
  - `POST /api/live-tournaments/{id}/rounds/validate` — header `If-Match`.
  - Every command response carries `{ document, documentVersion, eTag }`; the next command must send the **latest** `eTag`.
- `LeagueDocument` shape (`src/app/domain/models.ts`):
  ```ts
  LeagueDocument   = { id: string; name: string; status: 'active' | 'completed'; tournaments: TournamentDocument[] }
  TournamentDocument = { id: string; leagueId: string; name: string; tournamentDate: string; rounds: RoundDocument[]; playerArchetypes: { playerName: string; archetype: string }[] }
  RoundDocument    = { id: string; entries: RoundEntry[] }
  RoundEntry(match)= { kind: 'match'; id: string; table: string; player1Name: string; player2Name: string; player1Score: number; player2Score: number; player1DeckArchetype: string; player2DeckArchetype: string }
  RoundEntry(bye)  = { kind: 'bye'; id: string; playerName: string; playerDeckArchetype: string }
  ```

## Requirements

- New `fixtures/dev-environments/demo/leagues.json` — 2 leagues, each a whole `LeagueDocument`, with synthetic ids and player names.
- New `fixtures/dev-environments/demo/live-tournaments.json` — 2 running tournaments described declaratively, not as documents.
- `scripts/seed-dev-environment.mjs` fills `seedLeagues` and `seedLiveTournaments`.
- `validateEnvironment` gains league + live rules.
- `ops/dev-environments.test.ts` gains five tests.

## Fixture shapes (decided here — do not invent another)

`demo/leagues.json` = a JSON array of `LeagueDocument`. Two entries:

1. `id: "demo-league-6"`, `name: "Gones League 6"`, `status: "completed"`, **3** tournaments (`demo-gl6-day-1`, `demo-gl6-day-2`, `demo-gl6-day-3`), each with **3** rounds of **4** match entries plus one `bye` entry in round 3 of day 3. Explicit synthetic names (`Demo Player 01`, `Demo Player 02`, …) provide at least 9 distinct players so standings are non-trivial. `playerArchetypes` is populated for at least 4 players per tournament with archetypes already present in `src/app/config/legacy-archetype-presets.ts`.
2. `id: "demo-league-7"`, `name: "Gones League 7"`, `status: "active"`, **1** tournament (`demo-gl7-day-1`) with **2** rounds, same player pool. This one is the "in progress" archive.

Every `tournamentDate` is a literal `YYYY-MM-DD` in the past — the archive is history, so absolute dates are correct here and must **not** be made relative.

Every `id` is a stable literal string (not a UUID) so the fixture stays diffable and a re-seed is idempotent.

`demo/live-tournaments.json` — `[{ key, organizerEmail, name, leagueKey, tournamentDate, roundCount, customRoundCount, paidTrackingEnabled, players, scoredRounds }]`:

- `leagueKey` is the `id` of an entry in `leagues.json`, or `null` for an unassigned running tournament.
- `tournamentDate` uses the same relative form as T2: `{ "offsetDays": 0 }` → the seeder renders it with `localDateTime(offsetDays, '00:00').slice(0, 10)`.
- `players`: `[{ "name": string, "initialWins": number, "initialDraws": number, "initialLosses": number, "archetype": string }]`.
- `scoredRounds`: integer, how many rounds the seeder starts, scores and validates before stopping. The final started-but-unscored round is controlled by `leaveRoundOpen: boolean`.

Two entries:

| key | organizerEmail | players | roundCount | scoredRounds | leaveRoundOpen | leagueKey |
| --- | --- | --- | --- | --- | --- | --- |
| `demo-live-in-progress` | `organizer@gones.test` | 8 | 3 | 1 | `true` | `demo-league-7` |
| `demo-live-standings` | `organizer2@gones.test` | 6 | 3 | 3 | `false` | `null` |

## Seeder implementation (exact)

```js
async function seedLeagues(environment, tokens)         // -> Map<leagueId, leagueId>
async function seedLiveTournaments(environment, tokens) // -> void
```

`seedLeagues`

- Token: the Admin token (`admin@gones.test`) — Admin passes the Organizer policy and owns nothing, so ownership never blocks a re-seed.
- For each league: `POST /api/leagues-archive/restore` with header `Idempotency-Key: demo-league-restore-<league.id>` and body `{ kind: 'league', gonesDataVersion: 2, league }`.
- The idempotency key makes a second run return the first response instead of duplicating. Tolerate `409`.

`seedLiveTournaments`

For each entry, with the token of `organizerEmail`:

1. `POST /api/live-tournaments` header `Idempotency-Key: demo-live-create-<key>`, body `{ name, leagueId: entry.leagueKey, tournamentDate, roundCount, customRoundCount, paidTrackingEnabled }`. Keep `id` and `eTag` from the response.
2. For each player: `POST /api/live-tournaments/{id}/players` with `If-Match: <latest eTag>`; refresh `eTag` from each response.
3. Repeat `entry.scoredRounds` times: `POST …/rounds/start`; then for every `kind: 'match'` entry of `document.rounds.at(-1)`, `POST …/rounds/{roundId}/entries/{entryId}/score` with a deterministic score picked by index (`index % 3` → `2-0`, `2-1`, `1-1`); then `POST …/rounds/validate`.
4. `entry.leaveRoundOpen === true` → one extra `POST …/rounds/start` and stop, leaving the round unscored.
5. Any non-2xx → print `Seeding live tournament <key> failed at <step>: <status> <body>` and `process.exit(1)`.

Extend the printed summary with `2 league archives, 2 running tournaments`.

## Validation rules added to `validateEnvironment`

- every `leagues[].id` and `leagues[].name` is a non-empty string; ids unique → else `"<name>: duplicate league id <id>"`.
- every `leagues[].status` ∈ `active | completed`.
- every `leagues[].tournaments[].leagueId` equals its parent `leagues[].id` → else `"<name>: tournament <tournamentId> claims league <leagueId>"`.
- every `RoundEntry.kind` ∈ `match | bye`.
- every `liveTournaments[].organizerEmail` is an account with role `Organizer` or `Admin` → else `"<name>: running tournament <key> organizer <email> is not an Organizer"`.
- every non-null `liveTournaments[].leagueKey` matches some `leagues[].id` → else `"<name>: running tournament <key> references unknown league <leagueKey>"`.
- `liveTournaments[].scoredRounds` ≤ `roundCount`, and `players.length` ≥ 2 and even → else `"<name>: running tournament <key> cannot pair <n> players"`.

## TDD

1. **Red** — add the five tests below and create the two fixture files. Tests fail: `validateEnvironment` has no league/live rules yet.
2. **Green** — add the rules; then implement the two seeder hooks.
3. **Refactor** — only if needed. Keep green.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `the demo environment still validates with leagues and running tournaments` | `validateEnvironment(readEnvironment('demo'))` | `[]` |
| `the demo archive carries two leagues, one completed and one active` | `readEnvironment('demo').leagues` | length `2`; statuses as a `Set` equal `new Set(['completed', 'active'])`; the completed one has `3` tournaments |
| `every archive round entry is a match or a bye` | every entry of every round of every tournament of `readEnvironment('demo').leagues` | `['match', 'bye'].includes(entry.kind)` for all |
| `a running tournament that claims an unknown league is reported` | hand-built environment with `liveTournaments: [{ key: 'l1', organizerEmail: 'organizer@gones.test', leagueKey: 'nope', … }]` | returned array contains `'demo-broken: running tournament l1 references unknown league nope'` |
| `a running tournament cannot score more rounds than it has` | hand-built entry `{ key: 'l1', roundCount: 2, scoredRounds: 3, players: [4 players], … }` | returned array contains `'demo-broken: running tournament l1 cannot pair'`-prefixed message or the round-count message; assert the array is non-empty and mentions `l1` |

Run: `npx vitest run ops/dev-environments.test.ts`

## Impl steps

- [x] 1. Use donor data only to infer realistic fixture shape; commit explicit synthetic player names and values. → verify: tracked-tree donor-name grep is empty and `fixtures/dev-environments/demo/leagues.json` preserves at least 9 distinct synthetic players.
- [x] 2. Create `fixtures/dev-environments/demo/leagues.json`: `demo-league-6` (completed, 3 tournaments × 3 rounds × 4 matches, one `bye` in day 3 round 3) and `demo-league-7` (active, 1 tournament × 2 rounds). Literal string ids, past `tournamentDate` values, `playerArchetypes` filled from `src/app/config/legacy-archetype-presets.ts`. → verify: `node -e` shape probe prints 2 leagues / 3 + 1 tournaments / 3 + 2 rounds / one `bye`, and every archetype is a preset name.
- [x] 3. Create `fixtures/dev-environments/demo/live-tournaments.json` with the two rows in the table above. → verify: `node -e` probe prints the two keys with 8 / 6 players and the table's `roundCount`, `scoredRounds`, `leaveRoundOpen`, `leagueKey`.
- [x] 4. Add the five tests to `ops/dev-environments.test.ts`. Confirm red. → verify: `npx vitest run ops/dev-environments.test.ts` fails on the new league/live rules, existing 12 tests still counted.
- [x] 5. Add the seven league + live rules to `validateEnvironment` in `scripts/dev-environments.mjs`. → verify: the rules exist in the diff and produce the exact message strings the tests assert.
- [x] 6. Re-run `npx vitest run ops/dev-environments.test.ts` — green. → verify: 17 passed, 0 failed.
- [x] 7. Implement `seedLeagues` in `scripts/seed-dev-environment.mjs`. → verify: a real `--env=demo` run creates 2 League Archives (row count from `psql`).
- [x] 8. Implement `seedLiveTournaments`, including the `If-Match` eTag chain and the deterministic scoring rule. → verify: a real `--env=demo` run leaves `demo-live-in-progress` on stage `round` and `demo-live-standings` on stage `standings`.
- [x] 9. Extend the printed summary with league + running-tournament counts. → verify: the seeder prints `2 league archives, 2 running tournaments`.
- [x] 10. Document `leagues.json` and `live-tournaments.json` field by field in `fixtures/dev-environments/README.md`, including "archive dates are absolute on purpose". → verify: both file sections and the absolute-dates sentence are in the README diff.
- [x] 11. Run `npm run test && npm run lint && npm run typecheck && npm run build`. → verify: all four exit 0.
- [ ] 12. Manual: `npm run dev -- --env=demo`; signed in as `organizer@gones.test`, `/leagues-archive` lists both leagues, `Gones League 6` standings render; `/live-tournaments` shows the in-progress one on an open round and the other at standings. → automated substitute/context only, not manual execution: API reads (`GET /api/leagues-archive`, `GET /api/live-tournaments`) plus seeded row counts match expected data.

## Outputs

- Files added: `fixtures/dev-environments/demo/leagues.json`, `fixtures/dev-environments/demo/live-tournaments.json`.
- Files edited: `scripts/dev-environments.mjs`, `scripts/seed-dev-environment.mjs`, `ops/dev-environments.test.ts`, `fixtures/dev-environments/README.md`.
- Behaviour change: `--env=demo` now seeds League Archives and running tournaments. No app-code change.
- Migration/config: none.

## Validation

- [x] `npx vitest run ops/dev-environments.test.ts` passes.
- [x] `npm run test` passes.
- [x] `npm run lint` passes.
- [x] `npm run typecheck` passes.
- [x] `npm run build` passes.
- [x] `node scripts/seed-dev-environment.mjs --env=demo` exits 0; a second run exits 0 without duplicating a league (`GET /api/leagues-archive` still returns 2 non-placeholder leagues).
- [ ] Manual: `/leagues-archive/demo-league-6` renders 3 tournaments and a standings table with ≥ 9 players. → automated substitute/context only, not manual execution: `GET /api/leagues-archive/<restored id>` shows 3 tournaments and `…/result` ≥ 9 standing rows.
- [ ] Manual: `/live-tournaments` as `organizer@gones.test` shows `demo-live-in-progress` on an unscored round. → automated substitute/context only, not manual execution: `GET /api/live-tournaments` shows stage `round`, current round entries unscored.
- [x] App functional — no broken path from this slice. → verify: `npm run build` green and no `src/**` or `backend/**` file in the diff.
- [x] Commit msg draft: `feat(dev): seed demo league archives and running tournaments` — committed as `1f6cd4e`, pushed to `origin/feat/feedback-calendar-v1-round-3`.
