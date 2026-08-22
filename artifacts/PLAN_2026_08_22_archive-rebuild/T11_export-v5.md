# T11: Export bundle v5 and the import gate

**Plan:** `./artifacts/PLAN_2026_08_22_archive-rebuild.md`
**Depends:** T10
**Commit outcome:** Export writes four flat collections at version 5; v1–v4 bundles are refused with a clear message

## Context (self-contained)

- Goal: rebuild the Gones Archive on three tiers — **League → LeagueSeason → Tournament**. A
  Tournament becomes a first-class top-level record that may stand alone (`seasonId: null`).
  Today's flat `League` becomes `LeagueSeason`; a new `League` tier groups Seasons.
- This slice: the **serialization boundary** of that rebuild. It defines the v5 export bundle — four
  flat collections, no nesting — and the import gate that refuses every v1–v4 bundle. It writes no
  component, no route, no HTTP call and no persistence: it produces a pure schema module, a pure
  parse/validate service, a golden fixture set, and one new i18n message in both languages.
- Out of scope here (**fence — do not touch**):
  - Do **not** modify `src/app/domain/models.ts`. Its `GONES_DATA_VERSION = 4`,
    `SUPPORTED_IMPORT_DATA_VERSIONS = [1, 2, 3, 4]`, `LeagueDocument`, `TournamentDocument` and
    `PLACEHOLDER_LEAGUE_ID` stay exactly as they are until T17.
  - Do **not** modify `src/app/data/league-archive-import.service.ts`. The legacy import service keeps
    working until T17.
  - Do **not** modify `src/app/domain/export-schemas.ts`. This ticket **imports** four
    version-agnostic helpers from it and changes none of them.
  - Do **not** delete or edit `fixtures/league-domain/v1/`. T17 retires it.
  - **No components, no routes.** Do not touch `src/app/app.component.ts`, `src/app/app.routes.ts`,
    `src/app/features/**`, `cypress/**`, or anything under `backend/`.
  - Do not create `src/app/domain/archive-models.ts` — T10 already created it. Do not create
    `src/app/data/archive-repository.service.ts` — that is T12.
- Assumptions in force:
  - **Gones is unreleased. There is no production environment and there are no users.** No user holds
    a v1–v4 bundle that needs importing. This is the whole reason the door can be closed.
  - **ADR 0022 deliberately froze the export wire names, and this plan deliberately unfreezes them.**
    `docs/adr/0022-rename-the-archived-league-feature.md`, section "Two things are deliberately
    **not** renamed", item 1, reads verbatim:

    > **The export bundle format.** `kind: "league"`, `kind: "fullData"` and every JSON field name in
    > `src/app/domain/models.ts` and `export-schemas.ts` stay exactly as they are. ADR 0020 left one
    > door open — the import CLI applies bundles exported before it — and a wire-format rename would
    > slam it. The golden fixtures under `fixtures/league-domain/v1/` are unchanged, byte for byte.

    That freeze existed to keep the v1 import door open. **This plan closes that door on purpose.**
    There is **no converter and none is planned**. A v1–v4 file is refused, permanently, with a
    message that says so.
  - The legacy v1–v4 artifacts are *not* shaped like a v5 bundle. A v1–v4 file carries
    `kind: 'league' | 'fullData'` and `gonesDataVersion: 1|2|3|4` (see
    `src/app/domain/export-restore.ts:57-77`), or the pre-Angular shape `{ version: 1, league: {...} }`
    (`export-restore.ts:72-74`). A v5 bundle carries `version: 5` and four flat collections. The gate
    must recognise **all three** legacy shapes, not only a numeric `version` of 1–4.
  - `src/app/domain/export-schemas.ts` is **not** on the T17 deletion list, which covers
    `src/app/features/leagues-archive/**`, `src/app/features/tournaments-archive/**`,
    `src/app/data/league-archive-*.ts`, `src/app/backend/local-league-archive-backend.service.ts`,
    the archive half of `src/app/domain/models.ts`, and the backend `Leagues` endpoint/aggregate
    files. So importing its version-agnostic helpers is safe across T17.
  - TypeScript is `strict` with `noPropertyAccessFromIndexSignature: true`
    (`tsconfig.json:8-9`). Reading an unknown payload **must** use bracket access —
    `value['version']`, never `value.version`.

## Requirements

1. A new pure module `src/app/domain/archive-export-schemas.ts` publishes the v5 wire contract: the
   closed JSON Schema, the collection limits, the bundle builder, the checksum pair, the legacy
   detector, and the strict parser.
2. The bundle is exactly four flat collections plus a version, per contract section 11:
   `{ version: 5, leagues, leagueSeasons, tournaments, calendarEvents }`. No nesting: a
   `LeagueSeason` does not carry its Tournaments, a `League` does not carry its Seasons.
3. `SUPPORTED_ARCHIVE_IMPORT_VERSIONS` is exactly `[5]`, re-exported from this module so the
   serialization boundary has one import site.
4. A **standalone** Tournament (`seasonId: null`) survives export and import as a first-class row.
5. **Round trip is exact.** A bundle built by `buildArchiveBundle`, serialized, then read back by
   `ArchiveImportService.readBundle` reproduces the same `leagues`, `leagueSeasons` and `tournaments`
   — same ids, same field values, standalone `seasonId: null` included. No id remapping, no renaming,
   no trimming.
6. An export **never** leaks persistence metadata: `documentVersion`, `updatedAt` and `eTag` must not
   appear anywhere in the artifact, even when the caller passes `PersistedArchiveLeague`,
   `PersistedLeagueSeason` or `PersistedArchiveTournament` values.
7. A new service `src/app/data/archive-import.service.ts` reads a `File`, enforces the byte cap,
   verifies the checksum when one is present, and runs the gate. It **persists nothing**: it returns
   the validated bundle. Writing is T12's `ArchiveRepository`.
8. Every v1–v4 bundle — `kind: 'league'`, `kind: 'fullData'`, the pre-Angular `{version:1,league}`
   shape, and any numeric `version` in 1–4 — is refused with the error message
   `legacyArchiveBundleVersion`.
9. `src/app/i18n/messages.ts` gains **one** new key, `msg.importLegacyBundleUnsupported`, in **both**
   the English block and the French block. The file is 2497 lines, English first
   (`const en = {` at line 5), French second (`const fr: Record<MessageKey, string> = {` at line
   1255). The neighbouring import/export messages are `msg.importUnsupported` at line 339 (EN) and
   line 1584 (FR); the new key goes immediately after each.
10. A golden fixture set is created at `fixtures/archive-domain/v5/`, generated and asserted
    byte-for-byte by the schema test, mirroring the existing generator idiom in
    `src/app/domain/league-parity-fixtures.test.ts`. `fixtures/league-domain/v1/` is left untouched.
11. `npm run test`, `npm run typecheck` and `npm run lint` stay green; the app still compiles and
    runs, because nothing existing is modified except two added i18n lines.

## Inputs

Read these before writing code. Line numbers are as of this ticket.

- `src/app/domain/export-schemas.ts` — the existing validation idiom this ticket mirrors.
  - `EXPORT_LIMITS` at lines 30-44: `maxImportFileBytes: 2 * 1024 * 1024`,
    `maxFullDataLeagues: 100`, `maxCalendarEvents: 500`.
  - `ExportJsonSchema` interface, lines 46-53; `kindTaggedSchema`, lines 57-72;
    `EXPORT_JSON_SCHEMAS` map, lines 95-107 (`$id: 'https://gones.app/schemas/export-v${n}.json'`,
    `additionalProperties: false` only on v4).
  - `assertNoDeniedFields(value: unknown): void`, lines 110-120 — throws
    `` new Error(`deniedExportField:${key}`) `` on the first denylisted key.
  - `canonicalJsonStringify(value: unknown): string`, lines 123-125 — deterministic, recursively
    sorted keys, drops `undefined`.
  - `sha256Hex(text: string): Promise<string>`, lines 137-140.
  - `attachExportChecksum` / `verifyExportChecksum`, lines 149-163 — note
    `verifyExportChecksum` returns `true` when `checksum` is absent. v5 keeps that semantic.
  - `PUBLIC_EXPORT_V4_CALENDAR_EVENT_FIELDS`, lines 14-16 — the 13 public calendar fields.
- `src/app/data/league-archive-import.service.ts` — the existing import idiom (whole file, 60 lines):
  `if (file.size > MAX_IMPORT_FILE_BYTES) throw new Error('gonesImportFileTooLarge');`, then
  `JSON.parse(await file.text())`, then `verifyExportChecksum`, then version gate. **Read, do not
  edit.**
- `src/app/data/league-archive-import.service.test.ts` — the test harness idiom, in particular the
  `File` double at lines 108-112:
  ```ts
  /** `importFile` only reads `size` and `text()`; jsdom's `File` is not needed to exercise it. */
  async function bundleFile(file: object): Promise<File> {
    const text = JSON.stringify(await attachExportChecksum(file));
    return { size: text.length, text: async () => text } as unknown as File;
  }
  ```
- `src/app/domain/export-restore.ts:57-81` — `normalizeExportFile` and `assertSupportedVersion`: the
  exact legacy shapes the gate must recognise.
- `src/app/domain/league-parity-fixtures.test.ts` — the golden-fixture generator idiom:
  `resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/league-domain/v1')` at line 24,
  `stableJson` (`JSON.stringify(value, null, 2) + '\n'`) at lines 182-184, and the
  `process.env['UPDATE_LEAGUE_PARITY_FIXTURES'] === '1'` write-then-assert block at lines 218-228.
- `fixtures/league-domain/v1/manifest.json` — the golden manifest layout
  (`fixtureSet`, `fixtureVersion`, `source`, `serialization`, `paritySha256`, `caseCounts`).
- `src/app/domain/models.ts:36-96` — the shapes re-exported through `archive-models.ts`:
  `CalendarEventDocument` (13 string fields), `PlayerArchetypeDocument`, `RoundDocument`,
  `RoundEntry = MatchRoundEntry | ByeRoundEntry | InvalidRoundEntry`. **Read, do not edit.**
- `src/app/i18n/messages.ts:337-342` (EN import/export messages) and `:1582-1587` (their FR twins).
  `MessageKey = keyof typeof en` is declared at line 1253, so a key added to `en` but not to `fr`
  fails `npm run typecheck`, and `src/app/i18n/message-namespace.test.ts` also asserts
  `Object.keys(en).sort()` equals `Object.keys(fr).sort()`.
- `docs/adr/0022-rename-the-archived-league-feature.md:29-33` — the freeze this ticket lifts.
- `vitest.config.ts` — `environment: 'jsdom'`, `include: ['src/**/*.test.ts', 'ops/**/*.test.ts']`,
  `globals: true`. Tests may use `node:fs` and `node:crypto`; `league-parity-fixtures.test.ts`
  already does.

**From Depends (T10) — already on disk, consume verbatim, do not redeclare:**

`src/app/domain/archive-models.ts` exports these symbols. This ticket imports them and defines none
of them:

```ts
export const ARCHIVE_DATA_VERSION = 5;
export const SUPPORTED_ARCHIVE_IMPORT_VERSIONS = [5] as const;

export type LeagueStatus = 'active' | 'completed';

export interface ArchiveLeagueDocument {
  id: string;
  name: string;
  createdAt: string;   // ISO 8601 UTC
}

export interface PersistedArchiveLeague extends ArchiveLeagueDocument {
  documentVersion: number;
  updatedAt: string;
  eTag?: string;
}

export interface LeagueSeasonDocument {
  id: string;
  name: string;
  leagueId: string;    // mandatory — a Season always belongs to a League
  status: LeagueStatus;
}

export interface PersistedLeagueSeason extends LeagueSeasonDocument {
  documentVersion: number;
  updatedAt: string;
  eTag?: string;
}

export interface ArchiveTournamentDocument {
  id: string;
  name: string;
  seasonId: string | null;   // null ⇒ standalone; there is NO leagueId on a Tournament
  tournamentDate: string;    // ISO 8601 date, `YYYY-MM-DD`
  status: LeagueStatus;
  rounds: RoundDocument[];
  playerArchetypes: PlayerArchetypeDocument[];
}

export interface PersistedArchiveTournament extends ArchiveTournamentDocument {
  documentVersion: number;
  updatedAt: string;
  eTag?: string;
}

export interface ArchiveBundle {
  version: typeof ARCHIVE_DATA_VERSION;
  leagues: ArchiveLeagueDocument[];
  leagueSeasons: LeagueSeasonDocument[];
  tournaments: ArchiveTournamentDocument[];
  calendarEvents: CalendarEventDocument[];
}

// re-exported by archive-models.ts from ./models, never duplicated
export type {
  LeagueStatus, RoundDocument, RoundEntry, MatchRoundEntry, ByeRoundEntry,
  InvalidRoundEntry, PlayerArchetypeDocument, CalendarEventDocument
} from './models';
```

If any of those symbols is missing, T10 is incomplete: **stop and report blocked**. Do not declare a
local copy — a second declaration of `ARCHIVE_DATA_VERSION` or `ArchiveBundle` would give the
codebase two sources of truth for the wire version, which is exactly what this contract forbids.

## Interface contract (level 5)

### Produces — `src/app/domain/archive-export-schemas.ts`

```ts
import {
  ARCHIVE_DATA_VERSION,
  SUPPORTED_ARCHIVE_IMPORT_VERSIONS
} from './archive-models';
import type {
  ArchiveBundle,
  ArchiveLeagueDocument,
  ArchiveTournamentDocument,
  CalendarEventDocument,
  LeagueSeasonDocument,
  PlayerArchetypeDocument,
  RoundDocument
} from './archive-models';

/** Re-exported so the serialization boundary has exactly one import site. */
export { ARCHIVE_DATA_VERSION, SUPPORTED_ARCHIVE_IMPORT_VERSIONS } from './archive-models';
export type { ArchiveBundle } from './archive-models';

export type SupportedArchiveImportVersion = (typeof SUPPORTED_ARCHIVE_IMPORT_VERSIONS)[number];

/** The on-disk artifact: an `ArchiveBundle` plus the optional integrity checksum. */
export interface ArchiveExportFile extends ArchiveBundle {
  checksum?: string;
}

/** Sizes and counts accepted by the v5 browser import path. */
export const ARCHIVE_EXPORT_LIMITS: {
  readonly maxImportFileBytes: number;
  readonly maxLeagues: number;
  readonly maxLeagueSeasons: number;
  readonly maxTournaments: number;
  readonly maxCalendarEvents: number;
};

/** Exactly the fields a v5 artifact may carry per collection. Nothing else is written or accepted. */
export const ARCHIVE_EXPORT_V5_LEAGUE_FIELDS: readonly ['id', 'name', 'createdAt'];
export const ARCHIVE_EXPORT_V5_LEAGUE_SEASON_FIELDS: readonly ['id', 'name', 'leagueId', 'status'];
export const ARCHIVE_EXPORT_V5_TOURNAMENT_FIELDS: readonly ['id', 'name', 'seasonId', 'tournamentDate', 'status', 'rounds', 'playerArchetypes'];
export const ARCHIVE_EXPORT_V5_CALENDAR_EVENT_FIELDS: readonly ['id', 'slug', 'title', 'eventDate', 'startTime', 'endTime', 'location', 'country', 'city', 'address', 'description', 'richDescriptionHtml', 'externalLink'];

/** Published JSON Schema for the v5 artifact. Closed: `additionalProperties: false` at every level. */
export const ARCHIVE_EXPORT_JSON_SCHEMA: {
  $id: 'https://gones.app/schemas/archive-export-v5.json';
  type: 'object';
  additionalProperties: false;
  required: readonly ['version', 'leagues', 'leagueSeasons', 'tournaments', 'calendarEvents'];
  properties: Record<string, unknown>;
};

/**
 * Builds the artifact from documents. Picks field by field, so persistence metadata
 * (`documentVersion`, `updatedAt`, `eTag`) can never leak. Every collection is sorted by `id`
 * ascending, so the same data always produces the same bytes and the same checksum.
 */
export function buildArchiveBundle(source: {
  leagues: readonly ArchiveLeagueDocument[];
  leagueSeasons: readonly LeagueSeasonDocument[];
  tournaments: readonly ArchiveTournamentDocument[];
  calendarEvents?: readonly CalendarEventDocument[];
}): ArchiveBundle;

/** `2026-08-22 Gones Archive.json` */
export function archiveBundleFilename(now?: Date): string;

/** Adds `checksum: 'sha256:<64 hex>'` over the canonical JSON of the bundle (checksum excluded). */
export function attachArchiveChecksum(bundle: ArchiveBundle): Promise<ArchiveExportFile>;

/** True when the artifact carries no checksum, or carries one that matches its content. */
export function verifyArchiveChecksum(file: unknown): Promise<boolean>;

/**
 * True for a v1–v4 Gones Export in any of its three historical shapes:
 *  - `kind` is `'league'` or `'fullData'`      (v1–v4 tagged shape, `export-restore.ts:60,65`)
 *  - `version === 1` and a `league` key exists (pre-Angular shape, `export-restore.ts:73`)
 *  - `version` is a number in 1..4
 */
export function isLegacyGonesExport(value: unknown): boolean;

/** Throws `legacyArchiveBundleVersion` for a v1–v4 artifact, `unsupportedArchiveBundle` otherwise. */
export function assertSupportedArchiveBundleVersion(value: unknown): void;

/**
 * Strict, non-coercing validation. Returns a deep clone; ids and values pass through verbatim so
 * export → import is an identity on `leagues`, `leagueSeasons` and `tournaments`.
 */
export function parseArchiveBundle(value: unknown): ArchiveBundle;
```

### Produces — `src/app/data/archive-import.service.ts`

```ts
import { Injectable } from '@angular/core';
import type { ArchiveBundle } from '../domain/archive-models';

export interface ArchiveImportResult {
  bundle: ArchiveBundle;
  leagueCount: number;
  leagueSeasonCount: number;
  tournamentCount: number;
  calendarEventCount: number;
}

/**
 * The v5 import gate. Parses, verifies and validates; it writes nothing and injects nothing, so it
 * cannot pick a destination store. Persisting the returned bundle is `ArchiveRepository`'s job.
 */
@Injectable({ providedIn: 'root' })
export class ArchiveImportService {
  readBundle(file: File): Promise<ArchiveImportResult>;
}
```

### Produces — `src/app/i18n/messages.ts`, one key in each of the two blocks

```ts
// English block, immediately after `'msg.importUnsupported'` (line 339)
'msg.importLegacyBundleUnsupported': 'That file is a Gones Export from an older data version (1 to 4). Only version 5 archive bundles can be imported, and there is no converter.',
```

```ts
// French block, immediately after `'msg.importUnsupported'` (line 1584)
'msg.importLegacyBundleUnsupported': 'Ce fichier est un export Gones d’une version de données antérieure (1 à 4). Seuls les paquets d’archive en version 5 peuvent être importés, et il n’existe aucun convertisseur.',
```

### Produces — the v5 artifact on the wire (contract section 11, verbatim)

```json
{
  "version": 5,
  "leagues": [ { "id": "...", "name": "...", "createdAt": "..." } ],
  "leagueSeasons": [ { "id": "...", "name": "...", "leagueId": "...", "status": "completed" } ],
  "tournaments": [ { "id": "...", "name": "...", "seasonId": null, "tournamentDate": "2026-08-17",
                     "status": "completed", "rounds": [], "playerArchetypes": [] } ],
  "calendarEvents": []
}
```

`checksum` is an **optional** fifth top-level key. The shape printed above, with no checksum, is
valid input and must parse.

### Produces — `fixtures/archive-domain/v5/`

| File | Content |
| --- | --- |
| `manifest.json` | fixture-set metadata + `bundleSha256` over `bundle.json`'s exact bytes |
| `bundle.json` | the golden v5 artifact: 2 Leagues, 3 LeagueSeasons, 4 Tournaments (one standalone), 1 CalendarEvent, with `checksum` |
| `legacy-v1.json` | pre-Angular refused input: `{ "version": 1, "exportedAt": "...", "league": {...} }` |
| `legacy-v4.json` | v4 refused input: `{ "kind": "fullData", "gonesDataVersion": 4, ... }` |

`manifest.json` shape, exact:

```json
{
  "fixtureSet": "gones-archive-export-parity",
  "fixtureVersion": 5,
  "source": {
    "language": "TypeScript",
    "exporter": "src/app/domain/archive-export-schemas.test.ts",
    "sourceFiles": [
      "src/app/domain/archive-models.ts",
      "src/app/domain/archive-export-schemas.ts",
      "src/app/data/archive-import.service.ts"
    ],
    "archiveDataVersion": 5
  },
  "serialization": "JSON.stringify(value, null, 2) + LF",
  "bundleSha256": "<64 hex>",
  "caseCounts": {
    "leagues": 2,
    "leagueSeasons": 3,
    "tournaments": 4,
    "standaloneTournaments": 1,
    "calendarEvents": 1,
    "refusedBundles": 2
  }
}
```

### Consumes

- `src/app/domain/archive-models.ts` (T10) — every symbol quoted verbatim under **From Depends**.
- `src/app/domain/export-schemas.ts` — four version-agnostic helpers, imported unchanged:
  `assertNoDeniedFields`, `canonicalJsonStringify`, `sha256Hex`, `EXPORT_LIMITS`.

### Errors — exact string per failure path

Every failure throws `Error` whose `message` is exactly the string below. The strings are
browser-local error identifiers, not wire codes, matching the existing
`gonesImportFileTooLarge` / `unsupportedGonesExport` vocabulary in
`league-archive-import.service.ts:24-34`.

| Thrown by | `error.message` | Raised when | Intended i18n key |
| --- | --- | --- | --- |
| `ArchiveImportService.readBundle` | `gonesImportFileTooLarge` | `file.size > ARCHIVE_EXPORT_LIMITS.maxImportFileBytes` | `msg.importTooLarge` *(exists)* |
| `JSON.parse` (uncaught, propagates) | *(native `SyntaxError`)* | file text is not JSON | `msg.importBadJson` *(exists)* |
| `ArchiveImportService.readBundle` | `gonesExportChecksumMismatch` | `checksum` present and does not match | `msg.importChecksumMismatch` *(exists)* |
| `assertSupportedArchiveBundleVersion` / `parseArchiveBundle` | `legacyArchiveBundleVersion` | the artifact is a v1–v4 Gones Export in any of its three shapes | **`msg.importLegacyBundleUnsupported` (NEW, this ticket)** |
| `assertSupportedArchiveBundleVersion` / `parseArchiveBundle` | `unsupportedArchiveBundle` | not an object, `version` absent, `version` not in `SUPPORTED_ARCHIVE_IMPORT_VERSIONS`, an unknown top-level key, a missing/ non-array collection, or a malformed row | `msg.importUnsupported` *(exists)* |
| `parseArchiveBundle` | `gonesImportTooManyRecords` | any collection exceeds its `ARCHIVE_EXPORT_LIMITS` cap | `msg.importTooManyLeagues` *(exists)* |
| `assertNoDeniedFields` | `` deniedExportField:${key} `` | a denylisted key (`email`, `password`, `token`, …) appears anywhere in the payload | `msg.importFailed` *(exists)* |

**Wiring the classifier is out of scope.** `importErrorMessage` in `src/app/app.component.ts:434-447`
maps the legacy strings today; this ticket adds only the message key. A later ticket wires it.

### Invariants

1. `ARCHIVE_DATA_VERSION === 5` and `SUPPORTED_ARCHIVE_IMPORT_VERSIONS` deep-equals `[5]`. No other
   version is ever accepted; there is **no converter and none is planned**.
2. `parseArchiveBundle` is **strict, not coercing**. It never trims, never lowercases, never
   defaults a missing field. A row that does not match is a refusal, not a repair.
3. **Round trip is an identity.** For any `b = buildArchiveBundle(...)`,
   `parseArchiveBundle(JSON.parse(JSON.stringify(await attachArchiveChecksum(b))))` deep-equals `b`.
   Ids are preserved verbatim — there is no id remapping and no `(restored)` name suffixing at this
   layer, unlike the legacy `restoreLeague` path in `export-restore.ts:88-97`.
4. `seasonId` is `string | null` and is the **only** parent reference on a Tournament. There is no
   `leagueId` on a Tournament; the League is derived by joining through `seasonId`. `null` is a
   valid, first-class value meaning *standalone*, and `undefined` is refused.
5. **No nesting.** A `leagueSeasons` row carries no `tournaments` key; a `leagues` row carries
   neither `leagueSeasons` nor `tournaments`. The closed schema enforces this: any extra key is
   `unsupportedArchiveBundle`.
6. **No persistence metadata in the artifact.** `documentVersion`, `updatedAt` and `eTag` never
   appear, at any depth, in a bundle produced by `buildArchiveBundle`.
7. **Deterministic bytes.** `buildArchiveBundle` sorts `leagues`, `leagueSeasons`, `tournaments` and
   `calendarEvents` by `id` ascending (`<`/`>` string comparison, matching `sortKeysDeep` in
   `export-schemas.ts:127-135`). The same data yields the same JSON and the same checksum whatever
   the caller's query order was.
8. **Checksum is optional on read, always written on export.** `verifyArchiveChecksum` returns `true`
   for an artifact with no `checksum`, matching `verifyExportChecksum`
   (`export-schemas.ts:158-163`), so the contract-section-11 shape parses.
9. **Legacy detection precedes version comparison.** `{ version: 5, kind: 'fullData' }` is refused as
   `legacyArchiveBundleVersion`, not accepted: a `kind` tag is proof of a legacy artifact.
10. **Row validation depth is bounded and stated.** `rounds` is validated as an array whose every
    element is `{ id: string, entries: array }`, and every entry as an object whose `kind` is
    `'match' | 'bye' | 'invalid'` and whose `id` is a string. Field-level round-entry validation is
    the domain normalizer's job, not the wire gate's. Contents below that depth pass through
    unchanged, which is what makes invariant 3 hold.
11. `ArchiveImportService` has **no constructor parameters** and touches no store. It cannot choose a
    destination and must not try to.
12. `fixtures/league-domain/v1/` is byte-for-byte unchanged. It is still read by
    `backend/tests/Gones.UnitTests/LeagueParityTests.cs:172` and
    `backend/tests/Gones.IntegrationTests/LeagueArchiveRouteTests.cs:183`; deleting it now would
    break `npm run backend:test`. T17 retires it.

## TDD

1. **Red** — write `src/app/domain/archive-export-schemas.test.ts` first, with every test named in
   the Test plan below. Run `npx vitest run src/app/domain/archive-export-schemas.test.ts` and see it
   fail on the missing module. Then write `src/app/data/archive-import.service.test.ts` and see it
   fail the same way.
2. **Green** — write `archive-export-schemas.ts`, generate the fixtures, add the two i18n lines, then
   write `archive-import.service.ts`. Each test asserts behaviour through the public functions only —
   never a private helper, never an internal call count.
3. **Refactor** — only if a helper is duplicated between the two modules. Keep green. Do not extract
   anything into `export-schemas.ts`.

## Test plan

### `src/app/domain/archive-export-schemas.test.ts`

Run: `npx vitest run src/app/domain/archive-export-schemas.test.ts`

| Test | Input | Expect |
| ---- | ----- | ------ |
| `pins the archive data version to 5 and the import allowlist to [5]` | — | `ARCHIVE_DATA_VERSION` is `5`; `[...SUPPORTED_ARCHIVE_IMPORT_VERSIONS]` equals `[5]` |
| `builds four flat collections and nothing else` | `buildArchiveBundle` over the golden document | `Object.keys(bundle).sort()` equals `['calendarEvents', 'leagueSeasons', 'leagues', 'tournaments', 'version']` |
| `stores no Tournaments inside a LeagueSeason and no Seasons inside a League` | the golden bundle | every `leagues` row's keys equal `['id','name','createdAt']` sorted; every `leagueSeasons` row's keys equal `['id','leagueId','name','status']` sorted |
| `keeps a standalone Tournament as a top-level row with seasonId null` | the golden bundle | `bundle.tournaments.filter(t => t.seasonId === null)` has length `1` and its `id` is `'tournament-4'` |
| `never writes documentVersion, updatedAt or eTag` | `buildArchiveBundle` fed `PersistedArchiveLeague` / `PersistedLeagueSeason` / `PersistedArchiveTournament` values carrying `documentVersion: 9, updatedAt: '2026-01-01T00:00:00.000Z', eTag: 'W/"9"'` | `JSON.stringify(bundle)` contains none of `'documentVersion'`, `'updatedAt'`, `'eTag'` |
| `orders every collection by id ascending` | `buildArchiveBundle` fed each collection reversed | each collection's `id` array equals its own sorted copy |
| `publishes a closed v5 JSON Schema` | `ARCHIVE_EXPORT_JSON_SCHEMA` | `$id` is `'https://gones.app/schemas/archive-export-v5.json'`; `additionalProperties` is `false`; `required` equals `['version','leagues','leagueSeasons','tournaments','calendarEvents']`; `Object.keys(properties).sort()` equals `['calendarEvents','checksum','leagueSeasons','leagues','tournaments','version']` |
| `keeps the schema and the parser agreed on the accepted top-level keys` | for each key of `ARCHIVE_EXPORT_JSON_SCHEMA.properties` | a golden bundle carrying only those keys parses; a golden bundle plus `{ extra: 1 }` throws `unsupportedArchiveBundle` |
| `keeps the v5 calendar event fields identical to the v4 public allowlist` | `ARCHIVE_EXPORT_V5_CALENDAR_EVENT_FIELDS` vs `PUBLIC_EXPORT_V4_CALENDAR_EVENT_FIELDS` imported from `./export-schemas` | the two arrays are equal |
| `round-trips a bundle through serialize and parse unchanged` | `parseArchiveBundle(JSON.parse(JSON.stringify(await attachArchiveChecksum(golden))))` | deep-equals `golden`, including the `seasonId: null` row and every nested round entry |
| `parses the contract shape that carries no checksum` | contract section 11's literal JSON with empty collections | returns `{ version: 5, leagues: [], leagueSeasons: [], tournaments: [], calendarEvents: [] }`-shaped bundle, no throw |
| `refuses a v4 fullData export` | `{ kind: 'fullData', gonesDataVersion: 4, gonesAppVersion: '0.1.0', exportedAt: '2026-01-15T00:00:00.000Z', leagues: [], calendarEvents: [] }` | throws `legacyArchiveBundleVersion` |
| `refuses a v4 single-league export` | `{ kind: 'league', gonesDataVersion: 4, league: { id: 'l', name: 'L', status: 'active', tournaments: [] } }` | throws `legacyArchiveBundleVersion` |
| `refuses the pre-Angular v1 shape` | `{ version: 1, exportedAt: '2024-01-01', league: { id: 'l', name: 'L' } }` | throws `legacyArchiveBundleVersion` |
| `refuses every data version from 1 to 4` | `[1,2,3,4].map(v => ({ version: v, leagues: [], leagueSeasons: [], tournaments: [], calendarEvents: [] }))` | each throws `legacyArchiveBundleVersion` |
| `refuses a kind-tagged artifact even when it claims version 5` | `{ version: 5, kind: 'fullData', leagues: [], leagueSeasons: [], tournaments: [], calendarEvents: [] }` | throws `legacyArchiveBundleVersion` |
| `refuses a version above 5` | `{ version: 6, leagues: [], leagueSeasons: [], tournaments: [], calendarEvents: [] }` | throws `unsupportedArchiveBundle` |
| `refuses a non-object payload` | `null`, `'text'`, `42`, `[]` | each throws `unsupportedArchiveBundle` |
| `refuses a bundle missing a collection` | golden bundle with `leagueSeasons` deleted | throws `unsupportedArchiveBundle` |
| `refuses a Tournament whose seasonId is undefined` | golden bundle, `tournaments[0].seasonId` deleted | throws `unsupportedArchiveBundle` |
| `refuses a Tournament carrying a leagueId` | golden bundle, `tournaments[0].leagueId = 'archive-league-1'` added | throws `unsupportedArchiveBundle` |
| `refuses a LeagueSeason with no leagueId` | golden bundle, `leagueSeasons[0].leagueId` deleted | throws `unsupportedArchiveBundle` |
| `refuses an unknown status` | golden bundle, `leagueSeasons[0].status = 'finished'` | throws `unsupportedArchiveBundle` |
| `refuses more rows than a collection cap allows` | `tournaments` of length `ARCHIVE_EXPORT_LIMITS.maxTournaments + 1` | throws `gonesImportTooManyRecords` |
| `refuses a denylisted field anywhere in the payload` | golden bundle with `tournaments[0].playerArchetypes[0].email = 'a@b.c'` | throws `deniedExportField:email` |
| `verifies the checksum it attaches` | `verifyArchiveChecksum(await attachArchiveChecksum(golden))` | `true` |
| `rejects a tampered artifact` | attach the checksum, then set `leagues[0].name = 'Tampered'` | `verifyArchiveChecksum` returns `false` |
| `accepts an artifact with no checksum` | `verifyArchiveChecksum(golden)` | `true` |
| `names the export file with the ISO date` | `archiveBundleFilename(new Date('2026-08-22T18:00:00.000Z'))` | `'2026-08-22 Gones Archive.json'` |
| `reproduces the frozen v5 golden fixtures byte-for-byte` | regenerate `bundle.json`, `legacy-v1.json`, `legacy-v4.json`, `manifest.json` in memory | each equals `readFileSync(..., 'utf8')` |

### `src/app/data/archive-import.service.test.ts`

Run: `npx vitest run src/app/data/archive-import.service.test.ts`

| Test | Input | Expect |
| ---- | ----- | ------ |
| `reads the golden v5 fixture and reports its four collection counts` | `fixtures/archive-domain/v5/bundle.json` as a `File` double | `{ leagueCount: 2, leagueSeasonCount: 3, tournamentCount: 4, calendarEventCount: 1 }` |
| `preserves ids, standalone seasonId null and round contents` | same file | `result.bundle` deep-equals `parseArchiveBundle(JSON.parse(text))`; `result.bundle.tournaments.map(t => t.id)` equals `['tournament-1','tournament-2','tournament-3','tournament-4']`; the `'tournament-4'` row has `seasonId: null` |
| `round-trips an exported bundle back through the import gate` | `buildArchiveBundle` over documents including a standalone Tournament → `attachArchiveChecksum` → `File` double → `readBundle` | `result.bundle` deep-equals the built bundle |
| `refuses the golden legacy v1 fixture` | `fixtures/archive-domain/v5/legacy-v1.json` | rejects with `legacyArchiveBundleVersion` |
| `refuses the golden legacy v4 fixture` | `fixtures/archive-domain/v5/legacy-v4.json` | rejects with `legacyArchiveBundleVersion` |
| `refuses a file over the byte cap before parsing it` | `{ size: ARCHIVE_EXPORT_LIMITS.maxImportFileBytes + 1, text: spy }` | rejects with `gonesImportFileTooLarge` and the `text` spy was never called |
| `propagates a SyntaxError for a non-JSON file` | `{ size: 5, text: async () => 'not json' }` | rejects with an instance of `SyntaxError` |
| `refuses a tampered checksum` | golden bundle with a valid checksum, then `leagues[0].name` changed | rejects with `gonesExportChecksumMismatch` |
| `accepts an artifact that carries no checksum` | golden bundle with `checksum` deleted | resolves, `leagueCount` is `2` |
| `carries the legacy refusal message in English and in French` | `catalogs.en['msg.importLegacyBundleUnsupported']`, `catalogs.fr[...]` | both are non-empty, differ from each other, and each contains `'5'` |

## Impl steps

- [ ] 1. Confirm the T10 boundary is on disk
  - [ ] 1.1 Run `ls src/app/domain/archive-models.ts` — it must exist.
  - [ ] 1.2 Run `grep -n "ARCHIVE_DATA_VERSION\|SUPPORTED_ARCHIVE_IMPORT_VERSIONS\|interface ArchiveBundle\|interface ArchiveLeagueDocument\|interface LeagueSeasonDocument\|interface ArchiveTournamentDocument" src/app/domain/archive-models.ts` — all six must match. If any is missing, **stop and report blocked: T10 incomplete**. Do not declare a local copy.
  - [ ] 1.3 Run `git status --short` and confirm `fixtures/league-domain/v1/` is untouched; it must stay untouched through this whole ticket.

- [ ] 2. Red — write the schema test file
  - [ ] 2.1 Create `src/app/domain/archive-export-schemas.test.ts` with this header:
    ```ts
    import { createHash } from 'node:crypto';
    import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
    import { dirname, resolve } from 'node:path';
    import { fileURLToPath } from 'node:url';
    import { describe, expect, it } from 'vitest';
    import {
      ARCHIVE_DATA_VERSION,
      ARCHIVE_EXPORT_JSON_SCHEMA,
      ARCHIVE_EXPORT_LIMITS,
      ARCHIVE_EXPORT_V5_CALENDAR_EVENT_FIELDS,
      archiveBundleFilename,
      attachArchiveChecksum,
      buildArchiveBundle,
      parseArchiveBundle,
      SUPPORTED_ARCHIVE_IMPORT_VERSIONS,
      verifyArchiveChecksum
    } from './archive-export-schemas';
    import { PUBLIC_EXPORT_V4_CALENDAR_EVENT_FIELDS } from './export-schemas';
    import type { ArchiveBundle } from './archive-models';

    const fixtureDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/archive-domain/v5');

    function stableJson(value: unknown): string {
      return `${JSON.stringify(value, null, 2)}\n`;
    }
    ```
  - [ ] 2.2 In the same file, add the golden document builder — this is the single source of the
    fixture content, so it must be literal and deterministic:
    ```ts
    function goldenSource() {
      return {
        leagues: [
          { id: 'archive-league-1', name: 'Lyon Circuit', createdAt: '2025-01-06T09:00:00.000Z' },
          { id: 'archive-league-2', name: 'Grenoble Circuit', createdAt: '2025-02-10T09:00:00.000Z' }
        ],
        leagueSeasons: [
          { id: 'season-1', name: 'Lyon 2025', leagueId: 'archive-league-1', status: 'completed' as const },
          { id: 'season-2', name: 'Lyon 2026', leagueId: 'archive-league-1', status: 'active' as const },
          { id: 'season-3', name: 'Grenoble 2026', leagueId: 'archive-league-2', status: 'active' as const }
        ],
        tournaments: [
          {
            id: 'tournament-1', name: 'Lyon Opener', seasonId: 'season-1',
            tournamentDate: '2025-03-08', status: 'completed' as const,
            rounds: [{ id: 'round-1', entries: [
              { kind: 'match' as const, id: 'match-1', table: '1', player1Name: 'Alice', player2Name: 'Bob', player1Score: 2, player2Score: 0, player1DeckArchetype: 'Red Aggro', player2DeckArchetype: 'Blue Control' },
              { kind: 'bye' as const, id: 'bye-1', table: '2', playerName: 'Carol', deckArchetype: 'Green Ramp' }
            ] }],
            playerArchetypes: [
              { playerName: 'Alice', archetype: 'Red Aggro' },
              { playerName: 'Bob', archetype: 'Blue Control' },
              { playerName: 'Carol', archetype: 'Green Ramp' }
            ]
          },
          {
            id: 'tournament-2', name: 'Lyon Finals', seasonId: 'season-1',
            tournamentDate: '2025-11-22', status: 'completed' as const, rounds: [], playerArchetypes: []
          },
          {
            id: 'tournament-3', name: 'Grenoble Open', seasonId: 'season-3',
            tournamentDate: '2026-04-11', status: 'active' as const,
            rounds: [{ id: 'round-3', entries: [
              { kind: 'invalid' as const, id: 'invalid-1', rawText: 'bad,row', table: '', player: 'Dana', result: '???', opponent: 'Eve', playerDecklist: '', opponentDecklist: '' }
            ] }],
            playerArchetypes: []
          },
          {
            id: 'tournament-4', name: 'Standalone Charity Cup', seasonId: null,
            tournamentDate: '2026-06-01', status: 'completed' as const,
            rounds: [{ id: 'round-4', entries: [
              { kind: 'match' as const, id: 'match-4', table: '1', player1Name: 'Alice', player2Name: 'Dana', player1Score: 1, player2Score: 2, player1DeckArchetype: '', player2DeckArchetype: '' }
            ] }],
            playerArchetypes: [{ playerName: 'Dana', archetype: '' }]
          }
        ],
        calendarEvents: [{
          id: 'event-1', slug: 'lyon-opener-2025', title: 'Lyon Opener', eventDate: '2025-03-08',
          startTime: '10:00', endTime: '18:00', location: 'Club Lyon', country: 'FR', city: 'Lyon',
          address: '1 rue de la Republique', description: 'Season opener',
          richDescriptionHtml: '<p>Season opener</p>', externalLink: 'https://example.org/lyon'
        }]
      };
    }

    function goldenBundle(): ArchiveBundle {
      return buildArchiveBundle(goldenSource());
    }
    ```
  - [ ] 2.3 In the same file, add the two literal refused artifacts:
    ```ts
    /** Hand-authored so this fixture set has no import from the v1–v4 modules T17 removes. */
    const LEGACY_V1_FIXTURE = {
      version: 1,
      exportedAt: '2024-05-04T12:00:00.000Z',
      league: { id: 'legacy-league', name: 'Legacy League', status: 'finished', tournaments: [] }
    };

    const LEGACY_V4_FIXTURE = {
      kind: 'fullData',
      gonesDataVersion: 4,
      gonesAppVersion: '0.1.0',
      exportedAt: '2026-01-15T00:00:00.000Z',
      leagues: [{ id: 'legacy-league', name: 'Legacy League', status: 'completed', tournaments: [] }],
      calendarEvents: []
    };
    ```
  - [ ] 2.4 In the same file, write every test named in the Test plan table for
    `archive-export-schemas.test.ts`, in that order, inside
    `describe('archive export bundle v5', () => { ... })`.
  - [ ] 2.5 Write the fixture test last, as its own `describe`:
    ```ts
    describe('archive v5 golden fixtures', () => {
      it('reproduces the frozen v5 golden fixtures byte-for-byte', async () => {
        const bundleJson = stableJson(await attachArchiveChecksum(goldenBundle()));
        const legacyV1Json = stableJson(LEGACY_V1_FIXTURE);
        const legacyV4Json = stableJson(LEGACY_V4_FIXTURE);
        const manifestJson = stableJson({
          fixtureSet: 'gones-archive-export-parity',
          fixtureVersion: 5,
          source: {
            language: 'TypeScript',
            exporter: 'src/app/domain/archive-export-schemas.test.ts',
            sourceFiles: [
              'src/app/domain/archive-models.ts',
              'src/app/domain/archive-export-schemas.ts',
              'src/app/data/archive-import.service.ts'
            ],
            archiveDataVersion: ARCHIVE_DATA_VERSION
          },
          serialization: 'JSON.stringify(value, null, 2) + LF',
          bundleSha256: createHash('sha256').update(bundleJson).digest('hex'),
          caseCounts: {
            leagues: 2, leagueSeasons: 3, tournaments: 4,
            standaloneTournaments: 1, calendarEvents: 1, refusedBundles: 2
          }
        });

        if (process.env['UPDATE_ARCHIVE_FIXTURES'] === '1') {
          mkdirSync(fixtureDirectory, { recursive: true });
          writeFileSync(resolve(fixtureDirectory, 'bundle.json'), bundleJson);
          writeFileSync(resolve(fixtureDirectory, 'legacy-v1.json'), legacyV1Json);
          writeFileSync(resolve(fixtureDirectory, 'legacy-v4.json'), legacyV4Json);
          writeFileSync(resolve(fixtureDirectory, 'manifest.json'), manifestJson);
        }

        expect(readFileSync(resolve(fixtureDirectory, 'bundle.json'), 'utf8')).toBe(bundleJson);
        expect(readFileSync(resolve(fixtureDirectory, 'legacy-v1.json'), 'utf8')).toBe(legacyV1Json);
        expect(readFileSync(resolve(fixtureDirectory, 'legacy-v4.json'), 'utf8')).toBe(legacyV4Json);
        expect(readFileSync(resolve(fixtureDirectory, 'manifest.json'), 'utf8')).toBe(manifestJson);
      });
    });
    ```
  - [ ] 2.6 Run `npx vitest run src/app/domain/archive-export-schemas.test.ts` and confirm it fails
    with `Failed to resolve import "./archive-export-schemas"`. **Red confirmed.**

- [ ] 3. Green — write `src/app/domain/archive-export-schemas.ts`
  - [ ] 3.1 Create the file with the imports and re-exports:
    ```ts
    /**
     * Versioned contract for the Gones Archive export bundle, data version 5.
     *
     * Four flat collections, no nesting: `leagues`, `leagueSeasons`, `tournaments`,
     * `calendarEvents`. A Tournament is a top-level row and may stand alone (`seasonId: null`).
     *
     * ADR 0022 froze the v1–v4 wire names to keep the legacy import door open. That door is closed
     * here on purpose: Gones is unreleased, no user holds a bundle, and there is no converter.
     * A v1–v4 artifact is refused with `legacyArchiveBundleVersion`.
     */
    import { ARCHIVE_DATA_VERSION, SUPPORTED_ARCHIVE_IMPORT_VERSIONS } from './archive-models';
    import type {
      ArchiveBundle, ArchiveLeagueDocument, ArchiveTournamentDocument,
      CalendarEventDocument, LeagueSeasonDocument, LeagueStatus,
      PlayerArchetypeDocument, RoundDocument
    } from './archive-models';
    import { assertNoDeniedFields, canonicalJsonStringify, EXPORT_LIMITS, sha256Hex } from './export-schemas';

    export { ARCHIVE_DATA_VERSION, SUPPORTED_ARCHIVE_IMPORT_VERSIONS } from './archive-models';
    export type { ArchiveBundle } from './archive-models';

    export type SupportedArchiveImportVersion = (typeof SUPPORTED_ARCHIVE_IMPORT_VERSIONS)[number];

    /** The on-disk artifact: an `ArchiveBundle` plus the optional integrity checksum. */
    export interface ArchiveExportFile extends ArchiveBundle {
      checksum?: string;
    }
    ```
  - [ ] 3.2 Append the limits and field allowlists:
    ```ts
    export const ARCHIVE_EXPORT_LIMITS = {
      /** Same browser constraint as the v1–v4 path; the file cap is the real defence. */
      maxImportFileBytes: EXPORT_LIMITS.maxImportFileBytes,
      maxLeagues: 100,
      /** A LeagueSeason is what v4 called a League, so it keeps v4's `maxFullDataLeagues` ceiling. */
      maxLeagueSeasons: EXPORT_LIMITS.maxFullDataLeagues,
      maxTournaments: 2000,
      maxCalendarEvents: EXPORT_LIMITS.maxCalendarEvents
    } as const;

    export const ARCHIVE_EXPORT_V5_LEAGUE_FIELDS = ['id', 'name', 'createdAt'] as const;
    export const ARCHIVE_EXPORT_V5_LEAGUE_SEASON_FIELDS = ['id', 'name', 'leagueId', 'status'] as const;
    export const ARCHIVE_EXPORT_V5_TOURNAMENT_FIELDS = ['id', 'name', 'seasonId', 'tournamentDate', 'status', 'rounds', 'playerArchetypes'] as const;
    export const ARCHIVE_EXPORT_V5_CALENDAR_EVENT_FIELDS = [
      'id', 'slug', 'title', 'eventDate', 'startTime', 'endTime', 'location', 'country', 'city', 'address', 'description', 'richDescriptionHtml', 'externalLink'
    ] as const;
    ```
  - [ ] 3.3 Append the published JSON Schema:
    ```ts
    const stringFields = (fields: readonly string[]) =>
      Object.fromEntries(fields.map((field) => [field, { type: 'string' }]));

    const archiveLeagueSchema = {
      type: 'object', additionalProperties: false,
      required: [...ARCHIVE_EXPORT_V5_LEAGUE_FIELDS],
      properties: stringFields(ARCHIVE_EXPORT_V5_LEAGUE_FIELDS)
    } as const;

    const leagueSeasonSchema = {
      type: 'object', additionalProperties: false,
      required: [...ARCHIVE_EXPORT_V5_LEAGUE_SEASON_FIELDS],
      properties: { id: { type: 'string' }, name: { type: 'string' }, leagueId: { type: 'string' }, status: { enum: ['active', 'completed'] } }
    } as const;

    const archiveTournamentSchema = {
      type: 'object', additionalProperties: false,
      required: [...ARCHIVE_EXPORT_V5_TOURNAMENT_FIELDS],
      properties: {
        id: { type: 'string' }, name: { type: 'string' },
        seasonId: { type: ['string', 'null'] },
        tournamentDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        status: { enum: ['active', 'completed'] },
        rounds: { type: 'array' }, playerArchetypes: { type: 'array' }
      }
    } as const;

    const calendarEventSchema = {
      type: 'object', additionalProperties: false,
      required: [...ARCHIVE_EXPORT_V5_CALENDAR_EVENT_FIELDS],
      properties: stringFields(ARCHIVE_EXPORT_V5_CALENDAR_EVENT_FIELDS)
    } as const;

    /**
     * The published contract. `parseArchiveBundle` is the hand-rolled enforcer — the repository
     * carries no JSON Schema validator, exactly as `EXPORT_JSON_SCHEMAS` works for v1–v4.
     */
    export const ARCHIVE_EXPORT_JSON_SCHEMA = {
      $id: 'https://gones.app/schemas/archive-export-v5.json',
      type: 'object',
      additionalProperties: false,
      required: ['version', 'leagues', 'leagueSeasons', 'tournaments', 'calendarEvents'],
      properties: {
        version: { const: ARCHIVE_DATA_VERSION },
        checksum: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
        leagues: { type: 'array', maxItems: ARCHIVE_EXPORT_LIMITS.maxLeagues, items: archiveLeagueSchema },
        leagueSeasons: { type: 'array', maxItems: ARCHIVE_EXPORT_LIMITS.maxLeagueSeasons, items: leagueSeasonSchema },
        tournaments: { type: 'array', maxItems: ARCHIVE_EXPORT_LIMITS.maxTournaments, items: archiveTournamentSchema },
        calendarEvents: { type: 'array', maxItems: ARCHIVE_EXPORT_LIMITS.maxCalendarEvents, items: calendarEventSchema }
      }
    } as const;
    ```
  - [ ] 3.4 Append the builder and the filename helper:
    ```ts
    const byId = <T extends { id: string }>(left: T, right: T) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

    export function buildArchiveBundle(source: {
      leagues: readonly ArchiveLeagueDocument[];
      leagueSeasons: readonly LeagueSeasonDocument[];
      tournaments: readonly ArchiveTournamentDocument[];
      calendarEvents?: readonly CalendarEventDocument[];
    }): ArchiveBundle {
      return {
        version: ARCHIVE_DATA_VERSION,
        // Field-by-field picks, never a spread: a Persisted* input must not leak
        // `documentVersion`, `updatedAt` or `eTag` into a public artifact.
        leagues: [...source.leagues]
          .map((league) => ({ id: league.id, name: league.name, createdAt: league.createdAt }))
          .sort(byId),
        leagueSeasons: [...source.leagueSeasons]
          .map((season) => ({ id: season.id, name: season.name, leagueId: season.leagueId, status: season.status }))
          .sort(byId),
        tournaments: [...source.tournaments]
          .map((tournament) => ({
            id: tournament.id,
            name: tournament.name,
            seasonId: tournament.seasonId,
            tournamentDate: tournament.tournamentDate,
            status: tournament.status,
            rounds: structuredClone(tournament.rounds) as RoundDocument[],
            playerArchetypes: structuredClone(tournament.playerArchetypes) as PlayerArchetypeDocument[]
          }))
          .sort(byId),
        calendarEvents: [...(source.calendarEvents ?? [])]
          .map((event) => Object.fromEntries(ARCHIVE_EXPORT_V5_CALENDAR_EVENT_FIELDS.map((field) => [field, event[field]])) as unknown as CalendarEventDocument)
          .sort(byId)
      };
    }

    export function archiveBundleFilename(now: Date = new Date()): string {
      return `${now.toISOString().slice(0, 10)} Gones Archive.json`;
    }
    ```
  - [ ] 3.5 Append the checksum pair, mirroring `export-schemas.ts:143-163`:
    ```ts
    const CHECKSUM_PREFIX = 'sha256:';

    async function archiveChecksum(payload: Record<string, unknown>): Promise<string> {
      const { checksum: _ignored, ...rest } = payload;
      return `${CHECKSUM_PREFIX}${await sha256Hex(canonicalJsonStringify(rest))}`;
    }

    export async function attachArchiveChecksum(bundle: ArchiveBundle): Promise<ArchiveExportFile> {
      return { ...bundle, checksum: await archiveChecksum(bundle as unknown as Record<string, unknown>) };
    }

    /** True when the artifact carries no checksum (contract section 11 prints none) or it matches. */
    export async function verifyArchiveChecksum(file: unknown): Promise<boolean> {
      if (!file || typeof file !== 'object') return false;
      const payload = file as Record<string, unknown>;
      if (payload['checksum'] === undefined) return true;
      return typeof payload['checksum'] === 'string' && payload['checksum'] === await archiveChecksum(payload);
    }
    ```
  - [ ] 3.6 Append the legacy detector and the version gate:
    ```ts
    /**
     * The three historical shapes of a v1–v4 Gones Export, per `export-restore.ts:57-77`:
     * the `kind`-tagged artifact, the pre-Angular `{ version: 1, league }` file, and a bare
     * numeric `version` of 1 to 4.
     */
    export function isLegacyGonesExport(value: unknown): boolean {
      if (!value || typeof value !== 'object') return false;
      const payload = value as Record<string, unknown>;
      if (payload['kind'] === 'league' || payload['kind'] === 'fullData') return true;
      if (payload['version'] === 1 && payload['league'] !== undefined) return true;
      const version = payload['version'];
      return typeof version === 'number' && version >= 1 && version <= 4;
    }

    export function assertSupportedArchiveBundleVersion(value: unknown): void {
      // Legacy detection runs first: a `kind` tag proves a legacy artifact even if it claims v5.
      if (isLegacyGonesExport(value)) throw new Error('legacyArchiveBundleVersion');
      if (!value || typeof value !== 'object') throw new Error('unsupportedArchiveBundle');
      const version = (value as Record<string, unknown>)['version'];
      if (!SUPPORTED_ARCHIVE_IMPORT_VERSIONS.some((supported) => supported === version)) {
        throw new Error('unsupportedArchiveBundle');
      }
    }
    ```
  - [ ] 3.7 Append the strict parser:
    ```ts
    const ACCEPTED_TOP_LEVEL_KEYS = ['version', 'checksum', 'leagues', 'leagueSeasons', 'tournaments', 'calendarEvents'];
    const ACCEPTED_STATUSES: readonly string[] = ['active', 'completed'];
    const ACCEPTED_ENTRY_KINDS: readonly string[] = ['match', 'bye', 'invalid'];

    function reject(): never {
      throw new Error('unsupportedArchiveBundle');
    }

    function row(value: unknown): Record<string, unknown> {
      if (!value || typeof value !== 'object' || Array.isArray(value)) reject();
      return value as Record<string, unknown>;
    }

    function requireExactKeys(value: Record<string, unknown>, fields: readonly string[]): void {
      const keys = Object.keys(value).sort();
      const expected = [...fields].sort();
      if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) reject();
    }

    function text(value: unknown): string {
      if (typeof value !== 'string') reject();
      return value;
    }

    function status(value: unknown): LeagueStatus {
      if (typeof value !== 'string' || !ACCEPTED_STATUSES.includes(value)) reject();
      return value as LeagueStatus;
    }

    function collection(value: unknown, cap: number): unknown[] {
      if (!Array.isArray(value)) reject();
      if (value.length > cap) throw new Error('gonesImportTooManyRecords');
      return value;
    }

    /** Depth is deliberate: shape only. Field-level entry rules belong to the domain normalizer. */
    function rounds(value: unknown): RoundDocument[] {
      if (!Array.isArray(value)) reject();
      for (const round of value) {
        const parsed = row(round);
        text(parsed['id']);
        if (!Array.isArray(parsed['entries'])) reject();
        for (const entry of parsed['entries'] as unknown[]) {
          const parsedEntry = row(entry);
          if (typeof parsedEntry['kind'] !== 'string' || !ACCEPTED_ENTRY_KINDS.includes(parsedEntry['kind'])) reject();
          text(parsedEntry['id']);
        }
      }
      return structuredClone(value) as RoundDocument[];
    }

    function playerArchetypes(value: unknown): PlayerArchetypeDocument[] {
      if (!Array.isArray(value)) reject();
      for (const archetype of value) {
        const parsed = row(archetype);
        requireExactKeys(parsed, ['playerName', 'archetype']);
        text(parsed['playerName']);
        text(parsed['archetype']);
      }
      return structuredClone(value) as PlayerArchetypeDocument[];
    }

    /**
     * Strict and non-coercing: a row either matches or the file is refused. Ids and values pass
     * through verbatim, so `buildArchiveBundle` → serialize → `parseArchiveBundle` is an identity.
     */
    export function parseArchiveBundle(value: unknown): ArchiveBundle {
      assertSupportedArchiveBundleVersion(value);
      const payload = row(value);
      if (Object.keys(payload).some((key) => !ACCEPTED_TOP_LEVEL_KEYS.includes(key))) reject();
      assertNoDeniedFields(payload);

      const leagues = collection(payload['leagues'], ARCHIVE_EXPORT_LIMITS.maxLeagues).map((entry) => {
        const parsed = row(entry);
        requireExactKeys(parsed, ARCHIVE_EXPORT_V5_LEAGUE_FIELDS);
        return { id: text(parsed['id']), name: text(parsed['name']), createdAt: text(parsed['createdAt']) };
      });

      const leagueSeasons = collection(payload['leagueSeasons'], ARCHIVE_EXPORT_LIMITS.maxLeagueSeasons).map((entry) => {
        const parsed = row(entry);
        requireExactKeys(parsed, ARCHIVE_EXPORT_V5_LEAGUE_SEASON_FIELDS);
        return { id: text(parsed['id']), name: text(parsed['name']), leagueId: text(parsed['leagueId']), status: status(parsed['status']) };
      });

      const tournaments = collection(payload['tournaments'], ARCHIVE_EXPORT_LIMITS.maxTournaments).map((entry) => {
        const parsed = row(entry);
        requireExactKeys(parsed, ARCHIVE_EXPORT_V5_TOURNAMENT_FIELDS);
        const seasonId = parsed['seasonId'];
        // `null` is first-class and means standalone; `undefined` is a malformed row.
        if (seasonId !== null && typeof seasonId !== 'string') reject();
        return {
          id: text(parsed['id']),
          name: text(parsed['name']),
          seasonId: seasonId as string | null,
          tournamentDate: text(parsed['tournamentDate']),
          status: status(parsed['status']),
          rounds: rounds(parsed['rounds']),
          playerArchetypes: playerArchetypes(parsed['playerArchetypes'])
        };
      });

      const calendarEvents = collection(payload['calendarEvents'], ARCHIVE_EXPORT_LIMITS.maxCalendarEvents).map((entry) => {
        const parsed = row(entry);
        requireExactKeys(parsed, ARCHIVE_EXPORT_V5_CALENDAR_EVENT_FIELDS);
        return Object.fromEntries(ARCHIVE_EXPORT_V5_CALENDAR_EVENT_FIELDS.map((field) => [field, text(parsed[field])])) as unknown as CalendarEventDocument;
      });

      return { version: ARCHIVE_DATA_VERSION, leagues, leagueSeasons, tournaments, calendarEvents };
    }
    ```
  - [ ] 3.8 Run `npx vitest run src/app/domain/archive-export-schemas.test.ts`. Every test except
    `reproduces the frozen v5 golden fixtures byte-for-byte` must pass; that one fails on
    `ENOENT: no such file or directory`, which step 4 fixes.

- [ ] 4. Generate the golden fixtures
  - [ ] 4.1 Run `UPDATE_ARCHIVE_FIXTURES=1 npx vitest run src/app/domain/archive-export-schemas.test.ts`.
  - [ ] 4.2 Run `ls fixtures/archive-domain/v5` and confirm exactly `bundle.json`, `legacy-v1.json`,
    `legacy-v4.json`, `manifest.json`.
  - [ ] 4.3 Run `node -e "const b=require('./fixtures/archive-domain/v5/bundle.json'); console.log(b.version, b.leagues.length, b.leagueSeasons.length, b.tournaments.length, b.calendarEvents.length, b.tournaments.filter(t=>t.seasonId===null).length)"`
    and confirm the output is `5 2 3 4 1 1`.
  - [ ] 4.4 Run `npx vitest run src/app/domain/archive-export-schemas.test.ts` again with no env var
    and confirm the whole file is green. **Green confirmed for the schema module.**
  - [ ] 4.5 Run `git status --short fixtures/` and confirm the only additions are under
    `fixtures/archive-domain/v5/`; `fixtures/league-domain/v1/` must show no change.

- [ ] 5. Add the refusal message in both languages
  - [ ] 5.1 In `src/app/i18n/messages.ts`, in the **English** block, immediately after the line
    `  'msg.importUnsupported': 'That file is not a supported Gones Export.',` (line 339), insert:
    ```ts
      'msg.importLegacyBundleUnsupported': 'That file is a Gones Export from an older data version (1 to 4). Only version 5 archive bundles can be imported, and there is no converter.',
    ```
  - [ ] 5.2 In the same file, in the **French** block, immediately after the line
    `  'msg.importUnsupported': 'Ce fichier n’est pas un export Gones pris en charge.',` (line 1584),
    insert:
    ```ts
      'msg.importLegacyBundleUnsupported': 'Ce fichier est un export Gones d’une version de données antérieure (1 à 4). Seuls les paquets d’archive en version 5 peuvent être importés, et il n’existe aucun convertisseur.',
    ```
  - [ ] 5.3 Run `grep -n "msg.importLegacyBundleUnsupported" src/app/i18n/messages.ts` and confirm
    exactly two hits, one below line 339 and one below line 1585.
  - [ ] 5.4 Run `npx vitest run src/app/i18n` and confirm
    `en and fr have identical key sets` is green.

- [ ] 6. Red — write the import service test file
  - [ ] 6.1 Create `src/app/data/archive-import.service.test.ts` with this header and `File` double,
    copied from the idiom at `src/app/data/league-archive-import.service.test.ts:108-112`:
    ```ts
    import { readFileSync } from 'node:fs';
    import { dirname, resolve } from 'node:path';
    import { fileURLToPath } from 'node:url';
    import { describe, expect, it, vi } from 'vitest';
    import { ArchiveImportService } from './archive-import.service';
    import {
      ARCHIVE_EXPORT_LIMITS,
      attachArchiveChecksum,
      buildArchiveBundle,
      parseArchiveBundle
    } from '../domain/archive-export-schemas';
    import { catalogs } from '../i18n/messages';

    const fixtureDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/archive-domain/v5');

    /** `readBundle` only reads `size` and `text()`; jsdom's `File` is not needed to exercise it. */
    function textFile(text: string): File {
      return { size: text.length, text: async () => text } as unknown as File;
    }

    function fixtureFile(name: string): File {
      return textFile(readFileSync(resolve(fixtureDirectory, name), 'utf8'));
    }
    ```
  - [ ] 6.2 Write every test named in the Test plan table for `archive-import.service.test.ts`,
    inside `describe('ArchiveImportService v5 gate', () => { ... })`, constructing the subject as
    `const service = new ArchiveImportService();`.
  - [ ] 6.3 Run `npx vitest run src/app/data/archive-import.service.test.ts` and confirm it fails
    with `Failed to resolve import "./archive-import.service"`. **Red confirmed.**

- [ ] 7. Green — write `src/app/data/archive-import.service.ts`
  - [ ] 7.1 Create the file:
    ```ts
    import { Injectable } from '@angular/core';
    import type { ArchiveBundle } from '../domain/archive-models';
    import {
      ARCHIVE_EXPORT_LIMITS,
      parseArchiveBundle,
      verifyArchiveChecksum
    } from '../domain/archive-export-schemas';

    export interface ArchiveImportResult {
      bundle: ArchiveBundle;
      leagueCount: number;
      leagueSeasonCount: number;
      tournamentCount: number;
      calendarEventCount: number;
    }

    /**
     * The v5 import gate. It parses, verifies and validates, and it writes nothing: it injects no
     * store, so it cannot pick a destination. `ArchiveRepository` persists the returned bundle.
     *
     * A v1–v4 Gones Export is refused with `legacyArchiveBundleVersion`. ADR 0022 froze the old wire
     * names to keep that import door open; this closes it on purpose. There is no converter.
     */
    @Injectable({ providedIn: 'root' })
    export class ArchiveImportService {
      async readBundle(file: File): Promise<ArchiveImportResult> {
        if (file.size > ARCHIVE_EXPORT_LIMITS.maxImportFileBytes) throw new Error('gonesImportFileTooLarge');

        const parsed: unknown = JSON.parse(await file.text());
        // A checksum mismatch rejects the file before any caller can persist it.
        if (!(await verifyArchiveChecksum(parsed))) throw new Error('gonesExportChecksumMismatch');

        const bundle = parseArchiveBundle(parsed);
        return {
          bundle,
          leagueCount: bundle.leagues.length,
          leagueSeasonCount: bundle.leagueSeasons.length,
          tournamentCount: bundle.tournaments.length,
          calendarEventCount: bundle.calendarEvents.length
        };
      }
    }
    ```
  - [ ] 7.2 Run `npx vitest run src/app/data/archive-import.service.test.ts` and confirm every test
    is green. **Green confirmed for the import gate.**

- [ ] 8. Prove nothing else moved
  - [ ] 8.1 Run `git status --short` and confirm the changed set is exactly:
    `src/app/domain/archive-export-schemas.ts`, `src/app/domain/archive-export-schemas.test.ts`,
    `src/app/data/archive-import.service.ts`, `src/app/data/archive-import.service.test.ts`,
    `src/app/i18n/messages.ts`, `fixtures/archive-domain/v5/*` (4 files).
  - [ ] 8.2 Run `git diff --stat src/app/i18n/messages.ts` and confirm exactly 2 insertions, 0
    deletions.
  - [ ] 8.3 Run `git diff --quiet -- src/app/domain/models.ts src/app/domain/export-schemas.ts src/app/data/league-archive-import.service.ts fixtures/league-domain && echo UNTOUCHED` and confirm it prints `UNTOUCHED`.
  - [ ] 8.4 Run the Validation commands below.

## Outputs

- Files touched:
  - **new** `src/app/domain/archive-export-schemas.ts`
  - **new** `src/app/domain/archive-export-schemas.test.ts`
  - **new** `src/app/data/archive-import.service.ts`
  - **new** `src/app/data/archive-import.service.test.ts`
  - **new** `fixtures/archive-domain/v5/bundle.json`
  - **new** `fixtures/archive-domain/v5/legacy-v1.json`
  - **new** `fixtures/archive-domain/v5/legacy-v4.json`
  - **new** `fixtures/archive-domain/v5/manifest.json`
  - **modified** `src/app/i18n/messages.ts` — exactly 2 inserted lines, one per language block
- Public API / behaviour change:
  - The v5 export contract exists and is machine-checkable: `ARCHIVE_EXPORT_JSON_SCHEMA`,
    `buildArchiveBundle`, `parseArchiveBundle`, `attachArchiveChecksum`, `verifyArchiveChecksum`,
    `isLegacyGonesExport`, `assertSupportedArchiveBundleVersion`, `archiveBundleFilename`,
    `ARCHIVE_EXPORT_LIMITS`, and the four field allowlists.
  - `ArchiveImportService.readBundle(file: File): Promise<ArchiveImportResult>` exists and refuses
    every v1–v4 bundle with `legacyArchiveBundleVersion`.
  - `msg.importLegacyBundleUnsupported` exists in both catalogues.
  - **No user-visible behaviour changes yet.** Nothing calls the new module: the legacy
    `LeagueArchiveImportService` still serves the header's import control, unchanged, and the
    `importErrorMessage` classifier in `src/app/app.component.ts:434-447` is untouched. Wiring is a
    later ticket's job.
- Migrate / config: none. No database change, no environment variable, no build-script change.
  `fixtures/` ships in no image and no release path reads it.

## Validation

- [ ] `npx vitest run src/app/domain/archive-export-schemas.test.ts src/app/data/archive-import.service.test.ts src/app/i18n` → exit `0`, all tests passing, `0 failed`.
- [ ] `npm run test` → exit `0`. In particular
      `src/app/domain/league-parity-fixtures.test.ts`,
      `src/app/domain/export-schemas.test.ts`,
      `src/app/domain/export-restore.test.ts`,
      `src/app/data/league-archive-import.service.test.ts` and
      `src/app/i18n/message-namespace.test.ts` must still pass untouched.
- [ ] `npm run typecheck` → exit `0`. This is the gate that proves the French block gained the same
      key as the English one, since `MessageKey = keyof typeof en` and
      `const fr: Record<MessageKey, string>`.
- [ ] `npm run lint` → exit `0`, no new warning.
- [ ] `npm run build` → exit `0` (the app still compiles; the new modules are tree-shaken because
      nothing imports them yet).
- [ ] `UPDATE_ARCHIVE_FIXTURES=1 npx vitest run src/app/domain/archive-export-schemas.test.ts && git diff --quiet -- fixtures/archive-domain && echo DETERMINISTIC` → prints `DETERMINISTIC`, proving the fixture generator is reproducible.
- [ ] `git diff --quiet -- src/app/domain/models.ts src/app/domain/export-schemas.ts src/app/data/league-archive-import.service.ts fixtures/league-domain && echo UNTOUCHED` → prints `UNTOUCHED`.
- [ ] `git diff --stat src/app/i18n/messages.ts` → `1 file changed, 2 insertions(+)`.
- [ ] Manual check: none. This slice ships no UI and no CLI; every behaviour it adds is asserted by
      the two test files above.
- [ ] App functional — the running app is byte-identical in behaviour: the only modified existing
      file is `messages.ts`, and it only gained an unused key.
- [ ] `npm run backend:test` is **not** required by this ticket — no backend file is touched — but
      `fixtures/league-domain/v1/` must stay untouched precisely because
      `backend/tests/Gones.UnitTests/LeagueParityTests.cs:172` and
      `backend/tests/Gones.IntegrationTests/LeagueArchiveRouteTests.cs:183` read it.
- [ ] Commit msg draft: `feat(archive): write export bundles at version 5 and refuse v1-v4 imports`
