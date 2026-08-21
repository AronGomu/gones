using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Adds the ADR 0043 Glicko-2 columns to <c>player_statistics</c>, and indexes the two the rankings
    /// sort by — <c>rating</c> and <c>tournaments_played</c>. The other six are read back with a row that
    /// has already been found, so an index on them would only cost rebuild time.
    ///
    /// <para><b>No backfill here, and the defaults are not the answer.</b> The rating is replayed from the
    /// League documents by C# the migrator cannot call, and the whole table is rewritten by the next
    /// rebuild — which <c>PlayerStatisticsFormula.Version</c> going to 2 in the same commit is what
    /// triggers. The defaults exist only so <c>NOT NULL</c> is legal for rows that already exist between
    /// this migration and that rebuild, so they are the published seed (1500 / 350 / 0.06) rather than a
    /// number anybody should read. They are deliberately database-level only: the model declares no
    /// default, because a rating that silently fell back to a default would be a bug worth a crash.</para>
    /// </summary>
    public partial class AddPlayerRatingColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<double>(
                name: "decayed_rating",
                table: "player_statistics",
                type: "double precision",
                nullable: false,
                defaultValue: 1500.0);

            migrationBuilder.AddColumn<string>(
                name: "last_played_date",
                table: "player_statistics",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "last_rating_delta",
                table: "player_statistics",
                type: "double precision",
                nullable: false,
                defaultValue: 0.0);

            migrationBuilder.AddColumn<double>(
                name: "previous_rating",
                table: "player_statistics",
                type: "double precision",
                nullable: false,
                defaultValue: 1500.0);

            migrationBuilder.AddColumn<double>(
                name: "rating",
                table: "player_statistics",
                type: "double precision",
                nullable: false,
                defaultValue: 1500.0);

            migrationBuilder.AddColumn<double>(
                name: "rating_deviation",
                table: "player_statistics",
                type: "double precision",
                nullable: false,
                defaultValue: 350.0);

            migrationBuilder.AddColumn<double>(
                name: "rating_volatility",
                table: "player_statistics",
                type: "double precision",
                nullable: false,
                defaultValue: 0.06);

            migrationBuilder.AddColumn<int>(
                name: "tournaments_played",
                table: "player_statistics",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateIndex(
                name: "ix_player_statistics_rating",
                table: "player_statistics",
                column: "rating");

            migrationBuilder.CreateIndex(
                name: "ix_player_statistics_tournaments_played",
                table: "player_statistics",
                column: "tournaments_played");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_player_statistics_rating",
                table: "player_statistics");

            migrationBuilder.DropIndex(
                name: "ix_player_statistics_tournaments_played",
                table: "player_statistics");

            migrationBuilder.DropColumn(
                name: "decayed_rating",
                table: "player_statistics");

            migrationBuilder.DropColumn(
                name: "last_played_date",
                table: "player_statistics");

            migrationBuilder.DropColumn(
                name: "last_rating_delta",
                table: "player_statistics");

            migrationBuilder.DropColumn(
                name: "previous_rating",
                table: "player_statistics");

            migrationBuilder.DropColumn(
                name: "rating",
                table: "player_statistics");

            migrationBuilder.DropColumn(
                name: "rating_deviation",
                table: "player_statistics");

            migrationBuilder.DropColumn(
                name: "rating_volatility",
                table: "player_statistics");

            migrationBuilder.DropColumn(
                name: "tournaments_played",
                table: "player_statistics");
        }
    }
}
