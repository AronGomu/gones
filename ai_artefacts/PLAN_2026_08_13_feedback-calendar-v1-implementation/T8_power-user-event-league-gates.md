# T8: Power User Mode + Event/League Gates

**Plan:** `./ai_artefacts/PLAN_2026_08_13_feedback-calendar-v1-implementation.md`
**Depends:** T7
**Commit outcome:** Any browser persists Power User mode; disabled mode blocks every Event + League/Archive mutation while browsing/export/registration/Settings remain available.

## Context (self-contained)

- Goal: advanced creation/editing opt-in without hiding homepage cards or read pages.
- This slice: setting, guard, Event + League Archive mutation perimeter. Live comes T9.
- Out of scope here: server privilege changes; syncing local docs; creator ID schema; staged Archive editor (T13).
- Assumptions in force: signed-out visitor may enable mode + edit local League docs. Client setting is UX capability only. Server writes still Organizer/Admin. Regular-User proposal API remains, UI/route removed.

## Requirements

- Storage key: `gones.settings.power-user`; missing/malformed→false; persist `'true'/'false'`.
- Settings checkbox visible signed in/out.
- Event create/edit/publish UI requires enabled + Organizer/Admin + verified email. `/events/new` and organizer edit guarded. Proposal API unchanged.
- Advanced Event source-data mutations require enabled: create/edit/publish/cancel/delete UI + handlers. Event registration stays available. Regular-User proposal API stays callable but hidden from UI/routes.
- All League Archive/Archive Tournament mutations require enabled: create/edit/move/import/restore/delete/status/player rename/archetype commands.
- League list/detail/result + export remain usable.
- Direct create routes redirect; inline edit controls suppressed. Repo methods fail before adapter call if disabled.

## Inputs

- `src/app/features/settings/settings.component.ts`; `settings-capabilities.ts`.
- `src/app/app.routes.ts`; `src/app/auth/auth.guards.ts`.
- `src/app/features/calendar/public-calendar.component.ts`, `organizer-event-create.component.ts`, `organizer-event-list.component.ts`.
- `src/app/data/league-archive-repository.service.ts`; `league-archive-command-ux.ts`.
- League/Archive components + `src/app/app.component.ts` header actions.
- **From Depends:** T7 fixes About only. T6 final Calendar Register must stay available regardless Power mode.

## TDD

1. **Red** — service/guard tests: default, restore, persist, malformed, signed-out, redirects.
2. **Red** — Event matrix tests: Visitor/User/Organizer/Admin × verified × Power; proposal API integration stays green.
3. **Red** — Event list tests: cancel/delete controls + handlers blocked off; registration unaffected. Repository tests enumerate every League mutation: disabled throws `powerUserRequired` before server/local mock; reads unchanged.
4. **Red** — component/shell tests: create/edit/import/delete hidden; exports visible; direct detail read-only.
5. **Green** — service + central policy + guard + repo enforcement + UI composition.
6. **Refactor** — one `canUsePowerMutation(power, authority)` fn; do not duplicate role logic.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| pref | signed-out set true/reload | true restored |
| Event create | Org/Admin + power + verified | visible/reachable |
| User Event | power true | no UI/route; proposal API unchanged |
| local League | power off/on | read-only/editable |
| server League | Org power off/on | read-only/editable |
| mutation bypass | direct repo call off | reject before adapter |
| export/register | power off | available |

## Impl steps

- [x] 1. Create `src/app/shared/power-user-settings.service.ts` + test. API: `enabled: Signal<boolean>`, `setEnabled(value)`, `requireEnabled()`.
- [x] 2. Create `src/app/shared/power-user.guard.ts` + test; known fallbacks: Event create→`/calendar`, Event edit→`/organizer/events`, Live create later→`/live-tournaments`.
- [x] 3. Add Settings `mat-card`/checkbox + EN/FR help clarifying no privilege escalation.
- [x] 4. Update `/events/new`: `[organizerGuard, verifiedEmailGuard, powerUserGuard]`; Event edit likewise. Keep public/detail/proposal routes.
- [x] 5. Compose `PublicCalendarComponent.canCreateEvent` from role+verified+Power; early-return mutation methods in Event create/edit component. In `OrganizerEventListComponent`, gate `canEdit`, cancel/delete controls, `cancel()` + `delete()` handlers with Power; keep public view/participants links.
- [x] 6. Inject service into `LeagueArchiveRepository`; call `requireEnabled()` before every port mutation listed in `LeagueArchiveBackendPort`; leave reads untouched.
- [x] 7. Update League list/detail + Archive Tournament detail permission computeds to `power && canManageLeague(...)`.
- [x] 8. Split shell import/export branch: import/restore/delete/status/move/rename hidden by Power; Full/League Export always shown.
- [x] 9. Add `src/app/shared/power-user-gates.test.ts` asserting all mutation handlers/repos block while off, including Event cancel/delete.
- [x] 10. Update `src/app/backend/server-authority-boundary.test.ts` browser-storage allowlist with `power-user-settings.service.ts`, documenting boolean pref only; run boundary test.
- [x] 11. Add `cypress/e2e/power-user-gating.cy.js`: signed-out local, Organizer server, Event cancel/delete, direct URLs, export/registration unaffected.
- [x] 12. Update existing League/Event mutation Cypress setup to enable Power first.
- [x] 13. Add `power user` to `docs/GLOSSARY.md`; record client UX boundary in new ADR T12/T15 docs. (ADR edit excluded by T8 authorization; glossary records boundary.)

## Outputs

- `PowerUserSettingsService`, `powerUserGuard`, central policy.
- Event + League UI/repo gates.
- Public proposal API/backend policies unchanged.

## Validation

- [x] `npx vitest run src/app/shared/power-user-settings.service.test.ts src/app/shared/power-user.guard.test.ts src/app/shared/power-user-gates.test.ts src/app/data/league-archive-repository.service.test.ts src/app/data-mode-routes.test.ts src/app/backend/server-authority-boundary.test.ts` → exit 0.
- [x] `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~EventProposalTests|FullyQualifiedName~EventProposalDecisionTests"` → exit 0.
- [x] `npm run typecheck && npm run build` → exit 0.
- [x] `npx cypress run --spec cypress/e2e/power-user-gating.cy.js,cypress/e2e/organizer-event-create.cy.js` → exit 0.
- [ ] manual check: mode off pages/cards visible; all mutation actions absent/read-only; exports/Register work.
- [x] app functional — mode on restores current local/server role-routed behavior.
- [x] commit msg draft: `feat(settings): gate event and archive mutations behind power mode`
