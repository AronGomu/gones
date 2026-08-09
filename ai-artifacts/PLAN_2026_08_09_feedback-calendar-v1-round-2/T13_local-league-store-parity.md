# T13: Local League store — full port parity

**Plan:** `./ai-artifacts/PLAN_2026_08_09_feedback-calendar-v1-round-2.md`
**Depends:** T12
**Commit outcome:** `LocalLeagueArchiveBackend` implements every one of the 22 `LeagueArchiveBackendPort` methods and declares `implements LeagueArchiveBackendPort` without `Partial`, so the browser-local store is a drop-in for the server adapter.

## Context (self-contained)

- Goal: land round-2 feedback on Gones (Angular 21 SPA; ASP.NET API + PostgreSQL is the data authority except for two sanctioned browser-local stores).
- This slice: the second quarter of feedback line 4 — a signed-out visitor must be able to do everything with a local league that an Organizer can do with a server league, and nothing may reach the backend.
- Out of scope here: the repository merge and the UI (T14), export/import (T15). **Do not touch `LeagueArchiveRepository`, any component, or `app.component.ts`.** After this commit the service is complete and still has no caller; that is the intended, compiling end state.
- Assumptions in force: **A2** total port parity; **A4** local ids are `local-<uuid>`; **A5** the store's return value is the truth the caller adopts.

### Read this first

`docs/adr/0028-dual-source-league-archive.md`. It is the specification, not a summary.

### What T12 left you — quote it, do not re-derive it

`src/app/data/league-archive-origin.ts` exports:

```ts
export const LOCAL_LEAGUE_ID_PREFIX = 'local-';
export const LOCAL_PLACEHOLDER_LEAGUE_ID = 'local-placeholder-league';
export function isLocalLeagueId(id: string | null | undefined): boolean;
export function newLocalLeagueId(uuid?: string): string;
export function isAnyPlaceholderLeagueId(id: string | null | undefined): boolean;
```

`src/app/backend/local-league-archive-backend.service.ts` exports:

```ts
export const LOCAL_LEAGUE_DB_NAME = 'gones-leagues';
export const LOCAL_LEAGUE_STORE = 'leagues';
export class LeagueConcurrencyError extends Error { readonly status = 412; /* message: 'staleLeagueDocument' */ }

@Injectable({ providedIn: 'root' })
export class LocalLeagueArchiveBackend implements Partial<LeagueArchiveBackendPort> {
  listLeagueArchives(): Promise<PersistedLeague[]>;
  getLeagueArchive(id: string): Promise<PersistedLeague | null>;
  createLeagueArchive(name: string, idempotencyKey?: string): Promise<PersistedLeague>;
  renameLeagueArchive(id: string, expectedVersion: number, name: string): Promise<PersistedLeague>;
  changeLeagueArchiveStatus(id: string, expectedVersion: number, status: LeagueStatus): Promise<PersistedLeague>;
  deleteLeagueArchive(id: string, expectedVersion: number): Promise<void>;
  restoreLeagueArchive(command: LeagueRestoreCommand, idempotencyKey?: string): Promise<PersistedLeague>;
  restoreFullLeagueArchiveData(command: FullLeagueRestoreCommand, idempotencyKey?: string): Promise<PersistedLeague[]>;

  private mutate(id: string, expectedVersion: number, change: (league: PersistedLeague) => LeagueDocument): Promise<PersistedLeague>;
  private open(): Promise<IDBDatabase>;
  private ensurePlaceholder(database: IDBDatabase): Promise<void>;
}
```

`mutate` loads the document, throws `LeagueConcurrencyError` if `documentVersion !== expectedVersion`, runs `change`, re-normalises through `normalizeLeague`, forces the original `id`, bumps `documentVersion` by 1, stamps `updatedAt`, writes and returns. **Every method below is a `mutate` call plus one pure transform.** If you find yourself reaching for IndexedDB directly, you are doing it wrong.

`src/app/backend/local-league-archive-backend.service.test.ts` already fakes IndexedDB (the setup was copied from `local-live-backend.service.test.ts`). Extend that file.

`src/app/backend/server-authority-boundary.test.ts` already allowlists this file for IndexedDB use. No change needed here.

### The 14 methods still missing

From `src/app/backend/application-backend.ts`:

```ts
createArchiveTournament(id: string, expectedVersion: number, name: string, tournamentDate: string): Promise<PersistedLeague>;
editArchiveTournament(id: string, tournamentId: string, expectedVersion: number, name: string, tournamentDate: string): Promise<PersistedLeague>;
deleteArchiveTournament(id: string, tournamentId: string, expectedVersion: number): Promise<PersistedLeague>;
moveArchiveTournament(id: string, tournamentId: string, expectedVersion: number, targetLeagueId: string, targetExpectedVersion: number): Promise<MoveResultTournamentResult>;
addArchiveRound(id: string, tournamentId: string, expectedVersion: number): Promise<PersistedLeague>;
deleteArchiveRound(id: string, tournamentId: string, roundId: string, expectedVersion: number): Promise<PersistedLeague>;
importArchiveRound(id: string, tournamentId: string, roundId: string, expectedVersion: number, text: string): Promise<PersistedLeague>;
replaceArchiveRound(id: string, tournamentId: string, roundId: string, expectedVersion: number, entries: RoundEntry[]): Promise<PersistedLeague>;
addArchiveEntry(id: string, tournamentId: string, roundId: string, expectedVersion: number, entry: RoundEntry): Promise<PersistedLeague>;
editArchiveEntry(id: string, tournamentId: string, roundId: string, entryId: string, expectedVersion: number, entry: RoundEntry): Promise<PersistedLeague>;
deleteArchiveEntry(id: string, tournamentId: string, roundId: string, entryId: string, expectedVersion: number): Promise<PersistedLeague>;
updateArchivePlayerArchetype(id: string, tournamentId: string, playerName: string, expectedVersion: number, archetype: string): Promise<PersistedLeague>;
renameLeagueArchivePlayerName(id: string, expectedVersion: number, fromName: string, toName: string): Promise<PersistedLeague>;
```

That is 13; the 14th is dropping `Partial<>` from the class declaration.

`MoveResultTournamentResult = { fromLeague: PersistedLeague; toLeague: PersistedLeague }`.

### The pure domain functions to compose — invent no rules

- `src/app/domain/models.ts`: `createTournament({ id, leagueId, name, tournamentDate, rounds, playerArchetypes }, { idFactory })`, `createRound({ id, entries }, { idFactory })`, `createRoundEntry(entry, { idFactory })`, `getDefaultTournamentName(date?)`, `normalizeLeague`, `defaultIdFactory`, `trimPlayerName`, `normalizeDeckArchetype`, `TournamentDocument`, `RoundDocument`, `RoundEntry`, `PlayerArchetypeDocument`.
- `src/app/domain/round-import.ts`: `importRoundEntries(...)` — the parser behind `importArchiveRound`. **Read its exported signature before calling it**; match the server adapter's usage.
- `src/app/domain/rename-player.ts`: `renamePlayerInLeague(...)` — the transform behind `renameLeagueArchivePlayerName`. It is already used by `src/app/domain/league-parity-fixtures.test.ts`, so its contract is pinned.
- `src/app/domain/validation.ts`: `validateRoundEntry(...)`.

`src/app/domain/league-parity-fixtures.test.ts` is the canonical parity harness: it drives `normalizeLeague`, `createTournament`, `importRoundEntries`, `renamePlayerInLeague`, `validateRoundEntry`, `calculateLeagueResult`, `calculatePlayerStatistics` and `getTournamentWarnings` over a fixture in `fixtures/league-domain/v1/parity.json` and hashes the result. Reuse those same domain calls so the local adapter cannot drift from the shared rules the server also honours.

- **From Depends (T12):** as quoted above.

## Requirements

- All 22 methods implemented; the class declares `implements LeagueArchiveBackendPort` with no `Partial`.
- Every mutating method routes through `mutate`, so the version guard and the `updatedAt` stamp have exactly one home.
- `moveArchiveTournament` is the one method that touches two documents. It must guard **both** versions before writing **either**, and must reject with `LeagueConcurrencyError` if either is stale, leaving both untouched.
- `moveArchiveTournament` refuses a cross-store move: if `targetLeagueId` is not a local id, reject with `new Error('crossAuthorityMoveNotSupported')`. Local and server leagues never exchange tournaments (ADR 0028).
- A tournament created with an empty `name` gets `getDefaultTournamentName()`; its `leagueId` is always set to the owning league's id.
- `importArchiveRound` replaces the named round's entries with the parse result and leaves every other round alone.
- `updateArchivePlayerArchetype` writes into `playerArchetypes` on the tournament, matching player names after `trimPlayerName`.
- `renameLeagueArchivePlayerName` renames across every tournament, round and entry of the league, exactly as `renamePlayerInLeague` defines it.
- Nothing in this file makes a network request.

## Inputs

- `docs/adr/0028-dual-source-league-archive.md`
- `src/app/backend/local-league-archive-backend.service.ts` (from T12) and its test file.
- `src/app/backend/aspnet-api-backend.service.ts` lines 55–105 — the server signatures to mirror exactly.
- `src/app/backend/application-backend.ts` — the port.
- `src/app/domain/models.ts`, `round-import.ts`, `rename-player.ts`, `validation.ts`.
- `src/app/domain/league-parity-fixtures.test.ts` and `fixtures/league-domain/v1/` — the parity harness.
- **From Depends:** see above.

## TDD

1. **Red** — add every case below to `local-league-archive-backend.service.test.ts` before writing a method. They fail because the methods do not exist.
2. **Green** — implement the 13 methods, then drop `Partial<>`.
3. **Refactor** — only if needed. Keep green.

## Test plan

Set up a shared fixture helper in the test file: `async function leagueWithRound()` creates a league, adds a tournament, adds a round, adds two match entries, and returns `{ backend, leagueId, tournamentId, roundId, version }`.

| Test | Input | Expect |
| --- | --- | --- |
| `creating a tournament appends it` | `createArchiveTournament(leagueId, 1, 'Weekly', '2026-08-15')` | `tournaments.length === 1`; the new tournament has `name === 'Weekly'`, `tournamentDate === '2026-08-15'`, `leagueId === leagueId`; league `documentVersion === 2` |
| `an unnamed tournament gets the default name` | `createArchiveTournament(leagueId, 1, '', '')` | `name === getDefaultTournamentName()` |
| `creating with a stale version is refused` | `createArchiveTournament(leagueId, 99, 'x', '')` | rejects with `status === 412`; the league still has 0 tournaments |
| `editing a tournament changes name and date` | `editArchiveTournament(leagueId, tournamentId, v, 'Renamed', '2026-09-01')` | both fields updated, rounds untouched, version bumped |
| `editing an unknown tournament is a no-op write` | `editArchiveTournament(leagueId, 'nope', v, 'x', '')` | resolves; the league's tournaments are unchanged apart from the version bump |
| `deleting a tournament removes it` | `deleteArchiveTournament(leagueId, tournamentId, v)` | that id is gone; every other tournament survives |
| `adding a round appends an empty round` | `addArchiveRound(leagueId, tournamentId, v)` | the tournament gains one round with `entries.length === 0` and a non-empty `id` |
| `deleting a round removes only that round` | two rounds, delete the first | one round left and it is the second |
| `replacing a round swaps its entries` | `replaceArchiveRound(leagueId, tournamentId, roundId, v, [entryA, entryB])` | that round has exactly those two entries; other rounds unchanged |
| `importing a round parses text into entries` | `importArchiveRound(leagueId, tournamentId, roundId, v, '<two-line fixture>')` | the round's entries equal what `importRoundEntries` returns for that text |
| `adding an entry appends to the round` | `addArchiveEntry(leagueId, tournamentId, roundId, v, entry)` | round entry count grows by one; the entry has an id |
| `editing an entry replaces it in place` | `editArchiveEntry(…, entryId, v, changed)` | the entry at that id reflects `changed`; order is preserved |
| `deleting an entry removes it` | `deleteArchiveEntry(…, entryId, v)` | that id is gone; siblings survive |
| `setting a player archetype records it` | `updateArchivePlayerArchetype(leagueId, tournamentId, 'Alice', v, 'Burn')` | `playerArchetypes` contains `{ playerName: 'Alice', archetype: 'Burn' }` |
| `setting an archetype twice overwrites` | call again with `'Storm'` | exactly one entry for `'Alice'`, archetype `'Storm'` |
| `renaming a player rewrites every entry` | `renameLeagueArchivePlayerName(leagueId, v, 'Alice', 'Alicia')` | no entry anywhere in the league still names `'Alice'`; every one that did now names `'Alicia'`; the result equals `renamePlayerInLeague` applied to the same input |
| `moving a tournament transfers it` | two local leagues, `moveArchiveTournament(fromId, tournamentId, fromV, toId, toV)` | `fromLeague` no longer holds it; `toLeague` does, with `leagueId === toId`; both versions bumped |
| `moving refuses a stale source` | wrong `expectedVersion` | rejects with `status === 412`; **both** leagues unchanged, including the target |
| `moving refuses a stale target` | wrong `targetExpectedVersion` | rejects with `status === 412`; **both** leagues unchanged, including the source |
| `moving to a server league is refused` | `targetLeagueId: 'placeholder-league'` | rejects with message `crossAuthorityMoveNotSupported`; both stores untouched |
| `moving into the local placeholder is allowed` | `targetLeagueId: LOCAL_PLACEHOLDER_LEAGUE_ID` | succeeds; the placeholder holds the tournament |
| `every write bumps exactly one version` | run each of the 13 methods once from a known version | the resulting `documentVersion` is exactly the input `expectedVersion + 1` (2 for the move, one per league) |
| `every method rejects a stale version` | each mutating method with `expectedVersion + 50` | rejects with `status === 412` and leaves the stored document byte-identical |
| `the adapter satisfies the whole port` | TypeScript | the class declares `implements LeagueArchiveBackendPort` and `npm run typecheck` passes — this is the parity assertion that cannot be faked |
| `the adapter never talks to the network` | service source text | contains no `fetch`, no `HttpClient`, no `firstValueFrom`, no `/api/` |

## Impl steps

- [ ] 1. Add the whole Test plan to `src/app/backend/local-league-archive-backend.service.test.ts`, including the `leagueWithRound()` helper. Run `npx vitest run src/app/backend/local-league-archive-backend.service.test.ts` — the new cases must fail.
- [ ] 2. Add a private tournament-level helper so the twelve tournament/round/entry methods stay one-liners:
      ```ts
      private mutateTournament(id: string, tournamentId: string, expectedVersion: number, change: (tournament: TournamentDocument) => TournamentDocument): Promise<PersistedLeague> {
        return this.mutate(id, expectedVersion, (league) => ({
          ...league,
          tournaments: league.tournaments.map((tournament) => tournament.id === tournamentId ? change(tournament) : tournament)
        }));
      }
      ```
      and a round-level one on top of it:
      ```ts
      private mutateRound(id: string, tournamentId: string, roundId: string, expectedVersion: number, change: (round: RoundDocument) => RoundDocument): Promise<PersistedLeague> {
        return this.mutateTournament(id, tournamentId, expectedVersion, (tournament) => ({
          ...tournament,
          rounds: tournament.rounds.map((round) => round.id === roundId ? change(round) : round)
        }));
      }
      ```
- [ ] 3. `createArchiveTournament(id, expectedVersion, name, tournamentDate)` → `this.mutate(id, expectedVersion, (league) => ({ ...league, tournaments: [...league.tournaments, createTournament({ leagueId: league.id, name, tournamentDate })] }))`.
- [ ] 4. `editArchiveTournament` → `mutateTournament(..., (tournament) => createTournament({ ...tournament, name, tournamentDate }))`.
- [ ] 5. `deleteArchiveTournament` → `this.mutate(id, expectedVersion, (league) => ({ ...league, tournaments: league.tournaments.filter((tournament) => tournament.id !== tournamentId) }))`.
- [ ] 6. `addArchiveRound` → `mutateTournament(..., (tournament) => ({ ...tournament, rounds: [...tournament.rounds, createRound({})] }))`.
- [ ] 7. `deleteArchiveRound` → `mutateTournament(..., (tournament) => ({ ...tournament, rounds: tournament.rounds.filter((round) => round.id !== roundId) }))`.
- [ ] 8. `replaceArchiveRound` → `mutateRound(..., (round) => createRound({ id: round.id, entries }))`.
- [ ] 9. `importArchiveRound` → `mutateRound(..., (round) => createRound({ id: round.id, entries: importRoundEntries(text) }))`. **First read `src/app/domain/round-import.ts` and match its real exported signature**; if it takes options or returns a wrapper, adapt the call and say so in a comment.
- [ ] 10. `addArchiveEntry` → `mutateRound(..., (round) => createRound({ id: round.id, entries: [...round.entries, entry] }))`.
- [ ] 11. `editArchiveEntry` → `mutateRound(..., (round) => createRound({ id: round.id, entries: round.entries.map((item) => item.id === entryId ? { ...entry, id: entryId } : item) }))`.
- [ ] 12. `deleteArchiveEntry` → `mutateRound(..., (round) => createRound({ id: round.id, entries: round.entries.filter((item) => item.id !== entryId) }))`.
- [ ] 13. `updateArchivePlayerArchetype` → `mutateTournament(..., (tournament) => ({ ...tournament, playerArchetypes: upsertArchetype(tournament.playerArchetypes, playerName, archetype) }))` with a module-private `upsertArchetype` that compares names through `trimPlayerName` and normalises the value through `normalizeDeckArchetype`.
- [ ] 14. `renameLeagueArchivePlayerName(id, expectedVersion, fromName, toName)` → `this.mutate(id, expectedVersion, (league) => renamePlayerInLeague(league, fromName, toName))`. Read `src/app/domain/rename-player.ts` for the real signature and adapt if it returns a wrapper rather than a `LeagueDocument`.
- [ ] 15. `moveArchiveTournament(id, tournamentId, expectedVersion, targetLeagueId, targetExpectedVersion)` — this one cannot use `mutate` because it spans two documents. Write it explicitly:
      a. `if (!isLocalLeagueId(targetLeagueId)) throw new Error('crossAuthorityMoveNotSupported');`
      b. open the database once; load both documents through the existing `require` helper.
      c. throw `new LeagueConcurrencyError()` if `from.documentVersion !== expectedVersion` **or** `to.documentVersion !== targetExpectedVersion` — before any write.
      d. find the tournament on `from`; if absent, throw `new Error('tournamentNotFound')`.
      e. build both next documents (`from` without it, `to` with `createTournament({ ...moved, leagueId: targetLeagueId })` appended), each with `documentVersion + 1` and a fresh `updatedAt`.
      f. `put` both, then return `{ fromLeague, toLeague }`.
      Note in a comment that IndexedDB cannot span the two writes in one transaction through the `indexed-db.ts` wrapper (it runs one request per transaction), so a crash between the two writes can leave the tournament in both leagues; the local store accepts that, and the boundary is documented in ADR 0028.
- [ ] 16. Change the class declaration to `export class LocalLeagueArchiveBackend implements LeagueArchiveBackendPort`.
- [ ] 17. Run `npm run typecheck`. Every unimplemented or mis-typed method surfaces here. Fix until clean.
- [ ] 18. Run `npx vitest run src/app/backend src/app/domain` — green.

## Outputs

- Changed: `src/app/backend/local-league-archive-backend.service.ts` (+13 methods, `Partial<>` dropped), `src/app/backend/local-league-archive-backend.service.test.ts`.
- Public API for T14 to consume verbatim: `LocalLeagueArchiveBackend implements LeagueArchiveBackendPort` — every method of the port, same signatures as `AspNetApiBackend`. Stale writes reject with `LeagueConcurrencyError` (`status === 412`, message `staleLeagueDocument`), which `leagueCommandError` already classifies as `'stale'`. A cross-store move rejects with `Error('crossAuthorityMoveNotSupported')`.
- Behaviour: still none user-visible; nothing injects the service yet.

## Validation

- [ ] `npm run test` passes
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes — this is the parity gate; `implements LeagueArchiveBackendPort` compiling is the proof
- [ ] `npm run build` passes
- [ ] `npx vitest run src/app/backend/server-authority-boundary.test.ts` still passes
- [ ] `npx vitest run src/app/domain/league-parity-fixtures.test.ts` still passes — the shared domain rules were not altered
- [ ] Manual: `npm run dev` and browse — nothing changed; still no `gones-leagues` database, because nothing injects the service.
- [ ] app functional — no broken path from this slice
- [ ] commit msg draft: `feat(leagues): complete the browser-local league store to full port parity`
