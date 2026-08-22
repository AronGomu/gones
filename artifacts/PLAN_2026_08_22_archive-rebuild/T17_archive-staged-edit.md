# T17: Archive staged-edit UI on the new surface

**Plan:** `./artifacts/PLAN_2026_08_22_archive-rebuild.md`
**Depends:** T14, T4
**Commit outcome:** A power user can stage, review and apply archive edits on `/archive/**` with the same guarantees ADR 0037 gives today.

## Context (self-contained)

- Goal: the Archive is being rebuilt on three tiers — **League → LeagueSeason → Tournament**. A Tournament is now a first-class top-level record that may stand alone (`seasonId: null`). Today's flat `League` becomes `LeagueSeason`; a new `League` tier groups Seasons. `leagues-archive` → `archive` everywhere. A new `/api/archive/**` API and a new `src/app/features/archive/**` UI are being added **beside** the legacy `/api/leagues-archive/**` + `src/app/features/leagues-archive/**` surface; the legacy half is deleted only at T19, so every commit until then must compile and run with both halves alive.
- This slice: the **only mutation surface** on `/archive/**`. T13 built the archive shell and the League Seasons tab, T14 built the Tournaments tab plus the Tournament detail and result pages — **all of them read-only**. T4 built the write endpoints. This ticket rebuilds ADR 0037's power-user staged-edit workflow on top of them: the Tournament detail page starts read-only for everyone, an authorized power user clicks **Edit**, mutates an in-memory draft, and one confirmed **Save Changes** sends a single explicit-intent batch to `POST /api/archive/tournaments/{tournamentId}/edit-batch` with a mandatory `If-Match`. A success adopts the returned authoritative document **without a refetch**.
- **Why this ticket exists (the gap):** T19 deletes `src/app/features/tournaments-archive/**`, which holds today's whole staged editor, and `cypress/e2e/archive-staged-edit.cy.js` loses its subject. Without this ticket the rebuilt archive would have no way to edit anything and ADR 0037 would be silently un-implemented.

**Out of scope here — do not touch:**

- **No backend work at all.** T4 already shipped every route this ticket calls. No file under `backend/**` is edited, no migration is written, and `npm run api:generate` is **not** run — this ticket adds no endpoint and therefore causes no OpenAPI drift.
- **Do not delete the legacy surface.** `src/app/features/leagues-archive/**` and `src/app/features/tournaments-archive/**` stay exactly as they are, still routed, still tested, still dispatching `gones-league-updated`. T19 deletes them. Likewise leave `src/app/data/league-archive-*.ts`, `src/app/backend/local-league-archive-backend.service.ts`, `src/app/domain/archive-tournament-edit-batch.ts` and `cypress/e2e/power-user-gating.cy.js` untouched.
- **No rankings work.** `/global-stats`, the scope filter and `player_statistics` belong to T15.
- **No resync work.** The Settings "Resynchronize everything" control belongs to T16.
- **No cache work.** Do not write, read or shape an IndexedDB partition, do not touch `src/app/backend/archive-cache.service.ts`, `src/app/backend/archive-backfill-queue.ts`, `src/app/shared/catalog-cache.ts`, and do not add a file to the IndexedDB allowlist in `src/app/backend/server-authority-boundary.test.ts`. This ticket's one interaction with the cache is calling the existing invalidation funnel after a successful write.
- **No table work** — no column, sort, paging or expansion change to the archive tables from T13/T14.
- **No create and no delete surface.** ADR 0037 keeps whole-Tournament and whole-League deletion out of the staged batch, and nothing in this plan gives `/archive/**` a create affordance yet. This ticket edits an existing Tournament and nothing else.
- **No new CSS.** Every class this ticket uses already exists in `src/styles.css`. Never hardcode a colour; never add a token.

**Assumptions in force:**

- **Gones is unreleased. There is no production environment and there are no users.** Local data may be reset freely.
- Frontend is Angular 21 standalone components with signals. Tests are Vitest (`npm run test` → `vitest run`, `environment: 'jsdom'`, `include: ['src/**/*.test.ts', 'ops/**/*.test.ts']`). **There is no TestBed in this repo** — component tests read the component source with `readFileSync` for template assertions and build behaviour instances with `Object.create(Component.prototype)` + `Object.assign`, or with a bare `Injector.create(...)` + `runInInjectionContext`. Follow that idiom; `src/app/features/leagues-archive/league-archive-list.component.test.ts:1-45` is the model.
- `tsconfig.json` sets `"strict": true` and `"isolatedModules": true`, so a type-only re-export must use `export type { … } from '…'`.
- `src/app/i18n/message-namespace.test.ts` asserts `Object.keys(en).sort()` equals `Object.keys(fr).sort()`. Every key added below lands in **both** catalogues.
- `src/app/shared/data-cy-coverage.test.ts` requires **every** element in a component `template:` literal to carry `data-cy` or `[attr.data-cy]` (exempt tags: `ng-container`, `ng-template`, `ng-content`, `svg`, `path`, `defs`, `g`, `use`, `circle`, `rect`, `line`, `polyline`, `polygon`, `br`, `hr`). Per-row markers use the binding form.
- `src/app/shared/back-button-coverage.test.ts` requires a routed page component to carry both `position="top"` and `position="bottom"` back buttons. T14 already put them on the detail page; keep both.
- `src/app/backend/server-authority-boundary.test.ts` asserts an **exact** allowlist of files that may mention `indexedDB` or `IDB*`. **No file this ticket writes or edits may mention either.** The server adapter added here speaks HTTP only; the browser-local adapter it routes to (`src/app/backend/local-archive-backend.service.ts`) is already on that list from T10.
- The frontend classifier keys on **HTTP status first, code/message second**, so the ticket is correct whether the wire code is snake_case (`archive_tournament_locked`, per the arbitration in force) or camelCase (`archiveTournamentLocked`, as an earlier draft of the backend ticket wrote it). Both spellings are accepted; see *Errors*.

## Requirements

1. `/archive/tournaments/:tournamentId` starts **read-only for everyone**, exactly as it does after T14. Nothing about the read-only rendering changes.
2. An **Edit** control appears only when all three gates pass at once: the browser preference `gones.settings.power-user` is on, the caller may manage the record (browser-local id, or `Organizer`/`Admin` for a server id), and the row is not lock-blocked (locked and the caller is not `Admin`).
3. Clicking **Edit** clones the authoritative document into an in-memory draft. **No repository call is made while drafting.** A reload loses the draft and shows the authoritative document.
4. Staged scope is exactly ADR 0037's: name, date, Season move (including detach to standalone), add/delete/replace rounds, round entries and round import output, player archetypes, plus the completed/active status toggle. Whole-Tournament and whole-League deletion stay out.
5. **Save Changes** opens one confirmation dialog summarising the Season move and the number of deleted rounds and deleted entries, then sends **one** batch to `POST /api/archive/tournaments/{tournamentId}/edit-batch` with a mandatory `If-Match`. One save is one request and one version bump.
6. A successful save **adopts the returned document without a refetch** — the response body carries the authoritative document precisely so it can. No `GET /api/archive/tournaments/{id}` is issued after a `200`.
7. An **empty** save (no diff, no move, no status change) exits edit mode with **no** repository call.
8. A failure writes nothing and **retains the draft byte-for-byte**. `412` additionally offers **Reload Latest**, which discards the draft only after confirmation and never merges, rebases or retries.
9. **Cancel Edit** discards the draft only after confirmation when the draft is dirty; a clean draft exits immediately.
10. Refusals render distinctly and correctly for `409 archive_tournament_locked`, `412 stale_version`, `403` and `404`.
11. The move is **same-authority only**: a browser-local Tournament may move only between browser-local Seasons, a server Tournament only between server Seasons. There is no local↔server move and no sync.
12. Every write goes through `ArchiveRepository`, and its mutating method funnels through the one private invalidation wrapper so the archive caches are dropped and `gones-archive-updated` is announced after — never before — the write succeeded.
13. `cypress/e2e/archive-staged-edit.cy.js` is rewritten against `/archive/**` and the new endpoints. It no longer mentions `/leagues-archive` or `/api/leagues-archive`.
14. Every user-visible string added is present in **both** `en` and `fr` in `src/app/i18n/messages.ts`.
15. `npm run test`, `npm run typecheck`, `npm run lint` and `npm run build` are green, and the app still compiles and runs with the legacy archive surface intact.

## Inputs

Read before writing code.

**ADR 0037 — the guarantees to preserve exactly.** `docs/adr/0037-power-user-staged-archive-edits.md`, plus the two diagrams `docs/archive-staged-edit.html` and `docs/power-user-capability.html`. The binding sentences, quoted:

> - Browser-local key `gones.settings.power-user`; default false; usable signed out.
> - UX capability only. Never role/claim/security boundary.
> - Archive Tournament page starts read-only for everyone.
> - Authorized Power User clicks Edit, mutates memory draft, then Save Changes.
> - Staged scope: name, date, same-authority League move, rounds, entries/imports, archetypes.
> - Whole Tournament/League deletion remains separate.
> - Save sends fixed explicit intent batch + expected source/target versions. No whole doc req.
> - Same-authority move only; no sync/cross-authority move.
> - Stale/validation failure writes nothing. 412 preserves draft; discard needs confirmation; no auto-merge.
> - Round/entry deletion summarized once in final save dialog.
> - Empty Save exits edit mode without a repository call. Cancel Edit discards only after confirmation when dirty.
> - Validation, network, and 412 failures retain the single in-memory draft. Reload Latest never merges or retries: cancellation keeps the draft; confirmation reloads authoritative versions, discards it, and exits.
> - A successful same-League batch adopts `sourceLeague`.

The last line is the one the three-tier rebuild simplifies: a Tournament is now **its own row with its own version**, so a move has no second document to version-guard, there is no `Target-If-Match`, and a successful save adopts exactly one document.

**The existing implementation — read it, do not edit it.** Several of these have uncommitted modifications; read the on-disk contents.

- `src/app/features/tournaments-archive/tournament-archive-detail.component.ts` (619 lines) — the whole staged editor being rebuilt.
  - `:1-31` the import block and the `@Component({ standalone: true, imports: [...] })` shape.
  - `:36-46` the action row: Cancel Edit / Save Changes when `editing()`, Edit when `canEdit()`, the status toggle when `canToggleStatus() && !editing()`.
  - `:57-62` the heading fields: name input under `@if (editing())`, date input, League `<mat-select>`.
  - `:96-160` the rounds section: add-round button, the rounds `mat-expansion-panel`, the per-round panel, the round menu with Delete round, the import `<textarea>`, the entry table with its three entry kinds, the add-match / add-bye row.
  - `:161-186` the player-archetype panel.
  - `:187-188` the `leagues.readOnly` line and the Reload Latest button.
  - `:196-212` the class fields: `league`, `draft`, `editing`, `loading`, `saving`, `dirty`, `error`, `stale`, `importErrors`, and `canEdit = computed(() => Boolean(league && league.status === 'active' && canUsePowerMutation(this.power.enabled(), canManageLeague(league.id, this.auth.profile()?.globalRole))))`.
  - `:229-291` the draft mutators: `startEdit`, `cancelEdit`, `markDirty`, `addRound`, `addMatch`, `addBye`, `replaceRound`.
  - `:498-560` `save()`, including the confirm dialog and, at **line 560**, `window.dispatchEvent(new CustomEvent('gones-league-updated', { detail: { leagueId } }))` — the mutation dispatch this plan renames to `gones-archive-updated`.
  - `:562-611` `reloadLatest`, `toggleStatus`, `confirmDiscard`, `exitEdit`, `adoptLeague`, `notifyLeagueUpdated`, `applyCommandError`.
  - `:613-670` the pure helpers `tournamentCompletionIssues`, `validationMessage`, `tournamentWarningMessage` — **ported verbatim** by this ticket, retyped onto the three-tier document.
- `src/app/features/leagues-archive/league-archive-detail.component.ts` — the same dispatch at **line 145** (`saveTitleEdit`) and **line 169** (`createNewTournament`). Read for the `logBoundaryError` → `leagueCommandError` → error-signal shape; this ticket does not rebuild either of those two flows.
- `cypress/e2e/archive-staged-edit.cy.js` (193 lines) — the spec being rewritten. Reuse verbatim: the `etag(version)` helper at `:11-15`, the `SEED_MARKER` / `seed(win)` / `visit(path)` service-worker-proof seeding dance at `:39-72`, and the `organizer()` intercept pair at `:81-84`.
- `cypress/e2e/power-user-gating.cy.js` — **read only**, edit nothing. It proves the power gate on the legacy surface and keeps proving it until T19.
- `src/app/data/league-archive-repository.service.ts:196-247` — `saveTournamentEdits(sourceLeague, tournamentId, targetLeague, command)` and the `private async freshMutation<T>(action)` wrapper whose first statement is `this.power.requireEnabled();`. The repository-level power gate is a real ADR 0037 guarantee and is reproduced here.
- `src/app/backend/aspnet-api-backend.service.ts:98-116` — how the legacy adapter sends the batch, and `:288-295` `encodeLeagueETag(version)`, the exact `"` + base64(int64 big-endian) + `"` encoding. **Do not import from this file:** its archive half is deleted at T19. This ticket carries its own copy of the encoder, the same deliberate duplication the rest of this plan applies to doomed files.
- `src/app/domain/archive-tournament-edit-batch.ts` — the legacy pure diff builder. **Do not import it:** it imports `isLocalLeagueId` from `src/app/data/league-archive-origin.ts`, which T19 deletes. This ticket writes the three-tier twin.

**Shared app symbols — read for their exact surface.**

- `src/app/shared/power-user-settings.service.ts` — `POWER_USER_STORAGE_KEY = 'gones.settings.power-user'`; `@Injectable({ providedIn: 'root' }) class PowerUserSettingsService` with `readonly enabled: Signal<boolean>`, `setEnabled(value: boolean): void`, `requireEnabled(): void` (throws `new Error('powerUserRequired')` when off); and `export function canUsePowerMutation(power: boolean, authority: boolean): boolean { return power && authority; }`.
- `src/app/shared/dialogs.ts` — `export interface ConfirmData { title: string; message: string; confirmLabel: string; destructive?: boolean; }` and `ConfirmDialogComponent`, whose markers are `confirm-dialog-title`, `confirm-dialog-message`, `confirm-dialog-cancel`, `confirm-dialog-confirm`. Opened as `firstValueFrom(this.dialog.open(ConfirmDialogComponent, { data }).afterClosed())`, resolving `true` on confirm and `undefined` on cancel.
- `src/app/shared/back-button.component.ts` — selector `gones-back-button`, `@Input() link: string | unknown[] | null`, `@Input() label: string`, `@Input() position: 'top' | 'bottom'`.
- `src/app/shared/ranking-table.component.ts` — selector `gones-ranking-table`, `@Input({ required: true }) rows: RankingRow[]`, `@Input() emptyText: string`, `@Input() ratings: ReadonlyMap<string, number> | null`.
- `src/app/shared/deck-archetype-input.component.ts` — selector `gones-deck-archetype-input`, `@Input() inputId`, `@Input() label`, `@Input() value`, `@Input() disabled`, `@Input() allowAdd`, output `(valueChange)`.
- `src/app/shared/app-logger.ts:1` — `export function logBoundaryError(boundary: string, error: unknown, context: Record<string, unknown> = {}): void`.
- `src/app/i18n/i18n.service.ts` — `t(key: MessageKey, params?: MessageParams): string`, `plural(count, oneKey, manyKey, params?)`, `formatDate(value, options?)`, `formatDateTime(value, options?)`.
- `src/app/api/api-boundary.ts` — `export class ApiProblemError extends Error { constructor(readonly status: number, readonly problem: ApiProblemDetails) }` with `problem.code`; `export const API_ETAG = new HttpContextToken<string | undefined>(() => undefined)`; `export function joinApiUrl(baseUrl: string, path: string): string`. The `apiBoundaryInterceptor` already converts every `application/problem+json` error response into an `ApiProblemError`, sets `Authorization`, and sets `If-Match` from `API_ETAG` when present.
- `src/app/features/events/public-event.service.ts:22-32` — the sanctioned direct-`HttpClient` idiom: `private readonly http = inject(HttpClient); private readonly baseUrl = inject(API_BASE_URL);` then `joinApiUrl(this.baseUrl, path)`. `API_BASE_URL` is exported by `src/app/api/generated/gones-api`.

**Domain helpers reused unchanged — read for the exact signatures.**

```ts
// src/app/domain/models.ts
export type LeagueStatus = 'active' | 'completed';
export interface PlayerArchetypeDocument { playerName: string; archetype: string; }
export interface RoundDocument { id: string; entries: RoundEntry[]; }
export type RoundEntry = MatchRoundEntry | ByeRoundEntry | InvalidRoundEntry;
export interface MatchRoundEntry { kind: 'match'; id: string; table: string; player1Name: string; player2Name: string; player1Score: number; player2Score: number; player1DeckArchetype: string; player2DeckArchetype: string; }
export interface TournamentDocument { id: string; leagueId: string; name: string; tournamentDate: string; status: LeagueStatus; rounds: RoundDocument[]; playerArchetypes: PlayerArchetypeDocument[]; }
export function createRound(input?: { id?: string; entries?: RoundEntryInput[] }, options?: { idFactory?: IdFactory }): RoundDocument;
export function createMatchRoundEntry(entry?: Partial<MatchRoundEntry>, options?: { idFactory?: IdFactory }): MatchRoundEntry;   // player1Score defaults 2, player2Score defaults 0
export function createByeRoundEntry(entry?: Partial<ByeRoundEntry>, options?: { idFactory?: IdFactory }): ByeRoundEntry;

// src/app/domain/results.ts
export function calculateTournamentResult(tournament: TournamentDocument): { scope: 'tournament'; incomplete: boolean; provisional: boolean; rows: RankingRow[] };

// src/app/domain/validation.ts
export function validateRoundEntry(entry: RoundEntry | null | undefined): { valid: boolean; codes: string[] };

// src/app/domain/warnings.ts
export interface TournamentWarning { code: string; roundId?: string; entryIds?: string[]; playerName?: string; playerNames?: string[] }
export function getTournamentWarnings(tournament: TournamentDocument): TournamentWarning[];

// src/app/domain/round-import.ts
export function importRoundEntries(text: string, options?: { idFactory?: IdFactory }): { entries: RoundEntry[]; … };

// src/app/domain/tournament-archetypes.ts
export function tournamentPlayerArchetypeRows(tournament: TournamentDocument): { playerName: string; archetype: string }[];
export function setTournamentPlayerArchetype(tournament: TournamentDocument, playerName: string, archetype: string): TournamentDocument;
export function mergeImportedRoundArchetypes(tournament: TournamentDocument, entries: RoundEntry[]): { entries: RoundEntry[]; playerArchetypes: PlayerArchetypeDocument[]; conflicts: ArchetypeConflict[] };
export function validateTournamentPlayerArchetypes(tournament: TournamentDocument): ArchetypeConflict[];
export function archetypeForPlayer(tournament: TournamentDocument, playerName: string): string;
export interface ArchetypeConflict { playerName: string; existingArchetype: string; importedArchetype: string }
```

Every one of these takes the **legacy** `TournamentDocument`. The three-tier document differs from it by exactly one field — `seasonId: string | null` instead of `leagueId: string` — which none of them reads. T10 supplies the two adapters (`toTournamentDocument` / `toArchiveTournamentDocument`) that bridge the gap, and T14 already relies on this for `calculateTournamentResult`.

**Styling — the classes to reuse. `src/styles.css` already defines every one; add none.**

`.page-heading` (`:57-59`), `.section-header` (`:57`), `.kicker` (`:80`), `.muted` (`:81`), `.error` / `.warning` (`:82-86`), `.status` / `.status.completed` / `.status-dot` (`:42-45`), `.tournament-heading-fields` / `.title-field` / `.tournament-date-field` / `.tournament-league-field` (`:72-78`), `.secondary-action` (`:93-95`), `.create-action-button` (`:758-762`), `.danger-ghost-action` (`:180-181`), `.round-panel` / `.round-panel-title` / `.round-menu-button` / `.rounds-section-panel` (`:744-763`), `.rounds-section-actions` / `.add-round-button` (`:756-757`), `.player-archetype-panel` (`:437-486`), `.table-wrap` (`:605`), `.ranking-table` (`:700-702`), `.empty` (`:699`), `.stack`, `.panel`, `.sr-only`. Tokens available: `--forge --black-metal --iron --raised-iron --soot --ash --dim-ash --steel --blood --hot-blood --create-green --create-green-hot --rust-plate`.

**From Depends — spelled out, because the worker cannot read another ticket.**

*From T4 (backend, already deployed). The one route this ticket calls to write, Organizer-gated:*

```
POST /api/archive/tournaments/{tournamentId}/edit-batch
  headers: If-Match  (REQUIRED — strong ETag, `"` + base64(int64 big-endian version) + `"`)
  body:    ArchiveTournamentEditBatchRequest  (camelCase on the wire)
  200 → { "tournament": ArchiveTournamentCommandResponse }   + response header `ETag`
```

```jsonc
// ArchiveTournamentEditBatchRequest — every array is REQUIRED and non-null; the three nullable
// members are omitted or null when the intent is absent.
{
  "moveToSeason":    { "seasonId": "season-1" } | { "seasonId": null } | null,
  "editTournament":  { "name": "Spring Open", "tournamentDate": "2026-08-17" } | null,
  "status":          "active" | "completed" | null,
  "addRounds":       [ { "roundId": "r1", "entries": [ /* RoundEntry */ ] } ],
  "deleteRoundIds":  [ "r0" ],
  "replaceRounds":   [ { "roundId": "r2", "entries": [ /* RoundEntry */ ] } ],
  "updateArchetypes":[ { "playerName": "Alice", "archetype": "Burn" } ]
}
```

`moveToSeason` is the move discriminator: **absent or `null` means "do not move"**; present with `"seasonId": null` means "detach to standalone".

```jsonc
// ArchiveTournamentCommandResponse — a superset of the plain command envelope, carrying the
// authoritative document precisely so a staged save can adopt it without a refetch.
{
  "id": "tournament-1",
  "seasonId": "season-1",              // JSON null for a standalone Tournament; never omitted
  "name": "Spring Open",
  "tournamentDate": "2026-08-17",      // "YYYY-MM-DD"
  "status": "completed",               // "active" | "completed"
  "rounds": [ /* RoundDocument */ ],
  "playerArchetypes": [ /* PlayerArchetypeDocument */ ],
  "documentVersion": 5,
  "updatedAt": "2026-08-17T10:00:00Z", // ISO-8601 UTC instant
  "eTag": "\"AAAAAAAAAAU=\""
}
```

Backend behaviour that is binding on this ticket: `If-Match` is mandatory; an **empty** batch is refused with `400`; a validation or concurrency failure writes nothing; one successful batch produces exactly **one** version bump; intents apply in the fixed order delete → add(+replace) → replace → archetypes → status; the derived 365-day lock refuses non-`Admin` writes with `409`; `Admin` bypasses the lock and nothing else; a `completed` Tournament stays editable (there is **no** status gate on content writes — the freeze mechanism is the 365-day lock, not the status flag).

*From T7 (backend, already deployed). The read this ticket needs, anonymous public GET, `Cache-Control: public, max-age=60`, ETag + `304`:*

```
GET /api/archive/tournaments/{tournamentId}
  200 → { "id", "name", "seasonId": string|null, "tournamentDate": "YYYY-MM-DD", "status",
          "rounds": RoundDocument[], "playerArchetypes": PlayerArchetypeDocument[],
          "documentVersion": number, "updatedAt": ISO-8601 }
  400 → blank or >200-char id, application/problem+json, code "validation_failed"
  404 → id absent or soft-deleted, application/problem+json, code "not_found"
```

*From T5 (backend, already deployed), for the Season move dropdown:*

```
GET /api/archive/league-seasons/all → { items: ArchiveLeagueSeasonSummary[], totalCount, truncated }
```
```ts
interface ArchiveLeagueSeasonSummary {
  id: string; name: string; leagueId: string; status: 'active' | 'completed';
  updatedAt: string; documentVersion: number;
  tournamentCount: number; playerCount: number;
  firstTournamentDate: string | null; lastTournamentDate: string | null;
}
```

*From T10 — `src/app/domain/archive-models.ts`, `src/app/data/archive-origin.ts`, `src/app/data/archive-summary.ts`, `src/app/data/archive-command-ux.ts` and `src/app/backend/local-archive-backend.service.ts` exist and export, binding and verbatim:*

```ts
// src/app/domain/archive-models.ts
export const ARCHIVE_LOCK_WINDOW_DAYS = 365;
export interface ArchiveTournamentDocument {
  id: string;
  name: string;
  seasonId: string | null;
  tournamentDate: string;        // ISO 8601 date, `YYYY-MM-DD`
  status: LeagueStatus;
  rounds: RoundDocument[];
  playerArchetypes: PlayerArchetypeDocument[];
}
export interface PersistedArchiveTournament extends ArchiveTournamentDocument {
  documentVersion: number;
  updatedAt: string;
  eTag?: string;
}
/** A Tournament locks 365 days after the day it was played. Derived, never stored.
 *  `locked ⇔ (now - tournamentDate) > 365 whole UTC calendar days`. Exactly 365 days ago is NOT
 *  locked; 366 days ago IS. */
export function isArchiveTournamentLocked(tournamentDate: string, now?: Date): boolean;
export function toTournamentDocument(tournament: ArchiveTournamentDocument, leagueId?: string): TournamentDocument;
export function toArchiveTournamentDocument(tournament: TournamentDocument, seasonId?: string | null): ArchiveTournamentDocument;
export function normalizeSeasonId(seasonId: string | null | undefined): string | null;

// src/app/data/archive-origin.ts
export const LOCAL_ARCHIVE_ID_PREFIX = 'local-';
export function isLocalArchiveId(id: string | null | undefined): boolean;

// src/app/data/archive-summary.ts
/** Honours the browser-local exemption: a `local-` id is never locked. */
export function isArchiveTournamentRowLocked(row: Pick<ArchiveTournamentSummary, 'id' | 'tournamentDate'>, now?: Date): boolean;

// src/app/data/archive-command-ux.ts
export type GlobalRole = 'User' | 'Organizer' | 'Admin' | string;
export type ArchiveCommandError = 'forbidden' | 'stale' | 'locked' | 'notEmpty' | 'notFound' | 'invalid' | 'failed';
export function canManageArchive(role: GlobalRole | null | undefined): boolean;             // Organizer | Admin
export function canManageArchiveRecord(id: string | null | undefined, role: GlobalRole | null | undefined): boolean;  // local id OR the role
export function archiveCommandError(error: unknown): ArchiveCommandError;                    // status first, code/message second

// src/app/backend/local-archive-backend.service.ts
export class ArchiveConcurrencyError extends Error { readonly status = 412; /* message 'staleArchiveDocument' */ }
export class ArchiveNotFoundError extends Error { readonly status = 404; constructor(readonly subject: 'league' | 'leagueSeason' | 'tournament'); }
export interface ArchiveRoundIntent { roundId: string; entries: RoundEntry[]; }
/** One staged save (ADR 0037). A Tournament is its own row with its own version, so a move is just
 *  `moveToSeasonId` inside the same batch — there is no second document to version-guard.
 *  `moveToSeasonId` ABSENT ⇒ the Tournament does not move. Present and `null` ⇒ it becomes standalone. */
export interface ArchiveTournamentEditBatch {
  editTournament?: { name: string; tournamentDate: string };
  status?: LeagueStatus;
  moveToSeasonId?: string | null;
  addRounds: ArchiveRoundIntent[];
  deleteRoundIds: string[];
  replaceRounds: ArchiveRoundIntent[];
  updateArchetypes: { playerName: string; archetype: string }[];
}
@Injectable({ providedIn: 'root' })
export class LocalArchiveBackend {
  getArchiveTournament(id: string): Promise<PersistedArchiveTournament | null>;
  applyArchiveTournamentEditBatch(id: string, expectedVersion: number, batch: ArchiveTournamentEditBatch): Promise<PersistedArchiveTournament>;
  /* …and the rest of ArchiveBackendPort, which this ticket does not call. */
}
```

`LocalArchiveBackend.applyArchiveTournamentEditBatch` applies **`editTournament` → `deleteRoundIds` → `replaceRounds` → `addRounds` → `updateArchetypes` → `status` → `moveToSeasonId`** as one version bump, rejects a version mismatch with `ArchiveConcurrencyError` **before** any write, and rejects an empty batch with `Error('emptyArchiveTournamentEditBatch')`.

*From T12 — `src/app/data/archive-repository.service.ts` exists, `@Injectable({ providedIn: 'root' }) export class ArchiveRepository`, exporting:*

```ts
export const ARCHIVE_UPDATED_EVENT = 'gones-archive-updated';
export type ArchiveLeagueSeasonRow = ArchiveLeagueSeasonSummary & { isLocal: boolean };
export interface ArchiveCatalogResult<T> { items: T[]; totalCount: number; truncated: boolean; fetchedAt: string; fromCache: boolean; stale: boolean; }

export class ArchiveRepository {
  listLeagues(options?: { force?: boolean }): Promise<ArchiveCatalogResult<ArchiveLeagueRow>>;
  listLeagueSeasons(options?: { force?: boolean }): Promise<ArchiveCatalogResult<ArchiveLeagueSeasonRow>>;
  listYears(options?: { force?: boolean }): Promise<ArchiveYearEntry[]>;
  listTournaments(options?: { force?: boolean }): Promise<ArchiveCatalogResult<ArchiveTournamentRow>>;
  listSeasonTournaments(season: { id: string; firstTournamentDate: string | null; lastTournamentDate: string | null }): Promise<ArchiveSeasonTournamentsResult>;
  /** The single funnel every archive mutation goes through. Never rejects. */
  invalidateArchiveCaches(): Promise<void>;
}
```

Every public read is `list*`-prefixed, deliberately, because the structural coverage test classifies a `list`/`get`/`load`/`read`/`find`/`count`/`has`/`is` prefix as a read and presumes everything else mutates.

*From T16 — `src/app/data/archive-cache-invalidation.test.ts` exists and is a **structural** gate over `src/app/data/archive-repository.service.ts`. Four of its assertions constrain every line this ticket adds to that file:*

1. `the source parse sees every member the prototype has` — a member must be declared at exactly **two-space** class-body indentation with a conventional header, or the parse misses it and the test fails.
2. `declares no arrow-function member` — no `name = (…) => …` and no `name = async (…) => …` class property. Methods only. A `private readonly x = inject(Y);` field is fine.
3. `exactly one private wrapper carries the invalidation` — exactly **one** member other than `invalidateArchiveCaches` may contain the literal `this.invalidateArchiveCaches()`, and it must be `private`.
4. `every mutating method reaches the invalidation funnel` — every **public, non-getter** member whose name does not start with `list`/`get`/`load`/`read`/`find`/`count`/`has`/`is` must contain `this.<wrapperName>(`.

The wrapper T16 specifies, and whose name the coverage test discovers rather than hardcodes:

```ts
/**
 * Every mutating method's one exit: run the write, then invalidate. Invalidating before the write,
 * or invalidating when it threw, would drop a good cache and repopulate it from data the failed
 * write never changed.
 */
private async mutating<T>(action: () => Promise<T>): Promise<T> {
  const result = await action();
  await this.invalidateArchiveCaches();
  return result;
}
```

*From T14 — `src/app/features/archive/tournament-detail.component.ts` and its test exist. Binding, verbatim:*

```ts
/** The whole Tournament document as `GET /api/archive/tournaments/{id}` serves it. */
export interface ArchiveTournamentDetail {
  readonly id: string;
  readonly name: string;
  readonly seasonId: string | null;
  readonly tournamentDate: string;
  readonly status: LeagueStatus;
  readonly rounds: readonly RoundDocument[];
  readonly playerArchetypes: readonly PlayerArchetypeDocument[];
  readonly documentVersion: number;
  readonly updatedAt: string;
}

export interface ArchiveTournamentDetailSource {
  /** `undefined` for `404` — an absent or soft-deleted Tournament is a page state, not an error. */
  getTournament(tournamentId: string): Promise<ArchiveTournamentDetail | undefined>;
  getSeasonName(seasonId: string): Promise<string | undefined>;
}

export const ARCHIVE_TOURNAMENT_DETAIL_SOURCE = new InjectionToken<ArchiveTournamentDetailSource>(
  'ARCHIVE_TOURNAMENT_DETAIL_SOURCE', { providedIn: 'root', factory: archiveTournamentDetailSourceFactory });

export function toResultInput(detail: ArchiveTournamentDetail): TournamentDocument {
  return {
    id: detail.id,
    leagueId: detail.seasonId ?? '',
    name: detail.name,
    tournamentDate: detail.tournamentDate,
    status: detail.status,
    rounds: [...detail.rounds],
    playerArchetypes: [...detail.playerArchetypes]
  };
}

export class TournamentDetailComponent { /* route /archive/tournaments/:tournamentId */ }
```

The component T14 shipped holds `loading`, `error`, `notFound`, `tournament`, `seasonName` signals, `result = computed(…)`, `locked = computed(…)` and `async load()`. Its template is a top back button linking `['/archive/tournaments']`, a `.page-heading`, the Season link or `data-cy="archive-tournament-standalone"`, `<gones-ranking-table>`, a **read-only** rounds section, a link to `['/archive/tournaments', id, 'result']`, `<p class="muted" data-cy="archive-tournament-read-only">`, the not-found `<mat-card class="panel">`, and a bottom back button. The route registered in `src/app/app.routes.ts` is:

```ts
{ path: 'archive/tournaments/:tournamentId', loadComponent: () => import('./features/archive/tournament-detail.component').then((m) => m.TournamentDetailComponent) },
```

T14's test file `src/app/features/archive/tournament-detail.component.test.ts` contains a test named exactly **`the detail page offers no mutation`**, asserting the component source contains none of `save(`, `delete(`, `rename(`, `edit-batch`, `startEdit`, `ngModel`. **This ticket replaces that one test** — see *Conflicts* and Impl step 5.1. Every other test in that file stays and must stay green.

*i18n keys that already exist in BOTH `en` and `fr` and are reused verbatim — do not re-add any of them:*

`common.saving`, `common.delete`, `common.actions`, `common.player`, `common.table`, `common.cancelEsc`,
`tournament.name`, `tournament.date`, `tournament.rounds`, `tournament.roundN`, `tournament.entriesCount`, `tournament.roundCountOne`, `tournament.roundCountMany`, `tournament.addRound`, `tournament.addMatch`, `tournament.addBye`, `tournament.deleteRound`, `tournament.roundActions`, `tournament.roundImport`, `tournament.roundImportPlaceholder`, `tournament.importRoundData`, `tournament.importConflict`, `tournament.importConflictRow`, `tournament.closeWarning`, `tournament.noArchetype`, `tournament.playerArchetypes`, `tournament.playersCount`, `tournament.archetypeHelp`, `tournament.deckArchetypeCol`, `tournament.noPlayersYet`, `tournament.roundEntryLabel`, `tournament.roundEntryDelete`, `tournament.player1Name`, `tournament.player1Score`, `tournament.player2Name`, `tournament.player2Score`, `tournament.provisional`, `tournament.incomplete`, `tournament.warnings`, `tournament.entryIssue`, `tournament.archetypeConflict`, `tournament.needOneRound`, `tournament.aPlayer`, `tournament.warnMissingBye`, `tournament.warnDuplicatePlayer`, `tournament.warnNewPlayer`, `tournament.warnMissingArchetype`, `tournament.warnRepeatedPairing`, `tournament.emptyRanking`,
`validation.invalidRoundEntry`, `validation.playerRequired`, `validation.opponentRequired`, `validation.byeReservedPlayerName`, `validation.byeReservedOpponentName`, `validation.samePlayerName`, `validation.resultInvalid`, `validation.resultTooManyGameWins`, `validation.resultTooManyGameLosses`, `validation.fixCode`,
`archive.tournamentActive`, `archive.tournamentCompleted`, `archive.markComplete`, `archive.reopen`, `archive.completeConfirm`, `archive.reopenConfirm`,
`archiveDetail.kicker`, `archiveDetail.season`, `archiveDetail.standalone`, `archiveDetail.updated`, `archiveDetail.locked`, `archiveDetail.loadFailed`, `archiveDetail.readOnly`, `archiveDetail.seeResult`, `archiveDetail.backToTournaments`,
`live.deckArchetypeFor`.

## Interface contract (level 5)

### Produces — `src/app/domain/archive-staged-edit.ts` (NEW)

The pure diff between the authoritative document and the draft. No Angular, no injection, no I/O.

```ts
import type { ArchiveRoundIntent, ArchiveTournamentEditBatch } from '../backend/local-archive-backend.service';
import type { ArchiveTournamentDocument } from './archive-models';

/** What the final Save dialog reports once, per ADR 0037. */
export interface ArchiveStagedDeletionSummary {
  rounds: number;
  entries: number;
}

/** How the Season selector encodes "no Season". A `<mat-select>` cannot carry `null` as an option
 *  value without also meaning "nothing selected", so standalone gets its own sentinel string. */
export const ARCHIVE_STANDALONE_SEASON_VALUE = '__standalone__';

/**
 * Diff two Tournament documents into ADR 0037's fixed explicit-intent batch.
 *
 * `moveToSeasonId` is emitted **only** when `draftSeasonId` differs from `source.seasonId`, because
 * the key's mere presence is the move discriminator on both authorities: absent means "do not move",
 * present-and-null means "detach to standalone".
 *
 * `status` is emitted only when it changed. Round comparison is by `id`: a round present in the
 * draft and absent from the source is an add, absent from the draft and present in the source is a
 * delete, and present in both with different entries is a replace. Entries are compared with
 * `JSON.stringify`, which is order-sensitive on purpose — reordering entries is an edit.
 * `updateArchetypes` carries every player whose archetype changed, missing counted as `''`, sorted
 * by `playerName` with `localeCompare` so one draft always produces one byte-identical batch.
 */
export function buildArchiveStagedEditBatch(
  source: ArchiveTournamentDocument,
  draft: ArchiveTournamentDocument,
  draftSeasonId: string | null
): ArchiveTournamentEditBatch;

/** Rounds deleted outright, and entries deleted from a round that survived. */
export function archiveStagedDeletionSummary(
  source: ArchiveTournamentDocument,
  draft: ArchiveTournamentDocument
): ArchiveStagedDeletionSummary;

/**
 * True when the batch would be refused as empty by both authorities — `400 validation_failed` on the
 * server, `Error('emptyArchiveTournamentEditBatch')` in the browser. `moveToSeasonId` counts by
 * **key presence**, not by value, so a detach-to-standalone is never mistaken for an empty batch.
 */
export function archiveStagedEditBatchIsEmpty(batch: ArchiveTournamentEditBatch): boolean;
```

Reference implementation, binding:

```ts
export function buildArchiveStagedEditBatch(
  source: ArchiveTournamentDocument,
  draft: ArchiveTournamentDocument,
  draftSeasonId: string | null
): ArchiveTournamentEditBatch {
  const sourceRounds = new Map(source.rounds.map((round) => [round.id, round]));
  const draftRounds = new Map(draft.rounds.map((round) => [round.id, round]));
  const sourceArchetypes = new Map(source.playerArchetypes.map((row) => [row.playerName, row.archetype]));
  const draftArchetypes = new Map(draft.playerArchetypes.map((row) => [row.playerName, row.archetype]));
  const playerNames = [...new Set([...sourceArchetypes.keys(), ...draftArchetypes.keys()])]
    .sort((left, right) => left.localeCompare(right));

  return {
    ...(source.name !== draft.name || source.tournamentDate !== draft.tournamentDate
      ? { editTournament: { name: draft.name, tournamentDate: draft.tournamentDate } }
      : {}),
    ...(source.status !== draft.status ? { status: draft.status } : {}),
    ...(source.seasonId !== draftSeasonId ? { moveToSeasonId: draftSeasonId } : {}),
    addRounds: draft.rounds
      .filter((round) => !sourceRounds.has(round.id))
      .map((round): ArchiveRoundIntent => ({ roundId: round.id, entries: structuredClone(round.entries) })),
    deleteRoundIds: source.rounds.filter((round) => !draftRounds.has(round.id)).map((round) => round.id),
    replaceRounds: draft.rounds
      .filter((round) => sourceRounds.has(round.id) && !sameJson(sourceRounds.get(round.id)!.entries, round.entries))
      .map((round): ArchiveRoundIntent => ({ roundId: round.id, entries: structuredClone(round.entries) })),
    updateArchetypes: playerNames
      .filter((playerName) => (sourceArchetypes.get(playerName) ?? '') !== (draftArchetypes.get(playerName) ?? ''))
      .map((playerName) => ({ playerName, archetype: draftArchetypes.get(playerName) ?? '' }))
  };
}

export function archiveStagedDeletionSummary(
  source: ArchiveTournamentDocument,
  draft: ArchiveTournamentDocument
): ArchiveStagedDeletionSummary {
  const draftRounds = new Map(draft.rounds.map((round) => [round.id, round]));
  let entries = 0;
  for (const sourceRound of source.rounds) {
    const draftRound = draftRounds.get(sourceRound.id);
    if (!draftRound) continue;
    const draftEntryIds = new Set(draftRound.entries.map((entry) => entry.id));
    entries += sourceRound.entries.filter((entry) => !draftEntryIds.has(entry.id)).length;
  }
  return { rounds: source.rounds.filter((round) => !draftRounds.has(round.id)).length, entries };
}

export function archiveStagedEditBatchIsEmpty(batch: ArchiveTournamentEditBatch): boolean {
  return !batch.editTournament
    && batch.status === undefined
    && !Object.hasOwn(batch, 'moveToSeasonId')
    && batch.addRounds.length === 0
    && batch.deleteRoundIds.length === 0
    && batch.replaceRounds.length === 0
    && batch.updateArchetypes.length === 0;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
```

### Produces — `src/app/backend/server-archive-backend.service.ts` (NEW)

The server half of the Tournament write path. It speaks HTTP and nothing else: no cache, no IndexedDB, no routing decision, no power check.

```ts
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { joinApiUrl } from '../api/api-boundary';
import { API_BASE_URL } from '../api/generated/gones-api';
import type { PersistedArchiveTournament } from '../domain/archive-models';
import type { ArchiveTournamentEditBatch } from './local-archive-backend.service';

/**
 * The two Tournament operations the staged editor needs, and nothing else.
 *
 * `LocalArchiveBackend` satisfies this shape structurally, which is the whole point: the repository
 * picks an implementation from the record's origin and calls the same two members either way
 * (ADR 0028). It is deliberately NOT the full `ArchiveBackendPort` — this ticket ships one write
 * flow, and a port with fifteen unimplemented members would be a lie about what works.
 */
export interface ArchiveTournamentPort {
  /** `null` for `404` — an absent or soft-deleted Tournament is a page state, not an error. */
  getArchiveTournament(tournamentId: string): Promise<PersistedArchiveTournament | null>;
  applyArchiveTournamentEditBatch(
    tournamentId: string,
    expectedVersion: number,
    batch: ArchiveTournamentEditBatch
  ): Promise<PersistedArchiveTournament>;
}

/**
 * The strong ETag the API mints, reproduced: `"` + base64(int64 big-endian) + `"`, matching
 * `backend/src/Gones.Application/Concurrency/StrongETag.cs:7-13`.
 *
 * This is a copy of `encodeLeagueETag` rather than an import, because that function lives in
 * `aspnet-api-backend.service.ts`, whose archive half is deleted when the legacy surface is retired.
 * A reference into a doomed file would break at deletion time; twelve duplicated lines will not.
 */
export function encodeArchiveETag(version: number): string {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('invalidArchiveDocumentVersion');
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, BigInt(version));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `"${btoa(binary)}"`;
}

/** The runtime JSON of `GET /api/archive/tournaments/{id}`. */
interface RawArchiveTournamentDetail {
  id: string;
  name: string;
  seasonId?: string | null;
  tournamentDate: string;
  status: string;
  rounds?: RoundDocument[];
  playerArchetypes?: PlayerArchetypeDocument[];
  documentVersion: number;
  updatedAt: string;
  eTag?: string;
}

/** The runtime JSON of `POST /api/archive/tournaments/{id}/edit-batch`. */
interface RawArchiveTournamentEditBatchResponse {
  tournament: RawArchiveTournamentDetail;
}

/** The wire body. `moveToSeason` present ⇒ move; its `seasonId: null` ⇒ detach to standalone. */
interface RawArchiveTournamentEditBatchRequest {
  moveToSeason: { seasonId: string | null } | null;
  editTournament: { name: string; tournamentDate: string } | null;
  status: string | null;
  addRounds: { roundId: string; entries: RoundEntry[] }[];
  deleteRoundIds: string[];
  replaceRounds: { roundId: string; entries: RoundEntry[] }[];
  updateArchetypes: { playerName: string; archetype: string }[];
}

@Injectable({ providedIn: 'root' })
export class ServerArchiveBackend implements ArchiveTournamentPort {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  async getArchiveTournament(tournamentId: string): Promise<PersistedArchiveTournament | null>;
  async applyArchiveTournamentEditBatch(
    tournamentId: string,
    expectedVersion: number,
    batch: ArchiveTournamentEditBatch
  ): Promise<PersistedArchiveTournament>;
}
```

Method bodies, binding:

```ts
  async getArchiveTournament(tournamentId: string): Promise<PersistedArchiveTournament | null> {
    try {
      const raw = await firstValueFrom(this.http.get<RawArchiveTournamentDetail>(
        joinApiUrl(this.baseUrl, `/api/archive/tournaments/${encodeURIComponent(tournamentId)}`)
      ));
      return toPersistedArchiveTournament(raw);
    } catch (error) {
      // A missing Tournament is a page state, not a failure. Everything else propagates so the
      // caller can tell "not there" from "could not ask".
      if (error instanceof ApiProblemError && error.status === 404) return null;
      throw error;
    }
  }

  async applyArchiveTournamentEditBatch(
    tournamentId: string,
    expectedVersion: number,
    batch: ArchiveTournamentEditBatch
  ): Promise<PersistedArchiveTournament> {
    const body: RawArchiveTournamentEditBatchRequest = {
      moveToSeason: Object.hasOwn(batch, 'moveToSeasonId') ? { seasonId: batch.moveToSeasonId ?? null } : null,
      editTournament: batch.editTournament ?? null,
      status: batch.status ?? null,
      addRounds: batch.addRounds.map((round) => ({ roundId: round.roundId, entries: round.entries })),
      deleteRoundIds: [...batch.deleteRoundIds],
      replaceRounds: batch.replaceRounds.map((round) => ({ roundId: round.roundId, entries: round.entries })),
      updateArchetypes: batch.updateArchetypes.map((row) => ({ playerName: row.playerName, archetype: row.archetype }))
    };
    const response = await firstValueFrom(this.http.post<RawArchiveTournamentEditBatchResponse>(
      joinApiUrl(this.baseUrl, `/api/archive/tournaments/${encodeURIComponent(tournamentId)}/edit-batch`),
      body,
      { context: new HttpContext().set(API_ETAG, encodeArchiveETag(expectedVersion)) }
    ));
    return toPersistedArchiveTournament(response.tournament);
  }
```

and the module-local rehydrator:

```ts
/** The wire is trusted for shape, not for completeness: `seasonId` may arrive `null`, and both
 *  collections are absent on a Tournament that has neither. Everything else is required. */
function toPersistedArchiveTournament(raw: RawArchiveTournamentDetail): PersistedArchiveTournament {
  return {
    id: raw.id,
    name: raw.name,
    seasonId: raw.seasonId ?? null,
    tournamentDate: raw.tournamentDate,
    status: raw.status === 'completed' ? 'completed' : 'active',
    rounds: raw.rounds ?? [],
    playerArchetypes: raw.playerArchetypes ?? [],
    documentVersion: raw.documentVersion,
    updatedAt: raw.updatedAt,
    ...(raw.eTag ? { eTag: raw.eTag } : {})
  };
}
```

The `If-Match` header is **never** set by hand: it is carried in `API_ETAG` on the request `HttpContext`, and `apiBoundaryInterceptor` turns it into the header alongside `Authorization` and `withCredentials`. That is what makes the request identical in shape to every other command in the app.

### Produces — additions to `src/app/data/archive-repository.service.ts` (T12's file, additive)

```ts
/** One staged save. `expectedVersion` is the `documentVersion` the draft was cloned from. */
export interface ArchiveStagedSave {
  tournamentId: string;
  expectedVersion: number;
  batch: ArchiveTournamentEditBatch;
}
```

Exactly these members are added to the existing class:

```ts
  private readonly power = inject(PowerUserSettingsService);
  private readonly localTournaments: ArchiveTournamentPort = inject(LocalArchiveBackend);
  private readonly serverTournaments: ArchiveTournamentPort = inject(ServerArchiveBackend);

  /**
   * The whole Tournament document, from the store the id names. `null` for `404`.
   * `get`-prefixed, so the structural coverage test classifies it as the read it is.
   */
  async getTournament(tournamentId: string): Promise<PersistedArchiveTournament | null> {
    return this.tournamentPort(tournamentId).getArchiveTournament(tournamentId);
  }

  /**
   * ADR 0037's one staged save. One request, one version bump, and the authoritative document comes
   * back in the response so the caller adopts it without a second read.
   *
   * `requireEnabled()` runs inside the wrapper's action, not before it, so a power-gate refusal is a
   * rejected promise like every other refusal instead of a synchronous throw the caller would have
   * to guard separately.
   */
  saveTournamentEdits(save: ArchiveStagedSave): Promise<PersistedArchiveTournament> {
    return this.mutating(async () => {
      this.power.requireEnabled();
      return this.tournamentPort(save.tournamentId)
        .applyArchiveTournamentEditBatch(save.tournamentId, save.expectedVersion, save.batch);
    });
  }

  /** The whole routing rule: origin is encoded in the id, and nothing else decides the store. */
  private tournamentPort(tournamentId: string): ArchiveTournamentPort {
    return isLocalArchiveId(tournamentId) ? this.localTournaments : this.serverTournaments;
  }
```

`saveTournamentEdits` is the ticket's only mutating method, it is public, it does not start with a read prefix, and its body contains `this.mutating(` — which is exactly what the structural coverage test demands.

### Produces — additions to `src/app/features/archive/tournament-detail.component.ts` (T14's file, additive)

Exactly these public members are added to `TournamentDetailComponent`:

```ts
  readonly editing = signal(false);
  readonly saving = signal(false);
  readonly dirty = signal(false);
  readonly stale = signal(false);
  readonly draft = signal<ArchiveTournamentDocument | null>(null);
  readonly importErrors = signal<string[]>([]);
  readonly seasonOptions = signal<readonly ArchiveSeasonOption[]>([]);
  /** `null` means standalone. Held apart from the draft because the move is its own intent. */
  readonly selectedSeasonId = signal<string | null>(null);
  readonly expandedRoundNumbers = signal<ReadonlySet<number>>(new Set());

  /** Locked and not an Admin ⇒ the server would refuse every write with `409`, so offer none. */
  readonly lockBlocksEdit = computed<boolean>(…);
  /** Power mode never replaces role/origin authority; all three gates must pass. */
  readonly canEdit = computed<boolean>(…);
  readonly canManage = computed<boolean>(…);          // canEdit() && editing()
  readonly canToggleStatus = computed<boolean>(…);    // canEdit() && !editing()
  readonly statusLabel = computed<string>(…);
  readonly toggleLabel = computed<string>(…);
  readonly warnings = computed<readonly TournamentWarning[]>(…);
  readonly warningMessages = computed<readonly string[]>(…);
  readonly completionIssues = computed<readonly string[]>(…);
  /** The document currently rendered: the draft while editing, the authoritative one otherwise. */
  readonly current = computed<ArchiveTournamentDocument | null>(…);

  startEdit(): void;
  cancelEdit(): Promise<void>;
  markDirty(): void;
  addRound(): void;
  addMatch(round: RoundDocument): void;
  addBye(round: RoundDocument): void;
  deleteRound(round: RoundDocument): void;
  deleteEntry(round: RoundDocument, entryId: string): void;
  replaceRound(round: RoundDocument, text: string): void;
  hasValidRoundImport(text: string): boolean;
  setArchetype(playerName: string, archetype: string): void;
  syncPlayerArchetypesFromRoundEntries(): void;
  moveTournamentToSeason(value: string): void;
  isRoundExpanded(roundNumber: number): boolean;
  setRoundExpanded(roundNumber: number, expanded: boolean): void;
  roundViewModels(tournament: ArchiveTournamentDocument): { round: RoundDocument; number: number }[];
  playerArchetypeRows(tournament: ArchiveTournamentDocument): { playerName: string; archetype: string }[];
  archetypeFor(tournament: ArchiveTournamentDocument, playerName: string): string;
  entryInvalid(entry: RoundEntry): boolean;
  entryHasWarning(round: RoundDocument, entry: RoundEntry): boolean;
  roundEntryInputLabel(roundNumber: number, entryIndex: number, field: string): string;
  roundEntryDeleteLabel(roundNumber: number, entryIndex: number): string;
  seasonOptionLabel(option: ArchiveSeasonOption): string;
  save(): Promise<void>;
  reloadLatest(): Promise<void>;
  toggleStatus(): Promise<void>;
```

and this exported helper type:

```ts
/** A move target: a Season this Tournament may be attached to, in the same authority. */
export interface ArchiveSeasonOption {
  readonly id: string;
  readonly name: string;
}
```

Gate definitions, binding:

```ts
  readonly lockBlocksEdit = computed(() => {
    const tournament = this.tournament();
    if (!tournament) return false;
    // The lock is derived from the date, never stored, and a browser-local record is exempt.
    // An Admin bypasses it server-side, so offering the control to an Admin is honest.
    return isArchiveTournamentRowLocked({ id: tournament.id, tournamentDate: tournament.tournamentDate })
      && this.auth.profile()?.globalRole !== 'Admin';
  });

  readonly canEdit = computed(() => {
    const tournament = this.tournament();
    return Boolean(tournament
      && !this.lockBlocksEdit()
      && canUsePowerMutation(this.power.enabled(), canManageArchiveRecord(tournament.id, this.auth.profile()?.globalRole)));
  });

  readonly canManage = computed(() => this.editing() && this.canEdit());
  readonly canToggleStatus = computed(() => !this.editing() && this.canEdit());
```

`save()` control flow, binding, in this exact order:

1. Return immediately unless `canManage() && !saving()`.
2. Read `source = this.tournament()` and `draft = this.draft()`; return when either is `null`.
3. `draft.name = String(draft.name ?? '').trim()`. When it is now empty → `this.error.set(this.i18n.t('archiveEdit.nameRequired'))` and return. **No request, draft retained.**
4. `const batch = buildArchiveStagedEditBatch(source, draft, this.selectedSeasonId());`
5. When `archiveStagedEditBatchIsEmpty(batch)` → `this.exitEdit()` and return. **No repository call** (ADR 0037's empty-save rule).
6. `const issues = tournamentCompletionIssues(toTournamentDocument(draft), this.i18n, { includeMissingRound: false });` When non-empty → `this.error.set(this.i18n.t('archiveEdit.invalidDraft', { count: issues.length }))` and return. **No request, draft retained.**
7. `const deleted = archiveStagedDeletionSummary(source, draft);`
8. `this.saving.set(true)`, then open **one** `ConfirmDialogComponent` with
   `title: t('archiveEdit.saveChangesTitle')`,
   `message: t('archiveEdit.saveChangesSummary', { move, rounds: deleted.rounds, entries: deleted.entries })` where `move` is the target Season's name, or `t('archiveEdit.standaloneOption')` when detaching, or `t('archiveEdit.noSeasonMove')` when `selectedSeasonId() === source.seasonId`,
   `confirmLabel: t('archiveEdit.saveChanges')`,
   `destructive: deleted.rounds > 0 || deleted.entries > 0`.
   A cancelled dialog returns without a request.
9. `const saved = await this.repo.saveTournamentEdits({ tournamentId: source.id, expectedVersion: source.documentVersion, batch });`
10. On success: clear `error`, `stale`, `importErrors`, then `this.adopt(saved)`. **No `getTournament` call.**
11. On failure: `logBoundaryError('archive-tournament-detail.save', error, { tournamentId: source.id, seasonId: this.selectedSeasonId() })` then `this.applyCommandError(error)`. The draft is not touched.
12. `finally { this.saving.set(false); }`

`applyCommandError`, binding:

```ts
  /** HTTP status first, code second — the one classifier both authorities feed. */
  private applyCommandError(error: unknown): void {
    const kind = archiveCommandError(error);
    this.stale.set(kind === 'stale');
    this.error.set(this.i18n.t(
      kind === 'stale' ? 'archiveEdit.staleSave'
        : kind === 'locked' ? 'archiveEdit.lockedSave'
        : kind === 'forbidden' ? 'archiveEdit.forbidden'
        : kind === 'notFound' ? 'archiveEdit.notFoundSave'
        : kind === 'invalid' ? 'archiveEdit.invalidSave'
        : 'archiveEdit.saveFailed'
    ));
  }

  /** Adopt the authoritative document the write returned. No refetch: the response carries it. */
  private adopt(saved: PersistedArchiveTournament): void {
    this.tournament.set(saved);
    this.selectedSeasonId.set(saved.seasonId);
    this.exitEdit();
    void this.loadSeasonName(saved.seasonId);
  }

  private exitEdit(): void {
    this.draft.set(null);
    this.editing.set(false);
    this.dirty.set(false);
    this.stale.set(false);
    this.error.set('');
    this.importErrors.set([]);
    this.selectedSeasonId.set(this.tournament()?.seasonId ?? null);
  }
```

`reloadLatest()`: returns unless `stale() && !saving()`; opens a confirm with `archiveEdit.reloadLatestTitle` / `archiveEdit.reloadLatestMessage` / `archiveEdit.discardDraft`, `destructive: true`; on cancel returns with the draft intact; on confirm calls `this.repo.getTournament(this.tournamentId())`, throws `new Error('archiveTournamentNotFound')` on `null`, then `this.adopt(latest)`.

`toggleStatus()`: returns unless `canToggleStatus() && !saving()`; confirms with `archive.markComplete` / `archive.completeConfirm` or `archive.reopen` / `archive.reopenConfirm`; then saves the status-only batch

```ts
{ status: next, addRounds: [], deleteRoundIds: [], replaceRounds: [], updateArchetypes: [] }
```

through the same `repo.saveTournamentEdits(...)`, and adopts the result.

Host listeners, ported verbatim from `tournament-archive-detail.component.ts:222-227`:

```ts
  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) event.preventDefault();
  }

  @HostListener('document:keydown', ['$event']) handleShortcut(event: KeyboardEvent): void {
    if (!this.editing() || this.saving()) return;
    if (event.key === 'Escape' && this.dirty()) { event.preventDefault(); void this.cancelEdit(); }
    if (event.key.toLowerCase() === 's' && (event.metaKey || event.ctrlKey) && this.dirty()) { event.preventDefault(); void this.save(); }
  }
```

### Produces — i18n keys, both catalogues

Added to `src/app/i18n/messages.ts`, as one block immediately before the `} as const;` that closes `const en`, and as the mirrored block immediately before the `};` that closes `const fr` (the line directly above `export const catalogs`).

| Key | `en` | `fr` |
| --- | --- | --- |
| `archiveEdit.edit` | `Edit` | `Modifier` |
| `archiveEdit.cancelEdit` | `Cancel Edit` | `Annuler la modification` |
| `archiveEdit.saveChanges` | `Save Changes` | `Enregistrer les modifications` |
| `archiveEdit.saveChangesTitle` | `Save Tournament changes?` | `Enregistrer les modifications du tournoi ?` |
| `archiveEdit.saveChangesSummary` | `Move to: {move}. Deleted rounds: {rounds}. Deleted entries: {entries}.` | `Déplacer vers : {move}. Rondes supprimées : {rounds}. Entrées supprimées : {entries}.` |
| `archiveEdit.season` | `Season` | `Saison` |
| `archiveEdit.noSeasonMove` | `No Season move` | `Aucun déplacement de saison` |
| `archiveEdit.standaloneOption` | `Standalone — no Season` | `Indépendant — sans saison` |
| `archiveEdit.nameRequired` | `Give this Tournament a name before saving.` | `Donnez un nom à ce tournoi avant d’enregistrer.` |
| `archiveEdit.invalidDraft` | `Fix {count} Tournament source-data issue(s) before saving.` | `Corrigez {count} problème(s) de données source du tournoi avant d’enregistrer.` |
| `archiveEdit.discardEditTitle` | `Discard staged changes?` | `Abandonner les modifications préparées ?` |
| `archiveEdit.discardEditMessage` | `This removes every unsaved change in this edit session.` | `Toutes les modifications non enregistrées de cette session seront supprimées.` |
| `archiveEdit.discardDraft` | `Discard Changes` | `Abandonner les modifications` |
| `archiveEdit.reloadLatest` | `Reload latest saved data` | `Recharger les dernières données enregistrées` |
| `archiveEdit.reloadLatestTitle` | `Reload latest Tournament?` | `Recharger la dernière version du tournoi ?` |
| `archiveEdit.reloadLatestMessage` | `This reloads the authoritative Tournament and discards every staged change. Changes are not merged.` | `Cette action recharge le tournoi faisant autorité et abandonne toutes les modifications préparées. Elles ne sont pas fusionnées.` |
| `archiveEdit.staleSave` | `This Tournament changed since you opened it. Reload the latest saved data before saving again.` | `Ce tournoi a changé depuis son ouverture. Rechargez les dernières données avant d’enregistrer à nouveau.` |
| `archiveEdit.lockedSave` | `This Tournament was played more than 365 days ago and is locked. Only an administrator can still change it.` | `Ce tournoi a été joué il y a plus de 365 jours et il est verrouillé. Seul un administrateur peut encore le modifier.` |
| `archiveEdit.forbidden` | `Your account is not allowed to change this Tournament.` | `Votre compte n’est pas autorisé à modifier ce tournoi.` |
| `archiveEdit.notFoundSave` | `This Tournament no longer exists. It was deleted while you were editing it.` | `Ce tournoi n’existe plus. Il a été supprimé pendant votre modification.` |
| `archiveEdit.invalidSave` | `The server refused these changes. Check the Tournament data and try again.` | `Le serveur a refusé ces modifications. Vérifiez les données du tournoi et réessayez.` |
| `archiveEdit.saveFailed` | `Could not save this Tournament.` | `Impossible d’enregistrer ce tournoi.` |
| `archiveEdit.lockedNotice` | `Locked — this Tournament was played more than 365 days ago and can no longer be edited.` | `Verrouillé — ce tournoi a été joué il y a plus de 365 jours et ne peut plus être modifié.` |

### Consumes

Verbatim from the predecessors, binding, **not to be redesigned**:

- The wire routes and JSON shapes reproduced under **Inputs → From Depends** (T4, T5, T7).
- `ArchiveTournamentEditBatch`, `ArchiveRoundIntent`, `ArchiveConcurrencyError`, `ArchiveNotFoundError` and `LocalArchiveBackend` from `src/app/backend/local-archive-backend.service.ts` (T10).
- `ArchiveTournamentDocument`, `PersistedArchiveTournament`, `isArchiveTournamentLocked`, `toTournamentDocument`, `toArchiveTournamentDocument` from `src/app/domain/archive-models.ts` (T10).
- `isLocalArchiveId` (T10, `archive-origin.ts`), `isArchiveTournamentRowLocked` (T10, `archive-summary.ts`), `canManageArchiveRecord` and `archiveCommandError` (T10, `archive-command-ux.ts`).
- `ArchiveRepository`, `ARCHIVE_UPDATED_EVENT`, `ArchiveLeagueSeasonRow`, `ArchiveCatalogResult<T>` and the private `mutating` wrapper from `src/app/data/archive-repository.service.ts` (T12/T16).
- `ArchiveTournamentDetail`, `ArchiveTournamentDetailSource`, `ARCHIVE_TOURNAMENT_DETAIL_SOURCE`, `toResultInput` and `TournamentDetailComponent` from `src/app/features/archive/tournament-detail.component.ts` (T14).
- Existing app symbols, unchanged: `PowerUserSettingsService`, `canUsePowerMutation`, `ConfirmDialogComponent`, `BackButtonComponent`, `RankingTableComponent`, `DeckArchetypeInputComponent`, `I18nService`, `AuthService`, `logBoundaryError`, `ApiProblemError`, `API_ETAG`, `joinApiUrl`, `API_BASE_URL`, and every domain helper listed under **Inputs**.

### Errors — exact code per failure path

| Failure | Reaches the UI as | Classified | Rendered |
| --- | --- | --- | --- |
| Server refuses a locked Tournament | `ApiProblemError`, `status 409`, `problem.code` `archive_tournament_locked` | `'locked'` | `.error[role=alert]`, `archiveEdit.lockedSave`; draft retained; `stale()` false |
| Server rejects a stale / missing `If-Match` | `ApiProblemError`, `status 412`, `problem.code` `stale_version` | `'stale'` | `archiveEdit.staleSave`; draft retained; `stale()` **true** ⇒ Reload Latest appears |
| Browser-local store rejects a stale write | `ArchiveConcurrencyError`, `status 412`, message `staleArchiveDocument` | `'stale'` | identical to the row above |
| Caller lacks the capability | `ApiProblemError`, `status 403` | `'forbidden'` | `archiveEdit.forbidden`; draft retained |
| Tournament deleted while editing | `ApiProblemError`, `status 404`, `problem.code` `not_found` | `'notFound'` | `archiveEdit.notFoundSave`; draft retained |
| Browser-local row missing | `ArchiveNotFoundError`, `status 404` | `'notFound'` | identical to the row above |
| Server validation refusal (empty batch, blank name, bad date) | `ApiProblemError`, `status 400`, `problem.code` `validation_failed` | `'invalid'` | `archiveEdit.invalidSave`; draft retained |
| Network failure / anything else | `HttpErrorResponse` or `Error` | `'failed'` | `archiveEdit.saveFailed`; draft retained |
| Power mode off at save time | `Error('powerUserRequired')` from `PowerUserSettingsService.requireEnabled()` | `'failed'` | `archiveEdit.saveFailed`. Unreachable through the UI — the Edit control is not rendered — and deliberately kept as the repository-level backstop ADR 0037 requires |
| Local blank / empty-batch draft refusal | `Error('emptyArchiveTournamentEditBatch')` | `'failed'` | Unreachable: step 5 of `save()` exits before the call |
| Draft name blank | *(no call)* | — | `archiveEdit.nameRequired`; draft retained |
| Draft has invalid entries or archetype conflicts | *(no call)* | — | `archiveEdit.invalidDraft` with the issue count; draft retained |
| `getTournament` rejects on Reload Latest | as classified above | as above | same `applyCommandError` path, logged at `archive-tournament-detail.reloadLatest` |

**The classifier is spelling-agnostic on the wire code by design.** `archiveCommandError` matches `409` with **either** `archive_tournament_locked` (snake_case, the API-wide vocabulary in force) **or** `archiveTournamentLocked` (camelCase, as an earlier draft of the backend contract wrote it), and both map to `'locked'`. Any other `409` maps to `'failed'`. The browser-local mirror keeps its camelCase message `staleArchiveDocument` because that is a browser-local string and never a wire code; the classifier keys on `status === 412` first regardless.

### Invariants

- **Read-only default.** `editing()` is `false` on every load. Nothing in the template binds `ngModel` outside a `@if (editing())` or `@if (canManage())` guard, so a reader can never mutate a field they cannot save.
- **Three gates, all required.** `canEdit() ⇔ tournament !== null ∧ ¬lockBlocksEdit() ∧ powerEnabled ∧ (isLocalArchiveId(id) ∨ role ∈ {Organizer, Admin})`. The browser preference alone never grants authority, and authority alone never reveals the control.
- **Lock derivation.** Lock state is derived from `tournamentDate` at render time and is never read from a stored field. A `local-` id is never locked. `Admin` bypasses `lockBlocksEdit`, matching the server, and bypasses nothing else.
- **No repository call while drafting.** Between `startEdit()` and `save()` / `cancelEdit()` / `reloadLatest()` the component calls no method on `ArchiveRepository` and issues no HTTP request. `startEdit()` deep-clones with `structuredClone`; the clone shares no reference with the authoritative document, so an aborted edit cannot leak into it.
- **One save, one request, one version bump.** A confirmed save issues exactly one `POST …/edit-batch`. A refused save issues zero. A cancelled confirm dialog issues zero.
- **Adopt without refetch.** After a `200` the component sets `tournament` from the response body. The count of `GET /api/archive/tournaments/{id}` requests is unchanged by a successful save.
- **Failure atomicity.** On any rejection the draft signal, `selectedSeasonId` and `expandedRoundNumbers` are byte-identical to their pre-save values. `stale()` is set only for `'stale'`, and Reload Latest is rendered only while `stale()` is true.
- **No auto-merge.** Reload Latest replaces the document wholesale and drops the draft. There is no merge, no rebase, no retry and no partial save anywhere in this ticket.
- **Same-authority move.** `seasonOptions()` holds only rows whose `isLocal` equals `isLocalArchiveId(tournamentId)`. A cross-authority id can therefore never reach `selectedSeasonId`, and `moveTournamentToSeason` additionally refuses a value absent from `seasonOptions()`.
- **Move encoding.** `moveToSeasonId` appears in the batch **only** when `selectedSeasonId() !== source.seasonId`. Absent means "do not move"; present-and-`null` means "detach to standalone". `ARCHIVE_STANDALONE_SEASON_VALUE` never leaves the template — `moveTournamentToSeason` converts it to `null` on the way in, and the option list converts `null` back to it on the way out.
- **Status is an intent, not a gate.** A `completed` Tournament stays editable. The only freeze is the 365-day lock.
- **Invalidation ordering.** `invalidateArchiveCaches()` runs after the write resolved and never when it threw, because the only call site is inside the private `mutating` wrapper, after `await action()`.
- **Nullability.** `seasonId` is `string | null`, never `undefined` and never `''`. `documentVersion` is an integer ≥ 1. `tournamentDate` is `YYYY-MM-DD` with no time and no zone. `updatedAt` is a UTC instant.
- **Ordering.** Rounds keep insertion order in the draft and in the batch. `updateArchetypes` is sorted by `playerName` with `localeCompare`, so one draft yields one byte-identical batch.
- **Idempotency.** `buildArchiveStagedEditBatch(source, source, source.seasonId)` returns an empty batch. Re-entering edit mode without changing anything and pressing Save issues no request.
- **data-cy.** Every element added to the template carries `data-cy` or `[attr.data-cy]`, and every static value is unique within the file. Repeated per-row markers use the binding form.
- **Accessibility.** Every entry input carries `[attr.aria-label]` built by `roundEntryInputLabel` / `roundEntryDeleteLabel`. The status chip's dot is `aria-hidden="true"`. The error paragraph carries `role="alert"`.

## TDD

1. **Red** — write these five test files/edits first, in this order, and run each to see it fail:
   1. `src/app/domain/archive-staged-edit.test.ts` — fails to resolve the module.
   2. `src/app/backend/server-archive-backend.service.test.ts` — fails to resolve the module.
   3. `src/app/data/archive-repository.staged-edit.test.ts` — fails: `saveTournamentEdits` is not a function.
   4. `src/app/features/archive/tournament-detail.component.test.ts` — the replaced and added tests fail on missing members and missing template markers.
   5. `cypress/e2e/archive-staged-edit.cy.js` — fails: `/archive/tournaments/:id` renders no Edit control.
2. **Green** — implement in the order of *Impl steps*: pure module → server adapter → repository → i18n → component → spec. Each step's tests go green before the next starts.
3. **Refactor** — only if needed. Keep green. Do not widen `archive-staged-edit.ts` beyond the three pure functions; anything that needs Angular belongs in the component.

## Test plan

### `src/app/domain/archive-staged-edit.test.ts`

| Test | Input | Expect |
| ---- | ----- | ------ |
| `an unchanged draft produces an empty batch` | `buildArchiveStagedEditBatch(doc, structuredClone(doc), doc.seasonId)` | `archiveStagedEditBatchIsEmpty(batch) === true`; all four arrays `[]`; no `editTournament`, no `status`, no `moveToSeasonId` key |
| `a renamed or redated draft emits one editTournament intent` | name `'A'`→`'B'`, date `'2026-01-01'`→`'2026-02-02'` | `batch.editTournament` deep-equals `{ name: 'B', tournamentDate: '2026-02-02' }`; arrays still empty |
| `a status change emits a status intent` | `'active'`→`'completed'` | `batch.status === 'completed'` |
| `a new round is an add, a dropped round is a delete, a changed round is a replace` | source rounds `r1,r2`; draft rounds `r2'(changed),r3` | `addRounds` = `[{roundId:'r3',…}]`; `deleteRoundIds` = `['r1']`; `replaceRounds` = `[{roundId:'r2',…}]` |
| `a reordered round counts as a replace` | same entry ids, swapped order | `replaceRounds.length === 1` |
| `round intents carry a deep copy, not a reference` | mutate `batch.addRounds[0].entries[0].table` after building | the draft's entry is unchanged |
| `changed archetypes are emitted sorted, missing counted as empty` | source `{Bob:'Burn'}`, draft `{Alice:'Elves', Bob:''}` | `updateArchetypes` deep-equals `[{playerName:'Alice',archetype:'Elves'},{playerName:'Bob',archetype:''}]` |
| `an unchanged archetype is not emitted` | source and draft both `{Alice:'Elves'}` | `updateArchetypes` is `[]` |
| `attaching to a Season emits the move` | `source.seasonId = null`, `draftSeasonId = 's1'` | `batch.moveToSeasonId === 's1'`; `archiveStagedEditBatchIsEmpty(batch) === false` |
| `detaching to standalone emits a null move, not an empty batch` | `source.seasonId = 's1'`, `draftSeasonId = null` | `Object.hasOwn(batch,'moveToSeasonId') === true`; `batch.moveToSeasonId === null`; `archiveStagedEditBatchIsEmpty(batch) === false` |
| `an unchanged Season emits no move key` | `source.seasonId = 's1'`, `draftSeasonId = 's1'` | `Object.hasOwn(batch,'moveToSeasonId') === false` |
| `the deletion summary counts dropped rounds and dropped entries separately` | source `r1(2 entries), r2(3 entries)`; draft keeps `r2` with 1 entry | `{ rounds: 1, entries: 2 }` |
| `the deletion summary ignores entries added to a surviving round` | draft adds an entry to `r1` | `{ rounds: 0, entries: 0 }` |
| `the standalone sentinel is a reserved value` | `ARCHIVE_STANDALONE_SEASON_VALUE` | `=== '__standalone__'` |

### `src/app/backend/server-archive-backend.service.test.ts`

Build the service with `Object.create(ServerArchiveBackend.prototype)` and `Object.assign(service, { http: fakeHttp, baseUrl: 'https://api.test' })`, where `fakeHttp` records `{ method, url, body, context }` and returns `of(response)`.

| Test | Input | Expect |
| ---- | ----- | ------ |
| `encodes the strong ETag the API mints` | `encodeArchiveETag(5)` | `'"AAAAAAAAAAU="'` |
| `refuses a version that cannot be an ETag` | `encodeArchiveETag(0)`, `encodeArchiveETag(1.5)` | both throw `Error('invalidArchiveDocumentVersion')` |
| `posts the batch to the tournament edit-batch route` | `applyArchiveTournamentEditBatch('t1', 4, batch)` | url `'https://api.test/api/archive/tournaments/t1/edit-batch'`, method `post` |
| `carries the expected version as the If-Match context` | same | `context.get(API_ETAG) === encodeArchiveETag(4)`; the request sets **no** `If-Match` header itself |
| `omits the move when the batch does not move` | batch without `moveToSeasonId` | `body.moveToSeason === null` |
| `sends a null seasonId when detaching to standalone` | `{ ...batch, moveToSeasonId: null }` | `body.moveToSeason` deep-equals `{ seasonId: null }` |
| `sends the target seasonId when attaching` | `{ ...batch, moveToSeasonId: 's2' }` | `body.moveToSeason` deep-equals `{ seasonId: 's2' }` |
| `sends null for absent editTournament and status` | minimal batch | `body.editTournament === null`, `body.status === null` |
| `adopts the document from the response envelope` | response `{ tournament: { id:'t1', seasonId:null, …, documentVersion:5 } }` | resolves the whole document with `documentVersion === 5`, `seasonId === null` |
| `defaults absent collections to empty arrays` | response document with no `rounds` / `playerArchetypes` | both `[]` |
| `escapes the tournament id in the path` | id `'a/b'` | url contains `/api/archive/tournaments/a%2Fb/edit-batch` |
| `reads a tournament from the detail route` | `getArchiveTournament('t1')` | url `'https://api.test/api/archive/tournaments/t1'`, method `get` |
| `returns null for a 404 and rethrows everything else` | http throws `new ApiProblemError(404, { code: 'not_found' })` / `new ApiProblemError(500, {})` | resolves `null` / rejects with the `500` |

### `src/app/data/archive-repository.staged-edit.test.ts`

Build with `Object.create(ArchiveRepository.prototype)` and `Object.assign` the four collaborators (`power`, `localTournaments`, `serverTournaments`, `archiveCache`) plus a spy `invalidateArchiveCaches`.

| Test | Input | Expect |
| ---- | ----- | ------ |
| `routes a server id to the server port` | `saveTournamentEdits({ tournamentId: 'server-1', … })` | `serverTournaments.applyArchiveTournamentEditBatch` called once with `('server-1', 4, batch)`; local port untouched |
| `routes a local id to the browser store` | `tournamentId: 'local-1'` | `localTournaments.applyArchiveTournamentEditBatch` called once; server port untouched |
| `refuses to write while Power mode is off` | `power.requireEnabled` throws `Error('powerUserRequired')` | rejects `'powerUserRequired'`; **neither** port called; `invalidateArchiveCaches` **not** called |
| `invalidates the archive caches after a successful write` | write resolves | `invalidateArchiveCaches` called exactly once, **after** the port resolved |
| `does not invalidate when the write failed` | port rejects `new ApiProblemError(412, { code: 'stale_version' })` | rejects with the same error; `invalidateArchiveCaches` **not** called |
| `returns the authoritative document unchanged` | port resolves `{ …, documentVersion: 5 }` | resolves the identical object reference |
| `reads a tournament from the store its id names` | `getTournament('local-1')`, `getTournament('server-1')` | the local port then the server port; `invalidateArchiveCaches` never called by either |

### `src/app/features/archive/tournament-detail.component.test.ts` (T14's file, edited)

**Replace** the existing test named `the detail page offers no mutation` with `the detail page starts read-only for everyone`. **Keep every other existing test unchanged.** Add the rest.

| Test | Input | Expect |
| ---- | ----- | ------ |
| `the detail page starts read-only for everyone` *(replaces `the detail page offers no mutation`)* | source | contains `data-cy="archive-tournament-read-only"`; every `ngModel` occurrence sits inside a block opened by `@if (canManage())` or `@if (editing())`; `component.editing()` is `false` on a freshly built instance |
| `the edit control needs power mode, authority and an unlocked row` | power on/off × role `User`/`Organizer`/`Admin` × id `local-1`/`server-1` × date today/400 days ago | `canEdit()` true **only** for: (power on ∧ (local id ∨ role∈{Organizer,Admin}) ∧ (unlocked ∨ role==='Admin')). Assert all 24 combinations from a table |
| `an admin may still edit a locked tournament` | role `Admin`, date 400 days ago, power on | `lockBlocksEdit() === false`, `canEdit() === true` |
| `a browser-local record is never locked` | id `local-1`, date 400 days ago, role `User`, power on | `lockBlocksEdit() === false`, `canEdit() === true` |
| `starting an edit clones the document and calls no repository method` | `startEdit()` on a loaded instance | `editing() === true`; `draft() !== tournament()`; `draft()!.rounds[0] !== tournament()!.rounds[0]`; every repository spy has `0` calls |
| `an empty save exits edit mode without a repository call` | `startEdit()` then `save()` | `saveTournamentEdits` not called; `editing() === false`; dialog not opened |
| `a blank name is refused before any request` | draft name `'   '`, then `save()` | `error()` is the `archiveEdit.nameRequired` string; `saveTournamentEdits` not called; `draft()` still non-null |
| `an invalid entry is refused before any request` | draft round with a match entry missing `player2Name`, then `save()` | `error()` matches the `archiveEdit.invalidDraft` string; `saveTournamentEdits` not called; draft retained |
| `the save dialog reports the move and both deletion counts` | draft dropping one round of two entries, Season change to `s2`, confirm stubbed | dialog `data.message` contains the Season name, `1` and `2`; `data.destructive === true` |
| `a save with no deletion is not destructive` | draft renaming only | dialog `data.destructive === false`; message contains the `archiveEdit.noSeasonMove` string |
| `a cancelled confirmation issues no request` | dialog resolves `undefined` | `saveTournamentEdits` not called; `editing() === true`; draft retained |
| `a successful save adopts the response without refetching` | `saveTournamentEdits` resolves `{ …, name: 'Committed', documentVersion: 5 }` | `tournament()!.name === 'Committed'`; `tournament()!.documentVersion === 5`; `editing() === false`; `dirty() === false`; `getTournament` **not** called |
| `a 412 keeps the draft and offers Reload Latest` | rejects `new ApiProblemError(412, { code: 'stale_version' })` | `stale() === true`; `editing() === true`; `draft()` unchanged; `error()` is the `archiveEdit.staleSave` string |
| `a browser-local stale write is the same conflict` | rejects `new ArchiveConcurrencyError()` | identical assertions to the row above |
| `a 409 lock refusal is reported as a lock` | rejects `new ApiProblemError(409, { code: 'archive_tournament_locked' })` | `error()` is the `archiveEdit.lockedSave` string; `stale() === false`; draft retained |
| `a camelCase lock code is reported the same way` | rejects `new ApiProblemError(409, { code: 'archiveTournamentLocked' })` | identical assertions to the row above |
| `a 403 is reported as forbidden` | rejects `new ApiProblemError(403, {})` | `error()` is the `archiveEdit.forbidden` string; draft retained |
| `a 404 says the tournament is gone` | rejects `new ApiProblemError(404, { code: 'not_found' })` | `error()` is the `archiveEdit.notFoundSave` string; draft retained |
| `a 400 is reported as a refusal, not a crash` | rejects `new ApiProblemError(400, { code: 'validation_failed' })` | `error()` is the `archiveEdit.invalidSave` string |
| `cancelling Reload Latest keeps the draft` | `stale()` true, dialog resolves `undefined` | `getTournament` not called; `draft()` unchanged; `stale() === true` |
| `confirming Reload Latest replaces the document and drops the draft` | dialog resolves `true`, `getTournament` resolves v6 | `tournament()!.documentVersion === 6`; `draft() === null`; `editing() === false`; `stale() === false` |
| `cancelling a clean edit exits without a dialog` | `startEdit()` then `cancelEdit()` | dialog not opened; `editing() === false` |
| `cancelling a dirty edit asks first` | `startEdit()`, `markDirty()`, dialog resolves `undefined` | `editing() === true`; draft retained |
| `the status toggle sends a status-only batch` | `toggleStatus()` on an active Tournament, confirm stubbed | `saveTournamentEdits` called once with `batch` deep-equal `{ status: 'completed', addRounds: [], deleteRoundIds: [], replaceRounds: [], updateArchetypes: [] }` |
| `the status toggle is hidden while editing` | `editing()` true | `canToggleStatus() === false` |
| `the season selector offers only same-authority seasons plus standalone` | seasons `[{id:'s1',isLocal:false},{id:'local-s2',isLocal:true}]`, tournament id `server-1` | `seasonOptions()` ids deep-equal `['s1']`; the template renders one extra option bound to `ARCHIVE_STANDALONE_SEASON_VALUE` |
| `selecting the standalone option stages a null season` | `moveTournamentToSeason(ARCHIVE_STANDALONE_SEASON_VALUE)` | `selectedSeasonId() === null`; `dirty() === true` |
| `an unknown season value is ignored` | `moveTournamentToSeason('nope')` | `selectedSeasonId()` unchanged; `dirty()` unchanged |
| `the detail page carries both back buttons` *(existing T14 test, must stay green)* | source | contains `position="top"` and `position="bottom"` |

### `cypress/e2e/archive-staged-edit.cy.js` (rewritten)

`describe('Archive Tournament explicit staged editor')`, seven `it` blocks. Every one is an `Organizer` with power mode on unless stated; every one intercepts `GET /api/archive/tournaments/t1`, `GET /api/archive/league-seasons/all`, `GET /api/archive/years` and `GET /api/archive/tournaments/all*`, and visits `/archive/tournaments/t1`.

| Test | Setup | Expect |
| ---- | ----- | ------ |
| `stages changes without persistence, commits once, and adopts the response without refetching` | edit-batch replies `200 { tournament: { …, name: 'Committed Cup', documentVersion: 5 } }` | read-only marker visible before Edit; after Edit, rename + add round + add match + type both players; `cy.reload()` shows the original name and no entry row; repeat the edits, Save, dialog contains `Deleted rounds: 0` and `Deleted entries: 0`, confirm; `h1` is `Committed Cup`; **exactly one** POST; the `GET …/tournaments/t1` count is unchanged across the save |
| `keeps the draft on 412, cancels Reload Latest without loss, then discards after confirmation` | edit-batch replies `412 { code: 'stale_version' }`; assert `if-match` equals `etag(4)` and `body.editTournament.name === 'Unsaved Draft'` | after the refusal the name input still holds `Unsaved Draft`; Reload Latest → cancel → input unchanged, still exactly one POST; Reload Latest → confirm → `h1` is the server name and the Edit control is back |
| `reports a locked refusal without losing the draft` | row dated 300 days ago; edit-batch replies `409 { code: 'archive_tournament_locked' }` | the `archiveEdit.lockedSave` text is visible; the name input still holds the staged value; no Reload Latest control |
| `reports a forbidden refusal` | edit-batch replies `403 { code: 'forbidden' }` | the `archiveEdit.forbidden` text is visible; draft retained |
| `reports a deleted Tournament` | edit-batch replies `404 { code: 'not_found' }` | the `archiveEdit.notFoundSave` text is visible; draft retained |
| `hides every edit control while Power mode is off` | seed `gones.settings.power-user` = `'false'` | `archive-tournament-edit` does not exist; `archive-tournament-read-only` is visible; `archive-tournament-edit-name-input` does not exist |
| `hides the edit control on a locked Tournament for a non-admin` | row dated 400 days ago, power on, role `Organizer` | `archive-tournament-edit` does not exist; the `archiveEdit.lockedNotice` text is visible |

Run commands:

```bash
npx vitest run src/app/domain/archive-staged-edit.test.ts
npx vitest run src/app/backend/server-archive-backend.service.test.ts
npx vitest run src/app/data
npx vitest run src/app/features/archive
npm run test
npx cypress run --spec cypress/e2e/archive-staged-edit.cy.js
```

## Impl steps

- [ ] 1. **The pure staged-edit diff.**
  - [ ] 1.1 Create `src/app/domain/archive-staged-edit.test.ts` with the 14 tests of *Test plan → archive-staged-edit*. Start the file with `import '@angular/compiler';` — the module's type-only import reaches `local-archive-backend.service.ts`, which pulls Angular in.
  - [ ] 1.2 Run `npx vitest run src/app/domain/archive-staged-edit.test.ts` — red, module not found.
  - [ ] 1.3 Create `src/app/domain/archive-staged-edit.ts` with `ARCHIVE_STANDALONE_SEASON_VALUE`, `ArchiveStagedDeletionSummary`, `buildArchiveStagedEditBatch`, `archiveStagedDeletionSummary`, `archiveStagedEditBatchIsEmpty` and the module-local `sameJson`, verbatim from *Interface contract → Produces — archive-staged-edit.ts*. Both batch-shape imports are `import type { … }` — `isolatedModules` is on and neither is a runtime value.
  - [ ] 1.4 Run `npx vitest run src/app/domain/archive-staged-edit.test.ts` — green.

- [ ] 2. **The server write adapter.**
  - [ ] 2.1 Create `src/app/backend/server-archive-backend.service.test.ts` with the 13 tests of *Test plan → server-archive-backend*. Start with `import '@angular/compiler';`.
  - [ ] 2.2 Run `npx vitest run src/app/backend/server-archive-backend.service.test.ts` — red, module not found.
  - [ ] 2.3 Create `src/app/backend/server-archive-backend.service.ts` with the imports, `ArchiveTournamentPort`, `encodeArchiveETag`, the three `Raw*` interfaces, `toPersistedArchiveTournament` and `@Injectable({ providedIn: 'root' }) export class ServerArchiveBackend implements ArchiveTournamentPort`, verbatim from *Interface contract → Produces — server-archive-backend.service.ts*. Import `ApiProblemError`, `API_ETAG` and `joinApiUrl` from `'../api/api-boundary'`, `API_BASE_URL` from `'../api/generated/gones-api'`, `HttpClient` and `HttpContext` from `'@angular/common/http'`, and `PlayerArchetypeDocument`, `RoundDocument`, `RoundEntry` as types from `'../domain/models'`.
  - [ ] 2.4 Confirm the file contains no `indexedDB`, no `IDB`, no `localStorage` and no `sessionStorage`, then run `npx vitest run src/app/backend/server-archive-backend.service.test.ts src/app/backend/server-authority-boundary.test.ts` — both green, and in particular the IndexedDB allowlist assertion is untouched.

- [ ] 3. **The repository staged-save funnel.**
  - [ ] 3.1 Run `grep -n "private async mutating\|invalidateArchiveCaches\|getTournament\|inject(" src/app/data/archive-repository.service.ts` and note three facts: the **name** of the private wrapper that calls `this.invalidateArchiveCaches()`, whether `getTournament` already exists, and where the `inject(...)` field block ends. Where the wrapper is named something other than `mutating`, use the real name everywhere below — the structural coverage test discovers it and does not hardcode it. Where the wrapper does **not** exist, add it verbatim as quoted under *Inputs → From Depends → From T16*.
  - [ ] 3.2 Create `src/app/data/archive-repository.staged-edit.test.ts` with the 7 tests of *Test plan → archive-repository.staged-edit*. Start with `import '@angular/compiler';`.
  - [ ] 3.3 Run `npx vitest run src/app/data/archive-repository.staged-edit.test.ts` — red.
  - [ ] 3.4 In `src/app/data/archive-repository.service.ts`, add to the existing `inject(...)` field block, at the same two-space indentation:
        ```ts
          private readonly power = inject(PowerUserSettingsService);
          private readonly localTournaments: ArchiveTournamentPort = inject(LocalArchiveBackend);
          private readonly serverTournaments: ArchiveTournamentPort = inject(ServerArchiveBackend);
        ```
        and the imports `import { PowerUserSettingsService } from '../shared/power-user-settings.service';`, `import { ArchiveTournamentPort, ServerArchiveBackend } from '../backend/server-archive-backend.service';`, `import type { ArchiveTournamentEditBatch } from '../backend/local-archive-backend.service';`, `import type { PersistedArchiveTournament } from '../domain/archive-models';`. `LocalArchiveBackend` and `isLocalArchiveId` are already imported by T12; do not re-import either.
  - [ ] 3.5 Add `export interface ArchiveStagedSave { tournamentId: string; expectedVersion: number; batch: ArchiveTournamentEditBatch; }` at module scope, beside T12's other exported interfaces.
  - [ ] 3.6 Add `async getTournament(...)`, `saveTournamentEdits(...)` and `private tournamentPort(...)` verbatim from *Interface contract → Produces — additions to archive-repository.service.ts*, each declared at exactly two-space indentation, each a method and never an arrow property. **Skip `getTournament` entirely if step 3.1 found it already present** — T14 may have added it — and leave the existing body alone.
  - [ ] 3.7 Run `npx vitest run src/app/data` — green, including T16's `archive-cache-invalidation.test.ts`. If `every mutating method reaches the invalidation funnel` reports `saveTournamentEdits`, the body is missing its `this.<wrapper>(` call; if it reports `getTournament`, the method was misnamed.

- [ ] 4. **i18n, both catalogues.**
  - [ ] 4.1 In `src/app/i18n/messages.ts`, insert immediately before the `} as const;` that closes `const en` a block headed `  // Archive staged edit (T17)` holding the 23 `en` values of *Interface contract → Produces — i18n keys*, one `'key': 'value',` per line.
  - [ ] 4.2 Insert the mirrored block, same 23 keys in the same order, immediately before the `};` that closes `const fr` — the line directly above `export const catalogs`.
  - [ ] 4.3 Run `npx vitest run src/app/i18n` — green, in particular `message-namespace.test.ts`.

- [ ] 5. **The staged editor on the Tournament detail page.**
  - [ ] 5.1 In `src/app/features/archive/tournament-detail.component.test.ts`, **replace** the test named `the detail page offers no mutation` with `the detail page starts read-only for everyone` as specified in *Test plan*, and add a comment recording why: `// T14 asserted this page could not mutate at all. T17 gives it ADR 0037's staged editor, so the` / `// guarantee narrows from "no mutation exists" to "no mutation without an explicit Edit": every` / `// ngModel lives inside a canManage()/editing() guard, and editing() starts false.` Leave every other test in the file exactly as it is.
  - [ ] 5.2 Add the remaining 27 tests of *Test plan → tournament-detail.component.test.ts* to the same file. Run `npx vitest run src/app/features/archive/tournament-detail.component.test.ts` — red.
  - [ ] 5.3 In `src/app/features/archive/tournament-detail.component.ts`, extend the `@Component` `imports` array with `FormsModule`, `MatButtonModule`, `MatExpansionModule`, `MatFormFieldModule`, `MatInputModule`, `MatMenuModule`, `MatSelectModule` and `DeckArchetypeInputComponent`, keeping every import T14 put there. Add the corresponding module imports plus `HostListener`, `ViewChild`, `firstValueFrom`, `MatDialog`, `MatExpansionPanel`, `ConfirmDialogComponent`, `AuthService`, `PowerUserSettingsService`, `canUsePowerMutation`, `canManageArchiveRecord`, `archiveCommandError`, `isArchiveTournamentRowLocked`, `ArchiveRepository`, and the domain helpers `createRound`, `createMatchRoundEntry`, `createByeRoundEntry`, `importRoundEntries`, `mergeImportedRoundArchetypes`, `setTournamentPlayerArchetype`, `tournamentPlayerArchetypeRows`, `archetypeForPlayer`, `validateTournamentPlayerArchetypes`, `validateRoundEntry`, `getTournamentWarnings`, `toTournamentDocument`, `toArchiveTournamentDocument`, and from `../../domain/archive-staged-edit` the three functions plus `ARCHIVE_STANDALONE_SEASON_VALUE`.
  - [ ] 5.4 Add the state signals and `export interface ArchiveSeasonOption` from *Interface contract → Produces — additions to tournament-detail.component.ts*, and `@ViewChild('roundsPanel') private roundsPanel?: MatExpansionPanel;`.
  - [ ] 5.5 Add the four gate `computed`s verbatim (`lockBlocksEdit`, `canEdit`, `canManage`, `canToggleStatus`), plus
        ```ts
          readonly current = computed(() => this.draft() ?? this.tournament());
          readonly statusLabel = computed(() => this.i18n.t(this.current()?.status === 'completed' ? 'archive.tournamentCompleted' : 'archive.tournamentActive'));
          readonly toggleLabel = computed(() => this.i18n.t(this.current()?.status === 'completed' ? 'archive.reopen' : 'archive.markComplete'));
          readonly warnings = computed(() => { const t = this.current(); return t ? getTournamentWarnings(toTournamentDocument(t)) : []; });
          readonly warningMessages = computed(() => { const t = this.current(); return t ? this.warnings().map((warning) => tournamentWarningMessage(warning, toTournamentDocument(t), this.i18n)) : []; });
          readonly completionIssues = computed(() => { const t = this.current(); return t ? tournamentCompletionIssues(toTournamentDocument(t), this.i18n) : []; });
        ```
        and re-point T14's `result` computed at `this.current()` so the ranking reflects the draft while editing.
  - [ ] 5.6 Change T14's `locked` computed to the id-aware form so a browser-local record is exempt:
        `readonly locked = computed(() => { const t = this.tournament(); return t ? isArchiveTournamentRowLocked({ id: t.id, tournamentDate: t.tournamentDate }) : false; });`
  - [ ] 5.7 Extend `load()` with the Season options, after the existing document read, in its own `try`/`catch` so a failed catalog read never blanks the page:
        ```ts
        try {
          const catalog = await this.repo.listLeagueSeasons();
          const local = isLocalArchiveId(this.tournamentId());
          this.seasonOptions.set(catalog.items
            .filter((row) => row.isLocal === local)
            .map((row) => ({ id: row.id, name: row.name })));
        } catch (error) {
          // A move target list the user cannot see is a smaller failure than a page that will not
          // render. The Season selector simply offers standalone and the current Season.
          logBoundaryError('archive-tournament-detail.seasons', error, { tournamentId: this.tournamentId() });
          this.seasonOptions.set([]);
        }
        this.selectedSeasonId.set(this.tournament()?.seasonId ?? null);
        ```
  - [ ] 5.8 Add the draft lifecycle methods `startEdit`, `cancelEdit`, `markDirty`, `exitEdit`, `confirmDiscard`, ported from `tournament-archive-detail.component.ts:229-260,591-600` with `structuredClone(tournament)` producing an `ArchiveTournamentDocument` draft, and `selectedSeasonId` reset from the authoritative document.
  - [ ] 5.9 Add the draft mutators `addRound`, `addMatch`, `addBye`, `deleteRound`, `deleteEntry`, `replaceRound`, `hasValidRoundImport`, `setArchetype`, `syncPlayerArchetypesFromRoundEntries`, plus the private `updateDraft(updater)` and `updateRound(roundId, updater)` — ported from `tournament-archive-detail.component.ts:261-353,472-484` with two changes: they update `this.draft` directly instead of walking a League's `tournaments[]`, and the three archetype helpers are called as `setTournamentPlayerArchetype(toTournamentDocument(draft), …)` / `mergeImportedRoundArchetypes(toTournamentDocument(draft), …)` with only `playerArchetypes` and `entries` read back off the result.
  - [ ] 5.10 Add `moveTournamentToSeason(value: string)`:
        ```ts
        moveTournamentToSeason(value: string): void {
          if (!this.canManage() || this.saving()) return;
          const seasonId = value === ARCHIVE_STANDALONE_SEASON_VALUE ? null : value;
          // Same-authority only (ADR 0037). `seasonOptions()` is already filtered by authority, so
          // membership is the whole check — a cross-authority id can never be an option.
          if (seasonId !== null && !this.seasonOptions().some((option) => option.id === seasonId)) return;
          this.selectedSeasonId.set(seasonId);
          this.markDirty();
        }
        ```
        and `seasonOptionLabel(option: ArchiveSeasonOption): string { return option.name; }`.
  - [ ] 5.11 Add the expansion helpers `isRoundExpanded`, `setRoundExpanded`, the view-model helpers `roundViewModels`, `playerArchetypeRows`, `archetypeFor`, `entryInvalid`, `entryHasWarning`, `roundEntryInputLabel`, `roundEntryDeleteLabel`, and `get roundImportPlaceholder(): string`, ported from `tournament-archive-detail.component.ts:236-246,355-372,425-441` and retyped onto `ArchiveTournamentDocument`.
  - [ ] 5.12 Add `save()` implementing the twelve numbered steps of *Interface contract → `save()` control flow*, `reloadLatest()`, `toggleStatus()`, and the private `adopt`, `exitEdit`, `applyCommandError` verbatim.
  - [ ] 5.13 Add the two `@HostListener`s verbatim.
  - [ ] 5.14 Copy the three pure helpers `tournamentCompletionIssues`, `validationMessage` and `tournamentWarningMessage` from `tournament-archive-detail.component.ts:613-670` to module scope of the new file, unchanged except that `tournamentCompletionIssues` and `tournamentWarningMessage` keep taking the legacy `TournamentDocument` — every call site already converts with `toTournamentDocument`. Head the block with: `// Copied, not imported: the file these live in is deleted when the legacy archive surface is` / `// retired, so a reference into it would break at deletion time.`
  - [ ] 5.15 **Template — the action row.** Insert immediately after the top `<gones-back-button …position="top" />`:
        ```html
        <div class="section-header" data-cy="archive-tournament-edit-actions">
          @if (editing()) {
            <button mat-stroked-button type="button" class="secondary-action" data-cy="archive-tournament-cancel-edit" [disabled]="saving()" (click)="cancelEdit()">{{ i18n.t('archiveEdit.cancelEdit') }}</button>
            <button mat-flat-button type="button" class="create-action-button" data-cy="archive-tournament-save-changes" [disabled]="saving()" (click)="save()">{{ saving() ? i18n.t('common.saving') : i18n.t('archiveEdit.saveChanges') }}</button>
          } @else if (canEdit()) {
            <button mat-stroked-button type="button" class="secondary-action" data-cy="archive-tournament-edit" (click)="startEdit()">{{ i18n.t('archiveEdit.edit') }}</button>
          }
          @if (canToggleStatus()) {
            <button mat-stroked-button type="button" class="secondary-action" data-cy="archive-tournament-complete-toggle" [disabled]="saving()" (click)="toggleStatus()">{{ toggleLabel() }}</button>
          }
        </div>
        @if (error()) { <p class="error" role="alert" data-cy="archive-tournament-edit-error">{{ error() }}</p> }
        @if (lockBlocksEdit()) { <p class="muted" data-cy="archive-tournament-locked-notice">{{ i18n.t('archiveEdit.lockedNotice') }}</p> }
        ```
  - [ ] 5.16 **Template — the heading fields.** Inside T14's `.page-heading` block, wrap the existing static name/date/Season rendering so the editable form replaces it under `@if (editing())`, keeping T14's read-only markup verbatim in the `@else` branch:
        ```html
        @if (editing()) {
          <div class="tournament-heading-fields" data-cy="archive-tournament-edit-fields" (input)="markDirty()">
            <mat-form-field appearance="outline" class="title-field" data-cy="archive-tournament-edit-name-field"><mat-label data-cy="archive-tournament-edit-name-label">{{ i18n.t('tournament.name') }}</mat-label><input matInput data-cy="archive-tournament-edit-name-input" [(ngModel)]="draft()!.name" [readonly]="saving()"></mat-form-field>
            <mat-form-field appearance="outline" class="tournament-date-field" data-cy="archive-tournament-edit-date-field"><mat-label data-cy="archive-tournament-edit-date-label">{{ i18n.t('tournament.date') }}</mat-label><input matInput type="date" data-cy="archive-tournament-edit-date-input" [(ngModel)]="draft()!.tournamentDate" [readonly]="saving()"></mat-form-field>
            <mat-form-field appearance="outline" class="tournament-league-field" data-cy="archive-tournament-edit-season-field"><mat-label data-cy="archive-tournament-edit-season-label">{{ i18n.t('archiveEdit.season') }}</mat-label><mat-select data-cy="archive-tournament-edit-season-select" [ngModel]="selectedSeasonId() ?? standaloneValue" [disabled]="saving()" (ngModelChange)="moveTournamentToSeason($event)"><mat-option [value]="standaloneValue" data-cy="archive-tournament-edit-season-option-standalone">{{ i18n.t('archiveEdit.standaloneOption') }}</mat-option>@for (option of seasonOptions(); track option.id) { <mat-option [attr.data-cy]="'archive-tournament-edit-season-option-' + option.id" [value]="option.id">{{ seasonOptionLabel(option) }}</mat-option> }</mat-select></mat-form-field>
          </div>
        } @else { <!-- T14's existing name / date / updated / status / season markup, unchanged --> }
        ```
        and add `readonly standaloneValue = ARCHIVE_STANDALONE_SEASON_VALUE;` as a class field so the template never names a module constant.
  - [ ] 5.17 **Template — completion and warning blocks.** After the heading, add the `@if (result().provisional || result().incomplete)` warning block and the `@if (warnings().length)` block, ported from `tournament-archive-detail.component.ts:63-95` with every `data-cy` re-prefixed `archive-tournament-`.
  - [ ] 5.18 **Template — the import-conflict block.** Port `tournament-archive-detail.component.ts:87-95` with the same re-prefix, keeping the dismiss button bound to `importErrors.set([])`.
  - [ ] 5.19 **Template — the rounds editor.** Replace T14's read-only rounds section with the editable one ported from `tournament-archive-detail.component.ts:96-160`, re-prefixing every `data-cy` to `archive-tournament-round-*`, guarding every control with `@if (canManage())`, binding the entry inputs to the draft's entries with `[readonly]="!canManage()"`, and keeping `#roundsPanel` on the outer `mat-expansion-panel`. The section keeps `(input)="syncPlayerArchetypesFromRoundEntries()"`.
  - [ ] 5.20 **Template — the archetypes editor.** Port `tournament-archive-detail.component.ts:161-186` with the same re-prefix, rendering `<gones-deck-archetype-input>` under `@if (canManage())` and a plain `<span>` otherwise.
  - [ ] 5.21 **Template — the tail.** Keep T14's `archive-tournament-read-only` paragraph under `@if (!editing())`, keep T14's link to `['/archive/tournaments', id, 'result']`, and add after them:
        `@if (stale()) { <button type="button" class="secondary-action" data-cy="archive-tournament-reload" [disabled]="saving()" (click)="reloadLatest()">{{ i18n.t('archiveEdit.reloadLatest') }}</button> }`.
        Leave both `gones-back-button` elements exactly where T14 put them.
  - [ ] 5.22 Run `npx vitest run src/app/features/archive src/app/shared/data-cy-coverage.test.ts src/app/shared/back-button-coverage.test.ts` — green.

- [ ] 6. **The Cypress spec.**
  - [ ] 6.1 Rewrite `cypress/e2e/archive-staged-edit.cy.js` from scratch with the seven `it` blocks of *Test plan → archive-staged-edit.cy.js*. Reuse verbatim from the current file: `etag(version)` (`:11-15`), the `SEED_MARKER` / `seed(win)` / `visit(path)` trio (`:39-72`) with `seed` extended to take the power flag and to `deleteDatabase('gones-archive-local')` and `deleteDatabase('gones-archive-cache')` when asked, and `organizer()` (`:81-84`). Fixture:
        ```js
        const tournament = {
          id: 't1', name: 'Server Cup', seasonId: 's1', tournamentDate: '2026-08-13', status: 'active',
          playerArchetypes: [],
          rounds: [{ id: 'r1', entries: [{ kind: 'match', id: 'e1', table: '1', player1Name: 'Alice', player2Name: 'Bob', player1Score: 2, player2Score: 0, player1DeckArchetype: '', player2DeckArchetype: '' }] }],
          documentVersion: 4, updatedAt: '2026-08-13T10:00:00Z'
        };
        const seasons = { items: [{ id: 's1', name: 'Spring Season', leagueId: 'l1', status: 'active', updatedAt: '2026-08-13T10:00:00Z', documentVersion: 1, tournamentCount: 1, playerCount: 2, firstTournamentDate: '2026-08-13', lastTournamentDate: '2026-08-13' }], totalCount: 1, truncated: false };
        ```
        Intercepts: `GET /api/archive/tournaments/t1$` counting calls, `GET /api/archive/league-seasons/all$` → `seasons`, `GET /api/archive/years$` → `{ years: [{ year: 2026, locked: false, tournamentCount: 1 }] }`, `GET /api/archive/tournaments/all*` → `{ items: [], totalCount: 0, truncated: false }`, and `POST /api/archive/tournaments/t1/edit-batch$` counting calls and asserting `req.headers['if-match']`.
  - [ ] 6.2 Confirm with `grep -n "leagues-archive\|tournaments-archive" cypress/e2e/archive-staged-edit.cy.js` that the file names neither legacy route nor legacy API path — expect **no output**.
  - [ ] 6.3 With the app served at `http://127.0.0.1:4200`, run `npx cypress run --spec cypress/e2e/archive-staged-edit.cy.js` — 7 passing.

- [ ] 7. **The gate.**
  - [ ] 7.1 Run `npm run test` — green, with `src/app/data/archive-cache-invalidation.test.ts`, `src/app/i18n/message-namespace.test.ts`, `src/app/backend/server-authority-boundary.test.ts`, `src/app/shared/data-cy-coverage.test.ts` and `src/app/shared/back-button-coverage.test.ts` all passing.
  - [ ] 7.2 Run `npm run typecheck` — exit `0`.
  - [ ] 7.3 Run `npm run lint` — exit `0`.
  - [ ] 7.4 Run `npm run build` — exit `0`.
  - [ ] 7.5 Confirm no backend file and no generated client changed: `git status --porcelain backend src/app/api/generated backend/openapi` — expect **no output**.

## Outputs

**Files created:**

- `src/app/domain/archive-staged-edit.ts`
- `src/app/domain/archive-staged-edit.test.ts`
- `src/app/backend/server-archive-backend.service.ts`
- `src/app/backend/server-archive-backend.service.test.ts`
- `src/app/data/archive-repository.staged-edit.test.ts`

**Files edited:**

- `src/app/data/archive-repository.service.ts` — three injected fields, `ArchiveStagedSave`, `getTournament` (only if absent), `saveTournamentEdits`, `private tournamentPort`.
- `src/app/features/archive/tournament-detail.component.ts` — the staged editor.
- `src/app/features/archive/tournament-detail.component.test.ts` — one test replaced, 27 added.
- `src/app/i18n/messages.ts` — 23 keys in `en`, the same 23 in `fr`.
- `cypress/e2e/archive-staged-edit.cy.js` — rewritten.

**Public API / behaviour change:** `/archive/tournaments/:tournamentId` gains an explicit, power-gated, staged edit mode. It is the first and only mutation surface on `/archive/**`. Every other archive page stays read-only. The legacy `/leagues-archive/**` editor is untouched and keeps working; both surfaces are live at once, exactly as this plan's expand-then-contract strategy requires.

**Migrate / config:** none. No backend change, no migration, no new env var, no new config key, no OpenAPI change, and no regeneration of `src/app/api/generated/gones-api.ts`.

## Validation

- [ ] `npx vitest run src/app/domain/archive-staged-edit.test.ts` — 14 passed, 0 failed.
- [ ] `npx vitest run src/app/backend/server-archive-backend.service.test.ts` — 13 passed, 0 failed.
- [ ] `npx vitest run src/app/data` — all passed, including `archive-cache-invalidation.test.ts` (`every mutating method reaches the invalidation funnel` green with `saveTournamentEdits` present).
- [ ] `npx vitest run src/app/features/archive` — all passed, including T14's untouched tests.
- [ ] `npm run test` — exit `0`, `0 failed`.
- [ ] `npm run typecheck` — exit `0`.
- [ ] `npm run lint` — exit `0`.
- [ ] `npm run build` — exit `0`.
- [ ] `npx cypress run --spec cypress/e2e/archive-staged-edit.cy.js` — `7 passing`, `0 failing`.
- [ ] `grep -n "leagues-archive\|tournaments-archive" cypress/e2e/archive-staged-edit.cy.js` — no output.
- [ ] `git status --porcelain backend src/app/api/generated backend/openapi` — no output.
- [ ] Manual check: `npm run dev`, sign in as an Organizer, enable Power User in Settings, open an archived Tournament from `/archive/tournaments`. Confirm in order: the page is read-only and shows an **Edit** button; Edit reveals the name, date and Season fields; a browser reload discards the draft; Save opens one dialog naming the move and the deletion counts; confirming updates the page with no second network read (Network tab shows one `POST …/edit-batch` and no following `GET …/tournaments/{id}`); turning Power User off removes the Edit button.
- [ ] App functional — `/archive/league-seasons`, `/archive/tournaments`, `/archive/tournaments/:id/result` and the whole legacy `/leagues-archive/**` surface still render and still behave exactly as before this slice.
- [ ] commit msg draft: `feat(archive): stage, review and apply Tournament edits on the new archive surface`

## Notes for the reviewer — decisions taken here, and conflicts found

**Conflicts against the brief and against a sibling ticket (kept as found, reported, not silently improved):**

1. **T14's test `the detail page offers no mutation` is replaced.** It asserts the Tournament detail source contains none of `save(`, `delete(`, `rename(`, `edit-batch`, `startEdit`, `ngModel`. T14 wrote it before the arbitration created this ticket. The plan's binding frontend route list has **no** `/archive/tournaments/:id/edit` route, and ADR 0037 says the *page* toggles into edit mode, so the staged editor must live on this component — which makes T14's assertion unsatisfiable. The replacement narrows the guarantee to the one ADR 0037 actually makes: read-only by default, and no `ngModel` outside an explicit `canManage()` / `editing()` guard. No other T14 test is touched.
2. **The `409` wire code spelling is contradictory across the brief.** The arbitration in force mandates snake_case `archive_tournament_locked`; the backend ticket's own error table still writes camelCase `archiveTournamentLocked`. Rather than pick one and be wrong half the time, this ticket relies on `archiveCommandError`, which already accepts **both** spellings for `409` and keys on HTTP status first. The ticket is correct under either backend outcome, and the Cypress spec pins the snake_case spelling the arbitration mandates.
3. **`ArchiveRepository.getTournament` does not exist in the repository ticket's contract, but the detail-page ticket calls it.** Impl step 3.1 greps for it and step 3.6 adds it only when absent, so the ticket is correct whether or not the earlier worker already closed that gap.
4. **The backend ticket gives the new edit-batch route the operation name `ApplyArchiveTournamentEditBatch`, which the legacy route at `backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs:33` already uses.** Two endpoints cannot share a `WithName`, so that ticket must have renamed one of them to boot at all — and the generated client member name is therefore unpredictable. This ticket sidesteps the question entirely by calling the route through `HttpClient` + `joinApiUrl` + `API_ETAG`, the same idiom `src/app/features/events/public-event.service.ts` already uses. No generated symbol is referenced, so no rename can break this slice.

**Decisions taken here that the plan left open:**

- **The staged editor lives on `tournament-detail.component.ts`, not on a new route.** The plan's route list is binding and contains no edit route; ADR 0037 describes a page that starts read-only and toggles.
- **A blank name is refused, not silently defaulted.** The legacy editor substituted `getDefaultTournamentName()`. That helper lives in the half of `models.ts` the legacy retirement deletes, and silently renaming a user's Tournament to a date string is worse UX than saying so. New key `archiveEdit.nameRequired`.
- **The lock, not the status, gates editing.** The legacy editor required `league.status === 'active'`. The three-tier backend explicitly drops the status gate on content writes and makes the derived 365-day lock the only freeze, so `canEdit` gates on `lockBlocksEdit` and never on `status`.
- **`Admin` sees the Edit control on a locked row; nobody else does.** It mirrors the server's Admin lock bypass exactly, so the UI never offers a control the server would refuse and never hides one it would accept.
- **The Season dropdown offers every same-authority Season, plus standalone.** The legacy editor filtered to `status === 'active'` Leagues; the new backend never reads the owning Season's status on a Tournament write, so filtering by it would hide legal targets. `ARCHIVE_STANDALONE_SEASON_VALUE = '__standalone__'` is this ticket's own sentinel and never leaves the template.
- **`saveTournamentEdits` takes one `ArchiveStagedSave` object, not four positional arguments.** The legacy four-argument form existed to carry a second document's version for the move; a Tournament is now its own versioned row, so there is no second version and the named-field form documents what remains.
- **The server write adapter is a new file with a two-member port, not an implementation of the full `ArchiveBackendPort`.** This ticket ships one write flow; a class claiming fifteen members and implementing one would misrepresent what works.
- **`encodeArchiveETag` is duplicated rather than imported** from `aspnet-api-backend.service.ts`, matching the duplication this plan already sanctions for helpers that live in files scheduled for deletion.
- **The power gate is enforced twice:** in the component, which does not render a control the user may not use, and in the repository, which refuses the write regardless of what the UI did. ADR 0037 requires both — the first is UX, the second is the invariant.
- **The Cypress spec drives the server authority.** `/archive/**` has no create affordance at this point in the plan, and the browser-local rows do not yet appear in the archive tabs, so a UI-driven local edit has no reachable entry point. The browser-local path is covered by the repository unit test (`routes a local id to the browser store`) and by the component test that classifies `ArchiveConcurrencyError` identically to a `412`.
