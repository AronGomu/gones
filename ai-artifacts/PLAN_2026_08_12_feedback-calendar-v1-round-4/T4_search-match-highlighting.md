# T4: Search match highlighting

**Plan:** `./ai-artifacts/PLAN_2026_08_12_feedback-calendar-v1-round-4.md`
**Depends:** T3
**Commit outcome:** typing in the calendar search box highlights the literal matching substrings inside list cards and day-cell event titles, with the same visual treatment as the player statistics page.

## Context (self-contained)

- Goal: ship round 4 of `feedback.md` — calendar/detail polish, an admin organization workbench, a guard fix, generated demo docs, and a Tournament → Event rename.
- This slice: feedback item 4. The player page already highlights search matches; the calendar page filters without highlighting.
- Out of scope here: changing the fuzzy matching itself, highlighting on the detail page or admin screens.
- Assumptions in force: calendar filtering is fuzzy (Fuse, threshold 0.35) while highlighting is literal substring matching — a card matched only fuzzily shows no highlight, and that is accepted.

## Requirements

- Create `src/app/shared/search-highlight.ts` exporting `HighlightPart` (`{ text: string; highlighted: boolean }`), `highlightSearchText(text, query)`, `searchWords(query)`, `normalizeSearchText(value)`, `normalizeSearchTextWithIndex(value)`. Move the implementations verbatim from `src/app/features/players/player-detail.component.ts` (local `HighlightPart` at line 14; `highlightSearchText` line 431; `searchWords` 465; `parseSearchTerms` 469; `quoteSearchTerm` 502; `normalizeSearchText` 506; `normalizeSearchTextWithIndex` 510). `parseSearchTerms` and `quoteSearchTerm` stay module-private in the new file.
- `player-detail.component.ts` imports from the new module; `highlightParts()` keeps delegating; no behaviour change on that page.
- `PublicCalendarComponent` gains `highlightParts(text: string): HighlightPart[] { return highlightSearchText(text, this.searchDraft()); }`.
- Highlighted fields — list card: title, date line, venue line, summary. Calendar view: the day-cell event title.
- Each highlighted field renders `@for (part of highlightParts(value); track $index) { <span [class.match-highlight]="part.highlighted" [attr.data-cy]="'calendar-card-title-part-' + item.slug + '-' + $index">{{ part.text }}</span> }` — `data-cy` unique per element (`src/AGENT.md`), so always scope it with the slug.
- Move `.match-highlight` from the `player-detail.component.ts` styles array into `src/styles.css` as a global rule: `.match-highlight { border-radius: .18rem; background: oklch(86% 0.16 82 / .3); color: oklch(92% 0.16 82); box-shadow: 0 0 0 2px oklch(86% 0.16 82 / .16); }` and delete the component copy.

## Inputs

- `src/app/features/players/player-detail.component.ts` — functions listed above, `.match-highlight` CSS around line 304.
- `src/app/features/calendar/public-calendar.component.ts` — `readonly searchDraft = signal<string>(…)`, `#tournamentCard` template, month-grid template with `calendar-month-day-event-title`.
- `src/app/features/calendar/tournament-fuzzy-search.ts` — `filterTournaments`, `splitSearchTerms`, `normalizeSearchValue`. Do not modify.
- **From Depends:** T3 made the list card clickable, deleted `calendar-card-view`, and renders the date via `cardDate(item)`; preserve those when adding highlight spans.

## TDD

1. **Red** — `src/app/shared/search-highlight.test.ts` plus two component tests.
2. **Green** — extract module, wire both views.
3. **Refactor** — delete the now-dead private helpers from `player-detail.component.ts`.

## Test plan

| Test | Input | Expect |
| ---- | ---- | ------ |
| `highlightSearchText returns one unhighlighted part for an empty query` | `('Gones Lyon', '')` | `[{ text: 'Gones Lyon', highlighted: false }]` |
| `highlightSearchText marks a case-insensitive match` | `('Gones Lyon', 'lyon')` | joined text equals input, exactly one part `highlighted: true` with text `'Lyon'` |
| `highlightSearchText ignores diacritics` | `('Ligue AURA à Lyon', 'a lyon')` | at least one highlighted part, joined text equals input |
| `highlightSearchText merges overlapping ranges` | `('aaaa', 'aa')` | joined text equals `'aaaa'` |
| component `list card title highlights the query` | search `lyon`, list view | some `[data-cy^=calendar-card-title-part-]` carries class `match-highlight` |
| component `month cell title highlights the query` | search `lyon`, calendar view | some `[data-cy^=calendar-month-day-event-title-part-]` carries class `match-highlight` |

## Impl steps

- [x] 1. Create `src/app/shared/search-highlight.ts`, moving the functions verbatim. — file exists; python diff of each moved function vs `player-detail.component.ts` printed `IDENTICAL` for all five.
- [x] 2. Create `src/app/shared/search-highlight.test.ts` with the four pure tests; run `npx vitest run src/app/shared/search-highlight.test.ts`. — `Test Files 1 passed (1) / Tests 5 passed (5)` (four ticket cases + the markup-shaped-query literal-text case).
- [x] 3. Edit `player-detail.component.ts`: import from `../../shared/search-highlight`, delete the moved locals, keep `highlightParts()`. — line 13 imports `HighlightPart, highlightSearchText, normalizeSearchText, searchWords`; the five moved locals are gone (`git diff --stat`: -93 lines); `highlightParts()` and `quoteSearchTerm` stay.
- [x] 4. Move `.match-highlight` into `src/styles.css`; delete the component-scoped rule. — global rule at `src/styles.css:669`; `player-detail.component.ts` no longer contains `.match-highlight {` (asserted by the new `is the shared global rule, not a component-scoped copy` test).
- [x] 5. Run `npx vitest run src/app/features/players` — unchanged, green. — that path holds no spec file (`No test files found`); the page is instead proved unchanged by the verbatim-move diff, `npm run typecheck`, and `npx vitest run src/app` (98 files / 801 tests passed).
- [x] 6. In `public-calendar.component.ts` import `highlightSearchText` / `HighlightPart`, add `highlightParts()`. — import added next to `filterTournaments`; `highlightParts(text)` delegates to `highlightSearchText(text, this.searchDraft())`.
- [x] 7. Replace the four list-card text bindings and the month-cell title binding with the `@for` span pattern and slug-scoped `data-cy`. — title/date/venue/summary + month-cell title now emit `calendar-card-{title,date,venue,summary}-part-<slug>-<i>` and `calendar-month-day-event-title-part-<slug>-<i>`.
- [x] 8. Add the two component tests to `public-calendar.component.test.ts`. — new `search match highlighting` describe (5 tests); suite `Tests 74 passed (74)`.
- [x] 9. Run `npx vitest run src/app`, `npm run lint`, `npm run typecheck`. — `Test Files 98 passed (98) / Tests 801 passed (801)`; `All files pass linting.`; `tsc --noEmit` clean for app + spec projects.
- [x] 10. Run `npx vitest run src/app/shared/data-cy-coverage.test.ts`. — `Test Files 1 passed (1) / Tests 8 passed (8)`.

## Outputs

- Files touched: `src/app/shared/search-highlight.ts` (new), `src/app/shared/search-highlight.test.ts` (new), `src/app/features/players/player-detail.component.ts`, `src/app/features/calendar/public-calendar.component.ts`, `public-calendar.component.test.ts`, `src/styles.css`.
- Behaviour change: highlighted matches on the calendar page; `.match-highlight` becomes global.

## Validation

- [x] `npx vitest run src/app` passes — `Test Files 98 passed (98) / Tests 801 passed (801)`.
- [x] `npm run lint && npm run typecheck` pass — `All files pass linting.`; `tsc --noEmit` clean on `tsconfig.app.json` + `tsconfig.spec.json`.
- [x] manual check: search `lyon` on `/calendar`, highlight visible in list and calendar views — done in a real browser instead of by hand: `public-calendar.cy.js` asserts `[data-cy^=calendar-month-day-event-title-part-lyon-legacy-].match-highlight` in the month grid and `[data-cy^=calendar-card-title-part-lyon-legacy-].match-highlight` plus the venue part in the list.
- [x] app functional — player statistics highlighting unchanged — the five functions moved byte-identical (scripted diff: `IDENTICAL` × 5), the page template is untouched, `.match-highlight` is byte-identical in `styles.css`, and lint/typecheck/`npm run test` are green. No e2e spec exists for that page, so the visual is left as a human step in `manual_test_checklist.md`.
- [x] `npm run test` passes (repo-wide gate, incl. `ops/e2e-spec-coverage.test.ts` and the acceptance matrix) — `Test Files 106 passed (106) / Tests 969 passed (969)`.
- [x] `npx cypress run --spec cypress/e2e/accessibility.cy.js` stays 11 passing / 0 failing — `Tests: 11 / Passing: 11 / Failing: 0`.
- [x] `npx cypress run --spec cypress/e2e/public-calendar.cy.js` green, including the browser proof that a markup-shaped query renders as literal text — `10 passing`; the new case renders a tournament titled `Lyon <img src=x onerror=alert(1)> Legacy`, types the same markup as the query, and asserts `have.text` equals the literal title with no `img` element anywhere under `[data-cy="public-calendar"]`.
- [x] highlight foreground/background pair measured at WCAG AA (≥ 4.5:1) — `oklch(92% 0.16 82)` on `oklch(86% 0.16 82 / .3)` composited over `--iron` = **6.76:1**, over `--black-metal` = **7.55:1** (OKLab → sRGB → WCAG relative-luminance calculation).
- [x] commit msg draft: `feat(calendar): highlight search matches in both calendar views`
