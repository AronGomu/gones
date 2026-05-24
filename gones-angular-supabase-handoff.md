# Gones Angular + Supabase Migration Handoff

## Session state

- Repo: `C:/Users/Natha/coding/gones`
- Current branch: `structural-angular-backend`
- User requested a structural migration to an Angular single-page app with backend persistence/auth.
- We ran a long design/grilling session and captured decisions in repository docs.
- Implementation has **not** started. The last approval prompt returned “Stop here,” so a future agent should not assume implementation approval unless the user explicitly asks to proceed.
- No secrets, API keys, passwords, OAuth client IDs, or personal emails were provided in the conversation.

## Files changed/created in this session

Do not duplicate the full decisions here; read these artifacts directly:

- Domain glossary/terminology updates: `CONTEXT.md`
- Main implementation plan: `docs/angular-supabase-migration-plan.md`
- New ADRs:
  - `docs/adr/0006-use-supabase-for-backend.md`
  - `docs/adr/0007-store-league-source-data-as-json-documents.md`
  - `docs/adr/0008-use-supabase-as-source-of-truth.md`
  - `docs/adr/0009-use-modern-angular-with-signals-and-typescript-domain.md`
  - `docs/adr/0010-use-optimistic-concurrency-for-league-documents.md`
  - `docs/adr/0011-public-read-with-google-oauth-role-allowlist.md`
  - `docs/adr/0012-use-angular-material-for-ui-components.md`
  - `docs/adr/0013-host-angular-spa-on-cloudflare-pages.md`
  - `docs/adr/0014-support-pwa-installability-without-offline-data-editing.md`
  - `docs/adr/0015-use-vitest-cypress-and-basic-ci-for-angular.md`
  - `docs/adr/0016-use-neutral-match-source-shape-with-import-adapters.md`
- Existing ADRs marked superseded/partially superseded:
  - `docs/adr/0002-use-js-files-and-directory-boundaries-for-modules.md`
  - `docs/adr/0003-plain-data-builders-and-jsdoc-types.md`
  - `docs/adr/0004-centralize-browser-storage-access.md`
  - `docs/adr/0005-use-cypress-e2e-for-local-tdd.md`

## High-level agreed direction

Read the plan/ADRs for details. In brief:

- Build a client-side Angular SPA hosted on Cloudflare Pages.
- Use modern standalone Angular, zoneless change detection, Angular Material, Signals/services, Angular Router, PWA installability.
- Use Supabase for PostgreSQL, Auth, and RLS; no custom backend server for MVP.
- Public Visitors can read all public League data and perform League/Full Data Export.
- Google OAuth is only for Organizer/Admin access. Unknown signed-in users behave like Visitors.
- Organizer/Admin roles are stored by lowercase authorized email in Supabase.
- Supabase is canonical source of truth. `localStorage` only for UI preferences like last consulted League.
- Store each League as one JSONB source document with mirrored metadata columns.
- Use optimistic concurrency for League document saves.
- Use explicit edit mode with Save/Cancel, unsaved-change guard, and stale-save handling.
- Keep derived rankings/statistics/warnings client-side in pure TypeScript domain modules.
- Canonical Match source shape becomes neutral (`player1Name`, `player2Name`, scores, deck archetypes, optional table), with import adapters converting current/SpiceRack-style data.
- Deck terminology is **Deck Archetype**, not Decklist; legacy `*_decklist` import headers map to archetype fields.
- Report Download (PDF/image) is explicitly future work, not part of the structural migration.

## Important caution points

- The plan is large and touches auth, permissions, persistence, RLS, imports/exports, concurrency, and UI framework migration. Treat it as production-risk work.
- Do not start implementation until the user explicitly approves proceeding from the plan.
- If implementation begins, read `docs/angular-supabase-migration-plan.md` fully first.
- Preserve existing Round Import behavior through adapters; do not redesign import semantics during migration.
- Preserve deck archetype data during every migration/import/export/restore path.
- Do not expose private operational metadata like `updated_by_email` in public reads/exports.
- RLS is the security boundary; hidden Angular controls are UX only.

## Suggested skills

If the user asks to proceed with implementation:

1. `add-feature` — primary skill for the full Angular + Supabase migration. Use production mode because this touches auth, persistence, migrations, concurrency, imports/exports, PWA, CI, and UI.
2. `add-migration` — when writing Supabase SQL migrations/RLS policies/seed setup.
3. `write-tests` — for TypeScript domain tests, export/restore contracts, import adapter conversion, and status normalization.
4. `add-e2e-test` — for Cypress coverage of Visitor vs Organizer/Admin behavior, using mocked app services as planned.
5. `audit-authz` — review Supabase/RLS authorization model before considering the work complete.
6. `audit-responsive` and/or `polish-ui` — after Angular Material UI parity work, especially ranking tables/cards and edit/admin forms.
7. `check-pr-readiness` — before commit/PR once implementation exists.

If the user asks to only continue planning/reviewing:

- `grill-with-docs` — continue challenging the plan against `CONTEXT.md` and ADRs.
- `sync-docs` — if decisions change and docs must be updated without implementation.

## Recommended next step

Ask the user whether they want to:

- approve and begin implementation from `docs/angular-supabase-migration-plan.md`, or
- continue revising the plan/docs only.

If they approve implementation, first inspect current repo structure and generated Angular migration options before editing. Keep changes phased and verifiable.
