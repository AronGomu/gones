# T25: data-cy sweep + acceptance matrix

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T3, T4, T10, T11, T19, T21, T22, T24, T25b
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

### Environment facts inlined by the parent — verified at `7479ab9`

- **The allowlist holds 24 entries, not the 25 listed above.**
  `src/app/shared/offline-banner.component.ts` is **already compliant and absent from the array** — do not go looking
  for it. Read the array itself; it is the work list. `live-tournament-runner.component.ts` is **1028** lines (the
  ticket says 999), `about.component.ts` 246, `public-tournament-detail.component.ts` 226, `dialogs.ts` only 33.
- **`npm run cy:run` cannot run on this host** — bare `cypress run` dies with
  `libglib-2.0.so.0: cannot open shared object file`, and most specs only pass under the release topology on 8081.
  Wherever this ticket says `npm run cy:run` (Test plan row 6, Impl step 11, the Validation line), the real gate is
  **`npm run e2e:ci`**, which rebuilds the release profile, resolves the NixOS `LD_LIBRARY_PATH` itself and seeds the
  auth fixture. Impl step 17 already names it. **T25b left it green: 18 specs, 18 pass, 0 fail.** Your job is to keep
  it that way — any red spec after your sweep is yours.
- **The auth rate limit does not constrain `e2e:ci`** (`scripts/full-stack-ci.mjs:14` sets
  `GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT: '1000'`). Run the gate as often as you need. The 5-per-15-minute limit only
  bites specs hand-run against the dev API on 5080.
- **The ngsw trap that cost this plan five red specs — know it before you touch a spec.** On the release build the
  service worker answers the navigation request from its own cache, so the document never travels through the Cypress
  proxy and **`cy.visit`'s `onBeforeLoad` is silently never called** — no error, no seed. T25b's fix pattern is to seed
  from the loaded window via `cy.window()` as well. If your sweep obliges you to touch a spec, follow that pattern; do
  not re-introduce an `onBeforeLoad`-only seed.
- **Two carried questions this ticket owns and must decide, not inherit:**
  1. `findDuplicateDataCy` is **textual** and does not understand mutually exclusive `@if` branches. The login and
     register arms of `auth-entry.component.ts` legitimately render the same ids (`auth-email`, `auth-password`,
     `auth-submit`) and Cypress selects on them; T4 kept the rendered DOM identical by switching the register arm to
     `[attr.data-cy]="'auth-email'"` bindings, which the static scan cannot see. That is a workaround, not a fix.
     **Decide: teach the check about exclusive branches, or accept the binding form as intentional and say so in the
     test.** Either is defensible; leaving it undocumented is not.
  2. T10 emits `[attr.data-cy]="'account-location-city-' + city"`, so attribute values contain spaces and apostrophes
     (`L'Arbresle`, `Montier-en-l'Isle`). **Decide whether to slugify.** Note a slugified value changes what a future
     spec would select on — no spec selects these today.
- **Two carried items are already resolved — do not spend time on them:**
  - `profile.location` is **still used** (`account-settings.component.ts:11`); T10 reused it. **Do not delete it.**
  - `profile.currentPasswordOptional` appears **only** in `src/app/i18n/messages.ts` (both maps) and is genuinely
    dead. Safe to delete if you want the tidy-up; it is optional.
- **Out of scope — record in the release notes as known gaps, do not fix here:**
  - `readOnly()`, `live.readOnly` and the `live-read-only` / `live-list-read-only` selectors became unreachable after
    T20. Removing unreachable UI is a behaviour change, which this ticket's Context forbids. `live-server.cy.js:378`
    still asserts `live-list-read-only` `should('not.exist')`, so it stays green either way.
  - `scripts/smoke-notification.mjs` deletes the outbox row but not its `notification_history` child, so the **second**
    run in any database fails on the FK.
  - **The tournament proposal flow has never been proved end to end against the live stack.** The two proposal tables
    have no grants for the local `gones_app` role — the compose `permissions` service ran before those tables existed
    (fix would be `docker compose up -d permissions`). T19's Cypress is intercept-based precisely because of this.
- **Step 15 lists six ADRs; there are seven.** T9b added
  `docs/adr/0027-external-identity-link-without-reauthentication.md`, which records a real security trade-off (the
  OAuth link/unlink password step-up was removed). The release notes must name it too.
- **There is no en/fr key-parity test** in this repo, so a one-sided i18n addition ships silently. Several tickets
  proved parity by grep only. Adding such a test is cheap and squarely in this ticket's "prove the release" spirit —
  optional, but say whether you did.
- **No Angular `TestBed`, no zone.js**, `@angular/common/http/testing` not installed. Template-shape claims are
  asserted by reading the source with `readFileSync` (see `data-cy-coverage.test.ts` itself).

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
| `full cypress suite` | `npm run e2e:ci` | green — 18 specs, 18 pass (T25b's baseline) |

Run: `npm run test -- data-cy-coverage` then `npm run acceptance:matrix` then `npm run e2e:ci`

## Impl steps

- [ ] 1. Capture the selector baseline: `grep -rhno "data-cy=[\"'][^\"']*" cypress/e2e/ | sed 's/.*data-cy=.//' | sort -u > /tmp/gones-cy-selectors.txt`. Keep it open; nothing in it may change value.
- [ ] 2. Set `PENDING_DATA_CY_RETROFIT = []` in `src/app/shared/data-cy-coverage.test.ts`.
- [ ] 3. Run `npm run test -- data-cy-coverage` and save the failing file list.
- [ ] 4. Sweep the files one at a time, in the order listed in Inputs. For each: add `data-cy` to every element the test names, using a kebab-case value prefixed by the component's feature (`admin-users-`, `live-runner-`, `about-`, `ranking-`, …), and `[attr.data-cy]` with an interpolated key for elements inside `@for` blocks.
- [ ] 5. `src/app/features/live-tournaments/live-tournament-runner.component.ts` is **1028** lines — sweep it in a dedicated pass and re-run the coverage test after it alone, before moving on.
- [ ] 6. `src/app/features/menu/about.component.ts` is 246 lines of marketing markup — prefix everything `about-` and number repeated blocks by index.
- [ ] 7. `src/app/shared/dialogs.ts` holds `ConfirmDialogComponent`, used by many call sites; give it stable values (`confirm-dialog-title`, `confirm-dialog-message`, `confirm-dialog-cancel`, `confirm-dialog-confirm`) and check no Cypress spec already asserts different ones.
- [ ] 8. After each file, re-run `npm run test -- data-cy-coverage` so the failure list only ever shrinks.
- [ ] 9. When the suite is green, re-run the baseline capture and `diff` it against `/tmp/gones-cy-selectors.txt`; the diff must be empty.
- [ ] 10. Run `npm run lint && npm run typecheck && npm run build`.
- [ ] 11. Run **`npm run e2e:ci`** in full (not `npm run dev` + `npm run cy:run`, which cannot run on this host) and fix
  any spec the sweep disturbed by restoring the original identifier value, never by editing the spec. T25b left the
  gate at 18/18 green — any red spec here is your sweep's doing.
- [ ] 12. Update `ops/acceptance-matrix.json`: confirm a `proved` row exists for each capability this plan added — cookie session persistence (T2), account deletion (T6), the full-catalog calendar (T12/T13/T14), the tournament proposal flow (T16/T17/T19), the local Live store (T20), the first-visit redirect (T21) and the archive rename (T23/T24). Add any missing row with real evidence targets.
- [ ] 13. Add a matrix row for the `data-cy` contract itself: gate `vitest`, target `src/app/shared/data-cy-coverage.test.ts`, detail "every rendered element carries a unique test identifier".
- [ ] 14. Run `npm run acceptance:matrix`.
- [ ] 15. Add a "Feedback release" section to `docs/RELEASE_NOTES_V1.md` listing, grouped by area, every user-visible change this plan shipped, and naming the six ADRs it rests on: `docs/adr/0021-role-scoped-browser-live-store.md`, `0022-rename-the-archived-league-feature.md`, `0023-full-catalog-calendar-cache.md`, `0024-tournament-proposal-signed-token-approval.md`, `0025-hard-account-deletion.md`, `0026-structured-profile-location-and-birth-date.md` — **and `0027-external-identity-link-without-reauthentication.md`, which the step's list omits.** Seven, not six. 0027 records a real security trade-off (the OAuth link/unlink password step-up was removed) and belongs in a release note. Also record, under a "known gaps" heading, the three items the parent listed as out of scope in the environment facts.
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
- [ ] `npm run e2e:ci` passes in full, 18/18 specs (this replaces `npm run cy:run`, unrunnable on this host)
- [ ] `npm run acceptance:matrix` passes with no new `deferred` row
- [ ] `npm run api:check` reports no drift
- [ ] `npm run e2e:ci` passes
- [ ] manual check: the captured Cypress selector list is unchanged
- [ ] app functional — nothing renders differently
- [ ] commit msg draft: `test(frontend): finish the data-cy sweep and prove the feedback release in the acceptance matrix`
