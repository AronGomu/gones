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

- [ ] 1. Create `src/app/shared/search-highlight.ts`, moving the functions verbatim.
- [ ] 2. Create `src/app/shared/search-highlight.test.ts` with the four pure tests; run `npx vitest run src/app/shared/search-highlight.test.ts`.
- [ ] 3. Edit `player-detail.component.ts`: import from `../../shared/search-highlight`, delete the moved locals, keep `highlightParts()`.
- [ ] 4. Move `.match-highlight` into `src/styles.css`; delete the component-scoped rule.
- [ ] 5. Run `npx vitest run src/app/features/players` — unchanged, green.
- [ ] 6. In `public-calendar.component.ts` import `highlightSearchText` / `HighlightPart`, add `highlightParts()`.
- [ ] 7. Replace the four list-card text bindings and the month-cell title binding with the `@for` span pattern and slug-scoped `data-cy`.
- [ ] 8. Add the two component tests to `public-calendar.component.test.ts`.
- [ ] 9. Run `npx vitest run src/app`, `npm run lint`, `npm run typecheck`.
- [ ] 10. Run `npx vitest run src/app/shared/data-cy-coverage.test.ts`.

## Outputs

- Files touched: `src/app/shared/search-highlight.ts` (new), `src/app/shared/search-highlight.test.ts` (new), `src/app/features/players/player-detail.component.ts`, `src/app/features/calendar/public-calendar.component.ts`, `public-calendar.component.test.ts`, `src/styles.css`.
- Behaviour change: highlighted matches on the calendar page; `.match-highlight` becomes global.

## Validation

- [ ] `npx vitest run src/app` passes
- [ ] `npm run lint && npm run typecheck` pass
- [ ] manual check: search `lyon` on `/calendar`, highlight visible in list and calendar views
- [ ] app functional — player statistics highlighting unchanged
- [ ] commit msg draft: `feat(calendar): highlight search matches in both calendar views`
