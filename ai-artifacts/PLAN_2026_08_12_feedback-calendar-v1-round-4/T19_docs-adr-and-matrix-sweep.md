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

- [ ] 1. Read `docs/adr/0033-session-ready-route-guards.md` against `src/app/auth/auth.guards.ts`; correct drift; set status to Accepted.
- [ ] 2. Read `docs/adr/0034-derived-organizer-role-and-draft-organizations.md` against `OrganizationMembershipRoleService` and the heal migration; correct drift; set status to Accepted.
- [ ] 3. Read `docs/adr/0035-calendar-event-vocabulary.md` against the rename migration and `src/app/app.routes.ts`; correct drift; set status to Accepted.
- [ ] 4. `git mv docs/tournament-proposal-flow.html docs/event-proposal-flow.html`; update its content and every reference.
- [ ] 5. Update `docs/calendar-data-flow.html` to the Event vocabulary.
- [ ] 6. Verify `docs/organization-membership-model.html` and `docs/event-vocabulary-rename.html` against the shipped behaviour; update the tables if anything moved.
- [ ] 7. Update `AGENT.md`, `docs/CONTEXT.md`, `docs/DESIGN.md`, `docs/GLOSSARY.md`, `docs/OPERATIONS.md`, `README.md`.
- [ ] 8. Add and fix the `ops/acceptance-matrix.json` rows; run `npx vitest run ops/acceptance-matrix.test.ts`.
- [ ] 9. Run the greps from the test plan; fix every hit.
- [ ] 10. Run `npm run test` and `dotnet test backend/Gones.sln` one last time.

## Outputs

- Files touched: the three ADRs (status + drift fixes), `docs/organization-membership-model.html`, `docs/event-vocabulary-rename.html`, `docs/event-proposal-flow.html` (renamed), `docs/calendar-data-flow.html`, `AGENT.md`, `docs/CONTEXT.md`, `docs/DESIGN.md`, `docs/GLOSSARY.md`, `docs/OPERATIONS.md`, `README.md`, `ops/acceptance-matrix.json`.
- Behaviour change: none.

## Validation

- [ ] `npx vitest run ops/acceptance-matrix.test.ts` passes
- [ ] `npm run test` passes
- [ ] `dotnet test backend/Gones.sln` passes
- [ ] manual check: open `docs/organization-membership-model.html`, `docs/event-vocabulary-rename.html` and `docs/event-proposal-flow.html` in a browser
- [ ] app functional — documentation-only commit
- [ ] commit msg draft: `docs(adr): record the Event rename, derived organizer role and guard fix`
