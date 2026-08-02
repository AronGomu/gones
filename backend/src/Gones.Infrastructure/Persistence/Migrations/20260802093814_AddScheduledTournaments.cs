using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddScheduledTournaments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "scheduled_tournaments",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organization_id = table.Column<Guid>(type: "uuid", nullable: false),
                    title = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    slug = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    summary = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    body_html = table.Column<string>(type: "character varying(10000)", maxLength: 10000, nullable: true),
                    street_address = table.Column<string>(type: "character varying(240)", maxLength: 240, nullable: false),
                    postal_code = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    city = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    country = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    time_zone_id = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    venue_start_date = table.Column<LocalDate>(type: "date", nullable: false),
                    venue_start_time = table.Column<LocalTime>(type: "time", nullable: false),
                    venue_end_date = table.Column<LocalDate>(type: "date", nullable: false),
                    venue_end_time = table.Column<LocalTime>(type: "time", nullable: false),
                    starts_at_utc = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    ends_at_utc = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    capacity = table.Column<int>(type: "integer", nullable: true),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    deleted_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    deleted_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    deleted_reason = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    normalized_search_text = table.Column<string>(type: "character varying(600)", maxLength: 600, nullable: false),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_scheduled_tournaments", x => x.id);
                    table.CheckConstraint("ck_scheduled_tournament_capacity", "capacity IS NULL OR capacity > 0");
                    table.CheckConstraint("ck_scheduled_tournament_deleted_metadata", "(deleted_at IS NULL AND deleted_by_user_id IS NULL) OR (deleted_at IS NOT NULL AND deleted_by_user_id IS NOT NULL)");
                    table.CheckConstraint("ck_scheduled_tournament_status", "status IN ('Published', 'InProgress', 'Completed', 'Cancelled')");
                    table.CheckConstraint("ck_scheduled_tournament_time_order", "ends_at_utc >= starts_at_utc");
                    table.CheckConstraint("ck_version_positive", "version > 0");
                    table.ForeignKey(
                        name: "fk_scheduled_tournaments_asp_net_users_created_by_user_id",
                        column: x => x.created_by_user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_scheduled_tournaments_asp_net_users_deleted_by_user_id",
                        column: x => x.deleted_by_user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_scheduled_tournaments_organizations_organization_id",
                        column: x => x.organization_id,
                        principalTable: "organizations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "scheduled_tournament_formats",
                columns: table => new
                {
                    scheduled_tournament_id = table.Column<Guid>(type: "uuid", nullable: false),
                    tournament_format_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_scheduled_tournament_formats", x => new { x.scheduled_tournament_id, x.tournament_format_id });
                    table.ForeignKey(
                        name: "fk_scheduled_tournament_formats_scheduled_tournaments_schedule~",
                        column: x => x.scheduled_tournament_id,
                        principalTable: "scheduled_tournaments",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_scheduled_tournament_formats_tournament_formats_tournament_~",
                        column: x => x.tournament_format_id,
                        principalTable: "tournament_formats",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_scheduled_tournament_formats_tournament_format_id",
                table: "scheduled_tournament_formats",
                column: "tournament_format_id");

            migrationBuilder.CreateIndex(
                name: "ix_scheduled_tournaments_city_country",
                table: "scheduled_tournaments",
                columns: new[] { "city", "country" });

            migrationBuilder.CreateIndex(
                name: "ix_scheduled_tournaments_created_by_user_id",
                table: "scheduled_tournaments",
                column: "created_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_scheduled_tournaments_deleted_by_user_id",
                table: "scheduled_tournaments",
                column: "deleted_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_scheduled_tournaments_normalized_search_text",
                table: "scheduled_tournaments",
                column: "normalized_search_text");

            migrationBuilder.CreateIndex(
                name: "ix_scheduled_tournaments_organization_id",
                table: "scheduled_tournaments",
                column: "organization_id");

            migrationBuilder.CreateIndex(
                name: "ix_scheduled_tournaments_organization_id_slug",
                table: "scheduled_tournaments",
                columns: new[] { "organization_id", "slug" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_scheduled_tournaments_starts_at_utc",
                table: "scheduled_tournaments",
                column: "starts_at_utc");

            migrationBuilder.CreateIndex(
                name: "ix_scheduled_tournaments_status",
                table: "scheduled_tournaments",
                column: "status");

            migrationBuilder.CreateIndex(
                name: "ix_scheduled_tournaments_venue_start_date_venue_start_time_id",
                table: "scheduled_tournaments",
                columns: new[] { "venue_start_date", "venue_start_time", "id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "scheduled_tournament_formats");

            migrationBuilder.DropTable(
                name: "scheduled_tournaments");
        }
    }
}
