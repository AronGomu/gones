using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// T12 — a one-shot heal of the two membership invariants against the rows that predate them.
    /// The rules themselves are enforced on every runtime write path (an organization without members
    /// is a Draft, and the global <c>Organizer</c> role is derived from membership), so this migration
    /// exists only to bring legacy rows in line once, at deploy. Nothing re-runs it on a schedule, and
    /// a Draft organization created deliberately after this deploy is never archived by anything.
    ///
    /// <para>There is no schema change. <c>Up</c> is four raw statements behind a lock, ordered so that each audit
    /// row is written from the same predicate as the change it records, and EF runs the whole
    /// migration inside a single transaction — so either every row moves with its audit record, or
    /// none does. Writing the audit rows first also means the archived organizations are still
    /// visible to the SELECT that records them.</para>
    ///
    /// <para><b>Why the table locks.</b> The audit row and the row it describes come from two
    /// statements sharing one predicate, so a membership written by an API instance that is still up
    /// between them would leave an audit record without its change, or a change without its record.
    /// The three tables are therefore locked against writers up front, in the global lock order
    /// <c>organizations</c> → <c>organization_members</c> → <c>asp_net_users</c>, which is the order
    /// every membership transaction already takes. Readers are unaffected. If a long transaction
    /// holds the tables, the migration times out and rolls back without applying anything, which is
    /// the safe failure: re-run the job.</para>
    ///
    /// <para><b>Idempotent.</b> Every statement is guarded by the condition it removes
    /// (<c>deleted_at IS NULL</c>, <c>global_role = 'Organizer'</c>), so a second execution of this SQL
    /// selects nothing, updates nothing and writes no audit row. The migration history table already
    /// makes a second <c>database update</c> a no-op; the guards make the SQL itself safe to replay by
    /// hand.</para>
    ///
    /// <para><b>Not reversible, which is why <c>Down</c> is empty.</b> The heal is a lossy projection:
    /// after it runs, an archived organization is indistinguishable from one an admin archived, and a
    /// demoted account is indistinguishable from one that never held the role. Nothing is deleted, so
    /// no operator recovery is needed for a correct run — an organization archived here is restored
    /// from <c>/admin/organizations</c> like any other, and a demotion is undone by granting the
    /// account a membership, which re-derives <c>Organizer</c>. A wrong run is recovered from the
    /// backup taken before the migration job (docs/OPERATIONS.md §7, §8), never by a down-migration.
    ///
    /// The heal only demotes: it never grants a role and never creates a membership, because a
    /// migration must not hand out a privilege nobody asked for. <c>Admin</c> is outside the
    /// derivation in both directions and is not touched here either.</para>
    /// </summary>
    public partial class HealOrganizationMembershipInvariants : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                LOCK TABLE organizations IN SHARE ROW EXCLUSIVE MODE;
                LOCK TABLE organization_members IN SHARE ROW EXCLUSIVE MODE;
                LOCK TABLE asp_net_users IN SHARE ROW EXCLUSIVE MODE;
                """);

            migrationBuilder.Sql("""
                INSERT INTO audit_records (id, version, actor_id, action, entity_type, entity_id, redacted_diff, occurred_at)
                SELECT gen_random_uuid(), 1, NULL, 'organization.healed.archived', 'organization', id::text,
                       '{"reason":"no_members"}'::jsonb, now()
                FROM organizations
                WHERE deleted_at IS NULL
                  AND id NOT IN (SELECT organization_id FROM organization_members);
                """);

            migrationBuilder.Sql("""
                UPDATE organizations
                SET deleted_at = now()
                WHERE deleted_at IS NULL
                  AND id NOT IN (SELECT organization_id FROM organization_members);
                """);

            migrationBuilder.Sql("""
                INSERT INTO audit_records (id, version, actor_id, action, entity_type, entity_id, redacted_diff, occurred_at)
                SELECT gen_random_uuid(), 1, NULL, 'organization.healed.demoted', 'user', id::text,
                       '{"before":"Organizer","after":"User","reason":"no_membership"}'::jsonb, now()
                FROM asp_net_users
                WHERE global_role = 'Organizer'
                  AND id NOT IN (SELECT user_id FROM organization_members);
                """);

            // The rotated security stamp is what makes the demotion bite on the subject's next
            // request rather than at their next token refresh.
            migrationBuilder.Sql("""
                UPDATE asp_net_users
                SET global_role = 'User', security_stamp = gen_random_uuid()::text
                WHERE global_role = 'Organizer'
                  AND id NOT IN (SELECT user_id FROM organization_members);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Deliberately empty: see the summary above. The heal cannot be undone row by row,
            // because after it runs a healed row is indistinguishable from one that was always in
            // that state. Reverting this migration only removes it from the history table; the data
            // stays healed, which is the safe direction. Recover a wrong run from the pre-migration
            // backup, and undo a single organization from /admin/organizations.
        }
    }
}
