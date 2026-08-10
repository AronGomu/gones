# T16: Reviewer correctness fixes — dual-source data integrity

**Plan:** `./ai-artifacts/PLAN_2026_08_09_feedback-calendar-v1-round-2.md`
**Depends:** T15
**Commit outcome:** importing a bundle can no longer destroy a browser-local league, a full export never silently omits the server's leagues, and the Live settings League picker offers only leagues the server can actually accept

## Context (self-contained)

This ticket exists because the parent orchestrator's independent reviewer fanout (correctness + security,
both `deep`, read-only) found three in-scope blockers in the code T12–T15 landed. Two reviewers reached
the first finding independently. Every claim below was re-verified against the source by the parent
before this ticket was written — treat them as facts, not hypotheses.

Background you need:

- The League archive is now the **union** of a server store and a browser-local IndexedDB store
  (`docs/adr/0028-dual-source-league-archive.md`). A league id beginning `local-` routes to the browser
  store; everything else routes to the server. `src/app/data/league-archive-origin.ts` owns that rule.
- ADR 0028 states the target store "rewrites incoming ids into that store's namespace … cannot collide".
  The local adapter does not currently honour that for ids that already look local.
- The server's own restore is **always additive**: `LeagueCommandService.RestoreOneAsync` mints a fresh
  `NewId()` and uniquifies the name, so importing the same bundle twice yields two leagues and never
  overwrites one. The local adapter must be a drop-in for that behaviour.

Out of scope here: `backend/**` C# source, the Cypress gate (T17 owns it), test-honesty gaps (T17),
and any change to how the union list itself is assembled.

## Requirements

1. A local restore never overwrites an existing local row, whatever id the incoming bundle carries.
2. `downloadFullExport` never writes a file that silently omits the server's leagues.
3. The Live Tournament settings League picker offers only leagues the server will accept.
4. Three orphans/doc drifts created by this plan are cleaned up.
5. Every existing test stays green; assertions that encoded the old, wrong behaviour are updated with a
   comment saying why.

## Inputs

- `src/app/backend/local-league-archive-backend.service.ts` — `putRestored` (around line 231) and its
  doc comment, which already claims collision-freedom the code does not deliver.
- `src/app/app.component.ts` — `downloadFullExport` (around line 312).
- `src/app/data/league-archive-repository.service.ts` — `listLeagues()` sets a `serverUnavailable` flag
  when the server read rejects and degrades to the local list.
- `src/app/features/live-tournaments/live-tournament-runner.component.ts` — `assignableLeagues`
  (line 233) and the `leagues` load (line 291).
- `src/app/data/league-archive-origin.ts` — `isLocalLeagueId`, `newLocalLeagueId`,
  `LOCAL_PLACEHOLDER_LEAGUE_ID`, `isAnyPlaceholderLeagueId`.
- `backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs` — read `RestoreOneAsync` / `LeagueCommands.Restore`
  for the behaviour you are mirroring. **Read only; do not edit any C# file.**
- `src/app/backend/local-league-archive-backend.service.test.ts` — existing restore cases, around lines 341–380.
- `src/app/i18n/messages.ts`, `src/app/features/leagues-archive/league-archive-list.component.ts`,
  `docs/adr/0028-dual-source-league-archive.md`, `src/app/backend/indexed-db.ts` — the cleanup targets.
- **From Depends (T15, `a6730a0`):** export/import routing is live; `downloadFullExport` already filters
  both placeholder leagues out of the bundle; `ops/acceptance-matrix.json` carries a `doc-league-local` row.

### The three blockers, already diagnosed — do not re-investigate

**B1 — a local import overwrites a live row (silent data loss).**
`putRestored` computes `targetId = isPlaceholderLeagueId(...) ? LOCAL_PLACEHOLDER : isLocalLeagueId(league.id) ? league.id : newLocalLeagueId()`
then calls `put(...)`, which is an IndexedDB upsert, with `documentVersion: 1` and no existence check and
no version guard. Reachable two ways:
- Self-inflicted: create local league `local-abc`, run Full Data Export (T15 now includes local leagues and
  `exportFullData` preserves ids), keep editing to v7, later import that bundle → `local-abc` is replaced by
  the stale snapshot at v1. Every edit since the export is gone, with no dialog and no stale error.
- Hostile file: the export checksum is an integrity hash the author computes, not authenticity. A `.gones.json`
  containing `"id": "local-<victim uuid>"` overwrites exactly that league on import. With
  `placeholder-league` or `local-placeholder-league` it wipes the browser's whole "Unassigned Tournaments"
  row, and `rollbackImportedLeagues` cannot undo it because the repository refuses to delete placeholder ids.

**B2 — "full data export" silently drops the server's leagues.**
`listLeagues()` degrades: when the server read rejects it returns the local list only and sets
`serverUnavailable`. `downloadFullExport` never reads that flag. A signed-in Organizer who is offline, or
whose token expired, or who hits a 500, gets a file named `gones-full-data.gones.json` containing only
browser-local leagues, presented as a complete backup. Before this plan the rejection propagated and no
file was written at all. Export is ADR 0028's stated bridge and the only protection against "clearing site
data destroys local leagues", so a silently partial bundle is the worst available failure mode.

**B3 — the merged list leaks into the server-only Live settings picker.**
`assignableLeagues` filters only `PLACEHOLDER_LEAGUE_ID`. Since T14 made `listLeagues()` return the union,
an Organizer on `/live-tournaments/:id` now sees a second "Unassigned Tournaments" (the local placeholder,
raw English, not localized by `leagueSelectValue`) plus every browser-local league. Picking one sends
`patch({ leagueId: 'local-…' })` → `updateLiveSettings` → the backend's `RequireLeagueReferenceAsync` throws
`"League was not found."` → the runner shows the generic `live.saveFailed` and resyncs, discarding the choice.
Cross-authority assignment is exactly what ADR 0028 forbids, yet it is offered as a normal menu option.

## TDD

1. **Red** — add the failing cases first, in this order:
   - `local-league-archive-backend.service.test.ts`: restoring a bundle whose league id is already
     `local-<uuid>` and already present must leave the existing row untouched and add a second row;
     restoring a bundle carrying a placeholder id must not replace the local placeholder row.
   - `src/app/app.component.export.test.ts`: when `listLeagues()` resolves but `serverUnavailable()` is
     true, `downloadFullExport` must not write a file.
   - a test for `assignableLeagues` proving a `local-` league and the local placeholder are both excluded
     while server leagues survive.
   Run them and watch each fail for the stated reason.
2. **Green** — minimal implementation, below.
3. **Refactor** — keep the suite green.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `a restored league never overwrites an existing local row` | store holds `local-abc` at v7; restore a bundle with `id: 'local-abc'` | the v7 row is unchanged; a second row exists with a freshly minted `local-` id and the bundle's content |
| `a restored placeholder does not replace the local placeholder` | restore a bundle containing `placeholder-league` (and again with `local-placeholder-league`) | `LOCAL_PLACEHOLDER_LEAGUE_ID` keeps its own rows; the incoming content lands as a new ordinary local league |
| `restoring the same bundle twice yields two leagues` | restore one bundle twice | two distinct rows, mirroring the server's additive restore |
| `a full export refuses to write when the server list failed` | `serverUnavailable()` true after `listLeagues()` | no file saved; the caller is told; the existing error surface is used |
| `a full export still writes when the server list succeeded` | `serverUnavailable()` false | file saved exactly as today, both placeholders filtered |
| `the live league picker excludes browser-local leagues` | leagues = server league, `local-x`, both placeholders | only the server league is offered |

## Impl steps

- [x] 1. Write the red tests named in TDD/Test plan. Run them; capture the failure output.
      Red: 3 restore cases fail (`expected 'local-9f68…' not to be 'local-9f68…'`, placeholder mapped,
      `['Imported','Imported']`), export case fails (`saveJsonFile` called once), picker case fails
      (`['local-placeholder-league','7f3a…','local-4d6f…']`).
- [x] 2. Make `putRestored` additive, mirroring `RestoreOneAsync`: **always mint a fresh id** with
      `newLocalLeagueId()` and never target an existing row or either placeholder. Mirror the server's
      name-uniquifying behaviour if the server does it; if that is more than a few lines, keep the name
      verbatim and record it under Outputs as a deliberate difference.
      Done: fresh `newLocalLeagueId()` on every restore + `uniqueRestoredName` mirroring the server's
      `UniqueName` (10 lines). `npx vitest run src/app/backend/local-league-archive-backend.service.test.ts`
      → 46 passed, the 3 red cases green.
- [x] 3. Rewrite `putRestored`'s doc comment so it states what the code now does. The current comment
      claims collision-freedom the old code did not deliver — that claim becomes true, so say it plainly.
- [x] 4. Update the existing restore assertions that encoded placeholder-mapping (around
      `local-league-archive-backend.service.test.ts:341-380`). Add a one-line comment on each changed
      assertion saying the old behaviour was a data-loss defect.
- [x] 5. In `downloadFullExport`, read the repository's `serverUnavailable` flag after `listLeagues()` and
      refuse to write the file when it is set **and the visitor is signed in** (`serverUnavailable() &&
      auth.profile()`), i.e. only when there are server leagues the bundle silently omits. Surface it
      through the component's existing error/notice mechanism — do not invent a new one, and do not add a
      dialog. Add the i18n key in **both** `en` and `fr` if you need new copy.
      *Corrected by the parent after the worker surfaced the conflict:* the original text said refuse
      whenever the flag is set, but `listLeagues()` raises it for an anonymous visitor too (their
      `/api/leagues-archive` read always 401s), so a blanket refusal would delete ADR 0028's only backup
      path for exactly the people who own browser-local leagues — a worse bug than the one being fixed.
      Done: `importError` banner + new `msg.fullDataExportServerUnavailable` in `en` and `fr`, guarded on
      the signed-in condition, plus a signed-out regression guard test;
      `npx vitest run src/app/app.component.export.test.ts` → 10 passed.
- [x] 6. In `live-tournament-runner.component.ts`, change `assignableLeagues` to exclude local ids and both
      placeholders: filter on `!isLocalLeagueId(league.id) && !isAnyPlaceholderLeagueId(league.id)`.
      Import from `src/app/data/league-archive-origin.ts`. Update the comment on line 232 to match.
      Done: `npx vitest run src/app/features/live-tournaments/` → 12 passed, picker returns the
      server league only.
- [x] 7. Delete the orphan `home.signInDesc` from `src/app/i18n/messages.ts` — **both** the `en` and the `fr`
      entry. It was orphaned when this plan deleted the home menu login card and has no reader anywhere in
      `src`, `cypress`, `ops`, `scripts` or `docs`.
      Done: `grep -rn "signInDesc" src/ cypress/ ops/ scripts/ docs/` → no match (exit 1).
- [x] 8. Delete the dead `canManageLeague(league)` method from
      `src/app/features/leagues-archive/league-archive-list.component.ts` (around line 93) and its now-unused
      named import (around line 12). It has no template binding, no test and no other caller. Do not touch
      the pure `canManageLeague` module it imported from — that is used elsewhere.
      Done: `grep -rn "canManageLeague(" src/` → only the pure module + its 3 live callers.
- [x] 9. In `docs/adr/0028-dual-source-league-archive.md` (around line 83), correct "all 22 methods" to 21.
      `LeagueArchiveBackendPort` declares 21; the parity test and `ops/acceptance-matrix.json` already say 21.
- [x] 10. In `src/app/backend/indexed-db.ts` (header comment, around lines 4-5), add the third sanctioned
      file. It currently names only itself and `local-live-backend.service.ts` (ADR 0021); the League local
      adapter is the third, under ADR 0028. `server-authority-boundary.test.ts` already allows three files.
- [x] 11. Re-run the red tests — green. `npm run test` → 92 files / 765 tests passed, including the
      3 restore cases, all 3 export cases (signed-in refusal, signed-out still exports, normal write)
      and both picker cases.

## Outputs

- Changed: `src/app/backend/local-league-archive-backend.service.ts` (+ its test), `src/app/app.component.ts`
  (+ `app.component.export.test.ts`), `src/app/features/live-tournaments/live-tournament-runner.component.ts`
  (+ a test), `src/app/i18n/messages.ts`, `src/app/features/leagues-archive/league-archive-list.component.ts`,
  `src/app/backend/indexed-db.ts`, `docs/adr/0028-dual-source-league-archive.md`.
- Behaviour: local restore is additive and cannot destroy an existing league; a full export fails loudly
  rather than writing a partial bundle; the Live League picker offers only server leagues.

## Validation

- [x] `npm run test` passes — `Test Files 92 passed (92) / Tests 765 passed (765)` (re-run after the
      step-5 correction)
- [x] `npm run lint` passes — `All files pass linting.`
- [x] `npm run typecheck` passes — `tsc --noEmit` both projects, no output
- [x] `npm run build` passes — `Application bundle generation complete. [3.271 seconds]`
- [x] `npx vitest run src/app/backend/local-league-archive-backend.service.test.ts` — the new restore cases green (`46 passed`)
- [x] `npm run acceptance:matrix` still passes — `99/99 non-deferred capability rows proved (3 deferred)`
- [x] grep proves the orphans are gone: `grep -rn "signInDesc" src/` → no match; `grep -rn "canManageLeague(" src/` → only the pure module and its 3 live callers
- [x] app functional — no broken path from this slice: each changed path is exercised by a test that
      runs the real code (adapter over the in-memory IndexedDB fake, `AppComponent.downloadFullExport`,
      an instantiated `LiveTournamentRunnerComponent`), plus a green production build. Browser-level
      proof is the Cypress gate (T17) and the human steps appended to `ai-artifacts/manual_test_checklist.md`.
- [x] commit msg draft: `fix(leagues): stop local import overwriting leagues and partial exports passing as full`
