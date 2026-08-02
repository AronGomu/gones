using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddNotificationDeliveryOperations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_notification_outbox_state",
                table: "notification_outbox");

            migrationBuilder.AddColumn<Instant>(
                name: "delivery_metadata_scrubbed_at",
                table: "notification_outbox",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "delivery_status",
                table: "notification_outbox",
                type: "character varying(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<Instant>(
                name: "last_provider_event_at",
                table: "notification_outbox",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Instant>(
                name: "provider_first_attempt_at",
                table: "notification_outbox",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "provider_message_id",
                table: "notification_outbox",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "notification_delivery_events",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    replay_key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    outbox_id = table.Column<Guid>(type: "uuid", nullable: false),
                    provider_message_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    occurred_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    received_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_notification_delivery_events", x => x.id);
                    table.ForeignKey(
                        name: "fk_notification_delivery_events_notification_outbox_outbox_id",
                        column: x => x.outbox_id,
                        principalTable: "notification_outbox",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_notification_outbox_created_at",
                table: "notification_outbox",
                column: "created_at");

            migrationBuilder.CreateIndex(
                name: "ix_notification_outbox_last_provider_event_at",
                table: "notification_outbox",
                column: "last_provider_event_at");

            migrationBuilder.CreateIndex(
                name: "ix_notification_outbox_provider_message_id",
                table: "notification_outbox",
                column: "provider_message_id");

            migrationBuilder.CreateIndex(
                name: "ix_notification_outbox_status_last_provider_event_at",
                table: "notification_outbox",
                columns: new[] { "status", "last_provider_event_at" });

            migrationBuilder.AddCheckConstraint(
                name: "ck_notification_outbox_state",
                table: "notification_outbox",
                sql: "(status = 'Pending' AND lease_token IS NULL AND lease_expires_at IS NULL AND sent_at IS NULL AND dead_lettered_at IS NULL AND scrubbed_at IS NULL AND recipient IS NOT NULL AND template_model_json IS NOT NULL)\nOR (status = 'Sending' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND sent_at IS NULL AND dead_lettered_at IS NULL AND scrubbed_at IS NULL AND recipient IS NOT NULL AND template_model_json IS NOT NULL)\nOR (status = 'Sent' AND lease_token IS NULL AND lease_expires_at IS NULL AND sent_at IS NOT NULL AND dead_lettered_at IS NULL AND scrubbed_at IS NOT NULL AND recipient IS NULL AND template_model_json IS NULL)\nOR (status = 'Reconciliation' AND lease_token IS NULL AND lease_expires_at IS NULL AND sent_at IS NULL AND dead_lettered_at IS NULL AND scrubbed_at IS NULL AND recipient IS NOT NULL AND template_model_json IS NOT NULL)\nOR (status = 'DeadLetter' AND lease_token IS NULL AND lease_expires_at IS NULL AND sent_at IS NULL AND dead_lettered_at IS NOT NULL AND scrubbed_at IS NOT NULL AND recipient IS NULL AND template_model_json IS NULL)");

            migrationBuilder.CreateIndex(
                name: "ix_notification_delivery_events_outbox_id",
                table: "notification_delivery_events",
                column: "outbox_id");

            migrationBuilder.CreateIndex(
                name: "ix_notification_delivery_events_received_at",
                table: "notification_delivery_events",
                column: "received_at");

            migrationBuilder.CreateIndex(
                name: "ix_notification_delivery_events_replay_key",
                table: "notification_delivery_events",
                column: "replay_key",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "notification_delivery_events");

            migrationBuilder.DropIndex(
                name: "ix_notification_outbox_created_at",
                table: "notification_outbox");

            migrationBuilder.DropIndex(
                name: "ix_notification_outbox_last_provider_event_at",
                table: "notification_outbox");

            migrationBuilder.DropIndex(
                name: "ix_notification_outbox_provider_message_id",
                table: "notification_outbox");

            migrationBuilder.DropIndex(
                name: "ix_notification_outbox_status_last_provider_event_at",
                table: "notification_outbox");

            migrationBuilder.DropCheckConstraint(
                name: "ck_notification_outbox_state",
                table: "notification_outbox");

            migrationBuilder.DropColumn(
                name: "delivery_metadata_scrubbed_at",
                table: "notification_outbox");

            migrationBuilder.DropColumn(
                name: "delivery_status",
                table: "notification_outbox");

            migrationBuilder.DropColumn(
                name: "last_provider_event_at",
                table: "notification_outbox");

            migrationBuilder.DropColumn(
                name: "provider_first_attempt_at",
                table: "notification_outbox");

            migrationBuilder.DropColumn(
                name: "provider_message_id",
                table: "notification_outbox");

            migrationBuilder.AddCheckConstraint(
                name: "ck_notification_outbox_state",
                table: "notification_outbox",
                sql: "(status = 'Pending' AND lease_token IS NULL AND lease_expires_at IS NULL AND sent_at IS NULL AND dead_lettered_at IS NULL AND scrubbed_at IS NULL AND recipient IS NOT NULL AND template_model_json IS NOT NULL)\nOR (status = 'Sending' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND sent_at IS NULL AND dead_lettered_at IS NULL AND scrubbed_at IS NULL AND recipient IS NOT NULL AND template_model_json IS NOT NULL)\nOR (status = 'Sent' AND lease_token IS NULL AND lease_expires_at IS NULL AND sent_at IS NOT NULL AND dead_lettered_at IS NULL AND scrubbed_at IS NOT NULL AND recipient IS NULL AND template_model_json IS NULL)\nOR (status = 'DeadLetter' AND lease_token IS NULL AND lease_expires_at IS NULL AND sent_at IS NULL AND dead_lettered_at IS NOT NULL AND scrubbed_at IS NOT NULL AND recipient IS NULL AND template_model_json IS NULL)");
        }
    }
}
