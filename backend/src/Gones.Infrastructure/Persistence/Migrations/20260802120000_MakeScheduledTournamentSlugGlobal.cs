using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class MakeScheduledTournamentSlugGlobal : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_scheduled_tournaments_organization_id_slug",
                table: "scheduled_tournaments");

            migrationBuilder.CreateIndex(
                name: "ix_scheduled_tournaments_slug",
                table: "scheduled_tournaments",
                column: "slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_scheduled_tournaments_organization_id_slug",
                table: "scheduled_tournaments",
                columns: new[] { "organization_id", "slug" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_scheduled_tournaments_organization_id_slug",
                table: "scheduled_tournaments");

            migrationBuilder.DropIndex(
                name: "ix_scheduled_tournaments_slug",
                table: "scheduled_tournaments");

            migrationBuilder.CreateIndex(
                name: "ix_scheduled_tournaments_organization_id_slug",
                table: "scheduled_tournaments",
                columns: new[] { "organization_id", "slug" },
                unique: true);
        }
    }
}
