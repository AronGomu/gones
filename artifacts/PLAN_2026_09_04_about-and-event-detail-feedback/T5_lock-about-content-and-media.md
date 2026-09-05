# T5: Lock About Content and Media

**Plan:** `./artifacts/PLAN_2026_09_04_about-and-event-detail-feedback.md`  
**Depends:** T4  
**Commit outcome:** About static sections use approved copy, fixed in-use media, cropped Fire/Ice photos, simplified headings, and no per-band Calendar buttons.

## Context (self-contained)

- C1. Goal: apply remaining approved About content/media/layout feedback without redesigning unrelated sections.
- C2. This slice: move 7 fixed imgs, update exact refs/dims/copy, remove named kickers/actions, tune Fire/Ice/media layout.
- C3. Out of scope here: staff/avatar img moves, French authoring, dynamic Upcoming logic, removing either temporary Next Up variant.
- C4. Assumptions in force: unchanged monthly/salty images stay in existing flat img dir; new/revised English copy is duplicated in French map until user supplies translations.

## Requirements

- R1. Create `src/assets/images/in-use/`; move exactly 7 approved files there with git-aware path changes.
- R2. Update every source/test ref to moved files; leave no stale old path.
- R3. Set weekly/association/leagues/Fire/Ice/hero/promo refs exactly per contract below.
- R4. Remove association, tournaments, staff kicker nodes + rows; preserve each heading/body.
- R5. Remove weekly/monthly/salty/leagues Calendar btns.
- R6. Remove `AboutTournamentBand.actionKey` + 4 now-unused action keys/values if no other refs.
- R7. Update weekly/monthly/salty metadata with exact supplied strings.
- R8. Fire & Ice title takes full available width; wraps only when needed.
- R9. Fire + Ice photos each fill equal side with crop; no distortion.
- R10. Update Fire & Ice and Leagues body exact strings.
- R11. Write every revised EN value identically into `en` + `fr` maps; do not translate.
- R12. Preserve all unchanged About section order, reveal behavior, semantics, and `data-cy` coverage.

## Inputs

- I1. `src/app/features/menu/about.component.ts` — band metadata, static sections, imgs.
- I2. `src/app/i18n/messages.ts` — About `en` + `fr` maps.
- I3. `src/styles.css` — shared content img, tournament band, Fire/Ice layout.
- I4. `src/app/features/menu/about.component.test.ts` — static content/asset/layout contracts.
- I5. `src/assets/images/` — current approved img files.
- I6. **From Depends:** T4 leaves dual Next Up variants and promo refs parameterized; update promo path after move without changing behavior.
- I7. **From Depends:** T3 leaves hero structure/full-bleed behavior; update hero path after move without changing geometry.

## Interface contract (level 5)

- P1. **Produces asset paths:**
  - P1.1. `assets/images/in-use/2025-01-ice-mtgones-10-years.jpeg` — hero, `2048x1152`.
  - P1.2. `assets/images/in-use/2017-gones-legacy-trollune.jpeg` — weekly, `2048x1536`.
  - P1.3. `assets/images/in-use/2025-07-last-trollune.jpeg` — association, `2048x1536`.
  - P1.4. `assets/images/in-use/2023-08-elm-qualifier-trollune.jpeg` — leagues, `2048x1152`.
  - P1.5. `assets/images/in-use/2024-07-cdf-legacy-vaugneray-original.jpeg` — Fire, `2048x1152`.
  - P1.6. `assets/images/in-use/2025-01-damnation-fest-pisa-mtgones-bougnat-01.jpeg` — Next Up promo, `2048x1366`.
  - P1.7. `assets/images/in-use/2026-01-ice-01.jpeg` — Ice, `2048x1536`.
- P2. **Metadata values:** weekly `field = '4 round swiss'`, `where = "Card'Era, Lyon"`; monthly `field = '5 round swiss + top 8'`, `when = 'First sunday of the month'`, `where = 'Arcaneum, Lyon'`; salty `field = '5-7 round swiss + top 8'`, `where = 'Lyon'`.
- P3. **Hero values:** title visual lines `Legacy is played` + `in Lyon`; lede paragraph 1 `MTGones brings Magic enthusiasts together around welcoming but challenging and memorable tournaments.`; paragraph 2 `Play at weekly Thursday meetups to major Fire & Ice weekends.`
- P4. **Fire/Ice body:** `One major each season: Fire in summer and Ice in winter. Play a full weekend of Magic tournaments and events in Eternal formats. Legacy is the main event, but you can also enjoy Pauper, Premodern, and even Vintage. We start Friday afternoon and finish Sunday!`
- P5. **Leagues body:** `Every weekly and monthly tournament earns you league points. At the end of the season, the 16 players with the most points qualify for the League Final to play for crazy prizes !`
- P6. **Consumes:** existing `MessageKey`-typed i18n API; same P2-P5 strings exist in both locale maps.
- P7. **Errors:** missing moved asset fails source-ref/asset test and manual image-load check; no fallback image.
- P8. **Invariants:** `object-fit: cover`; intrinsic `width`/`height` attrs match P1; no removed kicker/action leaves empty wrapper; no unrelated image moves.
- P9. **Integration links:** About component asset URL → Angular `src/assets` copy pipeline → browser `/assets/images/in-use/{filename}` → observe HTTP 200 + rendered non-zero dimensions.

## TDD

1. **Red** — update focused source/DOM tests to require exact copy/media/kicker/action/layout contract and fail against old content.
2. **Green** — move imgs, update refs/messages/template/CSS with min edits.
3. **Refactor** — remove only orphaned action metadata/message keys and empty wrappers; keep green.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| Asset inventory | 7 filenames | each exists only under `src/assets/images/in-use/` |
| Intrinsic dims | 7 moved imgs | dimensions equal P1 |
| Static refs | About source/render | exact weekly/association/leagues/Fire/Ice refs |
| Metadata | EN + FR locale | exact P2 values in both |
| Body copy | EN + FR locale | exact P3-P5 values in both |
| Removed kickers | About DOM | association/tournaments/staff markers absent |
| Removed actions | 4 bands | links/action metadata absent |
| Fire/Ice layout | wide + narrow | title uses width; each photo crops without distortion |
| Regression | About route | approved section order/reveal/data-cy coverage unchanged |

## Impl steps

- [ ] 1. Update tests red.
  - [ ] 1.1 Pin exact asset inventory/paths/dims.
  - [ ] 1.2 Pin exact locale strings.
  - [ ] 1.3 Pin removed kicker/action markers + Fire/Ice geometry.
- [ ] 2. Move approved imgs.
  - [ ] 2.1 Create `src/assets/images/in-use/`.
  - [ ] 2.2 Move only P1 files; preserve bytes.
  - [ ] 2.3 Update all source/test refs.
- [ ] 3. Update component data/template.
  - [ ] 3.1 Replace band/static image paths + intrinsic dims.
  - [ ] 3.2 Remove association/tournaments/staff kicker nodes.
  - [ ] 3.3 Remove 4 Calendar links, `actionKey`, empty wrappers.
- [ ] 4. Update copy in both locale maps.
  - [ ] 4.1 Apply P2 metadata.
  - [ ] 4.2 Apply P3 hero values.
  - [ ] 4.3 Apply P4-P5 body values.
  - [ ] 4.4 Remove only i18n keys orphaned by this work.
- [ ] 5. Update layout CSS.
  - [ ] 5.1 Remove Fire/Ice `18ch` title cap.
  - [ ] 5.2 Ensure equal photo columns + `object-fit:cover` at all supported widths.

## Validation

- [ ] V1. About tests pass: `npm test -- --run src/app/features/menu/about.component.test.ts`
- [ ] V2. `data-cy` coverage passes: `npm test -- --run src/app/shared/data-cy-coverage.test.ts`
- [ ] V3. asset path scan finds no stale refs: `! grep -R "assets/images/\(2025-01-ice-mtgones-10-years\|2017-gones-legacy-trollune\|2025-07-last-trollune\|2023-08-elm-qualifier-trollune\|2024-07-cdf-legacy-vaugneray-original\|2025-01-damnation-fest-pisa-mtgones-bougnat-01\|2026-01-ice-01\)" src --exclude-dir=in-use`
- [ ] V4. dimensions verified: `identify src/assets/images/in-use/{2025-01-ice-mtgones-10-years.jpeg,2017-gones-legacy-trollune.jpeg,2025-07-last-trollune.jpeg,2023-08-elm-qualifier-trollune.jpeg,2024-07-cdf-legacy-vaugneray-original.jpeg,2025-01-damnation-fest-pisa-mtgones-bougnat-01.jpeg,2026-01-ice-01.jpeg}`
- [ ] V5. typecheck + lint + build pass: `npm run typecheck && npm run lint && npm run build`
- [ ] V6. manual desktop/narrow check: every fixed img loads; Fire/Ice crops without stretch; copy/line wraps match contract
- [ ] V7. no silent-failure swallow on path this slice adds — `none`
- [ ] V8. app functional — About section nav/Next Up/remaining contact links work
- [ ] V9. commit msg draft: `feat(about): lock approved association story and media`
