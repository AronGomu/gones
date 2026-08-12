# T12: One-shot membership heal migration

**Plan:** `./ai-artifacts/PLAN_2026_08_12_feedback-calendar-v1-round-4.md`
**Depends:** T11
**Commit outcome:** a single EF migration soft-deletes organizations that have no members and demotes `Organizer` accounts that hold no membership, writing one audit record per change; nothing re-runs on a schedule afterwards.

## Context (self-contained)

- Goal: ship round 4 of `feedback.md`. This block builds the admin organization workbench and the membership rules behind it.
- This slice: legacy data only. T11 made the rules hold for new writes; rows created before it may violate them.
- Out of scope here: any recurring job, the UI, the Event rename. Draft organizations created deliberately AFTER this migration must never be archived by anything.
- Assumptions in force: this heals once, at deploy. Organizations soft-deleted here can be restored by an admin through the existing restore endpoint.

## Requirements

- New migration `backend/src/Gones.Infrastructure/Persistence/Migrations/<timestamp>_HealOrganizationMembershipInvariants.cs`, created with `dotnet ef migrations add HealOrganizationMembershipInvariants --project backend/src/Gones.Infrastructure --startup-project backend/src/Gones.Api`.
- The migration has no schema change; `Up` runs raw SQL only, `Down` is a no-op with an explaining comment (the heal cannot be reversed row by row).
- `Up` SQL, in this order and in one transaction (EF wraps migrations in one by default):
  1. Insert one audit row per affected organization: action `organization.healed.archived`, `entity_type` `organization`, `entity_id` the org id, `redacted_diff` `{"reason":"no_members"}`, `occurred_at` `now()`, `actor_id` NULL.
  2. `UPDATE organizations SET deleted_at = now() WHERE deleted_at IS NULL AND id NOT IN (SELECT organization_id FROM organization_members);`
  3. Insert one audit row per affected user: action `organization.healed.demoted`, `entity_type` `user`, `entity_id` the user id, `redacted_diff` `{"before":"Organizer","after":"User","reason":"no_membership"}`.
  4. `UPDATE asp_net_users SET global_role = 'User', security_stamp = gen_random_uuid()::text WHERE global_role = 'Organizer' AND id NOT IN (SELECT user_id FROM organization_members);`
- Verify the real column names before writing the SQL: `grep -n "ToTable\|HasColumnName" backend/src/Gones.Infrastructure/Persistence/Configurations/*.cs` (or the model snapshot). The names above are the expected snake_case forms — confirm, do not assume.
- Add an integration test that seeds a violating fixture, applies migrations, and asserts the healed state, in `backend/tests/Gones.IntegrationTests/OrganizationMembershipHealTests.cs`.
- Extend `docs/OPERATIONS.md` with a short "Membership heal migration" note: what it changes, that it runs once, and that healed organizations can be restored from `/admin/organizations`.

## Inputs

- `backend/src/Gones.Infrastructure/Persistence/Migrations/20260809122735_RenameLeagueArchiveTables.cs` — the reference for a hand-written migration with a documenting summary comment.
- `backend/src/Gones.Domain/Organizations/Organization.cs` — `DeletedAt`, `IsActive => DeletedAt is null`, restore path.
- `backend/src/Gones.Api/Admin/AdminRoleService.cs` — audit record shape (`ActorId`, `Action`, `EntityType`, `EntityId`, `RedactedDiff`, `OccurredAt`).
- `backend/tests/Gones.IntegrationTests/MigrationImportServiceTests.cs` and `scripts/smoke-migration.mjs` — how migrations are exercised.
- **From Depends:** T11 added `OrganizationMembershipRoleService` and the `organization_is_draft` publish gate; the heal must not fight them — it only touches rows that predate the deploy.

## TDD

1. **Red** — `OrganizationMembershipHealTests` asserting the post-migration state.
2. **Green** — write the migration SQL.
3. **Refactor** — none.

## Test plan

| Test | Input | Expect |
| ---- | ---- | ------ |
| `member-less organizations are soft-deleted` | org with no members, migration applied | `deleted_at` not null |
| `staffed organizations are untouched` | org with 1 member | `deleted_at` null |
| `organizers without membership are demoted` | user `Organizer`, no rows in `organization_members` | `global_role == 'User'` |
| `organizers with membership keep the role` | organizer with 1 membership | `global_role == 'Organizer'` |
| `admins are never demoted` | admin with no membership | `global_role == 'Admin'` |
| `each change writes an audit record` | one org + one user healed | one `organization.healed.archived` and one `organization.healed.demoted` row |
| `re-running migrations changes nothing` | apply twice | second apply is a no-op (migration already recorded) |

## Impl steps

- [ ] 1. Confirm the physical table and column names from the model snapshot.
- [ ] 2. Create `backend/tests/Gones.IntegrationTests/OrganizationMembershipHealTests.cs` with the seven assertions; run `dotnet test --filter OrganizationMembershipHeal` — red.
- [ ] 3. Generate the empty migration with `dotnet ef migrations add HealOrganizationMembershipInvariants …`.
- [ ] 4. Replace the scaffolded body with the four SQL statements and a summary comment explaining the one-shot rule and why `Down` is empty.
- [ ] 5. Run `dotnet test backend/tests/Gones.IntegrationTests` — green.
- [ ] 6. Run `node scripts/smoke-migration.mjs` against the local stack.
- [ ] 7. Add the operations note to `docs/OPERATIONS.md`.

## Outputs

- Files touched: new migration + its designer file, `backend/tests/Gones.IntegrationTests/OrganizationMembershipHealTests.cs` (new), `docs/OPERATIONS.md`.
- Data change: one-shot heal, audited.

## Validation

- [ ] `dotnet test backend/Gones.sln` passes
- [ ] `node scripts/smoke-migration.mjs` passes
- [ ] manual check: seed a member-less org locally, run `npm run dev`, confirm it is soft-deleted and listed under "include deleted" on `/admin/organizations`
- [ ] app functional — restoring a healed organization works
- [ ] commit msg draft: `fix(orgs): heal legacy membership violations once at deploy`
