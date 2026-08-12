# Progress: Feedback Calendar V1 — Round 4

- Goal: ship the 19 items of `feedback.md` — calendar/detail polish, admin organization workbench with derived Organizer role, session-ready guards, generated demo docs, Tournament → Event rename.
- Plan index: `ai-artifacts/PLAN_2026_08_12_feedback-calendar-v1-round-4.md`
- Tickets dir: `ai-artifacts/PLAN_2026_08_12_feedback-calendar-v1-round-4/`
- Workspace: branch `feat/feedback-calendar-v1-round-4` (base `origin/main`, forked from `feat/feedback-calendar-v1-round-3` @ ff6e9e6)
- Started: 2026-08-12
- Updated: 2026-08-12

## Success

- [x] Every one of the 19 feedback items is implemented — T1..T19 all terminal `done`; the scope reviewer traced each of the 19 `feedback.md` items to shipped code
- [x] `npm run test` green — `110 files / 1026 tests passed` (parent run, post-repair)
- [x] `npm run lint` green — `All files pass linting.`
- [x] `npm run typecheck` green — exit 0 on both tsconfigs
- [x] browser gate green — `npm run e2e:ci` exit 0, 22 specs / 100 tests / 0 failing (bare `npm run cy:run` cannot pass: no seeded auth accounts, default rate limit — `e2e:ci` is the repo's real gate)
- [ ] `dotnet test backend/Gones.sln` green — **not achievable on this host.** Parent run: UnitTests 198/198, ArchitectureTests 17/17, IntegrationTests `Failed: 3, Passed: 395`; all 3 failures are `RootlessKit PortManager.AddPort(): bind: address already in use` at container startup, zero assertion failures, and those same classes pass in a targeted run (`OrganizationApiTests|OrganizationMembershipHealTests|ApiBoundaryTests` 69/69). See Residual risk.
- [x] App functional after each ticket — per-ticket Validation blocks, plus the green `e2e:ci` at the end
- [x] `ai-artifacts/manual_test_checklist.md` current — 61 `## T` sections, T1..T19 of this round present and written against the post-rename routes, data-cy and copy

Baseline before T1 (commit f742982): `npm run test` 938 pass / 105 files, `npm run lint` clean, `npm run typecheck` clean.

## Out of scope

- Event-as-container-of-many-tournaments model
- Server-side paginated user search
- Cancellation/notification flows for events of deleted orgs
- Renaming `TournamentFormat`, `leagues-archive`, `live-tournaments`
- Any change to the `/api/tournaments` ↔ archive domain boundary

## Status

| ID | Title | File | State | Evidence | Note |
| --- | --- | --- | --- | --- | --- |
| T1 | Session-ready auth guards | `T1_session-ready-auth-guards.md` | done | `413dfbd`; vitest src/app/auth 127 pass, full suite 940 pass, lint+typecheck clean, cypress auth-route-guards 3 passing | ship terminal locally-verified; repro passed pre-fix (recorded in commit body), kept as regression |
| T2 | Calendar past-day styling | `T2_calendar-past-day-styling.md` | done | `00783cb` + repair `01eb9c8`; accessibility.cy.js 11 passing / 0 failing, public-calendar 9 passing, suite 959 pass | opacity .5 broke the AA contrast gate → repaired with cell-paint-only tokens; `today` read once at construction |
| T3 | List card click, hover, local time | `T3_list-card-click-hover-time.md` | done | `3992fa4`; suite 959 pass, lint+typecheck clean, public-calendar 9 passing incl. card-click vs ICS-click browser proof | also guards Enter/Space on the ICS button; found the T2 a11y regression |
| T4 | Search match highlighting | `T4_search-match-highlighting.md` | done | `69f8b15`; suite 969 pass, lint+typecheck clean, a11y 11 passing, public-calendar 10 passing, XSS query renders as literal text | highlight helpers extracted to `src/app/shared/search-highlight.ts`, shared with player detail |
| T5 | Month navigation scroll anchor | `T5_month-navigation-scroll-anchor.md` | done | `6ff895f`; suite 973 pass, lint+typecheck clean, public-calendar 12/12 with red-then-green browser scrollY proof, a11y 11/11 | plan defect escalated: ticket mechanism alone lost the race with RouterScroller — parent chose option A, added per-navigation `scroll: 'manual'` |
| T6 | Event detail hero reflow | `T6_detail-hero-reflow.md` | done | `56fc7d4`; suite 980 pass, lint+typecheck clean, a11y 11/11 incl. 375px, browser-read title text + bounding boxes | dead `.event-facts` CSS left in place (T8 touches same page) |
| T7 | Venue maps link | `T7_venue-maps-link.md` | done | `fc7d38d`; suite 986 pass, lint+typecheck clean, public-calendar 12/12, a11y 11/11; encoding proof on `1 "Bar" & Grill, Lyon` | fixed host + `encodeURIComponent`, `rel="noopener noreferrer"` browser-asserted |
| T8 | Registration action row + dialog | `T8_registration-action-row-and-dialog.md` | done | `9d09c49`; suite 995 pass, lint+typecheck clean, tournament-registration 6/6, a11y 11/11; dblclick → 1 POST, 500 → no success dialog, Esc returns focus | green uses `--create-green-hot` (5.65:1); `--create-green` on forge is 4.04:1 pre-existing debt |
| T9 | Generated DEMO_ACCOUNTS.md | `T9_demo-accounts-doc.md` | done | `126b47b`; suite 1000 pass, lint+typecheck clean; drift gate proved red on a mutated fixture, green after revert; generator idempotent (same sha256 twice) | only in-repo `DEV_PASSWORD` documented, no DB or `.env` read |
| T10 | Org membership read model | `T10_org-membership-read-model.md` | done | `3bbf064`; OrganizationApiTests 7/7 (red 2 first), live authz anon 401 / User 403 / Organizer 403 / admin 200 / unknown 404, exact key set, single-SQL no-N+1 from pg log; suite 1000 pass, lint/typecheck/api:check clean, admin-orgs 4/4 | `npm run backend:test` box left UNCHECKED — host Testcontainers flake, see residual risk |
| T11 | Derived Organizer role + draft orgs | `T11_derived-organizer-role-and-draft-orgs.md` | done | `bde7b3a`; live sequence: add → Organizer + stale token 401 immediately, remove → User, Admin immune both ways, draft publish 409 → 201 after staffing; IntegrationTests 368 pass / 6 host-flake, Unit 198/198, Architecture 17/17 + repair `8088b16` (sync on create / transfer / account-closure, one global lock order org→members→users, deadlock mapped to 409; live deadlock reproduced before and gone after) | demotion bites on the next request (security stamp + role claim revalidated), not at refresh |
| T12 | Membership heal migration | `T12_membership-heal-migration.md` | done | `7114ba1`; heal tests 8/8 (red 3 first), live before/after on seeded violations, idempotent on replay + second migrator run, `smoke-migration.mjs` exit 0, suite 1000 pass | not reversible — empty `Down`, operator recovers from backup; heal is demote-only |
| T13 | Admin organization workbench | `T13_admin-organization-workbench.md` | done | `0ca443b`; suite 1007 pass, lint+typecheck clean, admin-orgs 5/5, a11y 11/11; live create → add → remove → empty roster shows `isDraft true` | picker renders up to 500 options unvirtualised (server-side search deferred by the plan) |
| T14 | Admin all-organizations picker | `T14_admin-all-organizations-picker.md` | done | `ce06927`; suite 1012 pass, lint/typecheck/api:check clean, organizer-tournament-create 8/8, admin-orgs 5/5, a11y 11/11; live: organizer cross-org create 404, admin 201, admin publish of a Draft org still 409 | no `backend/src` change needed — the widening was already server-side, now pinned by test |
| T15 | Backend Event entity rename | `T15_backend-event-entity-rename.md` | done | `c763f8d` + `1275a56`; all 37 tables row-count-identical, `scheduled_tournaments` 13 → `events` 13, up→down→up md5-identical row dumps, 57/57 constraints, 146/146 `gones_app` grants, `gones_app` write proof; 21 integration classes + 198 unit + 17 arch green, suite 1012 pass | `Down` implemented and proven; bundle/report wire shape deliberately unchanged |
| T16 | Backend Event API rename | `T16_backend-event-api-rename.md` | done | `507b9b2`; every old `/api/tournaments*` path 404s, new `/api/events*` serves incl. `.ics`; authz re-proven 401/403/200/201 across preview, publish, organizer, admin, registration; api:generate+api:check exit 0, suite 1012 pass, 11 targeted backend suites green | HEAD intentionally red on `npm run typecheck` (151 errors, all in `src/app/features/calendar/**`) until T17 rewires the frontend — hard break, no aliases |
| T17 | Frontend Event symbol rename | `T17_frontend-event-symbol-rename.md` | done | `a702221` + `74daaaf`; typecheck back to exit 0 (was 151 errors), suite 1012 pass, lint clean, `npm run build` complete, 9 Cypress specs 54/54 incl. a11y 11/11; `grep api/tournaments src` empty | 62 files, 28 `git mv`; CSS class names and i18n keys deliberately untouched (T18 owns the copy) |
| T18 | Event routes + breadcrumbs | `T18_event-routes-and-breadcrumbs.md` | done | `4e3cda7` + `a8ec503`; suite 1022 pass, lint/typecheck/build clean, 10 Cypress specs green incl. a11y 11/11, redirects + cold deep link + encoded slug proven, breadcrumb reads Create Event in en and fr | `npm run cy:run` 96/100 — 4 auth-spec failures reproduced on a stashed pre-T18 tree, see residual risk |
| T19 | Docs, ADR and matrix sweep | `T19_docs-adr-and-matrix-sweep.md` | done | `762e00e` + `cd4e84d`; suite 1022 pass, lint+typecheck clean, `npm run acceptance:matrix` 103/103 proved (was 99), matrix red-step proved by breaking a target then restoring | ADRs 0033/0034/0035 → Accepted; three doc claims were false and were corrected to match shipped code |

States: pending|running|done|failed|blocked_user|blocked_dep|skipped

## Assumptions

- Plan-index assumptions (grill answers binding, draft org = zero members, hard API break at `/api/events/*`, past day = venue date strictly before today) are in force.
- Working tree at session start carried uncommitted round-3 auth repairs plus a wholesale deletion of `ai-artifacts/`. Isolated as two commits on the new branch: `e57a6d5` (plan artifacts, prunes superseded round-1..3 plans) and `f742982` (round-3 auth repairs). `ai-artifacts/README.md` and `ai-artifacts/manual_test_checklist.md` were restored — the checklist is cumulative QA state, not a superseded plan.
- Artifact directory is `ai-artifacts/` (repo convention per AGENT.md), not the skill's default `ai_artefacts/`.
- Branch is `feat/{slug}` per repo history, not `plan/{slug}`.
- Harness cannot set per-child model/effort here, so every worker carries an explicit `Tier:` line in its prompt.
- Cypress on this NixOS host needs the `LD_LIBRARY_PATH` computed by `scripts/full-stack-ci.mjs` (nix eval); bare `npx cypress run` exits 127 silently. Every worker running specs is told this.
- New Cypress specs must be wired into `scripts/full-stack-ci.mjs` or `ops/e2e-spec-coverage.test.ts` fails `npm run test`.

## Residual risk

- `npm run backend:test` (full solution) cannot go green on this host. Every failure is `RootlessKit PortManager.AddPort(): listen tcp4 0.0.0.0:3xxxx: bind: address already in use` at Testcontainers startup, never an assertion, and it hits random classes each run. Clean-tree control with all round-4 changes stashed: 6 failed / 366 passed, same error. Cause: `net.ipv4.ip_local_port_range = 32768 60999` overlaps rootless docker's published-port range; `xUnit.MaxParallelThreads=1` does not help. Recorded in the T10 ticket under `## Known environment defect`. Next human action: widen/shift `net.ipv4.ip_local_port_range`, or run `npm run backend:test` on a host without that overlap, and confirm 0 failures. Backend tickets in this run therefore gate on targeted `dotnet test --filter` runs plus `dotnet build`.

## Final review (fresh-context fanout, one dimension each)

| Dimension | Verdict | Acted on |
| --- | --- | --- |
| Correctness | 1 major, 5 minor, no blocker | major (archive/restore role drift) + 4 minors fixed in `2faa691` |
| Security / authz | 1 blocker, 1 should-fix, 3 notes | blocker (org Owner could mint global Organizer) and should-fix both closed in `2faa691` |
| Scope drift / plan fidelity | no blocker; all 19 items traced, all 5 out-of-scope items held | 3 of 4 minors fixed in `2faa691` |
| Tests / evidence | 2 major, 5 minor, no blocker | both majors (unpinned `whenSessionReady`, unpinned archive/restore derivation) fixed in `2faa691`, plus the alias-404 and SQL-idempotency gaps |

Blocker detail, for the record: making `global_role` derive from membership meant any organization Owner — not just an Admin — could create a membership and thereby mint a global `Organizer`, a role that also gates non-org-scoped surfaces (`DELETE /api/leagues-archive/{id}`, live commands, player-name maintenance). Closed by making only the two membership-*minting* endpoints admin-only (`POST /members`, `POST /transfer-ownership`, 403); remove and role-change stay Owner-callable because neither grants privilege. The owner-facing UI hides the controls it can no longer use.

## Log

- 2026-08-12 pre-flight: branch `feat/feedback-calendar-v1-round-4` created and pushed; baseline test/lint/typecheck green.
- 2026-08-12 T11 done — `bde7b3a` pushed. Publish gate sits in `PublishTournamentAsync` (not `NormalizeAsync`, which also serves preview/proposal validation), below idempotency replay and inside the transaction. Sole Owner may leave only as the last member.
- 2026-08-12 final gate — `npm run e2e:ci` exit 0, 22 specs / 100 tests / 0 failing. It fails first with one locale-dependent assertion: on the release build the service worker serves later navigations from Cache Storage, so Cypress' `onBeforeLoad` language seed never runs after the first page and the app boots `fr`. Fixed in `7cec810` by re-seeding and raising the `storage` event the app already listens for; two sibling specs had the same latent defect. Note: `e2e:ci` ends with `docker compose down -v`, so the local dev database was removed — reseed with `npm run dev -- --env=minimal` (or `--env=demo`) before manual QA.
- 2026-08-12 review repair done — `2faa691` pushed. Worker disproved the parent's premise that only admin screens call the membership endpoints (`/organizations/:id` has no `canActivate` and organizers are linked into it), so the parent narrowed the fix to the two minting endpoints.
- 2026-08-12 T19 done — `762e00e` + `cd4e84d` pushed. Docs-only. Found a real T15 fallout outside its ticket: `scripts/smoke-full-stack.mjs:56` `expectedMigrations` never got `20260812164333_RenameCalendarTournamentToEvent`, so `npm run smoke:full-stack` and `release-preflight.mjs:324` fail — repair worker spawned. Also disproved the earlier `MigrationImportService` residual: that service only reads memberships; all four `.Add` sites sync.
- 2026-08-12 T18 done — `4e3cda7` + `a8ec503` pushed. `/events/:slug` + `/events/new` canonical, old paths redirect with `pathMatch: 'full'`; 115 i18n values retitled across both catalogs. Whole-suite `npm run cy:run` shows 4 failures in `auth-profile` (×3) and `auth-session-persistence` (×1), all timing out in `login()` — reproduced on the stashed pre-T18 tree, so pre-existing; parent to retest after seeding dev accounts.
- 2026-08-12 T17 done — `a702221` + `74daaaf` pushed. data-cy contract moved `tournament-*` → `event-*` inside the calendar feature only; `tournament-archive-*`, `live-tournament-*`, `match-tournament` and `admin-nav-deleted-tournaments` untouched. Cache key VALUE `gones.calendar-v1.all-tournaments` kept, only the constant renamed.
- 2026-08-12 T16 done — `507b9b2` pushed. Endpoints moved to `Gones.Api/Events/`; `/api/organizer/events`, `/api/admin/events/*`, `/api/event-proposals*`, `{eventId}` route params. Account-deletion relation labels (ADR 0025) deliberately NOT renamed — T16's ticket does not ask for it; flagged for a T19 decision.
- 2026-08-12 T15 done — `c763f8d` + `1275a56` pushed. `dotnet ef migrations add` needs `--startup-project backend/src/Gones.Infrastructure` (Api has no EF Design ref). Sweep over-reach caught inline and reverted twice: `NotificationTemplateKeys.TournamentProposal` and the `MigrationPlan.ScheduledTournaments` bundle keys. Parent moved the worker's 232K of dev-DB dumps out of `ai-artifacts/T15-evidence/` into `.tmp/t15-evidence/`.
- 2026-08-12 T14 done — `ce06927` pushed. Picker lists every non-draft live org for admins; `GET /api/admin/organizations` is 403 for organizers and 401 anonymous, so the picker source is not enumerable. Dev-DB residue left on purpose: event `t14-cross-org-1786551794` and a member-less `T14 Draft Club`.
- 2026-08-12 T13 done — `0ca443b` pushed. Two-pane workbench: left list selects, right pane edits roster + delete/restore. Destructive remove and delete confirm; server refusal codes render as readable text via `admin.actionFailedCode`.
- 2026-08-12 T12 done — `7114ba1` pushed. Migration `20260812154508_HealOrganizationMembershipInvariants` archives member-less orgs and demotes membership-less Organizers, with audit rows and a rotated security stamp; takes `SHARE ROW EXCLUSIVE` in the declared lock order so audit and change cannot diverge. Worker disclosed one `git push --force-with-lease` after amending its own commit — sole author on the topic branch, remote now matches local at `7114ba1`, no history lost. Policy reminder issued in the T13 prompt: append a second commit instead.
- 2026-08-12 T11 repair done — `8088b16` pushed. Lock order is now `organizations` → `organization_members` → `asp_net_users`, ascending id within a table; only `AdminAccountService.CloseAsync` had to move. Residual: `MigrationImportService` still writes memberships without syncing.
- 2026-08-12 T11 gap found: `CreateAsync`, `TransferOwnershipAsync` and `AdminAccountService` closure all write memberships WITHOUT calling `SyncAfterMembershipChangeAsync` — they would mint fresh violations right after T12 heals the legacy ones. Plus a lock-order asymmetry (org→user here, user→org in `AdminAccountService.cs:76`) that can deadlock into a 500. Repair worker spawned before T12.
- 2026-08-12 T10 done — `3bbf064` pushed. `GET /api/admin/organizations/{id}/members` plus `memberCount`/`isDraft`; roster URL added to the service-worker private-URL list so identity data can never be SW-cached. Ticket's `npm run generate:api` is really `npm run api:generate`.
- 2026-08-12 T9 done — `126b47b` pushed. `scripts/generate-demo-accounts-doc.mjs` + `npm run docs:demo-accounts` + `ops/demo-accounts-doc.test.ts` drift gate; unknown role now throws instead of emitting a blank cell.
- 2026-08-12 T8 done — `9d09c49` pushed. Register sits beside add-to-calendar in a persistent action row (kept ICS visible for signed-out visitors); success dialog links to my registrations.
- 2026-08-12 T7 done — `fc7d38d` pushed. `venueMapsUrl` helper; location renders as anchor with pin icon, falls back to a span when there is no venue.
- 2026-08-12 T6 done — `56fc7d4` pushed. Title row `[Legacy] Lyon Legacy (32)`, single date+location row, website bottom-right. jsdom DOM-render tests are not viable in this repo (JIT, no AOT vite plugin → NG0303/NG0950 on `setInput`) — rendered-geometry claims live in Cypress instead.
- 2026-08-12 T5 done — `6ff895f` pushed. Supervisor decision A: keep capture/restore + `gridMinHeight` pin (stops browser clamping on shorter months) AND add `scroll: 'manual'` to the month-nav extras; `withInMemoryScrolling` in `src/main.ts` untouched.
- 2026-08-12 T4 done — `69f8b15` pushed. Highlight contrast 6.76:1 / 7.55:1; no `innerHTML`, injection proof in the browser spec.
- 2026-08-12 T2 repair done — `01eb9c8` pushed. Blanket `opacity` replaced by cell-background tint + `--steel` day number; measured 5.49-5.62:1, chips untouched; vitest guard forbids `opacity` in `.public-month-day--past`.
- 2026-08-12 T3 done — `3992fa4` pushed. Card is `role="link"`, ICS button stops click + Enter/Space. Reported that T2 had turned `accessibility.cy.js` red (2 color-contrast failures) → parent reproduced it and spawned the T2 repair worker.
- 2026-08-12 T2 done — `00783cb` pushed. `isPastCalendarDay` helper + `data-cy="calendar-month-day-past"` variant; existing selectors anchored on the old static data-cy repaired.
- 2026-08-12 T1 done — `413dfbd` pushed. `whenSessionReady()` via `bootstrapFlight`; four guards async. Tests landed in existing `src/app/auth/auth-guards.test.ts` (acceptance-matrix pins that path) instead of the ticket's `auth.guards.test.ts`.
