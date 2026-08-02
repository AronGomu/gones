using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddTournamentLifecycleEvents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "tournament_lifecycle_events",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tournament_id = table.Column<Guid>(type: "uuid", nullable: false),
                    actor_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    event_type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    reminder_plan_action = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    occurred_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_tournament_lifecycle_events", x => x.id);
                    table.CheckConstraint("ck_tournament_lifecycle_event_type", "event_type IN ('MajorDetailsUpdated', 'Cancelled', 'Deleted', 'Restored')");
                    table.CheckConstraint("ck_tournament_lifecycle_reminder_action", "reminder_plan_action IN ('None', 'RecalculateFuture', 'CancelFuture')");
                    table.ForeignKey(
                        name: "fk_tournament_lifecycle_events_asp_net_users_actor_user_id",
                        column: x => x.actor_user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_tournament_lifecycle_events_scheduled_tournaments_tournamen~",
                        column: x => x.tournament_id,
                        principalTable: "scheduled_tournaments",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_tournament_lifecycle_events_actor_user_id",
                table: "tournament_lifecycle_events",
                column: "actor_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_tournament_lifecycle_events_reminder_plan_action_occurred_at",
                table: "tournament_lifecycle_events",
                columns: new[] { "reminder_plan_action", "occurred_at" });

            migrationBuilder.CreateIndex(
                name: "ix_tournament_lifecycle_events_tournament_id_occurred_at",
                table: "tournament_lifecycle_events",
                columns: new[] { "tournament_id", "occurred_at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "tournament_lifecycle_events");
        }
    }
}
