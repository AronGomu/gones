using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class DirectEventPublication : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "consumed_event_preview_tickets");

            migrationBuilder.DropCheckConstraint(
                name: "ck_scheduled_tournament_capacity",
                table: "events");

            migrationBuilder.AlterColumn<string>(
                name: "region",
                table: "events",
                type: "character varying(120)",
                maxLength: 120,
                nullable: false,
                defaultValue: "Unknown",
                oldClrType: typeof(string),
                oldType: "character varying(120)",
                oldMaxLength: 120,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "postal_code",
                table: "events",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "Unknown",
                oldClrType: typeof(string),
                oldType: "character varying(32)",
                oldMaxLength: 32,
                oldNullable: true);

            migrationBuilder.AlterColumn<int>(
                name: "capacity",
                table: "events",
                type: "integer",
                nullable: false,
                defaultValue: int.MaxValue,
                oldClrType: typeof(int),
                oldType: "integer",
                oldNullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "latitude",
                table: "events",
                type: "numeric(9,6)",
                precision: 9,
                scale: 6,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "longitude",
                table: "events",
                type: "numeric(9,6)",
                precision: 9,
                scale: 6,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<string>(
                name: "provider_place_id",
                table: "events",
                type: "character varying(512)",
                maxLength: 512,
                nullable: false,
                defaultValue: "legacy-unresolved");

            migrationBuilder.Sql("ALTER TABLE events ALTER COLUMN region DROP DEFAULT, ALTER COLUMN postal_code DROP DEFAULT, ALTER COLUMN capacity DROP DEFAULT, ALTER COLUMN provider_place_id DROP DEFAULT");

            migrationBuilder.AddCheckConstraint(
                name: "ck_scheduled_tournament_capacity",
                table: "events",
                sql: "capacity > 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_scheduled_tournament_capacity",
                table: "events");

            migrationBuilder.DropColumn(
                name: "latitude",
                table: "events");

            migrationBuilder.DropColumn(
                name: "longitude",
                table: "events");

            migrationBuilder.DropColumn(
                name: "provider_place_id",
                table: "events");

            migrationBuilder.AlterColumn<string>(
                name: "region",
                table: "events",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(120)",
                oldMaxLength: 120);

            migrationBuilder.AlterColumn<string>(
                name: "postal_code",
                table: "events",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(32)",
                oldMaxLength: 32);

            migrationBuilder.AlterColumn<int>(
                name: "capacity",
                table: "events",
                type: "integer",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "integer");

            migrationBuilder.CreateTable(
                name: "consumed_event_preview_tickets",
                columns: table => new
                {
                    ticket_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    expires_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_consumed_event_preview_tickets", x => x.ticket_hash);
                });

            migrationBuilder.AddCheckConstraint(
                name: "ck_scheduled_tournament_capacity",
                table: "events",
                sql: "capacity IS NULL OR capacity > 0");

            migrationBuilder.CreateIndex(
                name: "ix_consumed_event_preview_tickets_expires_at",
                table: "consumed_event_preview_tickets",
                column: "expires_at");
        }
    }
}
