using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddNotificationOutbox : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "notification_outbox",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    dedupe_key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    template_key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    locale = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    recipient = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: true),
                    template_model_json = table.Column<string>(type: "jsonb", nullable: true),
                    user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    tournament_id = table.Column<Guid>(type: "uuid", nullable: true),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    available_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    lease_token = table.Column<Guid>(type: "uuid", nullable: true),
                    lease_expires_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    last_attempt_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    attempt_count = table.Column<int>(type: "integer", nullable: false),
                    last_error_code = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    sent_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    dead_lettered_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    scrubbed_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_notification_outbox", x => x.id);
                    table.CheckConstraint("ck_notification_outbox_attempt_count", "attempt_count >= 0");
                    table.CheckConstraint("ck_notification_outbox_state", "(status = 'Pending' AND lease_token IS NULL AND lease_expires_at IS NULL AND sent_at IS NULL AND dead_lettered_at IS NULL AND scrubbed_at IS NULL AND recipient IS NOT NULL AND template_model_json IS NOT NULL)\nOR (status = 'Sending' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND sent_at IS NULL AND dead_lettered_at IS NULL AND scrubbed_at IS NULL AND recipient IS NOT NULL AND template_model_json IS NOT NULL)\nOR (status = 'Sent' AND lease_token IS NULL AND lease_expires_at IS NULL AND sent_at IS NOT NULL AND dead_lettered_at IS NULL AND scrubbed_at IS NOT NULL AND recipient IS NULL AND template_model_json IS NULL)\nOR (status = 'DeadLetter' AND lease_token IS NULL AND lease_expires_at IS NULL AND sent_at IS NULL AND dead_lettered_at IS NOT NULL AND scrubbed_at IS NOT NULL AND recipient IS NULL AND template_model_json IS NULL)");
                    table.CheckConstraint("ck_version_positive", "version > 0");
                });

            migrationBuilder.CreateIndex(
                name: "ix_notification_outbox_dedupe_key",
                table: "notification_outbox",
                column: "dedupe_key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_notification_outbox_status_available_at_created_at",
                table: "notification_outbox",
                columns: new[] { "status", "available_at", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_notification_outbox_status_created_at",
                table: "notification_outbox",
                columns: new[] { "status", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_notification_outbox_status_lease_expires_at",
                table: "notification_outbox",
                columns: new[] { "status", "lease_expires_at" });

            migrationBuilder.CreateIndex(
                name: "ix_notification_outbox_tournament_id",
                table: "notification_outbox",
                column: "tournament_id");

            migrationBuilder.CreateIndex(
                name: "ix_notification_outbox_user_id",
                table: "notification_outbox",
                column: "user_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "notification_outbox");
        }
    }
}
