using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddLeagueArchiveCatalogCounts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "counts_version",
                table: "league_archive_aggregates",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "player_count",
                table: "league_archive_aggregates",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "tournament_count",
                table: "league_archive_aggregates",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateIndex(
                name: "ix_league_archive_aggregates_counts_version",
                table: "league_archive_aggregates",
                column: "counts_version");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_league_archive_aggregates_counts_version",
                table: "league_archive_aggregates");

            migrationBuilder.DropColumn(
                name: "counts_version",
                table: "league_archive_aggregates");

            migrationBuilder.DropColumn(
                name: "player_count",
                table: "league_archive_aggregates");

            migrationBuilder.DropColumn(
                name: "tournament_count",
                table: "league_archive_aggregates");
        }
    }
}
