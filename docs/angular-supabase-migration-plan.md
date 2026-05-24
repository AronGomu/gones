# Angular + Supabase Migration Plan

## Goal

Move Gones from a static Vite multi-page app with browser `localStorage` persistence to a client-side Angular single-page PWA backed by Supabase Auth, PostgreSQL, and Row Level Security.

## Non-goals for the migration

- No custom backend server.
- No Angular SSR.
- No offline tournament-data editing or stale League-data cache.
- No redesign of Round Import semantics.
- No Player entity or Player account model.
- No normalized Tournament/Round/Entry tables for MVP.
- No realtime collaborative editing for MVP.
- No Report Download implementation during the structural migration.

## Architecture decisions

- Angular SPA hosted on Cloudflare Pages.
- Supabase provides Auth, PostgreSQL, and authorization.
- Angular uses standalone components, zoneless change detection, Angular Router, Angular Material, services, and Signals.
- Tournament/domain logic moves to framework-independent TypeScript modules.
- Supabase is the canonical source of truth; local storage is only for non-canonical UI preferences such as last consulted League.
- Gones supports PWA installability for everyone, caching app shell/assets only.

## Roles and access

- Visitors are unauthenticated and can read public data.
- Visitors can perform League Export, Full Data Export, and future Report Download.
- Visitors cannot restore or modify source data.
- Google OAuth is used for Organizer/Admin access.
- Unknown signed-in Google users behave like Visitors.
- Authorized emails are lowercase and stored in Supabase.
- Roles are exactly `organizer` or `admin`.
- Admin Users inherit Organizer permissions.
- Admin Users manage authorized users and cannot remove/downgrade themselves or the last Admin User.
- First Admin User is bootstrapped with setup SQL/seed data, not app code.
- Supabase RLS is the security boundary; Angular only improves UX.

## Routes

- `/` redirects to `/leagues`.
- `/leagues` shows public League collection and Full Data Export.
- `/leagues/:leagueId` shows League detail and League Export.
- `/leagues/:leagueId/tournaments/:tournamentId` shows Tournament detail.
- `/players/:playerName` shows public Player Statistics.
- `/admin/users` is Admin-only authorized-user management.
- `/login` supports Google sign-in and return URL.
- Unknown routes show Not Found.
- Missing/deleted League/Tournament routes show contextual Not Found.

## Data storage

Use one Supabase `leagues` table for MVP:

- `id` UUID primary key.
- `name` text mirror of source data.
- `status` text mirror of source data with values `active` or `completed`.
- `source_data` JSONB containing full versioned League source data.
- `document_version` or equivalent optimistic-concurrency field.
- `created_at`.
- `updated_at`.
- `updated_by_email` visible only to Organizer/Admin paths.

Use a public-safe view such as `public_leagues` for public reads, excluding private operational metadata such as `updated_by_email`.

Use an `authorized_users` table:

- `email` lowercase unique text.
- `role` text check-constrained to `organizer` or `admin`.
- `created_at`.
- `created_by_email`.
- `updated_at`.
- `updated_by_email`.

## Source-data rules

- `source_data` is authoritative; `name` and `status` columns are mirrors updated by app code.
- League statuses are `active` and `completed`; legacy `finished` normalizes to `completed`.
- Completed Leagues block normal tournament source-data edits until reopened as active.
- Derived results, warnings, incomplete/provisional state, start/end dates, and Player Statistics are recalculated client-side from source data.
- Invalid Round Entries are valid source data and can be saved.
- IDs are UUID strings for Leagues, Tournaments, Rounds, and Round Entries.
- Canonical Match source data uses neutral fields: `table`, `player1Name`, `player2Name`, `player1Score`, `player2Score`, `player1DeckArchetype`, and `player2DeckArchetype`.
- `table` is optional source data and does not affect rankings.
- Round Import adapters preserve existing `table,player,result,opponent,player_decklist,opponent_decklist` behavior by converting source rows into canonical Match source data.
- Legacy import headers named `player_decklist` and `opponent_decklist` contain Deck Archetype data, not full Decklists.
- Deck Archetype data must be preserved during import, export, restore, and canonical-shape migration.
- Restore regenerates League and nested IDs when importing alongside existing data.

## Export and restore

- Gones Export means JSON source-data backup only.
- Report Download means future PDF/image presentation output.
- League Export exports one League and is visible on League detail.
- Full Data Export exports all non-deleted public Leagues in one JSON file and is visible on League collection.
- Gones Export includes `kind`, Gones Data Version, Gones App Version, and `exportedAt`.
- League Export uses `kind: "league"`.
- Full Data Export uses `kind: "fullData"` and a `leagues` array.
- Gones Restore rejects unsupported/future Data Versions and wrong-file-type restore flows.
- Unknown extra fields in supported Data Versions are ignored.
- League Restore is Organizer/Admin.
- Full Data Restore is Admin-only.
- Full Data Restore imports alongside existing Leagues; it does not overwrite the active dataset in MVP.

## Editing model

- Public routes are shared between read-only and signed-in users.
- Visitors and unauthorized users do not see source-data modification controls.
- Organizer/Admin users see account/status menu and can enter explicit edit mode.
- Edit mode uses local drafts and explicit Save/Cancel.
- Save uses optimistic concurrency and rejects stale saves with reload-before-saving guidance.
- Failed saves preserve unsaved drafts.
- Unsaved changes show a visible indicator and route-leave warning.
- Exports use saved canonical data; warn if exporting while unsaved changes exist.
- Round Import is edit-mode only and confirms Round Replacement.

## UI direction

- Keep Gones' current dark metal, blood-red, rust, and card-game-inspired color scheme as closely as possible.
- Fully embrace Angular Material for component foundation.
- Material behavior/structure wins when it conflicts with bespoke UI, while Gones theme/brand is preserved through tokens and styling.
- Keep phone-first layouts.
- Ranking displays may use Material tables on larger screens and ranking cards/lists on mobile.
- Keep existing assets: `gones_logo.png`, `fire.png`, and `ice.png`.
- Generate PWA/favicons from `gones_logo.png`.

## Remaining implementation defaults

These defaults resolve remaining edge cases unless implementation reveals a contradiction:

- Supabase public reads go through a public-safe view; direct table writes stay RLS-protected.
- RLS/database triggers should enforce role-management invariants where practical, including unique lowercase emails and last-admin protection.
- Google OAuth should require a verified email for Organizer/Admin role matching; missing/unverified emails receive Visitor-equivalent access.
- OAuth redirects return users to their original route when a return URL is present.
- Stale save message: “This League changed since you opened it. Reload the latest saved data before saving again.”
- League document saves write the whole League JSON document with optimistic concurrency.
- Delete conflicts should fail safely and ask the user to reload.
- Completed Leagues block source-data edits until reopened as active; reopening should be explicit and confirmed when there are unsaved edits.
- Completed Leagues still allow read, League Export, Full Data Export, future Report Download, and destructive delete by Organizer/Admin after confirmation.
- League Restore and Full Data Restore are all-or-nothing per restore action; malformed JSON or validation failure writes nothing.
- Duplicate restored League names use `Name (restored)` and then a numeric suffix if needed.
- Import/restore file-size limits and malformed-file messages should be user-friendly; exact size limit can follow browser/Supabase practical constraints during implementation.
- Use zoneless Angular with Signals/services; do not introduce NgRx.
- Use Angular Material plus Gones theme tokens; Material structure wins when component behavior conflicts with bespoke UI.
- Use Cloudflare Pages build output and environment configuration conventions from the generated Angular app.
- Cypress mocks Angular app services for auth/data; Supabase RLS gets SQL/manual verification instead of E2E automation for MVP.

## Testing and CI

- Use Vitest for domain/unit tests.
- Keep Cypress for browser user flows with Supabase/auth mocked at service boundary for MVP.
- Add GitHub Actions for install, lint, build/typecheck, and Vitest.
- Do not automate full Supabase/RLS E2E in Cypress for MVP.
- Include manual Supabase setup/verification checklist in README once commands/files are real.

Key tests to add:

- Legacy `finished` status normalizes to `completed`.
- Current import rows convert to canonical neutral Match fields without losing Deck Archetype data.
- League and Full Data export/restore contracts.
- Unsupported Data Versions rejected.
- Wrong export kind rejected by restore flow.
- Unknown extra fields ignored for supported Data Versions.
- IDs regenerated on restore.
- Visitor vs Organizer/Admin UI permissions.

## Implementation phases

1. Generate/convert to Angular standalone app with Angular Material, Tailwind/theming as appropriate, Vitest, Cypress, and basic routes.
2. Port pure domain modules and tests to TypeScript.
3. Add Supabase schema migrations, RLS policies, public view, and seed example.
4. Implement public League list/detail/Tournament/Player read flows from Supabase.
5. Add Google OAuth, role detection, account menu, and route/component guards.
6. Implement Organizer edit mode with explicit Save/Cancel and optimistic concurrency.
7. Implement League Export, Full Data Export, League Restore, and Admin-only Full Data Restore.
8. Implement Admin Users page.
9. Add PWA installability and app icons.
10. Replace GitHub Pages workflows with Cloudflare-oriented build/deploy docs and basic CI.
11. Update README with real setup commands and manual Supabase verification checklist.
