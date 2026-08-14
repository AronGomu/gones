# T10: Expanded Player Statistics Parity

**Plan:** `./ai_artefacts/PLAN_2026_08_13_feedback-calendar-v1-implementation.md`
**Depends:** T9
**Commit outcome:** TS/C# derive expanded Player/Global stats identically: W/L/D, game totals, opponent W-L, top archetype; no game draws.

## Context (self-contained)

- Goal: prepare Player page + Global Stats with one deterministic domain definition.
- This slice: pure domain + frozen parity only; UI/API later.
- Out of scope here: pagination, online toggle, endpoint, Elo, Player entity.
- Assumptions in force: exact trimmed case-sensitive Player Names. Valid head-to-head matches only. Byes remain `byeCount` on Player stats, excluded Global eligibility/performance. User accepted all future first recommendations: Nemesis/Rival/archetype ties alphabetical ascending; this explicit accepted plan decision supersedes older CONTEXT worst-rate/recency rules. Raw ratios stored.

## Requirements

- Extend `PlayerStatistics`: `matchLosses`, `matchDraws`, `playedGameCount`, `mostPlayedArchetype`; Nemesis/Rival details include selected-player `wins/losses`.
- Global rows exact 14-col data (Position assigned endpoint/UI later).
- `playedGameCount = gameWins + gameLosses`; individual game draws absent.
- Match winrate = wins / played matches; draws non-wins. Game winrate = wins / played games.
- Archetype count per match: selected side’s Match archetype; blank fallback Tournament roster; blank omitted. Tie alpha.
- Global source helper includes completed Leagues only; excludes bye/roster-only.

## Inputs

- `src/app/domain/player-stats.ts`; new focused test.
- `backend/src/Gones.Domain/Leagues/LeagueDocuments.cs`, `LeagueRules.cs`.
- `src/app/domain/league-parity-fixtures.test.ts`; `backend/tests/Gones.UnitTests/LeagueParityTests.cs`.
- `fixtures/league-domain/v1/parity.json`, `manifest.json`.
- `docs/CONTEXT.md` current metric/tie rules.
- **From Depends:** T9 changes Live gates only; League source shape unchanged.

## TDD

1. **Red** — TS tests: counts W/L/D/games; excludes byes; opponent records; archetype source/fallback/tie; exact name case; completed-only global; bye-only excluded.
2. **Red** — parity fixture adds expanded stats + global rows; C# frozen consumer fails.
3. **Green** — TS minimum; regenerate frozen fixture intentionally; C# exact mirror.
4. **Refactor** — share accumulator/tie helper per language; deterministic ordinal name sort. Update docs to new alphabetical tie contract.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| 2-1 win/0-2 loss/1-1 draw | player | played 3; W1 L1 D1; games 3-4 |
| bye | player | byeCount + history only |
| opponent | multiple | Nemesis max losses; Rival max meetings; W-L perspective |
| archetype | Match + roster fallback | count/match; alpha tie |
| names | `Alice`, `alice` | separate rows |
| League status | active/completed | Global completed only |

## Impl steps

- [x] 1. Define TS interfaces `OpponentRecord`, `PlayerArchetypeUsage`, `GlobalPlayerStatistics` in `player-stats.ts`.
- [x] 2. Create `src/app/domain/player-stats.test.ts` with exact cases/assertions.
- [x] 3. Extend accumulator: `matchLosses`, `matchDraws`, `playedGameCount`, opponent W/L maps, archetype counts.
- [x] 4. Change `nemesis`/`rival` from string to `OpponentRecord | null`; adapt existing tests now; UI adaptation waits T11 but app must compile: temporarily render `.name` in `player-detail.component.ts` with same visible behavior.
- [x] 5. Add `calculateGlobalPlayerStatistics(data)` filtering `league.status === 'completed'`, exact names, `playedMatchCount > 0`.
- [x] 6. Mirror records/calculation in `LeagueDocuments.cs` + `LeagueRules.cs`.
- [x] 7. Extend parity fixture generator + C# parity test with draws, tied opponents/archetypes, active League, bye-only, case variant.
- [x] 8. Run fixture update command; inspect diff; commit fixture/manifest.
- [x] 9. Update `docs/CONTEXT.md`: record user-confirmed future-recommendation override, new counts, alpha ties, archetype rule, Global eligibility; remove conflicting old Nemesis/Rival worst-rate/recency tie text.

## Outputs

- Pure TS/C# stats contracts/functions.
- Frozen cross-language parity proof.
- Player detail minimally compiles against richer opponent type; full layout T11.

## Validation

- [x] `UPDATE_LEAGUE_PARITY_FIXTURES=1 npx vitest run src/app/domain/league-parity-fixtures.test.ts` → exit 0; inspect generated diff.
- [x] `npx vitest run src/app/domain/player-stats.test.ts src/app/domain/league-parity-fixtures.test.ts src/app/domain/player-stats-names.test.ts` → exit 0.
- [x] `dotnet test backend/Gones.sln --configuration Release --filter FullyQualifiedName~LeagueParityTests` → exit 0.
- [x] `npm run typecheck && npm run build` → exit 0.
- [ ] manual check: existing player page still loads/display names.
- [x] app functional — League/Tournament result calculations unchanged.
- [x] commit msg draft: `feat(stats): derive expanded player metrics in parity`
