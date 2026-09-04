# Final Implementation Report: Create/Edit Event Page

## State

`done` locally. All five tickets implemented, independently reviewed, and merged into local `main` at `65c6a48`. Push remains intentionally pending explicit outward-action authorization.

## Ticket State List

| Ticket | State | Primary commit | Outcome |
| --- | --- | --- | --- |
| T1 | DONE | `3732d44` | Replaced Google location authority with required manual address and backend-validated IANA timezone; removed provider tokens/config/geodata; added DB/API migration. |
| T2 | DONE | `017a3d8` | Added worldwide country and backend TZDB timezone selects; removed autocomplete/provider UI and requests. |
| T3 | DONE | `e7e7835` | Enforced nullable singular Event image through UI, API, proposal envelope v3, DB cardinality, cleanup, migration, and public detail. |
| T4 | DONE | `bcc1e9b` | Added live preview header/sticky scroll, corrected title/type/player display, full-width Publish, complete accessible error tooltip, centered uploader. |
| T5 | DONE | `e106efa` | Added account-scoped recoverable create draft, create/edit dirty baselines, Angular leave guard, native unload protection, and Temporary image hydration. |

Corrective commits: `0351ace`, `a009155`, `5c222e6`, `128b181`, `76b43db`, `144b899`, `dcac5fc`, `ae029fe`, `ee79b51`. These close migration smoke, proposal integrity, viewport/tooltip, logout/account isolation, image hydration/security, release-journey, expiry precision, and wording findings.

## Delivered Contract

- Event location uses manual street, postal code, city, region, country, and IANA timezone. No paid location API, geocoder, provider key, signed location token, or persisted provider coordinates.
- Event media is zero or one image. Requests use nullable `imageId`; reads use optional nullable `image`; user alt/order controls and gallery navigation are removed.
- Live preview updates locally and shares the public detail component. Publish exposes every current disable reason through mouse- and keyboard-accessible UI.
- `/events/new` persists one normalized draft per account. Edit never persists locally. Logout and navigation guards preserve account isolation and unsaved work.

## Validation Evidence

- Frontend full suite: 176 files, 2,272 tests passed after cumulative fixes.
- Backend full suite: 342 unit + 20 architecture + 709 integration = 1,071 tests passed after cumulative fixes.
- Final migration suite: 4/4 passed, including predecessor v2 hashes, 100ns expiry precision, tampered envelopes, empty images, and survivor mismatch.
- Cypress: full 26/26 suite passed after T4; T5 relevant create/edit flows 21/21 passed; later create flow 15/15 passed. Final one-line singular-copy assertion was syntax checked and independently reviewed after its runtime predecessor failed only on `/images/i` versus singular `image`.
- `npm run api:check`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run acceptance:matrix` passed.
- Acceptance matrix: 111/111 non-deferred capabilities and 25/25 final checklist rows passed.
- Release rehearsal passed after cumulative API/journey corrections.
- Final independent reviewers reported PASS for proposal-image migration reconciliation, restored-image security, expiry precision, timezone wording, and cumulative reviewed fixes.

## Assumptions

### A1: Manual location authority

User-selected valid IANA timezone may not geographically match entered address. Product accepts this because no geocoding authority is used.

### A2: Timezone catalog

Backend NodaTime TZDB IDs are catalog and validation authority, preventing browser/backend list drift.

### A3: Destructive migrations

Repository is unreleased with no production environment per `AGENT.md`; provider geodata and obsolete plural image metadata are intentionally not reconstructable. Deployment must apply migrations with matching application version.

### A4: Browser draft boundary

Draft is recovery input, not canonical Event authority. Same-origin scripts and local browser-profile access can read it; account keying prevents normal cross-account UI access.

### A5: Native unload dialog

Browser owns native `beforeunload` copy. Application translations apply only to in-app confirmation dialog.

## User TODO

- [ ] U1 Review local `main` history ending at merge `65c6a48` and final report commit.
- [ ] U2 Explicitly authorize push when ready; no branch has been pushed by this run.
- [ ] U3 For any future deployment, ship application and migrations as one coordinated release; mixed-version rollout was not validated.
- [ ] U4 Stop shared local API/Worker containers when no longer needed; this run did not stop containers it did not exclusively own.

## Residual Risks

- Build reports two pre-existing `NG8113` warnings for unused `RouterLink` imports in Admin components; unrelated to this plan.
- Hosted/runtime behavior beyond local release rehearsal remains unproved because project has no production environment.
- Full Cypress was not rerun after the final one-line plural-to-singular test regex correction; preceding run was 6/7 with that exact assertion as sole failure, and syntax plus independent review passed afterward.

## Merge

Local `main` merge commit: `65c6a48` (`merge(events): deliver provider-free editor feedback`).
