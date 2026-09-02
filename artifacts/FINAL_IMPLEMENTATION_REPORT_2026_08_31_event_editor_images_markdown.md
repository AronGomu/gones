# Event Editor Images and Markdown — Final Implementation Report

## Ticket State List

- [x] T1 — runtime and provider foundations — PUSHED `ticket/event-editor-T1`; merged into integration at `5f75e44`
- [x] T2 — resolved Event locations — PUSHED `ticket/event-editor-T2`; merged at `da20a33`
- [x] T3 — temporary Event images — PUSHED `ticket/event-editor-T3`; merged with conflict resolution at `893e4ef`
- [x] T4 — Event Markdown and public media — PUSHED `ticket/event-editor-T4`; merged at `cc0a834`
- [x] T5 — direct publish and create editor — PUSHED `ticket/event-editor-T5`; merged at `4e6555a`
- [x] T6 — Event editing media concurrency — pushed `ticket/event-editor-T6`; merged with T7 seam at `ea790d6`
- [x] T7 — proposal image ownership — pushed `ticket/event-editor-T7`; merged with T6 seam at `ea790d6`
- [x] T8 — integrated acceptance — pushed `ticket/event-editor-T8`; merged into integration at `c74cf9d`; final lock review clean

## Assumptions

### A1 — Dirty main preservation

Main worktree contains mixed user changes. Implementation runs on isolated integration branch `plan/event-editor-images-markdown` from `6d36e3c9a40609a1aed0145525ad1370d02da1a1`. Dirty main remains untouched. Final merge waits for safe user-change disposition.

### A2 — Existing region and Event Type work

Reviewed plan-related backend, migration, generated-client, fixture, test, ADR, and vocabulary changes were imported as prerequisite commit `d89fd96`. Mixed unrelated frontend/About/landing/stats/power-user changes were excluded.

### A3 — Worker model routing

Implementation and repair workers used `openai-codex/gpt-5.6-sol` with xhigh thinking for concurrency, authz, media ownership, and release-harness work.

### A4 — Publication boundary

Ticket workers commit locally. Push is outward-facing, so orchestration stops before first push for explicit confirmation per global G3.

## Final State

- Implementation branch: `plan/event-editor-images-markdown` at `c74cf9d` plus final report/typecheck correction commit.
- Ticket branches T1–T8 pushed; integration branch not yet pushed.
- Merge into `main` blocked safely: `/home/aron/projects/gones` has extensive tracked + untracked user changes overlapping implementation paths.
- No stash/reset/overwrite applied to dirty `main`.

## User TODO

- [ ] Preserve/commit/disposition dirty `main` changes. Then merge `plan/event-editor-images-markdown` without history rewriting.

## Evidence Log

- Integration worktree: `/home/aron/projects/gones-worktrees/event-editor-images-markdown`
- Integration branch: `plan/event-editor-images-markdown`
- Prerequisite commit: `d89fd96 feat(events): preserve region and event type prerequisite`
- Prerequisite backend validation: 28 unit + 28 integration tests passed.
- Prerequisite frontend tooling validation: 118 Vitest tests passed.
- First T1 worker failed before edits: `You've hit your weekly limit · resets 9am (Europe/Paris)`.
- Repair T1 worker produced candidate across 33 paths, then timed out after 3,600,000 ms before final report/commit.
- Worker progress evidence: scoped/runtime smoke green; mandatory `npm run typecheck` and `npm run build` fail because prerequisite frontend Event payload builders omit required `region`/`eventType`.
- Prerequisite frontend correction: `93f9f87 fix(events): complete region and event type prerequisite`.
- T1 implementation: `e7e91e3 feat(events): establish private provider boundaries before editor integration`.
- T1 validation: runtime-config 2/2, compose-contract 3/3, filtered backend 35/35, typecheck, lint, build, `docker compose config --quiet` passed.
- Independent review found Time Zone auth blocker plus streamed S3 error-mapping gap; both fixed. Follow-up review: no blocker.
- Residual: no focused S3 mid-stream failure test; no captured real HttpClientFactory/OTel secret-log test; live MinIO bootstrap not independently rerun by parent.
- T2 follow-up review: no blocker/high. Residual medium: `BadRequest` unresolved mapping lacks direct test; `NotFound` path tested.
- T3 follow-up review: no blocker/high. Residual medium: 2-slot processor concurrency + bounded-copy behavior lack direct tests; pixel/animation/resource behavior covered.
- T4 first review blockers fixed in `de9a62c`: proposal derived HTML, release writers, C0 control cleanup, expanded golden corpus, fixture docs.
- T4 follow-up security gap fixed in `93ce9b9`: full XML 1.0 scalar filtering in TS/C#, shared boundary corpus, preview/update/public no-500 tests. Final independent review clean.
- T5 functional/security review blockers fixed in `a83bc93`; backend 57/57, frontend 60/60, Cypress 10/10, typecheck/lint/API gates pass. Acceptance evidence fixed in `9991b93`; acceptance matrix 111/111 capabilities + 25/25 checklist passed; matrix Vitest 7/7 passed.
- T6 final reviewed head `c10fe5c`: coherent media/ETag snapshots, location identity severity, token-expiry UX, missing-image recovery, valid `Instant` OpenAPI schemas.
- T7 final reviewed head `4da8028`: transactional proposal ownership, decision authz locking, expiry races, rollback, private review gallery, stable generated client contracts.
- T6/T7 merge seam `ea790d6`: 96 backend + 96 frontend focused tests, API generation/check, typecheck, lint passed.
- T8 final reviewed head `4e68e98`: real clean-volume API/PostgreSQL/MinIO create/edit/proposal lifecycle, accessibility, 404 continuity, optional content, image ETags, exact release Location, image revision attestation, semantic acceptance evidence.
- T8 release guard final: kernel `flock`, teardown/fresh-volume assertions, setup-failure lock release, final zero-volume assertion; focused 21 tests and rehearsal passed.
- Final merged integration validation: Vitest 173 files / 2,217 tests; backend 343 unit + 729 integration + 20 architecture; focused release-guard 12 tests; typecheck, lint, API drift, acceptance matrix 111/111 + 25/25, `git diff --check` passed.
- Full T8 evidence before merge: Cypress 170/170, E2E 26/26, release rehearsal, image build/verification, residue and secret scans passed.
- Final merge gate found one multiline `@ts-expect-error` placement defect in `ops/release-rehearsal.test.ts`; corrected before final commit.
