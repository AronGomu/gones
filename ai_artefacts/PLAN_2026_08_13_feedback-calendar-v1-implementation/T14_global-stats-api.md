# T14: Global Stats API

**Plan:** `./ai_artefacts/PLAN_2026_08_13_feedback-calendar-v1-implementation.md`  
**Depends:** T13  
**Commit outcome:** public API returns searched/sorted/paged 14-col Global Stats from valid Matches in completed nondeleted server Leagues.

## Context (self-contained)

- Goal: server-authoritative global ranking data.
- This slice: API + generated client only; page T15.
- Out of scope here: local League data; Elo; normalized reporting tables; Player aliases; UI.
- Assumptions in force: materialize completed League JSON docs acceptable unreleased/local V1. Exact Player Names. Exclude bye-only. Default sort Match Wins desc → Game Wins desc → Match Draws desc → name asc. Explicit numeric sort toggles dir; tie name asc. Null rates last.

## Requirements

- Route: `GET /api/leagues-archive/global-player-statistics` before dynamic `{id}` ambiguity.
- Query: page≥1; pageSize exact 10/25/50/100 default100; search max200 case-insensitive substring; sort allowlist numeric; direction asc/desc.
- Exact response columns: Position, Player, Matches Played, Match W/L/D, Match Win Rate, Games Played, Game W/L, Game Win Rate, Nemesis, Rival, Most Played Archetype.
- Opponent record gives name+wins+losses; archetype name+matchCount.
- Position = search-result sorted index after search (`((page-1)*pageSize)+rowIndex+1`); changes with search + sort. Label/architecture call it result position, not immutable global rank.
- Completed, nondeleted server League aggregates only. Valid Matches only.
- Public cache ETag derived from all contributing aggregate IDs/versions + normalized query.

## Inputs

- `backend/src/Gones.Api/Leagues/PublicLeagueEndpoints.cs`.
- `backend/src/Gones.Domain/Leagues/LeagueRules.cs` T10 `CalculateGlobalPlayerStatistics()`.
- `backend/tests/Gones.IntegrationTests/PublicLeagueApiTests.cs`.
- API generator files.
- **From Depends:** T10 leaves C# `LeagueRules.CalculateGlobalPlayerStatistics(GonesData)` returning rows with exact fields `PlayerName`, `PlayedMatchCount`, `MatchWins`, `MatchLosses`, `MatchDraws`, `MatchWinrate`, `PlayedGameCount`, `GameWins`, `GameLosses`, `GameWinrate`, `OpponentRecord? Nemesis`, `OpponentRecord? Rival`, `PlayerArchetypeUsage? MostPlayedArchetype`. T13 Archive edits update aggregate versions; endpoint ETag must reflect them.

## TDD

1. **Red** — integration fixture: completed League, active League leading player, soft-deleted completed League, bye-only, case variants, draws/archetypes.
2. **Red** — default sort/positions; each numeric explicit sort asc/desc; alpha ties; search; paging; validation; cache 304.
3. **Green** — endpoint materializes domain rows, filters/searches/sorts/pages, maps DTO.
4. **Refactor** — query normalization/sort allowlist pure internal helpers; one ETag fn.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| authority | completed/active/deleted | completed nondeleted only |
| eligibility | bye-only/roster-only | absent |
| identity | Alice/alice | separate |
| default | rows tied | wins→games→draws→name |
| explicit | each numeric col | requested dir + name tie |
| paging | 101 rows default | 100 + 1; positions 1..101 |
| invalid | size 20/bad sort/long search | 400 |
| ETag | same query/version | 304 |

## Impl steps

- [x] 1. Add endpoint route + named DTOs in `PublicLeagueEndpoints.cs`; ensure static route mapped before `/{id}`. Validation: `dotnet build` → 0 errors.
- [x] 2. Define allowlist: `playedMatchCount`, `matchWins`, `matchLosses`, `matchDraws`, `matchWinrate`, `playedGameCount`, `gameWins`, `gameLosses`, `gameWinrate`. Present in `GlobalStatsSortAllowlist` HashSet.
- [x] 3. Query DB `DeletedAt == null && Status == "completed"`; deserialize docs; build `GonesData`; call T10 domain fn. Confirmed by EF query in test logs.
- [x] 4. Apply trimmed case-insensitive player-name search; exact identity remains unchanged. `Search_is_case_insensitive_substring` and `Identity_alice_and_Alice_are_separate_players` pass.
- [x] 5. Apply default chain or explicit metric + ordinal player name. Sort null rates last both dirs. `Default_sort_*`, `Explicit_sort_*` tests pass.
- [x] 6. Assign Position after search/sort before page slice; response includes page/pageSize/total/sort/direction. `Position_reflects_search_result_rank_not_global_rank` passes.
- [x] 7. Build ETag from sorted contributing aggregate ID/version + normalized query; `Cache-Control: public,max-age=60`; support `If-None-Match` 304. `ETag_*` tests pass.
- [x] 8. Add all integration tests in `PublicLeagueApiTests.cs`. 15 new tests in `PublicLeagueApiTests_GlobalPlayerStatistics` class, all pass.
- [x] 9. Run `npm run api:generate`; verify generated `getGlobalPlayerStatistics()` + DTO field names; never hand-edit client. Generated at line 864 with all 14 DTO fields.
- [x] 10. Add endpoint capability to `ops/acceptance-matrix.json` only if ticket remains compile-safe with test target; final matrix sweep T15. Added `doc09-global-player-stats-api` entry.

## Outputs

- Public Global Stats API + tests.
- Regenerated OpenAPI/Angular client.
- No DB schema change.

## Validation

- [x] `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~PublicLeagueApiTests|FullyQualifiedName~LeagueParityTests"` → exit 0. 17 tests pass (2 original PublicLeagueApiTests + 15 new GlobalPlayerStatistics tests).
- [x] `npm run api:check` → exit 0. Snapshot matches generated client.
- [x] `npm run typecheck && npm run build` → exit 0. Bundle generates at dist/gones.
- [ ] manual `curl 'http://127.0.0.1:5080/api/leagues-archive/global-player-statistics?page=1&pageSize=100'` → 200, exact fields. (requires running server; validated via integration tests)
- [x] app functional — existing League public endpoints unchanged. `Existing_league_public_endpoints_unchanged` test passes.
- [ ] commit msg draft: `feat(stats): expose completed-league global ranking`
