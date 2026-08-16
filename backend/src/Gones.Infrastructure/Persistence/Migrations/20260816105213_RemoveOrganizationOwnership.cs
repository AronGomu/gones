using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// ADR 0041: nobody owns an organization. <c>OrganizationRoles</c> has one role left, so every
    /// stored <c>Owner</c> membership row becomes an <c>Organizer</c> one — the same member, with the
    /// rights every other member already had.
    ///
    /// <para>There is no schema change: the check constraint already allows <c>Organizer</c>, and the
    /// partial unique index that enforced one owner per organization simply stops matching any row.</para>
    ///
    /// <para><b>Idempotent.</b> The predicate is the value being written away from, so a second run
    /// selects nothing.</para>
    ///
    /// <para><b><c>Down</c> is a deliberate no-op.</b> Which member used to be the owner is not
    /// recoverable once the role is rewritten, and inventing one would hand a member a privilege the
    /// domain no longer has. Gones is unreleased and has no production environment (see
    /// <c>AGENT.md</c>), so no real history is lost.</para>
    /// </summary>
    public partial class RemoveOrganizationOwnership : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("UPDATE organization_members SET role = 'Organizer' WHERE role = 'Owner';");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Ownership cannot be reconstructed - see the type summary.
        }
    }
}
