using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Follow-up to <c>HealOrganizationMembershipInvariants</c>, which demoted only accounts with no
    /// membership row at all (<c>id NOT IN (SELECT user_id FROM organization_members)</c>). The
    /// runtime rule counts memberships in <b>live</b> organizations only, so a legacy Organizer whose
    /// sole membership sits in an already-archived organization is a violation the first heal walked
    /// past. That first migration is already applied, so it is not edited in place; this one heals the
    /// remaining case with the same audit trail and the same discipline.
    ///
    /// <para>The predicate here is a superset of the first one — "no membership in any live
    /// organization" covers "no membership at all" — so re-running the pair in either order lands on
    /// the same state, and on an already-healed database this selects nothing.</para>
    ///
    /// <para><b>Demote only, never <c>Admin</c>.</b> Same as the first heal: no role is granted, no
    /// membership is invented, and <c>Admin</c> is outside the derivation in both directions. There is
    /// no schema change, and no organization is archived here — the first heal already returned
    /// member-less organizations to Draft, and archiving one for a *demoted* account would be a second
    /// unrelated projection.</para>
    ///
    /// <para><b>Why the table locks.</b> Unchanged from the first heal: the audit row and the row it
    /// describes come from two statements sharing one predicate, so the three tables are locked
    /// against writers up front, in the global lock order <c>organizations</c> →
    /// <c>organization_members</c> → <c>asp_net_users</c>. Readers are unaffected; if a long
    /// transaction holds the tables, the migration times out and rolls back without applying anything.</para>
    ///
    /// <para><b>Not reversible, which is why <c>Down</c> is empty.</b> A demoted account is
    /// indistinguishable from one that never held the role. Nothing is deleted: a demotion is undone by
    /// granting the account a membership in a live organization, which re-derives <c>Organizer</c>.</para>
    /// </summary>
    public partial class HealOrganizerRolesWithoutLiveMembership : Migration
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
                SELECT gen_random_uuid(), 1, NULL, 'organization.healed.demoted', 'user', subject.id::text,
                       '{"before":"Organizer","after":"User","reason":"no_live_membership"}'::jsonb, now()
                FROM asp_net_users AS subject
                WHERE subject.global_role = 'Organizer'
                  AND NOT EXISTS (
                      SELECT 1
                      FROM organization_members AS member
                      JOIN organizations AS organization ON organization.id = member.organization_id
                      WHERE member.user_id = subject.id
                        AND organization.deleted_at IS NULL);
                """);

            // The rotated security stamp is what makes the demotion bite on the subject's next
            // request rather than at their next token refresh.
            migrationBuilder.Sql("""
                UPDATE asp_net_users AS subject
                SET global_role = 'User', security_stamp = gen_random_uuid()::text
                WHERE subject.global_role = 'Organizer'
                  AND NOT EXISTS (
                      SELECT 1
                      FROM organization_members AS member
                      JOIN organizations AS organization ON organization.id = member.organization_id
                      WHERE member.user_id = subject.id
                        AND organization.deleted_at IS NULL);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Deliberately empty: see the summary above. The heal cannot be undone row by row, because
            // after it runs a healed row is indistinguishable from one that was always in that state.
        }
    }
}
