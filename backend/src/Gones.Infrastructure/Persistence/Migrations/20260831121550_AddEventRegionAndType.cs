using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddEventRegionAndType : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "event_type",
                table: "events",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "region",
                table: "events",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_events_country_region_city",
                table: "events",
                columns: new[] { "country", "region", "city" });

            migrationBuilder.CreateIndex(
                name: "ix_events_event_type",
                table: "events",
                column: "event_type");

            migrationBuilder.CreateIndex(
                name: "ix_events_region",
                table: "events",
                column: "region");

            migrationBuilder.AddCheckConstraint(
                name: "ck_event_type",
                table: "events",
                sql: "event_type IS NULL OR event_type IN ('Weekly', 'Monthly', 'Major')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_events_country_region_city",
                table: "events");

            migrationBuilder.DropIndex(
                name: "ix_events_event_type",
                table: "events");

            migrationBuilder.DropIndex(
                name: "ix_events_region",
                table: "events");

            migrationBuilder.DropCheckConstraint(
                name: "ck_event_type",
                table: "events");

            migrationBuilder.DropColumn(
                name: "event_type",
                table: "events");

            migrationBuilder.DropColumn(
                name: "region",
                table: "events");
        }
    }
}
