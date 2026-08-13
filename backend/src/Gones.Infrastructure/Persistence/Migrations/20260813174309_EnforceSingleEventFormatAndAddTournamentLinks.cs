using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class EnforceSingleEventFormatAndAddTournamentLinks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "archive_tournament_url",
                table: "events",
                type: "character varying(2048)",
                maxLength: 2048,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "live_tournament_url",
                table: "events",
                type: "character varying(2048)",
                maxLength: 2048,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_event_formats_event_id",
                table: "event_formats",
                column: "event_id",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_event_formats_event_id",
                table: "event_formats");

            migrationBuilder.DropColumn(
                name: "archive_tournament_url",
                table: "events");

            migrationBuilder.DropColumn(
                name: "live_tournament_url",
                table: "events");
        }
    }
}
