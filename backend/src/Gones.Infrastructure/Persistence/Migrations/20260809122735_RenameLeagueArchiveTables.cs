using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// T23 / ADR 0022 — renames the archived League table to <c>league_archive_aggregates</c>.
    ///
    /// EF scaffolds a <c>DropTable</c> + <c>CreateTable</c> pair for this change because the model
    /// snapshot still carried the old CLR name at diff time, so it cannot recognise
    /// <c>LeagueAggregate</c> -> <c>LeagueArchiveAggregate</c> as an entity-type rename. Applying
    /// that scaffold would silently drop every archived League. It is hand-corrected here to a pure
    /// rename: the table, its primary key and its five indexes are renamed in place and every row
    /// survives. The <c>ck_league_aggregate_*</c> and <c>ck_version_positive</c> check constraints
    /// keep their names on both sides of the rename, so they need no work.
    /// </summary>
    public partial class RenameLeagueArchiveTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameTable(
                name: "league_aggregates",
                newName: "league_archive_aggregates");

            // MigrationBuilder has no RenamePrimaryKey. In PostgreSQL renaming a primary-key
            // constraint also renames the unique index backing it, which is what the model expects.
            migrationBuilder.Sql(
                "ALTER TABLE league_archive_aggregates RENAME CONSTRAINT pk_league_aggregates TO pk_league_archive_aggregates;");

            migrationBuilder.RenameIndex(
                name: "ix_league_aggregates_deleted_at_updated_at_id",
                newName: "ix_league_archive_aggregates_deleted_at_updated_at_id",
                table: "league_archive_aggregates");

            migrationBuilder.RenameIndex(
                name: "ix_league_aggregates_document_id",
                newName: "ix_league_archive_aggregates_document_id",
                table: "league_archive_aggregates");

            migrationBuilder.RenameIndex(
                name: "ix_league_aggregates_name",
                newName: "ix_league_archive_aggregates_name",
                table: "league_archive_aggregates");

            migrationBuilder.RenameIndex(
                name: "ix_league_aggregates_status",
                newName: "ix_league_archive_aggregates_status",
                table: "league_archive_aggregates");

            migrationBuilder.RenameIndex(
                name: "ix_league_aggregates_version",
                newName: "ix_league_archive_aggregates_version",
                table: "league_archive_aggregates");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Mirror image of Up: the indexes and the primary key are renamed back while the table
            // still carries its new name, then the table itself is renamed last.
            migrationBuilder.RenameIndex(
                name: "ix_league_archive_aggregates_deleted_at_updated_at_id",
                newName: "ix_league_aggregates_deleted_at_updated_at_id",
                table: "league_archive_aggregates");

            migrationBuilder.RenameIndex(
                name: "ix_league_archive_aggregates_document_id",
                newName: "ix_league_aggregates_document_id",
                table: "league_archive_aggregates");

            migrationBuilder.RenameIndex(
                name: "ix_league_archive_aggregates_name",
                newName: "ix_league_aggregates_name",
                table: "league_archive_aggregates");

            migrationBuilder.RenameIndex(
                name: "ix_league_archive_aggregates_status",
                newName: "ix_league_aggregates_status",
                table: "league_archive_aggregates");

            migrationBuilder.RenameIndex(
                name: "ix_league_archive_aggregates_version",
                newName: "ix_league_aggregates_version",
                table: "league_archive_aggregates");

            migrationBuilder.Sql(
                "ALTER TABLE league_archive_aggregates RENAME CONSTRAINT pk_league_archive_aggregates TO pk_league_aggregates;");

            migrationBuilder.RenameTable(
                name: "league_archive_aggregates",
                newName: "league_aggregates");
        }
    }
}
