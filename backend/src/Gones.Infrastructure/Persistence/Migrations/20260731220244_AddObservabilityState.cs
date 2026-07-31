using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddObservabilityState : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "correlation_id",
                table: "notification_outbox",
                type: "character varying(36)",
                maxLength: 36,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "trace_parent",
                table: "notification_outbox",
                type: "character varying(55)",
                maxLength: 55,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "worker_heartbeats",
                columns: table => new
                {
                    worker_id = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    last_seen_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_worker_heartbeats", x => x.worker_id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "worker_heartbeats");

            migrationBuilder.DropColumn(
                name: "correlation_id",
                table: "notification_outbox");

            migrationBuilder.DropColumn(
                name: "trace_parent",
                table: "notification_outbox");
        }
    }
}
