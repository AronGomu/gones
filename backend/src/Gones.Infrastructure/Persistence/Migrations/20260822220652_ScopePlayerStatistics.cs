using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Re-keys the ADR 0040 read model by scope: <c>player_statistics</c> goes from one row per player to
    /// one row per <c>(scope_kind, scope_id, player_name)</c>, where a scope is the whole archive, one
    /// League, or one LeagueSeason.
    ///
    /// <para>There is no backfill. The two database-level defaults below exist only so <c>NOT NULL</c> is
    /// legal for rows that already exist between this migration and the next rebuild, and the whole table
    /// is rewritten by the rebuild that <c>PlayerStatisticsFormula.Version</c> going to 3 in this same
    /// commit triggers on the next start. They are deliberately database-level only, so the model declares
    /// no default and a row the code writes must always name its own scope.</para>
    /// </summary>
    public partial class ScopePlayerStatistics : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropPrimaryKey(
                name: "pk_player_statistics",
                table: "player_statistics");

            migrationBuilder.AddColumn<string>(
                name: "scope_kind",
                table: "player_statistics",
                type: "text",
                nullable: false,
                defaultValue: "global");

            migrationBuilder.AddColumn<string>(
                name: "scope_id",
                table: "player_statistics",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddPrimaryKey(
                name: "pk_player_statistics",
                table: "player_statistics",
                columns: new[] { "scope_kind", "scope_id", "player_name" });

            migrationBuilder.AddCheckConstraint(
                name: "ck_player_statistics_scope_kind",
                table: "player_statistics",
                sql: "scope_kind IN ('global','league','season')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropPrimaryKey(
                name: "pk_player_statistics",
                table: "player_statistics");

            migrationBuilder.DropCheckConstraint(
                name: "ck_player_statistics_scope_kind",
                table: "player_statistics");

            migrationBuilder.DropColumn(
                name: "scope_kind",
                table: "player_statistics");

            migrationBuilder.DropColumn(
                name: "scope_id",
                table: "player_statistics");

            migrationBuilder.AddPrimaryKey(
                name: "pk_player_statistics",
                table: "player_statistics",
                column: "player_name");
        }
    }
}
