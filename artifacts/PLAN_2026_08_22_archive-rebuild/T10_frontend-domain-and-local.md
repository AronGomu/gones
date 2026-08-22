# T10: Frontend three-tier domain and browser-local archive

**Plan:** `./artifacts/PLAN_2026_08_22_archive-rebuild.md`
**Depends:** T2
**Commit outcome:** `src/app/domain/archive-models.ts` carries the three tiers and `gones-archive-local` stores them.

## Context (self-contained)

- **Goal:** rebuild the Gones Archive on three tiers — **League → LeagueSeason → Tournament**. A Tournament becomes a first-class top-level record that may stand alone (`seasonId: null`). Today's flat `League` becomes `LeagueSeason`; a new `League` tier groups Seasons. `leagues-archive` → `archive` everywhere.
- **This slice:** the frontend foundation. It adds the three-tier TypeScript shapes, the derived lock rule, the id-origin rule, the summary projections, the command-failure classifier and the browser-local IndexedDB authority (ADR 0028) that stores the three tiers. **Nothing renders it yet** — components and routes are later tickets, the public catalog cache is a later ticket, export/import is a later ticket. This slice is pure domain + browser-local persistence.
- **Out of scope here (hard fence — do not cross):**
  - **Do not modify `src/app/domain/models.ts`.** Not one line. It keeps its current `LeagueDocument` (with `tournaments[]`), `TournamentDocument` (with `leagueId`), `GONES_DATA_VERSION = 4`, `SUPPORTED_IMPORT_DATA_VERSIONS = [1, 2, 3, 4]` and `PLACEHOLDER_LEAGUE_ID = 'placeholder-league'` until a much later ticket retires them. Mutating it here would break every legacy component that is deliberately kept alive, and the app would stop compiling.
  - **Do not delete or modify** `src/app/backend/local-league-archive-backend.service.ts`, `src/app/backend/application-backend.ts`, or any `src/app/data/league-archive-*.ts`. The legacy archive surface must keep compiling and working after this commit. It is retired in a later ticket, not this one.
  - **Do not remove anything from any allowlist.** You add exactly one line to one allowlist array (see *Interface contract → Produces — allowlist edit*). Removing `src/app/backend/local-league-archive-backend.service.ts` from it is a later ticket's job.
  - **NO components, NO templates, NO routes, NO i18n keys.** Do not touch `src/app/app.routes.ts`, `src/app/i18n/messages.ts`, `src/app/features/**`, `src/styles.css`.
  - **NO public catalog cache.** Do not create `src/app/backend/archive-cache.service.ts`, `src/app/backend/archive-backfill-queue.ts` or `src/app/data/archive-repository.service.ts`. A later ticket owns the second IndexedDB database `gones-archive-cache` and every one of its stores. This ticket opens **only** the authority database `gones-archive-local`.
  - **NO export bundle work.** Do not create `src/app/domain/archive-export-schemas.ts` or `src/app/data/archive-import.service.ts`.
  - **NO backend, NO Cypress, NO fixtures, NO scripts, NO ADR, NO docs.** Do not touch `backend/**`, `cypress/**`, `fixtures/**`, `ops/**`, `scripts/**`, `docs/**`, `AGENT.md`, `README.md`.
  - Do not add a runtime dependency. In particular **do not add `fake-indexeddb`** — the test fake is copied from an existing spec (see *Impl steps 5.1*).
  - Do not register a DI `InjectionToken` for the new adapter; that wiring belongs to the repository ticket that follows. Provide the class with `@Injectable({ providedIn: 'root' })` and stop there.
- **Assumptions in force:**
  1. **Gones is unreleased. There is no production environment and there are no users.** Local data may be reset freely. There is therefore no migration of the existing `gones-leagues` IndexedDB database into `gones-archive-local`; the new database starts empty and the old one keeps serving the legacy pages.
  2. A new file created beside its legacy counterpart is the whole strategy — expand now, contract later. Every commit compiles and the app runs. Nothing you write is imported by the running application yet, and that is expected.
  3. **`src/app/domain/models.ts` already exports everything this slice reuses**: `createRound`, `defaultIdFactory`, `getDefaultTournamentName`, `normalizeLeagueStatus`, `normalizeTournamentStatus`, `trimPlayerName`, `normalizeDeckArchetype`, plus the types `LeagueStatus`, `LeagueDocument`, `TournamentDocument`, `RoundDocument`, `RoundEntry`, `MatchRoundEntry`, `ByeRoundEntry`, `InvalidRoundEntry`, `PlayerArchetypeDocument`, `CalendarEventDocument`, `IdFactory`. Shared shapes are **re-exported, never duplicated**.
  4. `tsconfig.json` sets `"strict": true`, `"isolatedModules": true`, `"noImplicitReturns": true`, `"noPropertyAccessFromIndexSignature": true`, `"moduleResolution": "bundler"`, target `ES2022`. `isolatedModules` means a type re-export **must** use `export type { … } from './models'`, never a bare `export { … }`.
  5. `npm run typecheck` runs `tsc --noEmit -p tsconfig.app.json && tsc --noEmit -p tsconfig.spec.json`. `tsconfig.app.json` only has `files: ["src/main.ts"]`, so files not reachable from the app graph are typechecked by **`tsconfig.spec.json`**, whose `include` is `["src/**/*.ts", "ops/**/*.ts"]`. Your new files are covered there, and only there. They must compile clean anyway.
  6. Vitest config: `environment: 'jsdom'`, `globals: true`, `include: ['src/**/*.test.ts', 'ops/**/*.test.ts']`. Tests import `{ describe, expect, it }` from `'vitest'` explicitly, following every existing spec.
  7. ESLint: `@typescript-eslint/no-unused-vars` is an error with `argsIgnorePattern: '^_'` and `varsIgnorePattern: '^_'`, so a destructure-to-drop must name its discard `_leagueId` / `_seasonId`.
  8. **The name `LOCAL_LEAGUE_STORE` will exist twice in the codebase** after this commit: `src/app/backend/local-league-archive-backend.service.ts` exports `LOCAL_LEAGUE_STORE = 'leagues'` for the legacy `gones-leagues` database, and your new adapter exports `LOCAL_LEAGUE_STORE = 'leagues'` for `gones-archive-local`. Two modules, two bindings, no global collision — this is the frozen contract and it is deliberate. Never import both into one file without aliasing.

## Requirements

1. `src/app/domain/archive-models.ts` exists and declares the three tiers `ArchiveLeagueDocument`, `LeagueSeasonDocument`, `ArchiveTournamentDocument` plus their `Persisted*` twins, `ArchiveBundle`, `ARCHIVE_DATA_VERSION = 5` and `SUPPORTED_ARCHIVE_IMPORT_VERSIONS = [5]`, exactly as given in *Interface contract*.
2. The shared non-archive shapes are **re-exported** from `./models`, never re-declared: `LeagueStatus`, `RoundDocument`, `RoundEntry`, `MatchRoundEntry`, `ByeRoundEntry`, `InvalidRoundEntry`, `PlayerArchetypeDocument`, `CalendarEventDocument`.
3. `ARCHIVE_LOCK_WINDOW_DAYS = 365` and `isArchiveTournamentLocked(tournamentDate, now?)` exist in `archive-models.ts` with the exact signature in *Interface contract*. Semantics: `locked ⇔ (now − tournamentDate) > 365`, compared on **whole UTC calendar days**. Exactly 365 days old is **not** locked; 366 days old **is**. A future date is never locked. An unparseable date is never locked.
4. `src/app/data/archive-origin.ts` exists, exports `LOCAL_ARCHIVE_ID_PREFIX = 'local-'`, `isLocalArchiveId`, `newLocalArchiveId`, and carries **no placeholder concept** — `PLACEHOLDER_LEAGUE_ID` is retired by this plan and must not appear in any new file.
5. `src/app/data/archive-summary.ts` exists, declares the six read-model shapes of the wire contract verbatim (`ArchiveCatalogResponse<T>`, `ArchiveLeagueSummary`, `ArchiveLeagueSeasonSummary`, `ArchiveTournamentSummary`, `ArchiveYearEntry`, `ArchiveYearsResponse`), and derives the browser half of the catalog with `summarizeArchiveLeague`, `summarizeLeagueSeason`, `summarizeArchiveTournament`. Player counts come from the **existing** standings formula (`calculateTournamentResult` / `calculateLeagueResult` in `src/app/domain/results.ts`), never a second derivation.
6. `archive-summary.ts` also exposes the two row-level lock derivations `isArchiveTournamentRowLocked` and `isLeagueSeasonRowLocked`. **A browser-local row (`local-` id prefix) is never locked**, whatever its date.
7. `src/app/data/archive-command-ux.ts` exists and classifies a failed archive command **on HTTP status first, message/code second**, returning one of `'forbidden' | 'stale' | 'locked' | 'notEmpty' | 'notFound' | 'invalid' | 'failed'`.
8. `src/app/backend/local-archive-backend.service.ts` exists, opens `gones-archive-local` at version `1` with the three object stores `leagues`, `league-seasons`, `tournaments` (all `keyPath: 'id'`), and implements the whole `ArchiveBackendPort` surface in *Interface contract*.
9. The adapter throws `ArchiveConcurrencyError` (`status = 412`, message `'staleArchiveDocument'`, `name = 'ArchiveConcurrencyError'`) on every stale write, `ArchiveLeagueNotEmptyError` (`status = 409`, message `'archiveLeagueNotEmpty'`) when a League with Seasons is deleted, and `ArchiveNotFoundError` (`status = 404`) for a missing row.
10. **Concurrency is per row.** Editing a Tournament never touches its Season's or its League's `documentVersion` or `updatedAt`.
11. Deleting a LeagueSeason **detaches** its Tournaments (`seasonId = null`) in the **same IndexedDB transaction**; it never deletes tournament data.
12. Every one of the five new `*.ts` files has a sibling `*.test.ts` written in this ticket, red before green.
13. `src/app/backend/server-authority-boundary.test.ts` gains `'src/app/backend/local-archive-backend.service.ts'` in its IndexedDB allowlist array — **an addition only**, nothing removed.
14. `npm run test`, `npm run typecheck`, `npm run lint` and `npm run build` all pass. The legacy archive pages still work.

## Inputs

Files to read before writing code (paths are repo-relative to `/home/aron/projects/gones`):

- `src/app/domain/models.ts` — **read-only, never edited by this ticket.** Line 2-4: `GONES_DATA_VERSION = 4`, `SUPPORTED_IMPORT_DATA_VERSIONS = [1, 2, 3, 4]`, `PLACEHOLDER_LEAGUE_ID = 'placeholder-league'`. Line 52-57: `LeagueDocument { id; name; status; tournaments: TournamentDocument[] }`. Line 67: `TournamentDocument.leagueId`. The helpers this slice composes: `createRound({ id, entries }, { idFactory })`, `defaultIdFactory()`, `getDefaultTournamentName(date?)`, `normalizeLeagueStatus(status)` (unknown ⇒ `'active'`), `normalizeTournamentStatus(status)` (**only the literal `'active'` reads active; anything else ⇒ `'completed'`**), `trimPlayerName`, `normalizeDeckArchetype`.
- `src/app/domain/tournament-archetypes.ts:16-41` — `normalizePlayerArchetypes(archetypes: unknown): PlayerArchetypeDocument[]` (dedupes on trimmed player name, sorts by player name) and `derivePlayerArchetypesFromRounds(tournament: Pick<TournamentDocument, 'rounds'>): PlayerArchetypeDocument[]`. These are the **exported** twins of the private pair `createTournament` uses internally; compose them instead of writing a third normalizer.
- `src/app/domain/results.ts:26-40` — `calculateTournamentResult(tournament: TournamentDocument)` and `calculateLeagueResult(league: LeagueDocument)`, both returning `{ …, rows: RankingRow[] }`. `rows.length` **is** the player count the whole app prints.
- `src/app/domain/rename-player.ts:25` — `renamePlayerInTournament(tournament: TournamentDocument, fromName: string, toName: string): TournamentDocument`.
- `src/app/domain/tournament-archetypes.ts:60` — `setTournamentPlayerArchetype(tournament: TournamentDocument, playerName: string, archetype: string): TournamentDocument`.
- `src/app/domain/round-import.ts:15` — `importRoundEntries(text: string, { idFactory }?): ImportResult` where `ImportResult` carries `entries`.
- `src/app/backend/indexed-db.ts` — the promise wrapper to reuse, **the only IndexedDB primitive layer**: `openDatabase(name, version, upgrade)`, `get<T>(db, store, key)`, `getAll<T>(db, store)`, `put(db, store, value)`, `remove(db, store, key)`, `requestResult<T>(request)`, `runTransaction<T>(db, stores, mode, action)`. `runTransaction` resolves only **after** the transaction commits and rolls the whole thing back on any request error.
- `src/app/backend/local-league-archive-backend.service.ts` — **the adapter to mirror, not to edit.** Lines 36-49 declare `LOCAL_LEAGUE_DB_NAME = 'gones-leagues'`, `LOCAL_LEAGUE_STORE = 'leagues'`, `const LOCAL_LEAGUE_DB_VERSION = 1`, and `class LeagueConcurrencyError extends Error { readonly status = 412; constructor() { super('staleLeagueDocument'); this.name = 'LeagueConcurrencyError'; } }`. Also mirror: the private `mutate` / `mutateTournament` / `mutateRound` ladder, the `require` + `persist` pair, and the `open()` that never memoizes a failed open.
- `src/app/data/league-archive-summary.ts` — the legacy summary: interface `LeagueArchiveSummary` + `summarizeLeague(league: PersistedLeague)` deriving `tournamentCount` and `playerCount` locally.
- `src/app/data/league-archive-origin.ts` — the legacy origin rule: `LOCAL_LEAGUE_ID_PREFIX = 'local-'`, `isLocalLeagueId`, `newLocalLeagueId(uuid = crypto.randomUUID())`.
- `src/app/data/league-archive-command-ux.ts` — the legacy classifier: `canManageLeagues`, `canManageLeague`, `createLeagueTarget`, `leagueCommandError` (status `403` ⇒ `'forbidden'`, `412` ⇒ `'stale'`, `Error.message === 'staleLeagueDocument'` ⇒ `'stale'`, else `'failed'`), and the duck-typed status read for non-`ApiProblemError` shapes.
- `src/app/api/api-boundary.ts:8-22` — `interface ApiProblemDetails { type?; title?; status?; code?; message?; traceId?; errors? }` and `class ApiProblemError extends Error { constructor(readonly status: number, readonly problem: ApiProblemDetails) }`. The wire `code` is on `error.problem.code`, not on `error.message`.
- `src/app/backend/local-league-archive-backend.service.test.ts:15-177` — **the in-memory IndexedDB fake to copy verbatim** into your new spec: `FakeStore`, `FakeDatabaseState`, `const databases`, `let failPutAt`, `let putCount`, `let readwriteTransactionCount`, `clone`, `FakeRequest`, `FakeObjectStore`, `FakeTransaction`, `FakeDatabase`, `fakeIndexedDb`, `originalIndexedDb`, `installFakeIndexedDb`. It supports failure injection through `failPutAt` (the Nth `put` throws a `ConstraintError`) and transaction rollback on abort.
- `src/app/backend/server-authority-boundary.test.ts:100-118` — the allowlist assertion you edit. Its `filesMatching(pattern)` helper **walks the real `src/` tree** (skipping `*.test.ts`) and returns the sorted repo-relative paths whose content matches the pattern, then asserts `toEqual` against a literal array. Consequence: a path listed there for a file that does not exist yet **fails the test**.

**From Depends (T2) — spell out, do not go read T2:**

- T2 is a **backend-only** ticket. It touched nothing under `src/**`, so nothing in your working tree changed because of it. There is no frontend artifact to import from it.
- T2 produced the C# mirror of your lock rule, and yours must agree with it day for day:
  ```csharp
  public static class ArchiveLockRule
  {
      public const int LockWindowDays = 365;
      public static bool IsLocked(LocalDate tournamentDate, LocalDate today) =>
          Period.Between(tournamentDate, today, PeriodUnits.Days).Days > LockWindowDays;
  }
  ```
  Whole calendar days, strict `>`. 365 days old ⇒ not locked. 366 days old ⇒ locked. A future date yields a negative day count and is never locked.
- T2 also settled the persisted three-tier shape the wire will carry: a League has `document_id`, `name`, `created_at`, `updated_at`, `version`; a LeagueSeason has `document_id`, `league_id` (NOT NULL), `name`, `status`, `updated_at`, `version` plus the denormalized `tournament_count`, `player_count`, `first_tournament_date`, `last_tournament_date`; a Tournament has `document_id`, `season_id` (**NULL-able**), `name`, `tournament_date`, `status`, the `rounds` + `playerArchetypes` JSON document, `updated_at`, `version`, `player_count`. `version` is an **`int`**, so `documentVersion` on the wire and in your types is a `number`, never a `bigint`.
- T2 pinned the backend player count to `LeagueRules.CalculateTournamentResult(...).Rows.Count` / `CalculateLeagueResult(...).Rows.Count` — the C# twins of `src/app/domain/results.ts`. Your browser-side count must come from the same formula so the two halves of a merged catalog never disagree.

## Interface contract (level 5)

### Produces — `src/app/domain/archive-models.ts` (NEW)

```ts
import { createRound, defaultIdFactory, getDefaultTournamentName, normalizeLeagueStatus, normalizeTournamentStatus } from './models';
import type { CalendarEventDocument, IdFactory, LeagueDocument, LeagueStatus, PlayerArchetypeDocument, RoundDocument, TournamentDocument } from './models';
import { derivePlayerArchetypesFromRounds, normalizePlayerArchetypes } from './tournament-archetypes';

// NOTE: the `export type { … } from './models'` block below creates NO local binding, so every type
// used inside this file — `CalendarEventDocument`, `LeagueStatus`, `PlayerArchetypeDocument`,
// `RoundDocument` — must also appear in the `import type` line above. Both are legal together.

/**
 * Shared non-archive shapes stay in `models.ts` and are re-exported here, never duplicated: two
 * declarations of the same round shape would drift, and every import site would have to pick one.
 */
export type {
  LeagueStatus, RoundDocument, RoundEntry, MatchRoundEntry, ByeRoundEntry,
  InvalidRoundEntry, PlayerArchetypeDocument, CalendarEventDocument
} from './models';

export const ARCHIVE_DATA_VERSION = 5;
export const SUPPORTED_ARCHIVE_IMPORT_VERSIONS = [5] as const;
export const ARCHIVE_LOCK_WINDOW_DAYS = 365;

/** Top tier. Groups Seasons. Has no page of its own — it is a column and a filter. */
export interface ArchiveLeagueDocument {
  id: string;
  name: string;
  createdAt: string;   // ISO 8601 UTC
}

export interface PersistedArchiveLeague extends ArchiveLeagueDocument {
  documentVersion: number;
  updatedAt: string;   // ISO 8601 UTC
  eTag?: string;
}

/** Middle tier. Mandatory parent League. What used to be called a League. */
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

/**
 * Bottom tier, now top-level: every Tournament is its own row. `seasonId: null` means standalone.
 * There is NO `leagueId` — the League is derived by joining through `seasonId`.
 */
export interface ArchiveTournamentDocument {
  id: string;
  name: string;
  seasonId: string | null;
  tournamentDate: string;   // ISO 8601 date, `YYYY-MM-DD`
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

export type ArchiveLeagueInput = Partial<ArchiveLeagueDocument>;
export type LeagueSeasonInput = Partial<LeagueSeasonDocument>;
export interface ArchiveTournamentInput extends Partial<Omit<ArchiveTournamentDocument, 'rounds' | 'playerArchetypes'>> {
  rounds?: RoundDocument[];
  playerArchetypes?: PlayerArchetypeDocument[];
}

export function createArchiveLeague(league?: ArchiveLeagueInput, options?: { idFactory?: IdFactory }): ArchiveLeagueDocument;
export function createLeagueSeason(season?: LeagueSeasonInput, options?: { idFactory?: IdFactory }): LeagueSeasonDocument;
export function createArchiveTournament(tournament?: ArchiveTournamentInput, options?: { idFactory?: IdFactory }): ArchiveTournamentDocument;

export function normalizeArchiveLeague(league?: ArchiveLeagueInput, options?: { idFactory?: IdFactory }): ArchiveLeagueDocument;
export function normalizeLeagueSeason(season?: LeagueSeasonInput, options?: { idFactory?: IdFactory }): LeagueSeasonDocument;
export function normalizeArchiveTournament(tournament?: ArchiveTournamentInput, options?: { idFactory?: IdFactory }): ArchiveTournamentDocument;

/** `''`, whitespace, `null` and `undefined` all mean standalone. */
export function normalizeSeasonId(seasonId: string | null | undefined): string | null;

/** Bridges to the shared standings/rename/archetype functions, which still speak the legacy shape. */
export function toTournamentDocument(tournament: ArchiveTournamentDocument, leagueId?: string): TournamentDocument;
export function toArchiveTournamentDocument(tournament: TournamentDocument, seasonId?: string | null): ArchiveTournamentDocument;
export function toLeagueDocument(season: LeagueSeasonDocument, tournaments: readonly ArchiveTournamentDocument[]): LeagueDocument;

/** A Tournament locks 365 days after the day it was played. Derived, never stored. */
export function isArchiveTournamentLocked(tournamentDate: string, now?: Date): boolean;
```

**Bodies that are not free to vary** — write these exactly:

```ts
const DAY_MS = 86_400_000;
const EPOCH_ISO = '1970-01-01T00:00:00.000Z';

export function normalizeSeasonId(seasonId: string | null | undefined): string | null {
  const text = String(seasonId ?? '').trim();
  return text || null;
}

export function createArchiveLeague(
  { id, name = 'New League', createdAt }: ArchiveLeagueInput = {},
  { idFactory = defaultIdFactory }: { idFactory?: IdFactory } = {}
): ArchiveLeagueDocument {
  return {
    id: id ?? idFactory(),
    name: String(name || 'New League').trim() || 'New League',
    createdAt: normalizeInstant(createdAt)
  };
}

export function createLeagueSeason(
  { id, name = 'New Season', leagueId = '', status }: LeagueSeasonInput = {},
  { idFactory = defaultIdFactory }: { idFactory?: IdFactory } = {}
): LeagueSeasonDocument {
  return {
    id: id ?? idFactory(),
    name: String(name || 'New Season').trim() || 'New Season',
    leagueId: String(leagueId ?? ''),
    status: normalizeLeagueStatus(status)
  };
}

export function createArchiveTournament(
  { id, name = getDefaultTournamentName(), seasonId = null, tournamentDate = '', status, rounds = [], playerArchetypes }: ArchiveTournamentInput = {},
  { idFactory = defaultIdFactory }: { idFactory?: IdFactory } = {}
): ArchiveTournamentDocument {
  const normalizedRounds = (Array.isArray(rounds) ? rounds : []).map((round) => createRound(round, { idFactory }));
  return {
    id: id ?? idFactory(),
    name: String(name || getDefaultTournamentName()).trim() || getDefaultTournamentName(),
    seasonId: normalizeSeasonId(seasonId),
    tournamentDate: String(tournamentDate ?? ''),
    status: normalizeTournamentStatus(status),
    rounds: normalizedRounds,
    playerArchetypes: normalizePlayerArchetypes(playerArchetypes ?? derivePlayerArchetypesFromRounds({ rounds: normalizedRounds }))
  };
}

export function toTournamentDocument(tournament: ArchiveTournamentDocument, leagueId = ''): TournamentDocument {
  const { seasonId: _seasonId, ...rest } = tournament;
  return { ...rest, leagueId };
}

export function toArchiveTournamentDocument(tournament: TournamentDocument, seasonId: string | null = null): ArchiveTournamentDocument {
  const { leagueId: _leagueId, ...rest } = tournament;
  return { ...rest, seasonId: normalizeSeasonId(seasonId) };
}

export function toLeagueDocument(season: LeagueSeasonDocument, tournaments: readonly ArchiveTournamentDocument[]): LeagueDocument {
  return {
    id: season.id,
    name: season.name,
    status: season.status,
    tournaments: tournaments.map((tournament) => toTournamentDocument(tournament, season.id))
  };
}

/**
 * `locked ⇔ (now − tournamentDate) > 365`, counted in whole UTC calendar days. Exactly 365 days old
 * is not locked; 366 days old is. Compared on the UTC day on purpose: the same row must lock on the
 * same date for every reader, whatever their timezone, and must agree with the C# `ArchiveLockRule`.
 */
export function isArchiveTournamentLocked(tournamentDate: string, now: Date = new Date()): boolean {
  const played = utcDayNumber(tournamentDate);
  if (played === null) return false;
  const today = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / DAY_MS);
  return today - played > ARCHIVE_LOCK_WINDOW_DAYS;
}

/** A stored date that does not round-trip (`2026-02-30`, `2027-02-29`, junk) is not a date at all. */
function utcDayNumber(date: string): number | null {
  const text = String(date ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const value = Date.parse(`${text}T00:00:00.000Z`);
  if (Number.isNaN(value)) return null;
  return new Date(value).toISOString().slice(0, 10) === text ? Math.floor(value / DAY_MS) : null;
}

/** Canonical UTC ISO 8601, or the epoch for a row that never carried a stamp. */
function normalizeInstant(value: unknown, fallback = EPOCH_ISO): string {
  const parsed = Date.parse(String(value ?? '').trim());
  return Number.isNaN(parsed) ? fallback : new Date(parsed).toISOString();
}
```

`normalizeArchiveLeague` / `normalizeLeagueSeason` / `normalizeArchiveTournament` are one-line delegations to their `create*` twin, exactly like `normalizeLeague` delegates to `createLeague` in `models.ts`.

**`createArchiveLeague` uses the epoch fallback for a missing `createdAt`.** A brand-new League is created by the adapter, which passes an explicit `createdAt`; the fallback exists only for a stored row that lost the field, and a non-deterministic `new Date()` inside a normalizer would make every read return a different document.

### Produces — `src/app/data/archive-origin.ts` (NEW)

```ts
/** A record authored in this browser carries this prefix; it is the whole routing rule (ADR 0028). */
export const LOCAL_ARCHIVE_ID_PREFIX = 'local-';

export function isLocalArchiveId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(LOCAL_ARCHIVE_ID_PREFIX);
}

export function newLocalArchiveId(uuid = crypto.randomUUID()): string {
  return `${LOCAL_ARCHIVE_ID_PREFIX}${uuid}`;
}
```

There is **no** placeholder export here. `PLACEHOLDER_LEAGUE_ID` / `Unassigned Tournaments` are retired by this plan and replaced by `seasonId: null`; the string `placeholder` must not appear in any file this ticket creates.

### Produces — `src/app/data/archive-summary.ts` (NEW)

The six read-model shapes are the **wire contract, frozen**. Field names, nullability and optionality are copied verbatim; do not add a field, do not widen a type.

```ts
import { isArchiveTournamentLocked, toLeagueDocument, toTournamentDocument } from '../domain/archive-models';
import type {
  ArchiveTournamentDocument, LeagueStatus, PersistedArchiveLeague, PersistedArchiveTournament, PersistedLeagueSeason
} from '../domain/archive-models';
import { calculateLeagueResult, calculateTournamentResult } from '../domain/results';
import { isLocalArchiveId } from './archive-origin';

export interface ArchiveCatalogResponse<T> {
  items: T[];
  totalCount: number;
  truncated: boolean;
}

export interface ArchiveLeagueSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  documentVersion: number;
}

export interface ArchiveLeagueSeasonSummary {
  id: string;
  name: string;
  leagueId: string;
  status: LeagueStatus;
  updatedAt: string;
  documentVersion: number;
  tournamentCount: number;
  playerCount: number;
  firstTournamentDate: string | null;   // null when the Season has no Tournament
  lastTournamentDate: string | null;
}

export interface ArchiveTournamentSummary {
  id: string;
  name: string;
  seasonId: string | null;
  tournamentDate: string;
  status: LeagueStatus;
  updatedAt: string;
  documentVersion: number;
  playerCount: number;
}

export interface ArchiveYearEntry {
  year: number;
  locked: boolean;
  tournamentCount: number;
}

export interface ArchiveYearsResponse {
  years: ArchiveYearEntry[];   // ascending by year
}

export function summarizeArchiveLeague(league: PersistedArchiveLeague): ArchiveLeagueSummary;
export function summarizeLeagueSeason(season: PersistedLeagueSeason, tournaments: readonly ArchiveTournamentDocument[]): ArchiveLeagueSeasonSummary;
export function summarizeArchiveTournament(tournament: PersistedArchiveTournament): ArchiveTournamentSummary;

/** The row-level lock: a browser-local row is never locked, whatever its date. */
export function isArchiveTournamentRowLocked(row: Pick<ArchiveTournamentSummary, 'id' | 'tournamentDate'>, now?: Date): boolean;

/** A Season is locked when every one of its Tournaments is — i.e. when its latest one is. */
export function isLeagueSeasonRowLocked(row: Pick<ArchiveLeagueSeasonSummary, 'id' | 'lastTournamentDate'>, now?: Date): boolean;
```

**Bodies that are not free to vary:**

```ts
export function summarizeLeagueSeason(season: PersistedLeagueSeason, tournaments: readonly ArchiveTournamentDocument[]): ArchiveLeagueSeasonSummary {
  const dates = tournaments.map((tournament) => tournament.tournamentDate).filter(Boolean).sort((left, right) => left.localeCompare(right));
  return {
    id: season.id,
    name: season.name,
    leagueId: season.leagueId,
    status: season.status,
    updatedAt: season.updatedAt,
    documentVersion: season.documentVersion,
    tournamentCount: tournaments.length,
    playerCount: calculateLeagueResult(toLeagueDocument(season, tournaments)).rows.length,
    firstTournamentDate: dates[0] ?? null,
    lastTournamentDate: dates.at(-1) ?? null
  };
}

export function summarizeArchiveTournament(tournament: PersistedArchiveTournament): ArchiveTournamentSummary {
  return {
    id: tournament.id,
    name: tournament.name,
    seasonId: tournament.seasonId,
    tournamentDate: tournament.tournamentDate,
    status: tournament.status,
    updatedAt: tournament.updatedAt,
    documentVersion: tournament.documentVersion,
    playerCount: calculateTournamentResult(toTournamentDocument(tournament)).rows.length
  };
}

export function isArchiveTournamentRowLocked(row: Pick<ArchiveTournamentSummary, 'id' | 'tournamentDate'>, now: Date = new Date()): boolean {
  return !isLocalArchiveId(row.id) && isArchiveTournamentLocked(row.tournamentDate, now);
}

export function isLeagueSeasonRowLocked(row: Pick<ArchiveLeagueSeasonSummary, 'id' | 'lastTournamentDate'>, now: Date = new Date()): boolean {
  return row.lastTournamentDate !== null && !isLocalArchiveId(row.id) && isArchiveTournamentLocked(row.lastTournamentDate, now);
}
```

**No summary carries an `isLocal` flag.** The wire shapes are frozen and origin is already encoded in the id, so a caller that needs it calls `isLocalArchiveId(row.id)`. This is the one deliberate divergence from the legacy `LeagueArchiveSummary`, which does carry `isLocal`.

### Produces — `src/app/data/archive-command-ux.ts` (NEW)

```ts
import { ApiProblemError } from '../api/api-boundary';
import { isLocalArchiveId } from './archive-origin';

export type GlobalRole = 'User' | 'Organizer' | 'Admin' | string;
export type ArchiveCommandError = 'forbidden' | 'stale' | 'locked' | 'notEmpty' | 'notFound' | 'invalid' | 'failed';

/** The server owns archive data, so managing it is a role question only (ADR 0020). */
export function canManageArchive(role: GlobalRole | null | undefined): boolean {
  return role === 'Organizer' || role === 'Admin';
}

/** A record in this browser is owned by whoever can see it; a server record needs the role (ADR 0028). */
export function canManageArchiveRecord(id: string | null | undefined, role: GlobalRole | null | undefined): boolean {
  return isLocalArchiveId(id) || canManageArchive(role);
}

/** Where a brand-new record is written. */
export function createArchiveTarget(role: GlobalRole | null | undefined): 'server' | 'local' {
  return canManageArchive(role) ? 'server' : 'local';
}

/**
 * HTTP status first, code/message second. The wire vocabulary is snake_case because that is what
 * `Gones.Api/Errors/ApiExceptions.cs` emits API-wide; the browser-local authority raises camelCase
 * messages because those are local strings, never wire codes. Both are accepted here so one classifier
 * serves both authorities.
 */
export function archiveCommandError(error: unknown): ArchiveCommandError {
  const status = errorStatus(error);
  const code = error instanceof ApiProblemError ? error.problem.code : undefined;
  const message = error instanceof Error ? error.message : undefined;
  if (status === 403) return 'forbidden';
  if (status === 412) return 'stale';
  if (status === 404) return 'notFound';
  if (status === 400) return 'invalid';
  if (status === 409) {
    if (code === 'archive_league_not_empty' || message === 'archiveLeagueNotEmpty') return 'notEmpty';
    if (code === 'archive_tournament_locked' || message === 'archiveTournamentLocked') return 'locked';
    return 'failed';
  }
  if (message === 'staleArchiveDocument') return 'stale';
  return 'failed';
}

function errorStatus(error: unknown): number | undefined {
  if (error instanceof ApiProblemError) return error.status;
  return typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
    ? error.status
    : undefined;
}
```

### Produces — `src/app/backend/local-archive-backend.service.ts` (NEW)

```ts
export const LOCAL_ARCHIVE_DB_NAME = 'gones-archive-local';
export const LOCAL_ARCHIVE_DB_VERSION = 1;
export const LOCAL_LEAGUE_STORE = 'leagues';
export const LOCAL_LEAGUE_SEASON_STORE = 'league-seasons';
export const LOCAL_TOURNAMENT_STORE = 'tournaments';

/**
 * Stale-write rejection with the shape `archive-command-ux.ts` classifies as `stale`: it keys on
 * `status === 412` first and on this exact message second, so both authorities produce the identical
 * "reload the latest document and reapply" conflict UX. The message stays camelCase on purpose — it
 * is a browser-local string, not a wire code.
 */
export class ArchiveConcurrencyError extends Error {
  readonly status = 412;

  constructor() {
    super('staleArchiveDocument');
    this.name = 'ArchiveConcurrencyError';
  }
}

/** A League is deleted only once it holds no Season. Mirrors the server's `409`. */
export class ArchiveLeagueNotEmptyError extends Error {
  readonly status = 409;

  constructor() {
    super('archiveLeagueNotEmpty');
    this.name = 'ArchiveLeagueNotEmptyError';
  }
}

/** `subject` names the tier, so a caller can phrase the message; the classifier only reads `status`. */
export class ArchiveNotFoundError extends Error {
  readonly status = 404;

  constructor(readonly subject: 'league' | 'leagueSeason' | 'tournament') {
    super('archiveRecordNotFound');
    this.name = 'ArchiveNotFoundError';
  }
}

export interface ArchiveRoundIntent {
  roundId: string;
  entries: RoundEntry[];
}

/**
 * One staged save (ADR 0037). Because a Tournament is now its own row with its own version, a move
 * is just `moveToSeasonId` inside the same batch — there is no second document to version-guard.
 * `moveToSeasonId` absent ⇒ the Tournament does not move. Present and `null` ⇒ it becomes standalone.
 */
export interface ArchiveTournamentEditBatch {
  editTournament?: { name: string; tournamentDate: string };
  status?: LeagueStatus;
  moveToSeasonId?: string | null;
  addRounds: ArchiveRoundIntent[];
  deleteRoundIds: string[];
  replaceRounds: ArchiveRoundIntent[];
  updateArchetypes: { playerName: string; archetype: string }[];
}

export interface ArchiveRestoreResult {
  leagues: PersistedArchiveLeague[];
  leagueSeasons: PersistedLeagueSeason[];
  tournaments: PersistedArchiveTournament[];
}

/**
 * The archive authority port. Implemented here by the browser-local store; the server adapter
 * implements the same shape against `/api/archive/**` in a later ticket, which is why every create
 * and the restore accept an optional `idempotencyKey` this implementation ignores.
 */
export interface ArchiveBackendPort {
  listArchiveLeagues(): Promise<ArchiveCatalogResponse<PersistedArchiveLeague>>;
  listArchiveLeagueSummaries(): Promise<ArchiveCatalogResponse<ArchiveLeagueSummary>>;
  listLeagueSeasons(): Promise<ArchiveCatalogResponse<PersistedLeagueSeason>>;
  listLeagueSeasonSummaries(): Promise<ArchiveCatalogResponse<ArchiveLeagueSeasonSummary>>;
  listArchiveTournaments(): Promise<ArchiveCatalogResponse<PersistedArchiveTournament>>;
  listArchiveTournamentSummaries(): Promise<ArchiveCatalogResponse<ArchiveTournamentSummary>>;
  listSeasonTournamentSummaries(seasonId: string | null): Promise<ArchiveCatalogResponse<ArchiveTournamentSummary>>;
  getArchiveLeague(id: string): Promise<PersistedArchiveLeague | null>;
  getLeagueSeason(id: string): Promise<PersistedLeagueSeason | null>;
  getArchiveTournament(id: string): Promise<PersistedArchiveTournament | null>;

  createArchiveLeague(name: string, idempotencyKey?: string): Promise<PersistedArchiveLeague>;
  renameArchiveLeague(id: string, expectedVersion: number, name: string): Promise<PersistedArchiveLeague>;
  deleteArchiveLeague(id: string, expectedVersion: number): Promise<void>;

  createLeagueSeason(leagueId: string, name: string, idempotencyKey?: string): Promise<PersistedLeagueSeason>;
  renameLeagueSeason(id: string, expectedVersion: number, name: string): Promise<PersistedLeagueSeason>;
  changeLeagueSeasonStatus(id: string, expectedVersion: number, status: LeagueStatus): Promise<PersistedLeagueSeason>;
  moveLeagueSeason(id: string, expectedVersion: number, leagueId: string): Promise<PersistedLeagueSeason>;
  deleteLeagueSeason(id: string, expectedVersion: number): Promise<void>;

  createArchiveTournament(seasonId: string | null, name: string, tournamentDate: string, idempotencyKey?: string): Promise<PersistedArchiveTournament>;
  editArchiveTournament(id: string, expectedVersion: number, name: string, tournamentDate: string): Promise<PersistedArchiveTournament>;
  moveArchiveTournament(id: string, expectedVersion: number, seasonId: string | null): Promise<PersistedArchiveTournament>;
  deleteArchiveTournament(id: string, expectedVersion: number): Promise<void>;
  addArchiveRound(id: string, expectedVersion: number): Promise<PersistedArchiveTournament>;
  deleteArchiveRound(id: string, roundId: string, expectedVersion: number): Promise<PersistedArchiveTournament>;
  importArchiveRound(id: string, roundId: string, expectedVersion: number, text: string): Promise<PersistedArchiveTournament>;
  replaceArchiveRound(id: string, roundId: string, expectedVersion: number, entries: RoundEntry[]): Promise<PersistedArchiveTournament>;
  addArchiveEntry(id: string, roundId: string, expectedVersion: number, entry: RoundEntry): Promise<PersistedArchiveTournament>;
  editArchiveEntry(id: string, roundId: string, entryId: string, expectedVersion: number, entry: RoundEntry): Promise<PersistedArchiveTournament>;
  deleteArchiveEntry(id: string, roundId: string, entryId: string, expectedVersion: number): Promise<PersistedArchiveTournament>;
  updateArchiveTournamentArchetype(id: string, expectedVersion: number, playerName: string, archetype: string): Promise<PersistedArchiveTournament>;
  renameArchiveTournamentPlayer(id: string, expectedVersion: number, fromName: string, toName: string): Promise<PersistedArchiveTournament>;
  applyArchiveTournamentEditBatch(id: string, expectedVersion: number, batch: ArchiveTournamentEditBatch): Promise<PersistedArchiveTournament>;

  restoreArchiveBundle(bundle: ArchiveBundle, idempotencyKey?: string): Promise<ArchiveRestoreResult>;
}

@Injectable({ providedIn: 'root' })
export class LocalArchiveBackend implements ArchiveBackendPort { /* … */ }
```

**Behaviour, binding, per method group:**

| Method group | Contract |
| --- | --- |
| every `list*` | `truncated: false`, `totalCount: items.length` — the browser store has no row cap, so its catalog is never truncated. |
| `listArchiveLeagues` / `listArchiveLeagueSummaries` | ordered `updatedAt DESC, id ASC` — the wire order of `GET /api/archive/leagues/all`. |
| `listLeagueSeasons` / `listLeagueSeasonSummaries` | ordered `updatedAt DESC, id ASC`. Each summary is built from the Season **and** the Tournaments that reference it, read in the same transaction. |
| `listArchiveTournaments` / `listArchiveTournamentSummaries` | ordered `tournamentDate DESC, id ASC`. |
| `listSeasonTournamentSummaries(seasonId)` | the Tournaments whose `seasonId === seasonId`; `null` selects the standalone ones. Ordered `tournamentDate DESC, id ASC`. |
| every `get*` | `null` for an absent id. Never throws for absence. |
| every command taking `expectedVersion` | version mismatch ⇒ `ArchiveConcurrencyError`, **before** any write. Absent row ⇒ `ArchiveNotFoundError`. |
| every successful command | `documentVersion += 1`, `updatedAt = new Date().toISOString()` on **its own row only**. |
| `createArchiveLeague(name)` | id `newLocalArchiveId()`, `createdAt = updatedAt = now`, `documentVersion = 1`. |
| `createLeagueSeason(leagueId, name)` | the League must exist ⇒ else `ArchiveNotFoundError('league')`. `status: 'active'`. |
| `createArchiveTournament(seasonId, name, tournamentDate)` | a non-null Season must exist ⇒ else `ArchiveNotFoundError('leagueSeason')`. `status: 'active'`, empty `rounds`, empty `playerArchetypes`. |
| `deleteArchiveLeague` | one `readwrite` transaction over `[leagues, league-seasons]`: any Season referencing it ⇒ `ArchiveLeagueNotEmptyError`, nothing written. |
| `deleteLeagueSeason` | one `readwrite` transaction over `[league-seasons, tournaments]`: the Season row is removed **and** every Tournament with that `seasonId` is rewritten with `seasonId: null`, `documentVersion + 1`, a fresh `updatedAt`. Never deletes tournament data. |
| `moveArchiveTournament` / batch `moveToSeasonId` | a non-null target Season must exist ⇒ else `ArchiveNotFoundError('leagueSeason')`. `null` detaches to standalone. |
| tournament round/entry/archetype/rename commands | compose the shared pure functions — `createRound`, `importRoundEntries(text).entries`, `renamePlayerInTournament`, `setTournamentPlayerArchetype` — through the `toTournamentDocument` / `toArchiveTournamentDocument` bridge. No rule is reimplemented here. |
| `applyArchiveTournamentEditBatch` | validates, then applies **`editTournament` → `deleteRoundIds` → `replaceRounds` → `addRounds` → `updateArchetypes` → `status` → `moveToSeasonId`**, in that order, as **one** version bump. |
| `restoreArchiveBundle` | additive. Every row lands under a **fresh** `local-` id and every parent link is remapped to the new ids; League names are uniquified against the store. All three stores are written in one transaction. `bundle.calendarEvents` is **ignored** — the Calendar is server-owned and is not part of the browser-local archive. |

**Edit-batch validation, exact messages** (mirrors the legacy `applyLocalEditBatch`, minus everything that only made sense with a parent League):

```
!Array.isArray(addRounds|deleteRoundIds|replaceRounds|updateArchetypes)  → Error('invalidArchiveTournamentEditBatch')
no editTournament, no status, no moveToSeasonId key, all four arrays empty → Error('emptyArchiveTournamentEditBatch')
editTournament.name.trim() === ''                                        → Error('tournamentNameRequired')
duplicate roundId inside addRounds                                       → Error('duplicateAddRound')
duplicate id inside deleteRoundIds                                       → Error('duplicateDeleteRound')
duplicate roundId inside replaceRounds                                   → Error('duplicateReplaceRound')
an added roundId that is not a v4-shaped UUID                            → Error('invalidRoundId')
an added roundId that already exists on the Tournament                   → Error('roundAlreadyExists')
a deleted or replaced roundId that does not exist                        → Error('roundNotFound')
a roundId in both deleteRoundIds and replaceRounds                       → Error('conflictingRoundIntents')
a blank or duplicated archetype player name                              → Error('duplicateArchetypeIntent')
```

The UUID shape check is the existing one, copied verbatim:
`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`.

**There is no status gate on a Tournament edit.** The legacy adapter refused every write to a non-`active` League (`completedLeagueCannotBeEdited`); in the three-tier model an archived Tournament is `completed` **by default** — that is what `normalizeTournamentStatus` means — so gating on status would make the archive read-only. The only write guards are `documentVersion` and, on the server, the 365-day lock.

**The lock never fires in this adapter.** Every row it holds carries a `local-` id and browser-local records are never locked, so no lock check is written here. This is asserted by a test, not left implicit.

**The private ladder to mirror** (`this.database` memoization included):

```ts
private open(): Promise<IDBDatabase> {
  if (!this.database) {
    this.database = openDatabase(LOCAL_ARCHIVE_DB_NAME, LOCAL_ARCHIVE_DB_VERSION, (database) => {
      for (const store of [LOCAL_LEAGUE_STORE, LOCAL_LEAGUE_SEASON_STORE, LOCAL_TOURNAMENT_STORE]) {
        if (!database.objectStoreNames.contains(store)) database.createObjectStore(store, { keyPath: 'id' });
      }
    }).catch((error: unknown) => {
      this.database = undefined; // never memoize a failed open: a later call must retry
      throw error;
    });
  }
  return this.database;
}
```

Row rehydration, one per tier, all deterministic:

```ts
private persistLeague(row: Partial<PersistedArchiveLeague>): PersistedArchiveLeague {
  return { ...normalizeArchiveLeague(row), documentVersion: row.documentVersion ?? 1, updatedAt: row.updatedAt ?? EPOCH_ISO };
}
```

with `const EPOCH_ISO = '1970-01-01T00:00:00.000Z';` local to the adapter, and the same pattern for `persistSeason` (`normalizeLeagueSeason`) and `persistTournament` (`normalizeArchiveTournament`).

**No IndexedDB index is created.** The three stores are keyed by `id` and nothing else; `listSeasonTournamentSummaries` filters in memory. A browser-local archive is authored by hand and is small, and adding an index would force `LOCAL_ARCHIVE_DB_VERSION` above the contracted `1`.

### Produces — allowlist edit, `src/app/backend/server-authority-boundary.test.ts`

Inside `it('confines IndexedDB to the sanctioned local adapters', …)`, the current assertion is exactly:

```ts
    expect(filesMatching(/\bindexedDB\b|\bIDB[A-Z]\w*/)).toEqual([
      // Promise wrapper over the raw request/transaction API. No data rules.
      'src/app/backend/indexed-db.ts',
      // The League browser-local adapter (ADR 0028), composing the pure domain.
      'src/app/backend/local-league-archive-backend.service.ts',
      // The Live browser-local adapter itself (anonymous + `User`), composing the pure domain.
      'src/app/backend/local-live-backend.service.ts',
      // Per-user offline read cache for server responses (ADR 0031). Reads only; purged on logout.
      'src/app/backend/server-read-cache.service.ts'
    ]);
```

It becomes exactly:

```ts
    expect(filesMatching(/\bindexedDB\b|\bIDB[A-Z]\w*/)).toEqual([
      // Promise wrapper over the raw request/transaction API. No data rules.
      'src/app/backend/indexed-db.ts',
      // The three-tier archive browser-local authority (ADR 0028), composing the pure domain.
      'src/app/backend/local-archive-backend.service.ts',
      // The League browser-local adapter (ADR 0028), composing the pure domain.
      'src/app/backend/local-league-archive-backend.service.ts',
      // The Live browser-local adapter itself (anonymous + `User`), composing the pure domain.
      'src/app/backend/local-live-backend.service.ts',
      // Per-user offline read cache for server responses (ADR 0031). Reads only; purged on logout.
      'src/app/backend/server-read-cache.service.ts'
    ]);
```

One line added, one comment added, **nothing removed**, and the array stays sorted (`filesMatching` returns `.sort()`ed paths, and `local-archive-…` sorts before `local-league-…`).

### Consumes

- **From `src/app/domain/models.ts`** (unchanged, imported never edited): `createRound`, `defaultIdFactory`, `getDefaultTournamentName`, `normalizeLeagueStatus`, `normalizeTournamentStatus`, and the types listed in *Assumptions in force 3*.
- **From `src/app/domain/tournament-archetypes.ts`**: `normalizePlayerArchetypes(archetypes: unknown): PlayerArchetypeDocument[]`, `derivePlayerArchetypesFromRounds(tournament: Pick<TournamentDocument, 'rounds'>): PlayerArchetypeDocument[]`, `setTournamentPlayerArchetype(tournament: TournamentDocument, playerName: string, archetype: string): TournamentDocument`.
- **From `src/app/domain/results.ts`**: `calculateTournamentResult(tournament: TournamentDocument)`, `calculateLeagueResult(league: LeagueDocument)`, both `{ …, rows: RankingRow[] }`.
- **From `src/app/domain/rename-player.ts`**: `renamePlayerInTournament(tournament: TournamentDocument, fromName: string, toName: string): TournamentDocument`.
- **From `src/app/domain/round-import.ts`**: `importRoundEntries(text: string, { idFactory }?): ImportResult` with `ImportResult.entries: RoundEntry[]`.
- **From `src/app/backend/indexed-db.ts`**: `openDatabase`, `get`, `getAll`, `put`, `remove`, `requestResult`, `runTransaction`.
- **From `src/app/api/api-boundary.ts`**: `ApiProblemError` with `readonly status: number` and `readonly problem: ApiProblemDetails` (`problem.code?: string`).
- **From the wire contract (binding, produced by the backend tickets, consumed as shapes only here — no HTTP call is made by this ticket):** the six read-model shapes reproduced verbatim in *Produces — archive-summary.ts*, and the error vocabulary `stale_version` (`412`), `not_found` (`404`), `validation_failed` (`400`), `archive_tournament_locked` (`409`), `archive_league_not_empty` (`409`), forbidden (`403`).

### Errors

| Thrower | Type | `status` | `message` | Raised when |
| --- | --- | --- | --- | --- |
| `local-archive-backend.service.ts` | `ArchiveConcurrencyError` | `412` | `staleArchiveDocument` | `expectedVersion !== row.documentVersion` on any command |
| `local-archive-backend.service.ts` | `ArchiveLeagueNotEmptyError` | `409` | `archiveLeagueNotEmpty` | `deleteArchiveLeague` while a Season references it |
| `local-archive-backend.service.ts` | `ArchiveNotFoundError` | `404` | `archiveRecordNotFound` | the addressed row, or a named parent, is absent |
| `local-archive-backend.service.ts` | `Error` | — | `unsupportedArchiveBundleVersion` | `restoreArchiveBundle` with `version` not in `SUPPORTED_ARCHIVE_IMPORT_VERSIONS` |
| `local-archive-backend.service.ts` | `Error` | — | the eleven edit-batch strings tabulated above | staged-edit validation |
| `indexed-db.ts` (existing) | `Error` | — | `indexedDbUnavailable` / `indexedDbBlocked` / `indexedDbOpenFailed` / `indexedDbTransactionFailed` / `indexedDbTransactionAborted` | environment / transaction failures, unchanged |

`archiveCommandError` maps them: `412 ⇒ 'stale'`, `409 + archiveLeagueNotEmpty ⇒ 'notEmpty'`, `409 + archive_tournament_locked ⇒ 'locked'`, `404 ⇒ 'notFound'`, `403 ⇒ 'forbidden'`, `400 ⇒ 'invalid'`, everything else `'failed'`.

### Invariants

1. **Lock:** `isArchiveTournamentLocked(d, now) ⇔ utcDay(now) − utcDay(d) > 365`. 365 ⇒ `false`, 366 ⇒ `true`, future ⇒ `false`, unparseable ⇒ `false`. Pure; no `Date.now()` beyond the defaulted `now` argument.
2. **Local rows never lock:** `isArchiveTournamentRowLocked({ id: 'local-…', tournamentDate })` is `false` for every date. Same for `isLeagueSeasonRowLocked`.
3. **Per-row concurrency:** a Tournament write bumps the Tournament row only. Its Season's and its League's `documentVersion` and `updatedAt` are byte-identical before and after.
4. **Detach, never cascade:** after `deleteLeagueSeason(id, v)` the Season row is gone and every Tournament that referenced it still exists with `seasonId === null`.
5. **Atomicity:** `deleteLeagueSeason`, `deleteArchiveLeague` and `restoreArchiveBundle` each run in exactly one `runTransaction` call. A failure inside leaves **every** store as it was.
6. **`seasonId` nullability:** `null` is the only "no Season" value stored. `''`, `'  '` and `undefined` are normalized to `null` on the way in; a stored `''` never survives a read.
7. **Ordering:** `tournamentDate DESC, id ASC` for tournament catalogs; `updatedAt DESC, id ASC` for league and season catalogs. Ties break on `id` ascending, always, so a list is deterministic.
8. **Restore is additive and id-minting:** no id from a bundle is ever reused, so importing the same bundle twice yields two independent copies and can never overwrite a live record.
9. **`truncated` is always `false`** from this adapter, and `totalCount === items.length`.
10. **Units:** `tournamentDate` is a `YYYY-MM-DD` calendar date with no time and no zone. `createdAt` / `updatedAt` are ISO 8601 **UTC** instants ending in `Z`. `documentVersion` is a positive integer starting at `1`.
11. **Idempotency:** `getArchiveLeague` / `getLeagueSeason` / `getArchiveTournament` and every `list*` are side-effect free — in particular, listing an empty store creates **no** row. (The legacy adapter seeded a placeholder League on list; this one must not, because the placeholder is retired.)

## TDD

1. **Red** — for each of the five modules, write its `*.test.ts` first and run it. Every test must fail for the right reason (module not found, then wrong value), never pass by accident. Named failing tests are listed in *Test plan*.
2. **Green** — write the minimum implementation that satisfies the named tests, following the level-5 contract above to the letter.
3. **Refactor** — only to remove duplication inside the adapter's private ladder. Keep every test green. No public signature changes.

Order is strict: `archive-models` → `archive-origin` → `archive-summary` → `archive-command-ux` → `local-archive-backend` → allowlist. Each module is green before the next one starts, because each depends on the previous.

## Test plan

Run any single file with `npx vitest run <path>`.

### `src/app/domain/archive-models.test.ts`

| Test | Input | Expect |
| ---- | ----- | ------ |
| `the archive bundle version is 5 and only 5 imports` | — | `ARCHIVE_DATA_VERSION === 5`, `[...SUPPORTED_ARCHIVE_IMPORT_VERSIONS]` `toEqual([5])`, `ARCHIVE_LOCK_WINDOW_DAYS === 365` |
| `a Tournament played today is not locked` | `('2026-08-22', new Date('2026-08-22T00:00:00.000Z'))` | `false` |
| `a Tournament played exactly 365 days ago is not locked` | `('2026-08-17', new Date('2027-08-17T23:59:59.999Z'))` | `false` |
| `a Tournament played 366 days ago is locked` | `('2026-08-17', new Date('2027-08-18T00:00:00.000Z'))` | `true` |
| `the lock compares whole UTC days, not the reader's local day` | `('2026-08-17', new Date('2027-08-18T00:30:00.000Z'))` and `('2026-08-17', new Date('2027-08-17T23:30:00.000Z'))` | `true`, then `false` — identical in every `TZ` |
| `a future Tournament is never locked` | `('2030-01-01', new Date('2027-08-18T00:00:00.000Z'))` | `false` |
| `an unparseable date never locks` | `''`, `'nope'`, `'2027-02-29'`, `'2026-02-30'`, `'17/08/2026'`, each with `new Date('2030-01-01T00:00:00.000Z')` | `false` for all five |
| `a missing season is stored as standalone, never as an empty string` | `createArchiveTournament({})`, `({ seasonId: '' })`, `({ seasonId: '  ' })` | `seasonId === null` for all three |
| `an unknown Tournament status reads completed` | `createArchiveTournament({ status: undefined })` and `({ status: 'active' })` | `'completed'`, then `'active'` |
| `an unknown Season status reads active` | `createLeagueSeason({ status: undefined })` and `({ status: 'completed' })` | `'active'`, then `'completed'` |
| `a Tournament derives its archetypes from its rounds when none are given` | one round, two match entries with archetypes | `playerArchetypes` holds every named player, sorted by name |
| `given archetypes are normalized and deduped` | `[{ playerName: ' Bob ', archetype: 'No Archetype' }, { playerName: 'Bob', archetype: 'Burn' }]` | one row, `{ playerName: 'Bob', archetype: '' }` |
| `a League without a createdAt falls back to the epoch, deterministically` | `createArchiveLeague({ name: 'Lyon' })` twice | both `createdAt === '1970-01-01T00:00:00.000Z'` |
| `a League createdAt is canonicalized to UTC` | `createArchiveLeague({ createdAt: '2026-08-22T10:00:00+02:00' })` | `'2026-08-22T08:00:00.000Z'` |
| `normalizeArchiveTournament repairs a partial stored row` | `normalizeArchiveTournament({ id: 'local-1' } as ArchiveTournamentInput)` | `rounds: []`, `playerArchetypes: []`, `seasonId: null`, `status: 'completed'`, non-empty `name` |
| `toTournamentDocument drops seasonId and carries the given leagueId` | a standalone Tournament, `'season-1'` | result has `leagueId === 'season-1'` and no `seasonId` key (`'seasonId' in result === false`) |
| `toArchiveTournamentDocument drops leagueId and normalizes the season` | a `TournamentDocument`, `''` | result has `seasonId === null` and no `leagueId` key |
| `toLeagueDocument nests the Season's Tournaments under the Season id` | a Season + two Tournaments | `{ id, name, status }` from the Season, both tournaments carrying `leagueId === season.id` |
| `the shared round shapes are the very types models.ts declares` | `createRound({})` from `models.ts` assigned to an `archive-models` `RoundDocument` | compiles and `toEqual`s itself — one module, one shape |

### `src/app/data/archive-origin.test.ts`

| Test | Input | Expect |
| ---- | ----- | ------ |
| `the local prefix is exactly local-` | — | `LOCAL_ARCHIVE_ID_PREFIX === 'local-'` |
| `a prefixed id is local` | `'local-abc'` | `true` |
| `a server id is not local` | `'7f3a1d2c-0b44-4f9e-9a1e-2c8f0d6b5a11'` | `false` |
| `nullish ids are not local` | `null`, `undefined`, `''` | `false` for all three |
| `a generated id is local` | `newLocalArchiveId()` | `isLocalArchiveId(...) === true` |
| `generated ids are unique` | 100 calls | `new Set(...).size === 100` |

### `src/app/data/archive-summary.test.ts`

| Test | Input | Expect |
| ---- | ----- | ------ |
| `summarizes a Season with its tournament and player counts` | a Season + 2 Tournaments, 3 distinct players across them | `tournamentCount === 2`, `playerCount === 3` |
| `derives the Season player count with the shared standings formula` | same | `playerCount === calculateLeagueResult(toLeagueDocument(season, tournaments)).rows.length` |
| `a Season with no Tournament reports null date bounds` | `[]` | `firstTournamentDate === null`, `lastTournamentDate === null`, `tournamentCount === 0`, `playerCount === 0` |
| `a Season spans its earliest and latest Tournament` | dates `2026-03-04`, `2026-01-02`, `2026-02-03` | `firstTournamentDate === '2026-01-02'`, `lastTournamentDate === '2026-03-04'` |
| `summarizes a Tournament with the shared player count` | one Tournament, 4 players | `playerCount === calculateTournamentResult(toTournamentDocument(t)).rows.length` |
| `a summary carries no isLocal flag` | any summary | `'isLocal' in summary === false`; origin comes from `isLocalArchiveId(summary.id)` |
| `a browser-local Tournament row is never locked` | `{ id: 'local-1', tournamentDate: '2000-01-01' }`, `now = 2030-01-01` | `false` |
| `a server Tournament row older than the window is locked` | `{ id: 'server-1', tournamentDate: '2026-08-17' }`, `now = 2027-08-18T00:00:00Z` | `true` |
| `a server Tournament row at exactly 365 days is not locked` | same id, `now = 2027-08-17T12:00:00Z` | `false` |
| `a Season is locked when its last Tournament is locked` | `{ id: 'server-1', lastTournamentDate: '2026-08-17' }`, `now = 2027-08-18T00:00:00Z` | `true` |
| `a Season whose last Tournament is recent is not locked` | `lastTournamentDate: '2027-08-01'`, same `now` | `false` |
| `a Season with no Tournament is not locked` | `lastTournamentDate: null` | `false` |
| `a browser-local Season row is never locked` | `{ id: 'local-1', lastTournamentDate: '2000-01-01' }` | `false` |

### `src/app/data/archive-command-ux.test.ts`

| Test | Input | Expect |
| ---- | ----- | ------ |
| `limits archive commands to Organizer and Admin` | `null`, `undefined`, `'User'`, `'Organizer'`, `'Admin'` | `false, false, false, true, true` |
| `a browser-local record is managed by whoever can see it` | `canManageArchiveRecord('local-1', 'User')`, `('server-1', 'User')`, `('server-1', 'Admin')` | `true`, `false`, `true` |
| `routes a new record by role` | `createArchiveTarget('User')`, `('Organizer')`, `(null)` | `'local'`, `'server'`, `'local'` |
| `classifies the wire vocabulary on status first` | `new ApiProblemError(403, { code: 'forbidden' })`, `(412, { code: 'stale_version' })`, `(404, { code: 'not_found' })`, `(400, { code: 'validation_failed' })` | `'forbidden'`, `'stale'`, `'notFound'`, `'invalid'` |
| `separates the two 409s by code` | `new ApiProblemError(409, { code: 'archive_tournament_locked' })`, `(409, { code: 'archive_league_not_empty' })`, `(409, { code: 'something_else' })` | `'locked'`, `'notEmpty'`, `'failed'` |
| `classifies a duck-typed generated-client failure` | `{ status: 403 }`, `{ status: 412 }` | `'forbidden'`, `'stale'` |
| `classifies the browser-local errors the local adapter throws` | `new ArchiveConcurrencyError()`, `new ArchiveLeagueNotEmptyError()`, `new ArchiveNotFoundError('league')` | `'stale'`, `'notEmpty'`, `'notFound'` |
| `classifies a bare stale message with no status` | `new Error('staleArchiveDocument')` | `'stale'` |
| `an unknown failure is failed` | `new Error('network')`, `undefined`, `'boom'` | `'failed'` for all three |

### `src/app/backend/local-archive-backend.service.test.ts`

| Test | Input | Expect |
| ---- | ----- | ------ |
| `names the documented database, version and three stores` | — | `'gones-archive-local'`, `1`, `'leagues'`, `'league-seasons'`, `'tournaments'` |
| `an empty store lists nothing and seeds nothing` | fresh adapter, all six `list*` | every `items` `[]`, `totalCount 0`, `truncated false`; a second `listArchiveLeagues()` still `[]` |
| `creates a League under a local- id at version 1` | `createArchiveLeague('Lyon')` | `isLocalArchiveId(id)`, `documentVersion === 1`, `createdAt` and `updatedAt` both ISO-`Z` |
| `creates a Season under its League` | `createLeagueSeason(league.id, 'S1')` | `leagueId === league.id`, `status === 'active'`, `documentVersion === 1` |
| `refuses a Season whose League is absent` | `createLeagueSeason('local-missing', 'S1')` | rejects `ArchiveNotFoundError`, `status === 404`, store unchanged |
| `creates a standalone Tournament` | `createArchiveTournament(null, 'Open', '2026-08-17')` | `seasonId === null`, `status === 'active'`, `rounds` `[]` |
| `creates a Tournament inside a Season` | `createArchiveTournament(season.id, …)` | `seasonId === season.id` |
| `refuses a Tournament whose Season is absent` | `createArchiveTournament('local-missing', …)` | rejects `ArchiveNotFoundError` |
| `rejects a stale write with the 412 mirror` | rename with `expectedVersion − 1` | rejects `ArchiveConcurrencyError`, `status === 412`, `message === 'staleArchiveDocument'`; stored row unchanged |
| `rejects a stale delete and leaves the row in place` | `deleteArchiveTournament(id, wrongVersion)` | rejects; `getArchiveTournament(id)` still returns the row |
| `refuses to delete a League that still holds a Season` | League + Season, `deleteArchiveLeague(league.id, 1)` | rejects `ArchiveLeagueNotEmptyError`, `status === 409`, League still listed |
| `deletes a League once its last Season is gone` | delete the Season, then the League | `listArchiveLeagues()` empty |
| `deleting a Season detaches its Tournaments` | Season + 2 Tournaments, `deleteLeagueSeason` | both Tournaments still exist, `seasonId === null`, each `documentVersion` bumped by 1 |
| `a failed detach leaves both stores untouched` | `failPutAt` set so the second detach `put` throws | rejects; the Season row still exists and both Tournaments still carry the old `seasonId` and version |
| `moving a Tournament to null makes it standalone` | `moveArchiveTournament(id, v, null)` | `seasonId === null`, version + 1 |
| `moving a Tournament to an absent Season is refused` | `moveArchiveTournament(id, v, 'local-missing')` | rejects `ArchiveNotFoundError`, row unchanged |
| `editing a Tournament bumps no Season and no League` | snapshot Season + League, run `editArchiveTournament` | Season and League `documentVersion` **and** `updatedAt` identical before/after |
| `adds, imports, replaces and deletes a round through the version guard` | the four round commands in sequence | each returns version + 1; final `rounds` reflect each step; `importArchiveRound` yields the entries `importRoundEntries` parses |
| `adds, edits and deletes an entry` | the three entry commands | entry list matches after each; the edited entry keeps its id |
| `renames a player across every round` | `renameArchiveTournamentPlayer(id, v, 'Alice', 'Alicia')` | no entry mentions `'Alice'`; the result equals `renamePlayerInTournament` applied to the same document |
| `sets a player archetype` | `updateArchiveTournamentArchetype(id, v, 'Bob', 'Burn')` | `playerArchetypes` holds `{ playerName: 'Bob', archetype: 'Burn' }` |
| `applies a staged edit batch as one version bump` | batch with `editTournament` + one `addRounds` + one `updateArchetypes` | one `documentVersion + 1`, every intent applied |
| `moves a Tournament inside a staged edit batch` | batch `{ moveToSeasonId: otherSeason.id, … }` | `seasonId === otherSeason.id`, one version bump |
| `refuses an empty staged edit batch` | all arrays empty, no other key | rejects `Error('emptyArchiveTournamentEditBatch')` |
| `refuses a staged edit batch that both deletes and replaces a round` | same `roundId` in both | rejects `Error('conflictingRoundIntents')` |
| `a browser-local Tournament stays editable however old it is` | Tournament dated `'2000-01-01'`, then `editArchiveTournament` | resolves; and `isArchiveTournamentRowLocked({ id, tournamentDate })` is `false` |
| `restores a bundle under fresh ids, remapping every parent link` | bundle: 1 League, 1 Season (`leagueId` = the League), 1 Tournament (`seasonId` = the Season) + 1 standalone | every new id `local-`-prefixed and different from the bundle's; `season.leagueId === restored league.id`; `tournament.seasonId === restored season.id`; the standalone stays `null` |
| `restoring the same bundle twice yields two independent copies` | restore twice | 2 Leagues, 2 Seasons, 4 Tournaments; the second League name is suffixed, not overwritten |
| `ignores the calendar half of a bundle` | bundle with one `calendarEvents` entry | resolves; no store gains a row for it |
| `refuses a bundle whose version is not 5` | `{ …, version: 4 }` | rejects `Error('unsupportedArchiveBundleVersion')`, nothing written |
| `lists tournaments newest first, ties broken by id` | dates `2026-01-01`, `2026-03-01`, and two on `2026-02-01` | `['…-03-01', both 2026-02-01 ordered by id ASC, '…-01-01']` |
| `lists a Season's Tournaments and the standalone ones separately` | `listSeasonTournamentSummaries(season.id)` then `(null)` | the Season's two, then the standalone one |
| `summary catalogs report totalCount and never truncate` | any populated `list*Summaries` | `totalCount === items.length`, `truncated === false` |
| `a failed open is retried on the next call` | make `indexedDB` open reject once, then succeed | first call rejects, second resolves |

### `src/app/backend/server-authority-boundary.test.ts` (edited, not created)

| Test | Input | Expect |
| ---- | ----- | ------ |
| `confines IndexedDB to the sanctioned local adapters` (existing name, unchanged) | the real `src/` tree | the five-entry array in *Produces — allowlist edit*, `local-archive-backend.service.ts` included |

## Impl steps

- [ ] 1. **Domain shapes and the lock rule**
  - [ ] 1.1 Create `src/app/domain/archive-models.test.ts` with the 19 tests of *Test plan → archive-models*, importing from `'./archive-models'`. Use fixed UTC dates (`new Date('2027-08-18T00:00:00.000Z')`), never `new Date()`, so the suite is timezone- and clock-independent.
  - [ ] 1.2 Run `npx vitest run src/app/domain/archive-models.test.ts` — expect a red run, "Failed to resolve import ./archive-models".
  - [ ] 1.3 Create `src/app/domain/archive-models.ts` with the imports, the `export type { … } from './models'` re-export block, the three constants and the six interfaces + `ArchiveBundle`, exactly as in *Interface contract → Produces — archive-models.ts*.
  - [ ] 1.4 In the same file add the three input types, then `normalizeSeasonId`, `createArchiveLeague`, `createLeagueSeason`, `createArchiveTournament` with the verbatim bodies given, plus the three `normalize*` one-line delegations.
  - [ ] 1.5 In the same file add `toTournamentDocument`, `toArchiveTournamentDocument`, `toLeagueDocument`, `isArchiveTournamentLocked`, and the private `utcDayNumber` + `normalizeInstant` + `DAY_MS` + `EPOCH_ISO`, verbatim.
  - [ ] 1.6 Run `npx vitest run src/app/domain/archive-models.test.ts` — green.
  - [ ] 1.7 Run `npx tsc --noEmit -p tsconfig.spec.json` — no error. In particular confirm the `export type` re-export of `LeagueStatus` does **not** clash with the local `import type { LeagueStatus }`: `export … from` creates no local binding, so both are legal.

- [ ] 2. **Id origin**
  - [ ] 2.1 Create `src/app/data/archive-origin.test.ts` with the 6 tests of *Test plan → archive-origin*.
  - [ ] 2.2 Run `npx vitest run src/app/data/archive-origin.test.ts` — red.
  - [ ] 2.3 Create `src/app/data/archive-origin.ts` with the three exports, verbatim from *Interface contract*. Add no placeholder export and import nothing from `models.ts`.
  - [ ] 2.4 Run `npx vitest run src/app/data/archive-origin.test.ts` — green.

- [ ] 3. **Summary projections and the row-level lock**
  - [ ] 3.1 Create `src/app/data/archive-summary.test.ts` with the 13 tests of *Test plan → archive-summary*. Build fixtures with `createArchiveTournament` / `createLeagueSeason` and hand-written `documentVersion` + `updatedAt`, mirroring the `league(id, tournamentCount)` fixture helper at `src/app/data/league-archive-summary.test.ts:12-26`.
  - [ ] 3.2 Run `npx vitest run src/app/data/archive-summary.test.ts` — red.
  - [ ] 3.3 Create `src/app/data/archive-summary.ts` with the imports and the six read-model interfaces, copied **verbatim** from *Interface contract → Produces — archive-summary.ts*.
  - [ ] 3.4 In the same file add `summarizeArchiveLeague` (`id`, `name`, `createdAt`, `updatedAt`, `documentVersion` straight through) and the verbatim `summarizeLeagueSeason` / `summarizeArchiveTournament` bodies.
  - [ ] 3.5 In the same file add the verbatim `isArchiveTournamentRowLocked` and `isLeagueSeasonRowLocked`.
  - [ ] 3.6 Run `npx vitest run src/app/data/archive-summary.test.ts` — green.

- [ ] 4. **Command-failure classifier**
  - [ ] 4.1 Create `src/app/data/archive-command-ux.test.ts` with the 9 tests of *Test plan → archive-command-ux*. Start the file with `import '@angular/compiler';` — `league-archive-command-ux.test.ts:1` does, because `api-boundary.ts` pulls Angular in.
  - [ ] 4.2 Leave the three tests that construct `ArchiveConcurrencyError` / `ArchiveLeagueNotEmptyError` / `ArchiveNotFoundError` **skipped** with `it.skip` for now, because step 5 creates those classes. Un-skip them in step 6.7.
  - [ ] 4.3 Run `npx vitest run src/app/data/archive-command-ux.test.ts` — red.
  - [ ] 4.4 Create `src/app/data/archive-command-ux.ts` with the whole module, verbatim from *Interface contract → Produces — archive-command-ux.ts*.
  - [ ] 4.5 Run `npx vitest run src/app/data/archive-command-ux.test.ts` — green.

- [ ] 5. **Local adapter — the failing spec**
  - [ ] 5.1 Create `src/app/backend/local-archive-backend.service.test.ts` and copy lines **15-177** of `src/app/backend/local-league-archive-backend.service.test.ts` into it verbatim — the doc comment through the closing brace of `installFakeIndexedDb()`. That block is the whole in-memory IndexedDB fake (`FakeStore`, `FakeDatabaseState`, `databases`, `failPutAt`, `putCount`, `readwriteTransactionCount`, `clone`, `FakeRequest`, `FakeObjectStore`, `FakeTransaction`, `FakeDatabase`, `fakeIndexedDb`, `originalIndexedDb`, `installFakeIndexedDb`). Add no dependency.
  - [ ] 5.2 Below the fake, add the `beforeEach` / `afterEach` pair from `local-league-archive-backend.service.test.ts:204-215`: clear `databases`, reset `failPutAt = null`, `putCount = 0`, `readwriteTransactionCount = 0`, `installFakeIndexedDb()`; restore the original `indexedDB` descriptor afterwards.
  - [ ] 5.3 Add the fixture helpers: `const rejection = (promise: Promise<unknown>) => promise.then(() => null, (reason: unknown) => reason);` (copied from the legacy spec) and an `async function seededArchive()` that creates one League, one Season under it, one Tournament in the Season and one standalone Tournament, returning the adapter and every id and version.
  - [ ] 5.4 Write the 34 tests of *Test plan → local-archive-backend* against `LocalArchiveBackend`, `LOCAL_ARCHIVE_DB_NAME`, `LOCAL_ARCHIVE_DB_VERSION`, `LOCAL_LEAGUE_STORE`, `LOCAL_LEAGUE_SEASON_STORE`, `LOCAL_TOURNAMENT_STORE`, `ArchiveConcurrencyError`, `ArchiveLeagueNotEmptyError`, `ArchiveNotFoundError`.
  - [ ] 5.5 Run `npx vitest run src/app/backend/local-archive-backend.service.test.ts` — red, "Failed to resolve import ./local-archive-backend.service".

- [ ] 6. **Local adapter — implementation**
  - [ ] 6.1 Create `src/app/backend/local-archive-backend.service.ts` with the `@angular/core` `Injectable` import, the domain imports (`createRound`, the `archive-models` factories, bridges and `SUPPORTED_ARCHIVE_IMPORT_VERSIONS`), `renamePlayerInTournament`, `setTournamentPlayerArchetype`, `importRoundEntries`, the `indexed-db` helpers, `newLocalArchiveId` from `'../data/archive-origin'`, and the summarizers + `ArchiveCatalogResponse` from `'../data/archive-summary'`.
  - [ ] 6.2 Add the five store constants, then `ArchiveConcurrencyError`, `ArchiveLeagueNotEmptyError`, `ArchiveNotFoundError`, verbatim from *Interface contract*.
  - [ ] 6.3 Add `ArchiveRoundIntent`, `ArchiveTournamentEditBatch`, `ArchiveRestoreResult` and the full `ArchiveBackendPort` interface, verbatim.
  - [ ] 6.4 Add `@Injectable({ providedIn: 'root' }) export class LocalArchiveBackend implements ArchiveBackendPort` with the private `database?: Promise<IDBDatabase>` field, the verbatim `open()`, and the three `persist*` rehydrators plus a module-local `const EPOCH_ISO = '1970-01-01T00:00:00.000Z';`.
  - [ ] 6.5 Implement the ten read methods per the behaviour table: `getAll` per store, `persist*` each row, sort, wrap as `{ items, totalCount: items.length, truncated: false }`. `listLeagueSeasonSummaries` reads `league-seasons` **and** `tournaments` in one `runTransaction(database, [LOCAL_LEAGUE_SEASON_STORE, LOCAL_TOURNAMENT_STORE], 'readonly', …)` so a Season's counters and its Tournaments are one consistent snapshot.
  - [ ] 6.6 Implement the private write ladder: `requireLeague` / `requireSeason` / `requireTournament` (absent ⇒ `ArchiveNotFoundError`), then `mutateLeague`, `mutateSeason`, `mutateTournament` (load → version guard ⇒ `ArchiveConcurrencyError` → pure transform → `normalize*` → `documentVersion + 1` → `updatedAt = new Date().toISOString()` → `put`), then `mutateRound` composing `mutateTournament`.
  - [ ] 6.7 Implement the three League commands. `deleteArchiveLeague` runs one `runTransaction(database, [LOCAL_LEAGUE_STORE, LOCAL_LEAGUE_SEASON_STORE], 'readwrite', …)`: read the League (absent ⇒ `ArchiveNotFoundError('league')`), guard the version, `getAll` the Seasons, and throw `ArchiveLeagueNotEmptyError` if any `leagueId` matches before deleting.
  - [ ] 6.8 Implement the five Season commands. `createLeagueSeason` and `moveLeagueSeason` verify the target League inside their transaction. `deleteLeagueSeason` runs one `runTransaction(database, [LOCAL_LEAGUE_SEASON_STORE, LOCAL_TOURNAMENT_STORE], 'readwrite', …)` that removes the Season and rewrites each referencing Tournament with `seasonId: null`, `documentVersion + 1` and a fresh `updatedAt`.
  - [ ] 6.9 Implement the Tournament commands: `createArchiveTournament` (verify a non-null Season in its transaction), `editArchiveTournament`, `moveArchiveTournament`, `deleteArchiveTournament`, the four round commands, the three entry commands, `updateArchiveTournamentArchetype` (via `setTournamentPlayerArchetype`) and `renameArchiveTournamentPlayer` (via `renamePlayerInTournament`), each bridging with `toTournamentDocument` / `toArchiveTournamentDocument`.
  - [ ] 6.10 Implement `applyArchiveTournamentEditBatch`: a private pure `applyEditBatch(tournament, batch)` performing every validation of the *Edit-batch validation* table with the exact message strings, applying the intents in the contracted order, and returning the new `ArchiveTournamentDocument`; the public method wraps it in `mutateTournament` plus the target-Season check when `moveToSeasonId` is present and non-null.
  - [ ] 6.11 Implement `restoreArchiveBundle`: reject `Error('unsupportedArchiveBundleVersion')` unless `(SUPPORTED_ARCHIVE_IMPORT_VERSIONS as readonly number[]).includes(bundle.version)`; build `Map<oldId, newId>` for Leagues and Seasons; in one `runTransaction` over all three stores, `put` each row at `documentVersion: 1` with the remapped parent links, a Tournament whose `seasonId` is absent from the map falling back to `null`; uniquify a colliding League name with the ` (restored)` / ` (restored) 2` ladder of `local-league-archive-backend.service.ts:412-421` (drop its `isUnassignedLeagueName` branch — the placeholder is retired); ignore `bundle.calendarEvents`.
  - [ ] 6.12 Un-skip the three `it.skip` cases left in `src/app/data/archive-command-ux.test.ts` at step 4.2 and import the three error classes there from `'../backend/local-archive-backend.service'`.
  - [ ] 6.13 Run `npx vitest run src/app/backend/local-archive-backend.service.test.ts src/app/data/archive-command-ux.test.ts` — green.

- [ ] 7. **IndexedDB allowlist**
  - [ ] 7.1 In `src/app/backend/server-authority-boundary.test.ts`, inside `it('confines IndexedDB to the sanctioned local adapters', …)`, insert these two lines immediately after `'src/app/backend/indexed-db.ts',`:
    ```ts
      // The three-tier archive browser-local authority (ADR 0028), composing the pure domain.
      'src/app/backend/local-archive-backend.service.ts',
    ```
    Remove nothing. Reorder nothing.
  - [ ] 7.2 Run `npx vitest run src/app/backend/server-authority-boundary.test.ts` — green, all assertions.

- [ ] 8. **Whole-suite validation**
  - [ ] 8.1 Run `npm run test` — green.
  - [ ] 8.2 Run `npm run typecheck` — clean.
  - [ ] 8.3 Run `npm run lint` — clean.
  - [ ] 8.4 Run `npm run build` — succeeds.
  - [ ] 8.5 Run `git status --porcelain` and confirm exactly 11 paths: the 10 new files and the single modified `src/app/backend/server-authority-boundary.test.ts`. Anything else means the fence was crossed — revert it.

## Outputs

**Files created (10):**

| Path | Content |
| --- | --- |
| `src/app/domain/archive-models.ts` | three tiers, `Persisted*` twins, `ArchiveBundle`, `ARCHIVE_DATA_VERSION = 5`, `SUPPORTED_ARCHIVE_IMPORT_VERSIONS = [5]`, `ARCHIVE_LOCK_WINDOW_DAYS = 365`, `isArchiveTournamentLocked`, factories, normalizers, legacy bridges, shared-shape re-exports |
| `src/app/domain/archive-models.test.ts` | 19 tests |
| `src/app/data/archive-origin.ts` | `LOCAL_ARCHIVE_ID_PREFIX`, `isLocalArchiveId`, `newLocalArchiveId` |
| `src/app/data/archive-origin.test.ts` | 6 tests |
| `src/app/data/archive-summary.ts` | the six frozen read-model shapes, three summarizers, two row-level lock helpers |
| `src/app/data/archive-summary.test.ts` | 13 tests |
| `src/app/data/archive-command-ux.ts` | `canManageArchive`, `canManageArchiveRecord`, `createArchiveTarget`, `archiveCommandError` |
| `src/app/data/archive-command-ux.test.ts` | 9 tests |
| `src/app/backend/local-archive-backend.service.ts` | `gones-archive-local` v1 with three stores, the three error classes, `ArchiveBackendPort`, `LocalArchiveBackend` |
| `src/app/backend/local-archive-backend.service.test.ts` | 34 tests + the copied IndexedDB fake |

**File modified (1):** `src/app/backend/server-authority-boundary.test.ts` — one path plus one comment added to the IndexedDB allowlist.

**Public API / behaviour change:** none that the running application can observe. No route, no component, no DI token and no legacy module changes; the new adapter is reachable only by `inject(LocalArchiveBackend)`, which nothing does yet. The user-visible archive is still the legacy one.

**Migration / config:** none. `gones-archive-local` is created lazily on the first call to the new adapter, so no browser that never reaches this code gains a database. `gones-leagues` is untouched.

**Consumed by later tickets (do not rename after this commit):** `ArchiveBackendPort` and its three error classes, `ArchiveCatalogResponse<T>` and the five summary/year shapes, `summarize*`, `isArchiveTournamentRowLocked`, `isLeagueSeasonRowLocked`, `archiveCommandError`, `isLocalArchiveId`, `newLocalArchiveId`, `ArchiveBundle`, `isArchiveTournamentLocked`.

## Validation

- [ ] tests pass:
  - `npx vitest run src/app/domain/archive-models.test.ts src/app/data/archive-origin.test.ts src/app/data/archive-summary.test.ts src/app/data/archive-command-ux.test.ts src/app/backend/local-archive-backend.service.test.ts src/app/backend/server-authority-boundary.test.ts` → all files pass, 0 failed
  - `npm run test` → exit `0`, no failed suite
  - `npm run typecheck` → exit `0`, no output
  - `npm run lint` → exit `0`, "All files pass linting"
  - `npm run build` → exit `0`, bundle written to `dist/`
- [ ] fence check: `git status --porcelain` lists exactly the 10 new files plus `M src/app/backend/server-authority-boundary.test.ts` — no other path, and in particular **not** `src/app/domain/models.ts`, `src/app/backend/application-backend.ts`, `src/app/backend/local-league-archive-backend.service.ts` or any `src/app/data/league-archive-*.ts`.
- [ ] allowlist check: `git diff src/app/backend/server-authority-boundary.test.ts` shows **only** additions (`+` lines), no deletion.
- [ ] no-placeholder check: `grep -rn "placeholder" src/app/domain/archive-models.ts src/app/data/archive-*.ts src/app/backend/local-archive-backend.service.ts` → no match.
- [ ] app functional — no broken path from this slice: `npm run build` succeeds and the legacy `/leagues-archive` pages still compile against the untouched legacy modules. Nothing in the running app imports the new files yet, by design.
- [ ] commit msg draft: `feat(archive): add the three-tier frontend domain and its browser-local store`
