# T11: Player Page Controls + Pagination

**Plan:** `./ai_artefacts/PLAN_2026_08_13_feedback-calendar-v1-implementation.md`
**Depends:** T10
**Commit outcome:** Player page defaults server-approved data, toggles merged local League data live, shows exact 2-row metrics, paginates Matches 10/20/50/100 default 50.

## Context (self-contained)

- Goal: requested Player Statistics UX.
- This slice: Player page only.
- Out of scope here: Global endpoint/page; Live store data; server-side player history paging.
- Assumptions in force: all Player stats come League Archive only. `Only use online data` checked default, persisted browser-wide. Online = server-origin League IDs, including approved cached server docs; local = `local-` League docs. Page index resets when data/filter/sort/size changes.

## Requirements

- Top row beside Back: checkbox at top-right.
- Stats row 1 exact: Matches Played, Match Wins, Match Losses, Match Draws, Games Played, Game Wins, Game Losses.
- Row 2: Match Win Rate, Game Win Rate, Nemesis, Rival, Most Played Archetype.
- Opponent display remains name on Player page unless existing interaction needs button; Global uses W-L later.
- Archetype display `Name (N matches)`.
- Match history: sort/filter first, then page; sizes 10/20/50/100; default/persisted 50. Page index not persisted.
- Toggle/page-size survive reload. Bad storage fails safe.

## Inputs

- `src/app/features/players/player-detail.component.ts`.
- `src/app/data/league-archive-repository.service.ts`; `league-archive-origin.ts`.
- `src/app/domain/player-stats.ts` expanded T10 API.
- **From Depends:** T10 leaves exact TS contracts:
  ```ts
  interface OpponentRecord { name:string; wins:number; losses:number; }
  interface PlayerArchetypeUsage { name:string; matchCount:number; }
  interface PlayerStatistics { matchLosses:number; matchDraws:number; playedGameCount:number; nemesis:OpponentRecord|null; rival:OpponentRecord|null; mostPlayedArchetype:PlayerArchetypeUsage|null; /* existing fields retained */ }
  ```
  Alpha ties; raw rates; exact case-sensitive names.

## TDD

1. **Red** — preference tests: defaults, supported restore, malformed fallback, storage errors.
2. **Red** — component tests: source filtering, exact card order, live recompute, page slicing/reset/clamp.
3. **Green** — pure preference helper + signals/computeds + template.
4. **Refactor** — pagination helper pure; no Material paginator dependency needed.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| initial | no prefs, 120 Matches | online checked, page 1, 50 rows |
| toggle off | server+local Leagues | stats/history include both |
| toggle on | same | local IDs excluded |
| size | 10/20/50/100 | exact slices; persisted |
| mutation | search/sort/toggle/size/data | page reset 1 |
| cards | known stats | exact 7 + 5 order/values |

## Impl steps

- [x] 1. Create `src/app/features/players/player-stats-preferences.ts` + test. Constants: `gones.playerStats.onlineOnly`, `gones.playerStats.matchPageSize`, sizes `[10,20,50,100]`, default 50.
- [x] 2. Create `player-detail.component.test.ts` with exact source/card/pagination assertions.
- [x] 3. In component, keep raw `leagues`; computed `selectedLeagues` filters `isLocalLeagueId()` when checked; feed stats/history.
- [x] 4. Add top control row around Back + `MatCheckboxModule`; persist toggle immediately; reset page.
- [x] 5. Replace stat grid with exact 2 rows/order; all nodes unique `data-cy`. Preserve Player Statistics existing 2-decimal percentage display from `docs/CONTEXT.md`; unavailable displays localized `N/A`. Whole-number + `—` formatting belongs Global Stats T15 only.
- [x] 6. Add match page signals/computeds: page, size, totalPages, `pagedMatches`; render paged list only.
- [x] 7. Add page-size select 10/20/50/100 + Previous/Next + `page/total`; disable bounds.
- [x] 8. Reset page on online toggle, search change/clear, chronological toggle, size change, new League data.
- [x] 9. Add EN/FR keys for all counts, toggle, archetype format, paging.
- [x] 10. Update `src/app/backend/server-authority-boundary.test.ts` localStorage allowlist with `player-stats-preferences.ts`, documenting two display prefs only; run boundary test.
- [x] 11. Update `docs/CONTEXT.md` Player page display + source semantics.

## Outputs

- Player preference helper/tests.
- Player detail component/tests/i18n changed.
- No API change; current merged repo read retained.

## Validation

- [x] `npx vitest run src/app/features/players/player-stats-preferences.test.ts src/app/features/players/player-detail.component.test.ts src/app/domain/player-stats.test.ts src/app/shared/data-cy-coverage.test.ts src/app/backend/server-authority-boundary.test.ts` → exit 0.
- [x] `npm run typecheck && npm run build` → exit 0.
- [ ] manual check: 120+ Match fixture pages; toggle updates metrics/history instantly; refresh keeps checkbox/size.
- [ ] app functional — Match card navigation/filter still works on paged slice.
- [x] commit msg draft: `feat(players): add source toggle metrics and match paging`
