# T9: Live Tournament Mutation Gates

**Plan:** `./ai_artefacts/PLAN_2026_08_13_feedback-calendar-v1-implementation.md`
**Depends:** T8
**Commit outcome:** Power mode off keeps Live Tournament list/detail readable; create, settings, players, rounds, finalize, delete blocked at UI + repository.

## Context (self-contained)

- Goal: apply Power User perimeter to Live domain.
- This slice: Live only.
- Out of scope here: changing ADR 0021 adapter selection; syncing local/server; homepage hide.
- Assumptions in force: Home Live card always visible. Anonymous/User still use `LocalLiveBackend`; Organizer/Admin still server adapter. Power mode never selects adapter.

## Requirements

- `/live-tournaments/new` needs `powerUserGuard`; list/detail remain public/readable.
- Repository gates every mutation before backend call.
- Disabled runner read-only for all roles/origins.
- Hide advanced settings, add/edit/drop/remove/paid players, start/regenerate/cancel/score/validate rounds, checkpoint restore, finalize/archive, delete.
- Enabled anonymous local + enabled Organizer/Admin server behavior unchanged.

## Inputs

- `src/app/data/live-tournament-repository.service.ts`.
- `src/app/features/live-tournaments/live-tournament-list.component.ts`, `live-tournament-runner.component.ts`.
- `src/app/backend/application-backend.ts` Live port; backend-selection tests.
- `src/app/app.component.ts`; `src/app/app.routes.ts`.
- **From Depends:** T8 leaves exact API:
  ```ts
  class PowerUserSettingsService { readonly enabled: Signal<boolean>; setEnabled(value:boolean):void; requireEnabled():void; }
  function canUsePowerMutation(powerEnabled:boolean, authorityAllowed:boolean): boolean;
  const powerUserGuard: CanActivateFn;
  ```
  Storage key = `gones.settings.power-user`; disabled mutation throws `Error('powerUserRequired')`.

## TDD

1. **Red** — repository mutation enumeration rejects `powerUserRequired` before mock.
2. **Red** — route/list/runner tests assert create route guarded; list/detail open; all mutation controls absent off.
3. **Red** — adapter test asserts toggling Power does not swap local/server backend.
4. **Green** — repo + UI + shell gates.
5. **Refactor** — one runner `canManage`/`readOnly` source; handler early returns remain defense-in-depth.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| anon local off | existing local Live | readable, no mutation |
| anon local on | same | mutation controls work |
| Organizer server off | server Live | readable, no mutation |
| Organizer server on | same | server cmds work |
| direct `/new` off | URL | redirect list |
| pref toggle | active injector | adapter selection unchanged |

## Impl steps

- [x] 1. Inject Power service into `LiveTournamentRepository`; gate `create`, `delete`, settings, player cmds, round cmds, checkpoint, finalize; keep `list/get`.
- [x] 2. Add repository tests for every public mutation + read exceptions.
- [x] 3. Add `powerUserGuard` to `/live-tournaments/new`; retain open detail route.
- [x] 4. In Live list, compose current local/role authority with `power.enabled()`; hide create card + block handler.
- [x] 5. In runner, make `readOnly = !canUsePowerMutation(power.enabled(), existingAuthorityAllowed)`; bind all controls/handlers.
- [x] 6. Hide shell advanced-settings button while Power off; handler also returns early.
- [x] 7. Update `live-tournament-delete.test.ts`, route tests, add list focused test if absent.
- [x] 8. Extend `power-user-gating.cy.js` with anonymous local + Organizer server Live cases.
- [x] 9. Update existing Live mutation Cypress setup to enable mode.

## Outputs

- Live UI/repo Power enforcement.
- No server API/ADR authority change.

## Validation

- [x] `npx vitest run src/app/data/live-tournament-repository.service.test.ts src/app/features/live-tournaments/live-tournament-delete.test.ts src/app/data-mode-routes.test.ts src/app/backend/live-backend-selection.test.ts` → exit 0.
- [x] `npm run typecheck && npm run build` → exit 0.
- [x] `npx cypress run --spec cypress/e2e/power-user-gating.cy.js` → exit 0.
- [ ] manual check: mode off existing local/server Live detail readable; no advanced/mutation controls.
- [ ] app functional — mode on local + server journeys still work.
- [x] commit msg draft: `feat(live): enforce power user mutation gate`
