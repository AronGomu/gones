using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddLiveAggregates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "live_aggregates",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    document_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    tournament_date = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    stage = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    updated_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    deleted_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    canonical_document = table.Column<string>(type: "jsonb", nullable: false),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_live_aggregates", x => x.id);
                    table.CheckConstraint("ck_live_aggregate_checkpoint_bound", "jsonb_array_length(canonical_document -> 'checkpoints') <= 80");
                    table.CheckConstraint("ck_live_aggregate_document_metadata", "canonical_document ->> 'id' = document_id AND canonical_document ->> 'name' = name AND canonical_document ->> 'tournamentDate' = tournament_date AND canonical_document ->> 'stage' = stage");
                    table.CheckConstraint("ck_live_aggregate_document_object", "jsonb_typeof(canonical_document) = 'object'");
                    table.CheckConstraint("ck_live_aggregate_document_size", "octet_length(canonical_document::text) <= 1048576");
                    table.CheckConstraint("ck_live_aggregate_stage", "stage IN ('registration', 'round', 'standings', 'completed')");
                    table.CheckConstraint("ck_version_positive", "version > 0");
                });

            migrationBuilder.CreateIndex(
                name: "ix_live_aggregates_deleted_at_updated_at_id",
                table: "live_aggregates",
                columns: new[] { "deleted_at", "updated_at", "id" },
                descending: new[] { false, true, false });

            migrationBuilder.CreateIndex(
                name: "ix_live_aggregates_document_id",
                table: "live_aggregates",
                column: "document_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_live_aggregates_name",
                table: "live_aggregates",
                column: "name");

            migrationBuilder.CreateIndex(
                name: "ix_live_aggregates_stage",
                table: "live_aggregates",
                column: "stage");

            migrationBuilder.CreateIndex(
                name: "ix_live_aggregates_tournament_date",
                table: "live_aggregates",
                column: "tournament_date");

            migrationBuilder.CreateIndex(
                name: "ix_live_aggregates_version",
                table: "live_aggregates",
                column: "version");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "live_aggregates");
        }
    }
}
