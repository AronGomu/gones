# T25: data-cy sweep + acceptance matrix

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T3, T4, T10, T11, T19, T21, T22, T24
**Commit outcome:** Every element of every component template carries a unique `data-cy`, the retrofit allowlist is empty, and the acceptance matrix proves the whole feedback release.

## Context (self-contained)

- Goal: land the whole `feedback.md` list on Gones Calendar V1. This ticket closes General §3 ("every html element must have a unique test identifier") for the components the feature tickets did not already touch, and brings `ops/acceptance-matrix.json` back to fully proved.
- This slice: mechanical markup edits across the remaining components, emptying `PENDING_DATA_CY_RETROFIT`, and the release documentation.
- Out of scope here: behaviour changes of any kind. If adding an identifier requires restructuring markup, stop and leave that file for a follow-up rather than changing what renders.
- Assumptions in force: **A1** — the attribute is `data-cy`. **A13** — the allowlist shrank ticket by ticket; whatever remains is what this ticket sweeps.

## Requirements

- `PENDING_DATA_CY_RETROFIT` in `src/app/shared/data-cy-coverage.test.ts` is `[]`.
- Every element in every `src/app/**/*.ts` component template has a `data-cy` or `[attr.data-cy]`, except the exempt tags T1 declared.
- No two static `data-cy` values collide inside one file.
- No existing Cypress selector breaks: identifiers already asserted by `cypress/e2e/**` keep their exact values.
- `npm run acceptance:matrix` passes with rows covering the new capabilities added by this plan.
- `docs/RELEASE_NOTES_V1.md` gains a section describing the feedback release.

## Inputs

- `src/app/shared/data-cy-coverage.test.ts` — created by T1. It exports `PENDING_DATA_CY_RETROFIT: string[]`, `findMissingDataCy(source): string[]`, `findDuplicateDataCy(source): string[]`, and iterates every `src/app/**/*.ts` file containing a `template:` block. `EXEMPT_TAGS` is `['ng-container','ng-template','ng-content','svg','path','defs','g','use','circle','rect','line','polyline','polygon','br','hr']`.
- `src/AGENT.md` — the rule text: static values use `data-cy="..."`, computed ones `[attr.data-cy]="..."`, values are kebab-case and feature-prefixed, unique inside the component.
- Files the feature tickets already made compliant (do **not** re-edit them): `app.component.ts` (T3), `home-menu.component.ts` (T3/T22), `auth-entry.component.ts` (T4), `account-settings.component.ts` (T8–T11), `settings.component.ts` (T8), `public-calendar.component.ts` (T14), `organizer-tournament-create.component.ts` (T15/T18), `my-registrations.component.ts` (T22), the four renamed archive components (T24), plus every component created by this plan.
- Files expected to remain in the allowlist when this ticket starts, each needing a sweep:
  - `src/app/features/admin/admin-audit.component.ts`
  - `src/app/features/admin/admin-home.component.ts`
  - `src/app/features/admin/admin-notification-delivery.component.ts`
  - `src/app/features/admin/admin-organizations.component.ts`
  - `src/app/features/admin/admin-users.component.ts`
  - `src/app/features/admin/organization-detail.component.ts`
  - `src/app/features/admin/organization-list.component.ts`
  - `src/app/features/admin/organizer-organizations.component.ts`
  - `src/app/features/calendar/admin-deleted-tournaments.component.ts`
  - `src/app/features/calendar/organizer-participants.component.ts`
  - `src/app/features/calendar/organizer-tournament-list.component.ts`
  - `src/app/features/calendar/public-tournament-detail.component.ts`
  - `src/app/features/calendar/server-sanitized-html.component.ts`
  - `src/app/features/calendar/tournament-detail-view.component.ts`
  - `src/app/features/live-tournaments/live-tournament-list.component.ts`
  - `src/app/features/live-tournaments/live-tournament-runner.component.ts`
  - `src/app/features/menu/about.component.ts`
  - `src/app/features/players/player-detail.component.ts`
  - `src/app/shared/back-button.component.ts`
  - `src/app/shared/deck-archetype-input.component.ts`
  - `src/app/shared/dialogs.ts`
  - `src/app/shared/not-found.component.ts`
  - `src/app/shared/offline-banner.component.ts`
  - `src/app/shared/ranking-table.component.ts`
  - `src/app/shared/route-error-boundary.ts`
  Confirm the real list by reading the array — earlier tickets may have removed some and T20/T24 may have renamed others.
- `ops/acceptance-matrix.json` — `{ kind: 'gones.acceptance-matrix', version: 1, note, rows: [...] }`; each row is `{ id, doc, capability, status, acceptance: [...], evidence: [{ gate, target, detail }] }`. `status` may be `proved` or `deferred`; `scripts/acceptance-matrix.mjs` and `ops/acceptance-matrix.test.ts` refuse a `proved` row whose evidence target does not resolve to something a committed gate runs.
- `docs/RELEASE_NOTES_V1.md` — the existing release notes to extend.
- Cypress selectors currently asserted: `grep -rhno "data-cy=[^]\"']*" cypress/e2e/ | sort -u` gives the exact set that must not change.
- **From Depends:** T3, T4, T10, T11, T19, T21, T22 and T24 each removed their own file from the allowlist and left their components compliant. T24 also renamed several paths, so the allowlist entries were repathed there.

## TDD

1. **Red** — set `PENDING_DATA_CY_RETROFIT = []` and run `npm run test -- data-cy-coverage`; the failure list is the work list.
2. **Green** — sweep each named file until the suite passes.
3. **Refactor** — none. Markup structure must not change.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `allowlist is empty` | `PENDING_DATA_CY_RETROFIT` | `[]` |
| `every template tags every element` | all component files | no violations |
| `no duplicate identifiers per file` | all component files | no duplicates |
| `existing cypress selectors survive` | the selector set captured before the sweep | every one still found in `src/app/**` |
| `acceptance matrix is valid` | `npm run acceptance:matrix` | exit 0, no `deferred` row introduced by this plan |
| `full cypress suite` | `npm run cy:run` | green |

Run: `npm run test -- data-cy-coverage` then `npm run acceptance:matrix` then `npm run cy:run`

## Impl steps

- [ ] 1. Capture the selector baseline: `grep -rhno "data-cy=[\"'][^\"']*" cypress/e2e/ | sed 's/.*data-cy=.//' | sort -u > /tmp/gones-cy-selectors.txt`. Keep it open; nothing in it may change value.
- [ ] 2. Set `PENDING_DATA_CY_RETROFIT = []` in `src/app/shared/data-cy-coverage.test.ts`.
- [ ] 3. Run `npm run test -- data-cy-coverage` and save the failing file list.
- [ ] 4. Sweep the files one at a time, in the order listed in Inputs. For each: add `data-cy` to every element the test names, using a kebab-case value prefixed by the component's feature (`admin-users-`, `live-runner-`, `about-`, `ranking-`, …), and `[attr.data-cy]` with an interpolated key for elements inside `@for` blocks.
- [ ] 5. `src/app/features/live-tournaments/live-tournament-runner.component.ts` is 999 lines — sweep it in a dedicated pass and re-run the coverage test after it alone, before moving on.
- [ ] 6. `src/app/features/menu/about.component.ts` is 246 lines of marketing markup — prefix everything `about-` and number repeated blocks by index.
- [ ] 7. `src/app/shared/dialogs.ts` holds `ConfirmDialogComponent`, used by many call sites; give it stable values (`confirm-dialog-title`, `confirm-dialog-message`, `confirm-dialog-cancel`, `confirm-dialog-confirm`) and check no Cypress spec already asserts different ones.
- [ ] 8. After each file, re-run `npm run test -- data-cy-coverage` so the failure list only ever shrinks.
- [ ] 9. When the suite is green, re-run the baseline capture and `diff` it against `/tmp/gones-cy-selectors.txt`; the diff must be empty.
- [ ] 10. Run `npm run lint && npm run typecheck && npm run build`.
- [ ] 11. Run `npm run dev` then `npm run cy:run` in full and fix any spec the sweep disturbed by restoring the original identifier value, never by editing the spec.
- [ ] 12. Update `ops/acceptance-matrix.json`: confirm a `proved` row exists for each capability this plan added — cookie session persistence (T2), account deletion (T6), the full-catalog calendar (T12/T13/T14), the tournament proposal flow (T16/T17/T19), the local Live store (T20), the first-visit redirect (T21) and the archive rename (T23/T24). Add any missing row with real evidence targets.
- [ ] 13. Add a matrix row for the `data-cy` contract itself: gate `vitest`, target `src/app/shared/data-cy-coverage.test.ts`, detail "every rendered element carries a unique test identifier".
- [ ] 14. Run `npm run acceptance:matrix`.
- [ ] 15. Add a "Feedback release" section to `docs/RELEASE_NOTES_V1.md` listing, grouped by area, every user-visible change this plan shipped, and naming the six ADRs it rests on: `docs/adr/0021-role-scoped-browser-live-store.md`, `0022-rename-the-archived-league-feature.md`, `0023-full-catalog-calendar-cache.md`, `0024-tournament-proposal-signed-token-approval.md`, `0025-hard-account-deletion.md`, `0026-structured-profile-location-and-birth-date.md`.
- [ ] 16. Run the full gate set: `npm run test && npm run lint && npm run typecheck && npm run build && npm run backend:test && npm run acceptance:matrix && npm run api:check`.
- [ ] 17. Run `npm run e2e:ci` for the end-to-end release gate.

## Outputs

- Files touched: `src/app/shared/data-cy-coverage.test.ts`, roughly 25 component files, `ops/acceptance-matrix.json`, `docs/RELEASE_NOTES_V1.md`, possibly a few `cypress/e2e/*.cy.js`.
- Public API / behavior change: none — identifiers only.
- Migrate / config: none.

## Validation

- [ ] `npm run test` passes with an empty allowlist
- [ ] `npm run lint && npm run typecheck && npm run build` pass
- [ ] `npm run backend:test` passes
- [ ] `npm run cy:run` passes in full
- [ ] `npm run acceptance:matrix` passes with no new `deferred` row
- [ ] `npm run api:check` reports no drift
- [ ] `npm run e2e:ci` passes
- [ ] manual check: the captured Cypress selector list is unchanged
- [ ] app functional — nothing renders differently
- [ ] commit msg draft: `test(frontend): finish the data-cy sweep and prove the feedback release in the acceptance matrix`
