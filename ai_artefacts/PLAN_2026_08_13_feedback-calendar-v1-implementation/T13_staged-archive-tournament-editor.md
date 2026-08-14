# T13: Explicit Staged Archive Tournament Editor

**Plan:** `./ai_artefacts/PLAN_2026_08_13_feedback-calendar-v1-implementation.md`
**Depends:** T12
**Commit outcome:** Archive Tournament detail starts read-only; authorized Power User clicks Edit, stages changes in memory, confirms one Save Changes batch; stale draft preserved.

## Context (self-contained)

- Goal: explicit edit mode for creator/Organizer/Admin semantics.
- This slice: Archive Tournament page + pure draft diff.
- Out of scope here: whole Tournament/League deletion inside batch; cross-authority moves; auto-merge stale draft.
- Assumptions in force: local browser = local creator. Any Organizer/Admin = server editor. Power disabled = read-only. Completed League current domain edit restriction remains; reopen League first. Delete whole docs stays separate.

## Requirements

- Top row: Back to League left; Edit right. Edit state: Cancel Edit + Save Changes.
- Default read-only even authorized.
- Stage name/date/same-authority League move/rounds/entries/imports/archetypes. Zero repo calls until save.
- Round/entry deletions no immediate prompt; final confirmation summarizes deleted rounds/entries. Cancel restores source.
- Save empty diff exits edit, no req. Confirmed save calls T12 once. Same-League response has `destinationLeague:null`; adopt `sourceLeague`. Move response adopts `destinationLeague!` for page route + refreshed source for caches.
- 412 preserves draft; show conflict + Reload Latest; discard only after confirmation. No auto merge/retry.
- Whole Tournament/League deletion remains separate header action + own confirmation.
- Player Archetype expansion chevron gets same padding/inset as Round header.

## Inputs

- `src/app/features/tournaments-archive/tournament-archive-detail.component.ts` — currently calls `startEdit()` during load + immediate commands.
- `src/app/app.component.ts` — whole-delete header.
- `src/app/domain/models.ts`, round/archetype/import helpers.
- T12 repository batch API.
- **From Depends:** T12 leaves exact API:
  ```ts
  saveTournamentEdits(sourceLeague:PersistedLeague,tournamentId:string,command:ArchiveTournamentEditBatchCommand,target?:PersistedLeague): Promise<{sourceLeague:PersistedLeague; destinationLeague:PersistedLeague|null}>;
  ```
  `addRounds` carry `{roundId,entries}`; same-League omits target; move target same authority only. T8 Power service API as quoted in T9. T10 stats doesn't affect editor.

## TDD

1. **Red** — pure diff tests: unchanged, name/date, add/delete/replace rounds, entries, archetypes, deletion summary, same-origin targets.
2. **Red** — component tests: default read-only all roles; permission matrix; no repo calls while drafting; one save; cancel; move nav; stale preserve/discard.
3. **Red** — CSS test equal chevron inset/no negative offset.
4. **Green** — pure draft diff + component state/actions.
5. **Refactor** — delete title-only edit/debounce/immediate persistence paths made orphan by staged flow.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| authorized load | local or Org server | read-only + Edit |
| unauthorized/off | server User / Power off | read-only, no Edit |
| draft cmds | add/delete/import/archetype | memory only |
| save cancel | dirty draft | draft retained, no req |
| save confirm | multi-change | one batch req |
| stale | 412 | draft unchanged; confirmed reload discards |
| deletion | round + entry | final dialog exact counts |
| move | target same authority | success navigates target route |

## Impl steps

- [x] 1. Create `src/app/domain/archive-tournament-edit-batch.ts` + test. Exports: `buildArchiveTournamentEditBatch(source,draft)`, `archiveTournamentDeletionSummary()`, `sameAuthorityLeagueOptions()`.
- [x] 2. Diff rules: changed name/date; missing/new round; full replace existing round when entries/order differ; archetype changes; no unchanged intents.
- [x] 3. Component state: authoritative `league`, nullable `draft`, `editing=false`, `dirty`, `saving`, `stale`, selected target League.
- [x] 4. Remove automatic `startEdit()` from `load()`. `currentLeague/currentTournament` selects draft only while editing.
- [x] 5. Compute `canEdit = power && canManageLeague(origin,role) && active League`; render top action row.
- [x] 6. Read mode renders values/read-only fields; hides add/import/delete/archetype editor.
- [x] 7. Edit clones authoritative League. Rewrite add/edit/delete/import/archetype/move handlers to mutate draft only.
- [x] 8. Filter League selector with same authority only; no cross-origin option.
- [x] 9. Save builds diff/summary; new Rounds already carry stable client IDs + entries in `addRounds`; imported text is parsed into draft entries before diff. Empty exits; dialog lists move + deletion counts; confirm one repo call. Same-League adopts `result.sourceLeague`; move adopts `result.destinationLeague!` + navigates target route.
- [x] 10. 412 keeps draft/editing/dirty; Reload Latest confirmation; cancel keeps draft; confirm fetches latest + exits.
- [x] 11. Cancel Edit confirms only if dirty; beforeunload remains.
- [x] 12. Keep shell whole-delete actions separate + T8 gated.
- [x] 13. Fix `.player-archetype-panel` header padding to exact same inline 24px as round; remove conflicting negative margin.
- [x] 14. Add EN/FR `Edit`, `Cancel Edit`, `Save Changes`, summary/conflict/discard strings.
- [x] 15. Add Cypress server + local staged flows in existing League specs or focused `archive-staged-edit.cy.js`.

## Outputs

- Pure diff helper/tests.
- Archive Tournament detail explicit staged editor.
- No immediate content mutation calls remain on page.

## Validation

- [x] `npx vitest run src/app/domain/archive-tournament-edit-batch.test.ts src/app/features/tournaments-archive/tournament-archive-detail.component.test.ts src/app/data/league-archive-repository.service.test.ts` → exit 0.
- [x] `npm run typecheck && npm run build` → exit 0.
- [x] `dotnet test backend/Gones.sln --configuration Release --filter FullyQualifiedName~LeagueCommandApiTests` → exit 0.
- [x] `npx cypress run --spec cypress/e2e/archive-staged-edit.cy.js,cypress/e2e/power-user-gating.cy.js` → exit 0.
- [ ] manual check: chevron inset parity; stale draft copy retained; same-origin move only.
- [x] app functional — ranking/result links/delete remain.
- [x] commit intent: `feat(archive): stage tournament edits before commit`
