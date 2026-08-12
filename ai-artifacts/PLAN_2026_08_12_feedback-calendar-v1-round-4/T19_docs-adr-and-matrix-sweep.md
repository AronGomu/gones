# T19: Docs, ADR and matrix sweep

**Plan:** `./ai-artifacts/PLAN_2026_08_12_feedback-calendar-v1-round-4.md`
**Depends:** T18
**Commit outcome:** the repository's documentation, ADRs, acceptance matrix and agent contract describe the shipped system: Event vocabulary, derived Organizer role with draft organizations, and session-ready route guards.

## Context (self-contained)

- Goal: ship round 4 of `feedback.md`. This is the closing slice.
- This slice: documentation only — no runtime behaviour changes. It exists because the previous 18 tickets changed vocabulary, routes, an API surface and a role model that several documents describe.
- Out of scope here: any source change beyond doc-referenced file paths; new features.
- Assumptions in force: ADRs live in `docs/adr/` (lowercase). ADRs 0033, 0034 and 0035 and the two architecture HTML documents were ALREADY written when this plan was produced — this ticket verifies them against the shipped code and flips their status, it does not author them from scratch.

## Requirements

- Verify and finalise the three existing ADRs against what actually shipped; correct any drift, then change `## Status` from `Proposed` to `Accepted` in each:
  - `docs/adr/0033-session-ready-route-guards.md` — guards await `AuthService.whenSessionReady()` (T1).
  - `docs/adr/0034-derived-organizer-role-and-draft-organizations.md` — membership drives `globalRole` both ways, `Admin` exempt, Draft orgs cannot publish, one-shot heal (T11, T12).
  - `docs/adr/0035-calendar-event-vocabulary.md` — rename map, no API aliases, permanent frontend redirects (T15-T18). Check every table and path named in the ADR against the migration and the route file; fix the ADR if the implementation diverged, and say which one moved.
- Verify the two existing architecture documents and update them if the implementation diverged: `docs/organization-membership-model.html`, `docs/event-vocabulary-rename.html`.
- Update existing docs:
  - `AGENT.md` — the "What Gones is" paragraph and any Calendar V1 wording; add `DEMO_ACCOUNTS.md` to the layout table (if T9 did not already); mention the new ADRs.
  - `docs/CONTEXT.md`, `docs/GLOSSARY.md` — add `Event` and `Draft organization`, mark `Scheduled tournament` as the retired term.
  - `docs/DESIGN.md` — the calendar/detail page descriptions changed in T2-T8.
  - `docs/calendar-data-flow.html` and `docs/tournament-proposal-flow.html` — rename to the Event vocabulary; `git mv docs/tournament-proposal-flow.html docs/event-proposal-flow.html` and update every internal reference (`grep -rn "tournament-proposal-flow" .` excluding `node_modules`).
  - `docs/OPERATIONS.md` — confirm the heal-migration note from T12 is present and accurate.
- `ops/acceptance-matrix.json` — update every `evidence.target` that names a renamed or moved file, and add rows for: derived Organizer role, draft-org publish refusal, session-ready guards, `/events` canonical routes.
- `README.md` — any `tournaments/new` or `/api/tournaments` reference.
- Delete nothing that still describes shipped behaviour; if a document is obsolete, say so in one line inside it rather than removing it silently.

## Inputs

- `docs/adr/` — 0013-0032 exist; naming convention `NNNN-kebab-title.md`.
- `docs/adr/0022-rename-the-archived-league-feature.md` — the closest precedent for a rename ADR, including the no-API-alias decision.
- `ops/acceptance-matrix.json` + `ops/acceptance-matrix.test.ts` + `scripts/acceptance-matrix.mjs` — a row may only be `proved` when every evidence target resolves to a real committed gate.
- `AGENT.md`, `docs/CONTEXT.md`, `docs/DESIGN.md`, `docs/GLOSSARY.md`, `docs/OPERATIONS.md`, `README.md`.
- **From Depends:** T1 added `AuthService.whenSessionReady()`; T9 added `DEMO_ACCOUNTS.md` + `scripts/generate-demo-accounts-doc.mjs`; T10-T13 added the roster endpoint, `OrganizationMembershipRoleService`, the `organization_is_draft` 409, the heal migration and the admin workbench; T14 gave admins the full org picker; T15-T18 renamed entities, tables, API paths, frontend symbols and routes.

## TDD

1. **Red** — run `npx vitest run ops/acceptance-matrix.test.ts` after adding the new rows with their evidence targets; it fails until every target exists.
2. **Green** — fix the targets and the docs.
3. **Refactor** — none.

## Test plan

| Test | Input | Expect |
| ---- | ---- | ------ |
| `acceptance matrix evidence resolves` | `npx vitest run ops/acceptance-matrix.test.ts` | green, new rows counted |
| `no doc references a removed API path` | `grep -rn "api/tournaments" docs README.md AGENT.md` | prints nothing |
| `no doc references the old create route` | `grep -rn "tournaments/new" docs README.md AGENT.md` | prints nothing (redirect mentions excluded, if any, must be explicit) |
| `ADR numbering has no gap or duplicate` | `ls docs/adr` | 0033, 0034, 0035 present exactly once, each with status Accepted |
| `renamed architecture doc has no dangling references` | `grep -rn "tournament-proposal-flow" . --exclude-dir=node_modules` | prints nothing |

## Impl steps

- [x] 1. Read `docs/adr/0033-session-ready-route-guards.md` against `src/app/auth/auth.guards.ts`; correct drift; set status to Accepted.
- [x] 2. Read `docs/adr/0034-derived-organizer-role-and-draft-organizations.md` against `OrganizationMembershipRoleService` and the heal migration; correct drift; set status to Accepted.
- [x] 3. Read `docs/adr/0035-calendar-event-vocabulary.md` against the rename migration and `src/app/app.routes.ts`; correct drift; set status to Accepted.
- [x] 4. `git mv docs/tournament-proposal-flow.html docs/event-proposal-flow.html`; update its content and every reference.
- [x] 5. Update `docs/calendar-data-flow.html` to the Event vocabulary.
- [x] 6. Verify `docs/organization-membership-model.html` and `docs/event-vocabulary-rename.html` against the shipped behaviour; update the tables if anything moved.
- [x] 7. Update `AGENT.md`, `docs/CONTEXT.md`, `docs/DESIGN.md`, `docs/GLOSSARY.md`, `docs/OPERATIONS.md`, `README.md`.
- [x] 8. Add and fix the `ops/acceptance-matrix.json` rows; run `npx vitest run ops/acceptance-matrix.test.ts`.
- [x] 9. Run the greps from the test plan; fix every hit.
- [x] 10. Run `npm run test` and `dotnet test backend/Gones.sln` one last time.

### Step evidence

- 1 — `docs/adr/0033` verified line by line against `src/app/auth/auth.guards.ts`: all four guards `async`, `await auth.whenSessionReady()` before `profile()`, `inject()` above the await, redirect targets `/login?returnUrl=`, `/?denied=`, `/verify-email?email=`. No drift; status `Accepted`, `## Shipped` paragraph added.
- 2 — drift found and corrected: the consequence "the users screen no longer grants the Organizer role by hand" was false (`admin-users.component.ts:46-48` renders Grant/Revoke Organizer, `AdminEndpoints.cs:43` still routes it, `AdminRoleService.ChangeRoleAsync` still applies it). ADR now records the manual override and that the derived sync overwrites it at the next membership write. Added the shipped lock order and the deadlock→409 mapping (`ApiExceptionHandler.cs:65`). Status `Accepted`.
- 3 — every table, column, constraint and index in the ADR checked against `20260812164333_RenameCalendarTournamentToEvent`; every route against `src/app/app.routes.ts`. Two divergences recorded in a new `## Shipped, and where it diverged` section: the `consumed_tournament_preview_tickets` table row was missing from the decision, and the redirect list shipped two entries wider (`/organizer/tournaments/new`, `/admin/tournaments/deleted`). Added the table of identifiers the rename deliberately kept. Status `Accepted`.
- 3b — ADRs 0023 and 0030 keep their historical `/api/tournaments*` text and gained a one-line pointer to ADR 0035; ADR 0025 records that the `account_owns_records` relation labels are shipped wire strings, not current table names.
- 4 — `git mv` done (`R  docs/tournament-proposal-flow.html -> docs/event-proposal-flow.html`); endpoints, routes and the footer updated to `/api/event-proposals*`, `/events/new`, `/event-requests/{token}`; the unrenamed notification template/dedupe keys called out. `git grep tournament-proposal-flow` returns only this ticket file.
- 5 — `docs/calendar-data-flow.html`: `/api/events/all`, `filterEvents`/`AllEventsCacheService`/`sortEventsForList`/`paginateEvents`, `PublicEventSummaryResponse`. Corrected a false claim: the note said day cells hold nothing but day numbers, while `public-calendar.component.ts:99-107` renders up to `MAX_DAY_CELL_EVENTS` filtered events plus a "+N more" line. Added the past-day tint rule, the month-nav scroll preservation and the highlight pass. Storage key `gones.calendar-v1.all-tournaments` kept and marked as deliberate.
- 6 — `organization-membership-model.html`: same Organizer-grant lie corrected; "One of two memberships removed → side effects: none" corrected to the `organization.role.unchanged` audit row that `OrganizationMembershipRoleService` really writes; org-create and ownership-transfer enforcement points and the lock order added; the unvirtualised 500-account picker recorded. `event-vocabulary-rename.html`: missing table and route rows added, plus the kept-identifier table.
- 7 — `AGENT.md` (What Gones is, the three new ADRs, CONTEXT pointer), `docs/CONTEXT.md` (Event, Scheduled Tournament as retired, Organization, Draft Organization, four relationships), `docs/GLOSSARY.md` (scheduled tournament / membership / draft organization rows), `docs/DESIGN.md` (Event Calendar and Event Detail component rules from T2-T8), `README.md` (Event lead paragraph). `docs/OPERATIONS.md` §8 heal note re-read against `20260812154508_HealOrganizationMembershipInvariants` — accurate as written, unchanged.
- 8 — four rows added: `doc03-session-ready-guards`, `doc04-derived-organizer-role`, `doc04-draft-organizations`, `doc09-event-routes`; capability prose swept to Event vocabulary. Rehearsal `detail` strings deliberately untouched — the validator matches them against the rehearsal script source. Red step proved by pointing one target at `src/app/does-not-exist.test.ts`: `row doc09-event-routes: file src/app/does-not-exist.test.ts does not exist`, 1 failed | 6 passed; restored → 7 passed.
- 9 — `git grep tournament-proposal-flow` clean. `git grep "api/tournaments\|tournaments/new" -- docs README.md AGENT.md` leaves only explicit retired-path mentions (ADR 0035's own rename map, the rename HTML's before column, the historical ADR 0023/0030 text under their new pointers, CONTEXT's `_Formerly_` line). See Assumptions.

## Outputs

- Files touched: the three ADRs (status + drift fixes), `docs/organization-membership-model.html`, `docs/event-vocabulary-rename.html`, `docs/event-proposal-flow.html` (renamed), `docs/calendar-data-flow.html`, `AGENT.md`, `docs/CONTEXT.md`, `docs/DESIGN.md`, `docs/GLOSSARY.md`, `docs/OPERATIONS.md`, `README.md`, `ops/acceptance-matrix.json`.
- Behaviour change: none.

## Validation

- [x] `npx vitest run ops/acceptance-matrix.test.ts` passes — `Test Files 1 passed (1) / Tests 7 passed (7)`. `npm run acceptance:matrix`: `103/103 non-deferred capability rows proved (3 deferred). 24/24 final acceptance checklist rows proved.` (99 before this ticket).
- [x] `npm run test` passes — `Test Files 110 passed (110) / Tests 1022 passed (1022)`.
- [x] `npm run lint` — `All files pass linting.`; `npm run typecheck` — clean, no output.
- [ ] `dotnet test backend/Gones.sln` passes — **not green on this host, and not from this ticket.** `Failed: 4, Passed: 390, Total: 394` in `Gones.IntegrationTests`; all four are Testcontainers startup failures (`RootlessKit PortManager.AddPort(): listen tcp4 0.0.0.0:37278: bind: address already in use`), zero assertion failures. `Gones.UnitTests` 198/198 and `Gones.ArchitectureTests` 17/17 pass. This ticket changes no `.cs` file.
- [x] manual check — no browser available in this session, so the three documents were parsed instead: every tag balanced, zero unclosed elements and zero mismatched closes in `event-proposal-flow.html`, `calendar-data-flow.html`, `organization-membership-model.html` and `event-vocabulary-rename.html`.
- [x] app functional — documentation-only commit: the diff touches `*.md`, `*.html` and `ops/acceptance-matrix.json` only, no `src/`, no `backend/`, no `scripts/`.
- [x] commit msg draft: `docs(adr): record the Event rename, derived organizer role and guard fix`

### Assumptions

- The test-plan rule "`grep api/tournaments docs README.md AGENT.md` prints nothing" is read the way the sibling `tournaments/new` rule states it explicitly: a hit is allowed only where the document marks the path as retired or historical. ADR 0035 must name the path it retired, and ADRs 0023/0030 are historical records that ADR 0022's precedent does not rewrite — each now carries a one-line pointer instead.
- No source file was changed. Where a document contradicted the code, the document moved.

### Residual risks (not this ticket's to fix)

- `scripts/smoke-full-stack.mjs:56` `expectedMigrations` is missing `20260812164333_RenameCalendarTournamentToEvent`, so `npm run smoke:full-stack` and the allowlist parse in `scripts/release-preflight.mjs:324` are stale since T15. Left untouched: it is a source change outside this ticket.
- `/admin/users` still grants and revokes `Organizer` by hand. Documented rather than removed; retiring that half of the endpoint pair is a follow-up.
