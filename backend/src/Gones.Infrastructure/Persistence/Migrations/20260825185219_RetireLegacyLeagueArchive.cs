using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RetireLegacyLeagueArchive : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "league_archive_aggregates");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "league_archive_aggregates",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    canonical_document = table.Column<string>(type: "jsonb", nullable: false),
                    counts_version = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    deleted_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    document_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    player_count = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    tournament_count = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    updated_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_league_archive_aggregates", x => x.id);
                    table.CheckConstraint("ck_league_aggregate_document_metadata", "canonical_document ->> 'id' = document_id AND canonical_document ->> 'name' = name AND canonical_document ->> 'status' = status");
                    table.CheckConstraint("ck_league_aggregate_document_object", "jsonb_typeof(canonical_document) = 'object'");
                    table.CheckConstraint("ck_league_aggregate_document_size", "octet_length(canonical_document::text) <= 1048576");
                    table.CheckConstraint("ck_league_aggregate_status", "status IN ('active', 'completed')");
                    table.CheckConstraint("ck_version_positive", "version > 0");
                });

            migrationBuilder.CreateIndex(
                name: "ix_league_archive_aggregates_counts_version",
                table: "league_archive_aggregates",
                column: "counts_version");

            migrationBuilder.CreateIndex(
                name: "ix_league_archive_aggregates_deleted_at_updated_at_id",
                table: "league_archive_aggregates",
                columns: new[] { "deleted_at", "updated_at", "id" },
                descending: new[] { false, true, false });

            migrationBuilder.CreateIndex(
                name: "ix_league_archive_aggregates_document_id",
                table: "league_archive_aggregates",
                column: "document_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_league_archive_aggregates_name",
                table: "league_archive_aggregates",
                column: "name");

            migrationBuilder.CreateIndex(
                name: "ix_league_archive_aggregates_status",
                table: "league_archive_aggregates",
                column: "status");

            migrationBuilder.CreateIndex(
                name: "ix_league_archive_aggregates_version",
                table: "league_archive_aggregates",
                column: "version");
        }
    }
}
