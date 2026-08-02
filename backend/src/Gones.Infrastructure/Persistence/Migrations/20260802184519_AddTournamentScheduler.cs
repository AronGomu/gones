using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddTournamentScheduler : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_tournament_lifecycle_events_reminder_plan_action_occurred_at",
                table: "tournament_lifecycle_events");

            migrationBuilder.AddColumn<Instant>(
                name: "reminder_plan_processed_at",
                table: "tournament_lifecycle_events",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "notification_history",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    outbox_id = table.Column<Guid>(type: "uuid", nullable: false),
                    template_key = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    dedupe_key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    tournament_id = table.Column<Guid>(type: "uuid", nullable: true),
                    sent_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_notification_history", x => x.id);
                    table.ForeignKey(
                        name: "fk_notification_history_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_notification_history_notification_outbox_outbox_id",
                        column: x => x.outbox_id,
                        principalTable: "notification_outbox",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_notification_history_scheduled_tournaments_tournament_id",
                        column: x => x.tournament_id,
                        principalTable: "scheduled_tournaments",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "scheduled_notifications",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tournament_id = table.Column<Guid>(type: "uuid", nullable: false),
                    registration_attempt_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    scheduled_at_utc = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    dedupe_key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    outbox_id = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_scheduled_notifications", x => x.id);
                    table.CheckConstraint("ck_scheduled_notification_outbox", "(status = 'Enqueued' AND outbox_id IS NOT NULL) OR (status <> 'Enqueued' AND outbox_id IS NULL)");
                    table.CheckConstraint("ck_scheduled_notification_status", "status IN ('Planned', 'Enqueued', 'Missed', 'Cancelled')");
                    table.CheckConstraint("ck_scheduled_notification_type", "type IN ('Monthly', 'Saturday', 'DayTwo', 'DayOne')");
                    table.ForeignKey(
                        name: "fk_scheduled_notifications_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_scheduled_notifications_notification_outbox_outbox_id",
                        column: x => x.outbox_id,
                        principalTable: "notification_outbox",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_scheduled_notifications_scheduled_tournaments_tournament_id",
                        column: x => x.tournament_id,
                        principalTable: "scheduled_tournaments",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_scheduled_notifications_tournament_registration_attempts_re~",
                        column: x => x.registration_attempt_id,
                        principalTable: "tournament_registration_attempts",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_tournament_lifecycle_events_reminder_plan_action_reminder_p~",
                table: "tournament_lifecycle_events",
                columns: new[] { "reminder_plan_action", "reminder_plan_processed_at", "occurred_at" });

            migrationBuilder.CreateIndex(
                name: "ix_scheduled_tournaments_status_ends_at_utc",
                table: "scheduled_tournaments",
                columns: new[] { "status", "ends_at_utc" });

            migrationBuilder.CreateIndex(
                name: "ix_scheduled_tournaments_status_starts_at_utc",
                table: "scheduled_tournaments",
                columns: new[] { "status", "starts_at_utc" });

            migrationBuilder.CreateIndex(
                name: "ix_notification_history_outbox_id",
                table: "notification_history",
                column: "outbox_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_notification_history_tournament_id_sent_at",
                table: "notification_history",
                columns: new[] { "tournament_id", "sent_at" });

            migrationBuilder.CreateIndex(
                name: "ix_notification_history_user_id_sent_at",
                table: "notification_history",
                columns: new[] { "user_id", "sent_at" });

            migrationBuilder.CreateIndex(
                name: "ix_scheduled_notifications_dedupe_key",
                table: "scheduled_notifications",
                column: "dedupe_key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_scheduled_notifications_outbox_id",
                table: "scheduled_notifications",
                column: "outbox_id");

            migrationBuilder.CreateIndex(
                name: "ix_scheduled_notifications_registration_attempt_id",
                table: "scheduled_notifications",
                column: "registration_attempt_id");

            migrationBuilder.CreateIndex(
                name: "ix_scheduled_notifications_status_scheduled_at_utc_id",
                table: "scheduled_notifications",
                columns: new[] { "status", "scheduled_at_utc", "id" });

            migrationBuilder.CreateIndex(
                name: "ix_scheduled_notifications_tournament_id_registration_attempt_~",
                table: "scheduled_notifications",
                columns: new[] { "tournament_id", "registration_attempt_id", "status" });

            migrationBuilder.CreateIndex(
                name: "ix_scheduled_notifications_user_id",
                table: "scheduled_notifications",
                column: "user_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "notification_history");

            migrationBuilder.DropTable(
                name: "scheduled_notifications");

            migrationBuilder.DropIndex(
                name: "ix_tournament_lifecycle_events_reminder_plan_action_reminder_p~",
                table: "tournament_lifecycle_events");

            migrationBuilder.DropIndex(
                name: "ix_scheduled_tournaments_status_ends_at_utc",
                table: "scheduled_tournaments");

            migrationBuilder.DropIndex(
                name: "ix_scheduled_tournaments_status_starts_at_utc",
                table: "scheduled_tournaments");

            migrationBuilder.DropColumn(
                name: "reminder_plan_processed_at",
                table: "tournament_lifecycle_events");

            migrationBuilder.CreateIndex(
                name: "ix_tournament_lifecycle_events_reminder_plan_action_occurred_at",
                table: "tournament_lifecycle_events",
                columns: new[] { "reminder_plan_action", "occurred_at" });
        }
    }
}
