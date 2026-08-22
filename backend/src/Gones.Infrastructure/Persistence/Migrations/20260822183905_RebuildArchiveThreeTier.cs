using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RebuildArchiveThreeTier : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "archive_leagues",
                columns: table => new
                {
                    document_id = table.Column<string>(type: "text", nullable: false),
                    name = table.Column<string>(type: "text", nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    deleted_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_archive_leagues", x => x.document_id);
                    table.CheckConstraint("ck_archive_league_version_positive", "version > 0");
                });

            migrationBuilder.CreateTable(
                name: "archive_league_seasons",
                columns: table => new
                {
                    document_id = table.Column<string>(type: "text", nullable: false),
                    league_id = table.Column<string>(type: "text", nullable: false),
                    name = table.Column<string>(type: "text", nullable: false),
                    status = table.Column<string>(type: "text", nullable: false),
                    updated_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    deleted_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    tournament_count = table.Column<int>(type: "integer", nullable: false),
                    player_count = table.Column<int>(type: "integer", nullable: false),
                    first_tournament_date = table.Column<LocalDate>(type: "date", nullable: true),
                    last_tournament_date = table.Column<LocalDate>(type: "date", nullable: true),
                    counts_version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_archive_league_seasons", x => x.document_id);
                    table.CheckConstraint("ck_archive_league_season_count_dates", "(first_tournament_date IS NULL) = (last_tournament_date IS NULL) AND (first_tournament_date IS NULL OR first_tournament_date <= last_tournament_date)");
                    table.CheckConstraint("ck_archive_league_season_counts_non_negative", "tournament_count >= 0 AND player_count >= 0");
                    table.CheckConstraint("ck_archive_league_season_status", "status IN ('active', 'completed')");
                    table.CheckConstraint("ck_archive_league_season_version_positive", "version > 0");
                    table.ForeignKey(
                        name: "fk_archive_league_seasons_archive_leagues_league_id",
                        column: x => x.league_id,
                        principalTable: "archive_leagues",
                        principalColumn: "document_id");
                });

            migrationBuilder.CreateTable(
                name: "archive_tournaments",
                columns: table => new
                {
                    document_id = table.Column<string>(type: "text", nullable: false),
                    season_id = table.Column<string>(type: "text", nullable: true),
                    name = table.Column<string>(type: "text", nullable: false),
                    tournament_date = table.Column<LocalDate>(type: "date", nullable: false),
                    status = table.Column<string>(type: "text", nullable: false),
                    document = table.Column<string>(type: "jsonb", nullable: false),
                    updated_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    deleted_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    player_count = table.Column<int>(type: "integer", nullable: false),
                    counts_version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_archive_tournaments", x => x.document_id);
                    table.CheckConstraint("ck_archive_tournament_document_metadata", "document ->> 'id' = document_id AND document ->> 'name' = name AND document ->> 'status' = status AND document ->> 'seasonId' IS NOT DISTINCT FROM season_id");
                    table.CheckConstraint("ck_archive_tournament_document_object", "jsonb_typeof(document) = 'object'");
                    table.CheckConstraint("ck_archive_tournament_document_size", "octet_length(document::text) <= 1048576");
                    table.CheckConstraint("ck_archive_tournament_player_count_non_negative", "player_count >= 0");
                    table.CheckConstraint("ck_archive_tournament_status", "status IN ('active', 'completed')");
                    table.CheckConstraint("ck_archive_tournament_version_positive", "version > 0");
                    table.ForeignKey(
                        name: "fk_archive_tournaments_archive_league_seasons_season_id",
                        column: x => x.season_id,
                        principalTable: "archive_league_seasons",
                        principalColumn: "document_id");
                });

            migrationBuilder.CreateIndex(
                name: "ix_archive_league_seasons_deleted_at_updated_at_document_id",
                table: "archive_league_seasons",
                columns: new[] { "deleted_at", "updated_at", "document_id" },
                descending: new[] { false, true, false });

            migrationBuilder.CreateIndex(
                name: "ix_archive_league_seasons_league_id",
                table: "archive_league_seasons",
                column: "league_id");

            migrationBuilder.CreateIndex(
                name: "ix_archive_leagues_deleted_at_updated_at_document_id",
                table: "archive_leagues",
                columns: new[] { "deleted_at", "updated_at", "document_id" },
                descending: new[] { false, true, false });

            migrationBuilder.CreateIndex(
                name: "ix_archive_tournaments_season_id",
                table: "archive_tournaments",
                column: "season_id");

            migrationBuilder.CreateIndex(
                name: "ix_archive_tournaments_tournament_date",
                table: "archive_tournaments",
                column: "tournament_date",
                descending: new bool[0]);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "archive_tournaments");

            migrationBuilder.DropTable(
                name: "archive_league_seasons");

            migrationBuilder.DropTable(
                name: "archive_leagues");
        }
    }
}
