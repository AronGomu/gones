using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddLeagueAggregates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "league_aggregates",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    document_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    updated_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    deleted_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    canonical_document = table.Column<string>(type: "jsonb", nullable: false),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_league_aggregates", x => x.id);
                    table.CheckConstraint("ck_league_aggregate_document_metadata", "canonical_document ->> 'id' = document_id AND canonical_document ->> 'name' = name AND canonical_document ->> 'status' = status");
                    table.CheckConstraint("ck_league_aggregate_document_object", "jsonb_typeof(canonical_document) = 'object'");
                    table.CheckConstraint("ck_league_aggregate_document_size", "octet_length(canonical_document::text) <= 1048576");
                    table.CheckConstraint("ck_league_aggregate_status", "status IN ('active', 'completed')");
                    table.CheckConstraint("ck_version_positive", "version > 0");
                });

            migrationBuilder.InsertData(
                table: "league_aggregates",
                columns: new[] { "id", "document_id", "name", "status", "updated_at", "deleted_at", "canonical_document", "version" },
                values: new object[]
                {
                    new Guid("00000000-0000-0000-0000-000000000030"),
                    "placeholder-league",
                    "Unassigned Tournaments",
                    "active",
                    Instant.FromUtc(2026, 8, 3, 0, 0),
                    null,
                    "{\"id\":\"placeholder-league\",\"name\":\"Unassigned Tournaments\",\"status\":\"active\",\"tournaments\":[]}",
                    1L
                });

            migrationBuilder.CreateIndex(
                name: "ix_league_aggregates_deleted_at_updated_at_id",
                table: "league_aggregates",
                columns: new[] { "deleted_at", "updated_at", "id" },
                descending: new[] { false, true, false });

            migrationBuilder.CreateIndex(
                name: "ix_league_aggregates_document_id",
                table: "league_aggregates",
                column: "document_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_league_aggregates_name",
                table: "league_aggregates",
                column: "name");

            migrationBuilder.CreateIndex(
                name: "ix_league_aggregates_status",
                table: "league_aggregates",
                column: "status");

            migrationBuilder.CreateIndex(
                name: "ix_league_aggregates_version",
                table: "league_aggregates",
                column: "version");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "league_aggregates");
        }
    }
}
