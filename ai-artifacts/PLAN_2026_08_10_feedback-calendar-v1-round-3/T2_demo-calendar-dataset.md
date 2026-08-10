# T2: Demo calendar dataset

**Plan:** `./ai-artifacts/PLAN_2026_08_10_feedback-calendar-v1-round-3.md`
**Depends:** T1
**Commit outcome:** `npm run dev -- --env=demo` resets the DB and seeds seven accounts, two organizations, four formats, nine published Calendar tournaments spread over past / ongoing / upcoming, and their registrations — all read from editable JSON files.

## Context (self-contained)

- Goal: land 15-line round-3 feedback on Gones. This slice covers feedback #2 — "generate different local environments with a pre-loaded database containing tournaments, running tournaments, and calendar events for various users with different rights … all the data can be edited directly in a text file".
- This slice: the Calendar half of the `demo` environment — accounts, organizations, formats, published tournaments, registrations. League Archives and running (Live) tournaments come in T3.
- Out of scope here: League Archive data, Live tournament data (T3). Any `backend/**` C# change. Any UI change.
- Assumptions in force:
  - Seeding drives the real HTTP API. Only `email_confirmed` and `global_role` go through SQL.
  - `demo` sets `resetDatabase: true`, so a swap never stacks two datasets.
  - Shared password `Gones-dev-pass-123!`.

## Inputs

- **From T1 (spell out — do not read T1):**
  - `fixtures/dev-environments/<name>/` holds `environment.json` (`{ name, description, resetDatabase }`) plus optional per-concern JSON arrays: `accounts.json`, `organizations.json`, `formats.json`, `tournaments.json`, `registrations.json`, `leagues.json`, `live-tournaments.json`. A missing file means `[]`.
  - `scripts/dev-environments.mjs` exports `DEV_ENVIRONMENTS_DIR`, `DEFAULT_DEV_ENVIRONMENT`, `DATA_FILES`, `listEnvironmentNames(root?)`, `readEnvironment(name, root?)` (throws `Error('unknownDevEnvironment')`), `validateEnvironment(environment) -> string[]`, `parseDevArgs(argv)`, `loginToken(email, password) -> { accessToken }`.
  - `readEnvironment` returns `{ name, description, resetDatabase, accounts, organizations, formats, tournaments, registrations, leagues, liveTournaments }`.
  - Account entry: `{ email, username, firstName, lastName, role, password?, emailConfirmed? }`, `role ∈ User | Organizer | Admin`.
  - `scripts/seed-dev-environment.mjs` already resets the stack, seeds accounts and prints the summary. It already declares the empty hooks `seedOrganizations`, `seedFormats`, `seedTournaments`, `seedRegistrations`, `seedLeagues`, `seedLiveTournaments` — this ticket fills the first four.
  - `ops/dev-environments.test.ts` already asserts: every shipped environment validates, `empty` seeds nothing, `minimal` has one account per role, every password meets policy, unknown name throws, `parseDevArgs` strips `--env`, and a data-carrying environment must set `resetDatabase: true`.
  - `npm run dev -- --env=<name>` and `npm run dev:env -- --env=<name>` both exist.
- API endpoints this ticket calls (all already exist, all `http://127.0.0.1:5080`):
  - `POST /api/auth/login` → `{ accessToken }`.
  - `GET /api/formats` (public) → `[{ id, name, slug, sortOrder }]`.
  - `POST /api/admin/formats` (Admin) body `{ "name": string, "slug": string, "sortOrder": number }` → `201` `{ id, … }`.
  - `GET /api/admin/users` (Admin) — used to resolve a fixture email to its `userId`.
  - `POST /api/admin/organizations` (Admin) body `{ "name": string, "description": string|null, "website": string|null, "contactEmail": string|null, "ownerUserId": guid }` → `201`.
  - `POST /api/tournaments/preview` (Organizer) body = the payload below → `{ previewTicket, render: { slug, … } }`.
  - `POST /api/tournaments` (Organizer) body `{ "previewTicket": string, "payload": <same payload> }` → `201` `{ id, slug, … }`.
  - `POST /api/tournaments/{tournamentId}/registrations` (User) → `201`.
- Donor data for realistic names / venues: `/home/aron/gdrive-snapshot-2026-08-10/backup/gones-exports/gones-full-data.gones.json` (real Lyon-area player names). Use it for flavour only in this ticket.

## Requirements

- New dir `fixtures/dev-environments/demo/` with `environment.json`, `accounts.json`, `organizations.json`, `formats.json`, `tournaments.json`, `registrations.json`.
- `scripts/seed-dev-environment.mjs` fills `seedFormats`, `seedOrganizations`, `seedTournaments`, `seedRegistrations`.
- Fixtures reference each other by human-readable keys, never by GUID — GUIDs do not exist before the seed runs.
- `ops/dev-environments.test.ts` gains four tests for the new cross-reference rules; `validateEnvironment` gains the matching rules.

## Fixture shapes (decided here — do not invent another)

`demo/environment.json`

```json
{ "name": "demo", "description": "Seven accounts, two organizations, nine calendar tournaments, two league archives, two running tournaments.", "resetDatabase": true }
```

`demo/accounts.json` — 7 entries, all default password, `emailConfirmed` true except the last:

| email | username | role | emailConfirmed |
| --- | --- | --- | --- |
| `admin@gones.test` | `gones-admin` | `Admin` | true |
| `organizer@gones.test` | `gones-organizer` | `Organizer` | true |
| `organizer2@gones.test` | `gones-organizer-2` | `Organizer` | true |
| `test@gones.test` | `gones-test` | `User` | true |
| `player1@gones.test` | `gones-player-1` | `User` | true |
| `player2@gones.test` | `gones-player-2` | `User` | true |
| `unverified@gones.test` | `gones-unverified` | `User` | **false** |

`demo/formats.json` — `[{ "key": string, "name": string, "slug": string, "sortOrder": number }]`, 4 entries:
`legacy` / "Legacy" / `legacy` / 10, `modern` / "Modern" / `modern` / 20, `pauper` / "Pauper" / `pauper` / 30, `commander` / "Commander" / `commander` / 40.

`demo/organizations.json` — `[{ "key": string, "name": string, "description": string, "website": string, "contactEmail": string, "ownerEmail": string }]`, 2 entries:

- `key: "gones-lyon"`, name `"Gones Lyon"`, owner `organizer@gones.test`.
- `key: "aura-league"`, name `"Ligue AURA"`, owner `organizer2@gones.test`.

`demo/tournaments.json` — `[{ key, organizationKey, organizerEmail, title, summary, bodyHtml, streetAddress, postalCode, city, country, timeZoneId, startsAtLocalOffsetDays, startsAtLocalTime, endsAtLocalOffsetDays, endsAtLocalTime, capacity, formatKeys }]`.

- Dates are **relative**, never absolute, so the dataset never rots: `startsAtLocalOffsetDays` is a signed integer added to today's date in the seeder; the wire value sent to the API is `YYYY-MM-DDTHH:mm` built from that.
- 9 entries: offsets `-90, -45, -21, -7, 0, +3, +10, +24, +60`. Give the `0` entry `startsAtLocalTime: "09:00"` and `endsAtLocalOffsetDays: 0`, `endsAtLocalTime: "19:00"` so it renders as ongoing for most of the day.
- Split ownership: 5 to `gones-lyon`, 4 to `aura-league`. Vary `city` across Lyon, Villeurbanne, Saint-Étienne, Grenoble. `timeZoneId` `"Europe/Paris"` everywhere. `capacity` between 16 and 64, one entry `null`.

`demo/registrations.json` — `[{ "tournamentKey": string, "userEmail": string }]`, 12 entries. Only future or today tournaments (offsets `0, +3, +10, +24, +60`) and only verified `User` accounts (`test@`, `player1@`, `player2@`). Include a tournament with 3 registrants so the organizer participant screen has content.

## Seeder implementation (exact)

Fill the four hooks in `scripts/seed-dev-environment.mjs`:

```js
async function seedFormats(environment, tokens)        // -> Map<formatKey, formatId>
async function seedOrganizations(environment, tokens)  // -> Map<organizationKey, organizationId>
async function seedTournaments(environment, tokens, organizationIds, formatIds) // -> Map<tournamentKey, { id, slug }>
async function seedRegistrations(environment, tokens, tournamentIds) // -> void
```

- `tokens` is a `Map<email, accessToken>` built once after account seeding by calling `loginToken(email, password)` for every fixture account whose `emailConfirmed` is `true`. Build it in a new `async function loginAll(environment)` and pass it down.
- `seedFormats`: `GET /api/formats`; match by `slug`; create missing ones with the Admin token; return the key→id map.
- `seedOrganizations`: resolve `ownerEmail` → `userId` through `GET /api/admin/users` (Admin token, match on `email` case-insensitively); `POST /api/admin/organizations`; return the key→id map.
- `seedTournaments`: for each entry, build `payload`:
  ```js
  {
    organizationId: organizationIds.get(entry.organizationKey),
    title: entry.title,
    summary: entry.summary,
    bodyHtml: entry.bodyHtml,
    streetAddress: entry.streetAddress,
    postalCode: entry.postalCode,
    city: entry.city,
    country: entry.country,
    timeZoneId: entry.timeZoneId,
    startsAtLocal: localDateTime(entry.startsAtLocalOffsetDays, entry.startsAtLocalTime),
    endsAtLocal: localDateTime(entry.endsAtLocalOffsetDays, entry.endsAtLocalTime),
    capacity: entry.capacity,
    formatIds: entry.formatKeys.map((key) => formatIds.get(key))
  }
  ```
  then `POST /api/tournaments/preview` with the organizer token → take `previewTicket` → `POST /api/tournaments` with `{ previewTicket, payload }`. Store `{ id, slug }` from the 201 body under `entry.key`.
- `localDateTime(offsetDays, time)`: new exported helper in `scripts/dev-environments.mjs`:
  ```js
  export function localDateTime(offsetDays, time, today = new Date()) // -> 'YYYY-MM-DDTHH:mm'
  ```
  Uses local calendar arithmetic (`new Date(today.getFullYear(), today.getMonth(), today.getDate() + offsetDays)`), zero-pads, appends `T${time}`.
- `seedRegistrations`: `POST /api/tournaments/{id}/registrations` with the registrant's token. Tolerate `409` (already registered) so a re-run is idempotent.
- Any non-2xx that is not a tolerated `409` → print `Seeding <step> failed for <key>: <status> <body>` and `process.exit(1)`.
- Extend the printed summary with `9 tournaments, 12 registrations` style counts.

## Validation rules added to `validateEnvironment`

- every `organizations[].ownerEmail` matches some `accounts[].email` → else `"<name>: organization <key> owner <email> is not a seeded account"`.
- every `tournaments[].organizationKey` matches some `organizations[].key` → else `"<name>: tournament <key> references unknown organization <organizationKey>"`.
- every `tournaments[].formatKeys[]` matches some `formats[].key` → else `"<name>: tournament <key> references unknown format <formatKey>"`.
- every `tournaments[].organizerEmail` is an account whose `role` is `Organizer` or `Admin` → else `"<name>: tournament <key> organizer <email> is not an Organizer"`.
- every `registrations[].tournamentKey` matches some `tournaments[].key`, and every `registrations[].userEmail` is an account with `emailConfirmed !== false` → else `"<name>: registration <tournamentKey>/<userEmail> is not seedable"`.
- keys are unique inside each list.

## TDD

1. **Red** — add the four tests below to `ops/dev-environments.test.ts` and create the `demo` fixture files. Tests fail because `validateEnvironment` has no cross-reference rules yet.
2. **Green** — add the rules to `validateEnvironment`; then implement the seeder hooks.
3. **Refactor** — only if needed. Keep green.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `the demo environment validates` | `validateEnvironment(readEnvironment('demo'))` | `[]` |
| `the demo environment covers every role and an unverified account` | `readEnvironment('demo').accounts` | roles set `{User, Organizer, Admin}`; exactly one entry with `emailConfirmed === false`; length `7` |
| `the demo calendar spans past, today and future` | `readEnvironment('demo').tournaments.map(t => t.startsAtLocalOffsetDays)` | contains at least one negative, exactly one `0`, and at least three positive; length `9` |
| `a dangling cross-reference is reported` | hand-built environment whose one tournament names `organizationKey: 'nope'` | returned array contains `'demo-broken: tournament t1 references unknown organization nope'` |
| `localDateTime builds a wire-shaped local timestamp` | `localDateTime(1, '09:00', new Date(2026, 0, 31))` | `'2026-02-01T09:00'` |

Run: `npx vitest run ops/dev-environments.test.ts`

## Impl steps

- [ ] 1. Create `fixtures/dev-environments/demo/environment.json` with `resetDatabase: true`.
- [ ] 2. Create `fixtures/dev-environments/demo/accounts.json` with the 7 rows in the table above.
- [ ] 3. Create `fixtures/dev-environments/demo/formats.json` with the 4 formats.
- [ ] 4. Create `fixtures/dev-environments/demo/organizations.json` with the 2 organizations.
- [ ] 5. Create `fixtures/dev-environments/demo/tournaments.json` with the 9 tournaments and the offsets `-90, -45, -21, -7, 0, +3, +10, +24, +60`.
- [ ] 6. Create `fixtures/dev-environments/demo/registrations.json` with 12 rows, one tournament carrying 3 registrants.
- [ ] 7. Add the five tests above to `ops/dev-environments.test.ts`. Confirm red.
- [ ] 8. Add `localDateTime` to `scripts/dev-environments.mjs` and export it.
- [ ] 9. Add the six cross-reference rules to `validateEnvironment`.
- [ ] 10. Re-run `npx vitest run ops/dev-environments.test.ts` — green.
- [ ] 11. Add `loginAll(environment)` to `scripts/seed-dev-environment.mjs` and call it after account seeding.
- [ ] 12. Implement `seedFormats`, then `seedOrganizations`, then `seedTournaments`, then `seedRegistrations`.
- [ ] 13. Extend the printed summary with the seeded counts.
- [ ] 14. Document the `demo` environment and every fixture field in `fixtures/dev-environments/README.md`.
- [ ] 15. Run `npm run test && npm run lint && npm run typecheck && npm run build`.
- [ ] 16. Manual: `npm run dev -- --env=demo`; `/calendar` shows tournaments in past, current and future months; sign in as `organizer@gones.test` and open `/organizer/tournaments`; open the participants screen of the 3-registrant tournament.

## Outputs

- Files added: `fixtures/dev-environments/demo/{environment,accounts,formats,organizations,tournaments,registrations}.json`.
- Files edited: `scripts/dev-environments.mjs` (`localDateTime`, cross-reference rules), `scripts/seed-dev-environment.mjs` (four hooks + `loginAll` + summary), `ops/dev-environments.test.ts`, `fixtures/dev-environments/README.md`.
- Behaviour change: `--env=demo` now seeds a populated Calendar. No app-code change.
- Migration/config: none.

## Validation

- [ ] `npx vitest run ops/dev-environments.test.ts` passes.
- [ ] `npm run test` passes.
- [ ] `npm run lint` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.
- [ ] `node scripts/seed-dev-environment.mjs --env=demo` exits 0 and prints seeded counts.
- [ ] Re-running the same command exits 0 again (registrations tolerate `409`).
- [ ] Manual: anonymous `/calendar` shows the 9 tournaments across months; the offset-`0` one reads ongoing.
- [ ] Manual: `organizer@gones.test` sees its 5 tournaments in `/organizer/tournaments`; `test@gones.test` sees its registrations in `/registrations`.
- [ ] App functional — no broken path from this slice.
- [ ] Commit msg draft: `feat(dev): seed the demo environment calendar from fixture files`
