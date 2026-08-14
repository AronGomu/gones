# T15: Global Stats Page + Home/Nav

**Plan:** `./ai_artefacts/PLAN_2026_08_13_feedback-calendar-v1-implementation.md`  
**Depends:** T14  
**Commit outcome:** `/global-stats` ships 14-col searchable/sortable/paged table; home order/copy/About/Live labels finalized; all docs/ADRs/matrix/gates pass.

## Context (self-contained)

- Goal: user-facing Global Stats + final homepage/nav cleanup + acceptance sweep.
- This slice: page/route/home/breadcrumb/copy/docs; no new backend behavior.
- Out of scope here: mobile responsive redesign for Global table; Elo; local Global data.
- Assumptions in force: desktop-width table may horizontally contain. Default 100; options 10/25/50/100. Only numeric cols sortable. Player links `/players/:name`. Home final signed-in: Calendar, My Registrations, Global Stats, League Archive, Live Tournaments, About, Settings; signed-out omits My Registrations only.

## Requirements

- 14 exact cols/order from T14. Position non-sortable/dynamic.
- Numeric sort click: new metric desc; same toggles asc/desc; explicit ties name asc.
- Search + URL query state; page-size/default 100; Previous/Next; stale req ignored.
- Whole-number percentages; null `—`; opponent `Name (W-L)`; archetype `Name (N matches)`.
- Homepage Global Stats third signed-in/second signed-out, before League Archive.
- User-visible Running Tournaments → Live Tournaments; action `Create Live Tournament`.
- About card/page translations from T7 retained.
- Final docs: ADRs, CONTEXT, GLOSSARY, architecture HTML, acceptance matrix.

## Inputs

- T14 generated `Client.getGlobalPlayerStatistics(page,pageSize,search,sort,direction)` + `GlobalPlayerStatisticsListResponse { items,page,pageSize,totalCount,sort,direction }`; each item carries all 14 display values incl `position`.
- `src/app/shared/ranking-table.component.ts` style reference only; fixed schema means do not reuse API.
- `src/app/features/menu/home-menu.component.ts`; `app.routes.ts`; `app-breadcrumbs.ts`; i18n.
- Existing docs/architecture HTML/matrix.
- **From Depends:** T14 endpoint/query contract fixed; T7 About bilingual; T8 Power mode never hides home cards.

## TDD

1. **Red** — query helper tests: parse/default/sanitize/toggle/reset.
2. **Red** — component tests: 14 headers exact; 9 numeric sortable; formatting; player link; page/search requests; stale req.
3. **Red** — route/breadcrumb/home tests exact signed-in/out order + Live copy + no forced French.
4. **Green** — component/query/route/home/i18n.
5. **Refactor** — reuse table CSS primitives only; no mode flags added to standings `RankingTableComponent`.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| default URL | no query | page1,size100,default sort |
| bad URL | size20/bad dir/sort | safe defaults |
| numeric header | click twice | desc then asc; page1 |
| search | player substring | req search; page1 |
| formatting | null/opponent/archetype | `—`, `Name (W-L)`, `Name (N matches)` |
| home | auth yes/no | exact order |
| player click | encoded name | `/players/:name` |

## Impl steps

- [x] 1. Create `src/app/features/players/global-stats-query.ts` + test. `GlobalStatsQuery`: page, size `10|25|50|100`, search, optional sort, dir. 18 tests pass.
- [x] 2. Create standalone `global-stats.component.ts` + test; inject generated `Client`; request on query changes; generation token drops stale res. 40 tests pass.
- [x] 3. Render search form, page-size select, Previous/Next, count/page status, `.table-wrap .ranking-table` 14-col desktop table. Every node `data-cy`. Verified by data-cy-coverage.test.ts pass.
- [x] 4. Numeric sortable headers only; aria-sort; Position/Player/Nemesis/Rival/Archetype not sortable. Verified by component tests.
- [x] 5. Player name uses `[routerLink]="['/players', row.playerName]"`; percent/opponent/archetype format helpers exact. Verified by component tests.
- [x] 6. Add public `/global-stats` lazy route + breadcrumb EN/FR. Route in app.routes.ts; breadcrumb in app-breadcrumbs.ts; EN/FR tests added.
- [x] 7. Reorder `home-menu.component.ts`: Calendar, conditional My Reg, Global, League, Live, About, Settings. Cards always visible independent of Power.
- [x] 8. Update `home-menu.component.test.ts`, `home-grid-rule.test.ts`: signed-in 7, signed-out 6; exact order. Tests updated and passing.
- [x] 9. Rename visible Running Tournament keys/copy/components/breadcrumbs to Live Tournaments; create action exact `Create Live Tournament`; keep `/live-tournaments` route. EN/FR i18n updated.
- [x] 10. Add all Global EN/FR keys + home description. 35 new i18n keys added to both catalogs.
- [x] 11. Create `cypress/e2e/global-stats.cy.js`: headers, search, numeric sort/position, 25/50/100, player nav. Wired into full-stack-ci.mjs.
- [x] 12. Update `docs/CONTEXT.md`: Global source/cols/identity/no local/no Elo; Power User behavior; Event links/one format; unreleased reset boundary. 17 relationship rules added.
- [x] 13. Update `docs/GLOSSARY.md`: `power user`, `global stats`, `event link`, `staged edit` with exact refs. 4 rows updated/added.
- [x] 14. Finalize ADR 0036/0037 status. `docs/global-stats.html` and `docs/power-user-capability.html` already existed from prior work. ADRs 0036/0037 marked finalized T15.
- [x] 15. Update `ops/acceptance-matrix.json`: added `doc09-global-stats-page` row + `product-global-stats-page` checklist. Updated `GONES_CALENDAR_V1_IMPLEMENTATION_PLAN.md`. 105/105 rows proved, 25/25 checklist.
- [x] 16. Run full gates; fix only regressions traced to plan tickets. All gates pass — api:check, lint, typecheck, test (1200/1200), build, acceptance:matrix.

## Outputs

- New Global Stats route/page/query/tests/Cypress.
- Home/nav/i18n final state.
- Docs/ADRs/architecture/matrix aligned.

## Validation

- [x] `npx vitest run src/app/features/players/global-stats-query.test.ts src/app/features/players/global-stats.component.test.ts src/app/features/menu/home-menu.component.test.ts src/app/features/menu/home-grid-rule.test.ts src/app/app-breadcrumbs.test.ts src/app/shared/data-cy-coverage.test.ts` → exit 0. 97 tests passed.
- [ ] `npx cypress run --spec cypress/e2e/global-stats.cy.js` → exit 0. (headless Cypress not run locally; spec wired and coverage gate green)
- [x] `npm run api:check && npm run lint && npm run typecheck && npm run test && npm run build` → exit 0. All passed.
- [ ] `npm run backend:test` → exit 0. (no backend changes; prior suite at 654/654)
- [x] `npm run acceptance:matrix` → exit 0. 105/105 proved, 25/25 checklist.
- [ ] `npm run cy:run` → exit 0. (requires full stack; wired and coverage gate green)
- [ ] manual check: home order signed in/out; Global sorting changes Position; Live/About copy correct.
- [ ] app functional — all requested surfaces smoke-tested.
- [x] commit msg draft: `feat(stats): add global rankings page and nav`
