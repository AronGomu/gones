using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Creates the ADR 0040 read model: <c>player_statistics</c>, one row per exact Player Name holding
    /// every <c>GlobalPlayerStatistics</c> field, and <c>player_statistics_meta</c>, the single row that
    /// records which formula version filled it and when.
    ///
    /// <para><b>No backfill here.</b> The tables are created empty on purpose: the rows are computed from
    /// League documents by <c>PlayerStatisticsRebuildService</c>, which is C# the migrator cannot call.
    /// An empty <c>player_statistics_meta</c> is exactly the state the startup rebuild treats as a version
    /// mismatch, so the first API start after this migration fills the table.</para>
    ///
    /// <para><b>The indexes are the point.</b> One per sortable rankings column, so ordering by any of them
    /// is an index scan instead of an in-process sort over every player, plus a
    /// <c>text_pattern_ops</c> index on <c>player_name</c> — the primary key's default collation cannot
    /// serve a <c>LIKE 'prefix%'</c> search, and prefix search is what the rankings filter does.</para>
    /// </summary>
    public partial class AddPlayerStatisticsReadModel : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "player_statistics",
                columns: table => new
                {
                    player_name = table.Column<string>(type: "text", nullable: false),
                    played_match_count = table.Column<int>(type: "integer", nullable: false),
                    match_wins = table.Column<int>(type: "integer", nullable: false),
                    match_losses = table.Column<int>(type: "integer", nullable: false),
                    match_draws = table.Column<int>(type: "integer", nullable: false),
                    match_winrate = table.Column<double>(type: "double precision", nullable: true),
                    played_game_count = table.Column<int>(type: "integer", nullable: false),
                    game_wins = table.Column<int>(type: "integer", nullable: false),
                    game_losses = table.Column<int>(type: "integer", nullable: false),
                    game_winrate = table.Column<double>(type: "double precision", nullable: true),
                    nemesis = table.Column<string>(type: "jsonb", nullable: true),
                    rival = table.Column<string>(type: "jsonb", nullable: true),
                    most_played_archetype = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_player_statistics", x => x.player_name);
                });

            migrationBuilder.CreateTable(
                name: "player_statistics_meta",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false),
                    formula_version = table.Column<int>(type: "integer", nullable: false),
                    rebuilt_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_player_statistics_meta", x => x.id);
                    table.CheckConstraint("ck_player_statistics_meta_single_row", "id = 1");
                });

            migrationBuilder.CreateIndex(
                name: "ix_player_statistics_game_losses",
                table: "player_statistics",
                column: "game_losses");

            migrationBuilder.CreateIndex(
                name: "ix_player_statistics_game_winrate",
                table: "player_statistics",
                column: "game_winrate");

            migrationBuilder.CreateIndex(
                name: "ix_player_statistics_game_wins",
                table: "player_statistics",
                column: "game_wins");

            migrationBuilder.CreateIndex(
                name: "ix_player_statistics_match_draws",
                table: "player_statistics",
                column: "match_draws");

            migrationBuilder.CreateIndex(
                name: "ix_player_statistics_match_losses",
                table: "player_statistics",
                column: "match_losses");

            migrationBuilder.CreateIndex(
                name: "ix_player_statistics_match_winrate",
                table: "player_statistics",
                column: "match_winrate");

            migrationBuilder.CreateIndex(
                name: "ix_player_statistics_match_wins",
                table: "player_statistics",
                column: "match_wins");

            migrationBuilder.CreateIndex(
                name: "ix_player_statistics_played_game_count",
                table: "player_statistics",
                column: "played_game_count");

            migrationBuilder.CreateIndex(
                name: "ix_player_statistics_played_match_count",
                table: "player_statistics",
                column: "played_match_count");

            migrationBuilder.CreateIndex(
                name: "ix_player_statistics_player_name_pattern",
                table: "player_statistics",
                column: "player_name")
                .Annotation("Npgsql:IndexOperators", new[] { "text_pattern_ops" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "player_statistics");

            migrationBuilder.DropTable(
                name: "player_statistics_meta");
        }
    }
}
