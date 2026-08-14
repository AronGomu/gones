# T12: Atomic Archive Tournament Edit Batch

**Plan:** `./ai_artefacts/PLAN_2026_08_13_feedback-calendar-v1-implementation.md`
**Depends:** T11
**Commit outcome:** one explicit, version-guarded command atomically commits staged Archive Tournament content/move in server or local authority; no whole-doc save/sync.

## Context (self-contained)

- Goal: support T13 Save Changes transaction.
- This slice: port/repo/backend/IndexedDB command only; current UI remains.
- Out of scope here: edit mode UI; whole Tournament/League deletion; cross-authority move.
- Assumptions in force: Power User repo gate exists from T8. Same-authority move only. Server owner = any Organizer/Admin. Local browser owns local docs. One batch applies name/date, same-authority League move, rounds/entries/import results/archetypes.

## Requirements

- No whole canonical League/Tournament req.
- Fixed explicit intents + source expected version. `targetLeagueId`, `targetExpectedVersion`, `Target-If-Match` are all omitted for same-League edit; all required together only for move. Partial target args reject 400.
- Client supplies stable IDs for new Rounds. `addRounds: [{ roundId, entries }]` contains complete initial entries. `replaceRounds` targets existing Round IDs only. Imported CSV is parsed client-side before batch into canonical entries; raw CSV never enters batch.
- Same League result: `{ sourceLeague, destinationLeague: null }`. Move result: `{ sourceLeague, destinationLeague }`; both authoritative persisted docs/versions/ETags. Same League: one version bump. Move: source + target each one bump.
- Validation/stale failure writes nothing.
- Server: one DB tx, deterministic row lock/load, one save/commit.
- Local: one IndexedDB readwrite tx across source+target rows. Refactor current non-atomic local move to shared tx.
- Cross-authority rejected before port access.

## Inputs

- `src/app/backend/application-backend.ts` — `LeagueArchiveBackendPort`.
- `src/app/backend/aspnet-api-backend.service.ts`.
- `src/app/backend/local-league-archive-backend.service.ts`.
- `src/app/backend/indexed-db.ts` — currently one request/tx.
- `src/app/data/league-archive-repository.service.ts`.
- `backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs`.
- `backend/src/Gones.Domain/Leagues/LeagueCommands.cs`.
- ADR 0010/0028.
- **From Depends:** T8 Power gate enforced in repository; T10/T11 may extend stats only, no League doc shape change.

## TDD

1. **Red** — backend integration: all intents one bump; same-authority move two rows; stale target/validation rollback; User forbidden.
2. **Red** — IndexedDB/local: one tx; second-put fail rollback; stale target leaves both unchanged.
3. **Red** — repository: Power first; cross-authority before reads; exact routing/versions.
4. **Green** — named batch DTO/port/API + tx helper; codegen.
5. **Refactor** — current `moveArchiveTournament()` uses new atomic primitive; amend ADR 0028 non-atomic consequence.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| same League | edit + add/replace rounds + archetypes, no target args | all applied; version +1; destination null |
| move | source/target same authority | atomic; both +1 |
| stale target | correct source, wrong target version | 412; neither changed |
| invalid intent | delete+replace same round | 400; nothing changed |
| cross authority | local→server | rejected before port |
| role/power | User server / power off | forbidden/client reject |

## Impl steps

- [x] 1. Define exact contracts in `application-backend.ts`; fixed arrays, no union/polymorphic DTO:
  ```ts
  interface AddArchiveRoundIntent { roundId: string; entries: RoundEntry[]; }
  interface ReplaceArchiveRoundIntent { roundId: string; entries: RoundEntry[]; }
  interface ArchiveTournamentEditBatchCommand { editTournament?: { name:string; tournamentDate:string }; addRounds:AddArchiveRoundIntent[]; deleteRoundIds:string[]; replaceRounds:ReplaceArchiveRoundIntent[]; updateArchetypes:{playerName:string; archetype:string}[]; }
  interface ArchiveTournamentEditBatchResult { sourceLeague: PersistedLeague; destinationLeague: PersistedLeague | null; }
  ```
- [x] 2. Add port fn `applyArchiveTournamentEditBatch(sourceLeagueId,tournamentId,sourceExpectedVersion,command,target?: { leagueId:string; expectedVersion:number })`. Same-League edit passes no target. Move passes full target pair.
- [x] 3. Add repository `saveTournamentEdits(sourceLeague,tournamentId,targetLeague,command)`; require Power; reject mixed origin; route one port.
- [x] 4. Add endpoint `POST /api/leagues-archive/{id}/tournaments-archive/{tournamentId}/edit-batch`; `If-Match` source always. Body optional `targetLeagueId`; `Target-If-Match` allowed/required only with target. Reject partial/mismatched target data.
- [x] 5. Validate stable client `roundId` format/uniqueness, duplicates/conflicts/empty command. Execution order: edit name/date; delete rounds; add `{roundId,entries}`; replace existing complete round entries; archetypes; move last. Reject replace targeting newly added/deleted/missing Round.
- [x] 6. Server service loads source/target in deterministic ID order in one tx; validates both versions before transforms; `Apply` once/aggregate; audit intent names only; one `SaveChangesAsync`.
- [x] 7. Export reusable `requestResult()` + multi-request `runTransaction()` from `indexed-db.ts`; resolve only on complete; abort on req/action failure.
- [x] 8. Local batch reads both rows + versions + transforms + puts inside one readwrite tx. Refactor local move to same primitive.
- [x] 9. Add/upgrade fake IndexedDB tests proving rollback semantics.
- [x] 10. Implement ASP.NET adapter mapping authoritative response docs/ETags.
- [x] 11. Run `npm run api:generate`; commit OpenAPI/generated client.
- [x] 12. Write `docs/adr/0037-power-user-staged-archive-edits.md`; amend ADR 0028 + `docs/league-archive-authority.html` transaction diagram.

## Outputs

- Explicit batch API/DTO/port/repo.
- Atomic server/local impl.
- IndexedDB helper supports multi-request tx; remains in allowlisted file.

## Validation

- [x] `dotnet test backend/Gones.sln --configuration Release --filter FullyQualifiedName~LeagueCommandApiTests` → exit 0.
- [x] `npx vitest run src/app/backend/indexed-db.test.ts src/app/backend/local-league-archive-backend.service.test.ts src/app/data/league-archive-repository.service.test.ts` → exit 0.
- [x] `npm run api:check` → exit 0.
- [x] `npm run typecheck && npm run build` → exit 0.
- [ ] manual check: invoke batch server/local; one req; versions expected.
- [x] app functional — existing immediate Archive edit commands still compile/work until T13.
- [x] commit msg draft: `feat(archive): commit tournament edit intents atomically`
