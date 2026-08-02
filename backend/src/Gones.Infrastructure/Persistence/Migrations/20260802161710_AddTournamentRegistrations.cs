using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddTournamentRegistrations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "organization_blocked_users",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organization_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    blocked_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_organization_blocked_users", x => x.id);
                    table.CheckConstraint("ck_organization_block_expiry", "expires_at IS NULL OR expires_at > blocked_at");
                    table.CheckConstraint("ck_version_positive", "version > 0");
                    table.ForeignKey(
                        name: "fk_organization_blocked_users_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_organization_blocked_users_organizations_organization_id",
                        column: x => x.organization_id,
                        principalTable: "organizations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "tournament_registration_attempts",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tournament_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    status = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    registered_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    registered_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    status_changed_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    status_changed_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_tournament_registration_attempts", x => x.id);
                    table.CheckConstraint("ck_tournament_registration_status", "status IN ('Confirmed', 'CancelledByUser', 'CancelledByTournament')");
                    table.CheckConstraint("ck_tournament_registration_status_history", "(status = 'Confirmed' AND status_changed_by_user_id IS NULL AND status_changed_at IS NULL) OR (status <> 'Confirmed' AND status_changed_by_user_id IS NOT NULL AND status_changed_at IS NOT NULL)");
                    table.CheckConstraint("ck_version_positive", "version > 0");
                    table.ForeignKey(
                        name: "fk_tournament_registration_attempts_asp_net_users_registered_by_~",
                        column: x => x.registered_by_user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_tournament_registration_attempts_asp_net_users_status_changed~",
                        column: x => x.status_changed_by_user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_tournament_registration_attempts_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_tournament_registration_attempts_scheduled_tournaments_tour~",
                        column: x => x.tournament_id,
                        principalTable: "scheduled_tournaments",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_organization_blocked_users_active",
                table: "organization_blocked_users",
                columns: new[] { "organization_id", "user_id" },
                unique: true,
                filter: "is_active");

            migrationBuilder.CreateIndex(
                name: "ix_organization_blocked_users_organization_id_user_id_expires_~",
                table: "organization_blocked_users",
                columns: new[] { "organization_id", "user_id", "expires_at" });

            migrationBuilder.CreateIndex(
                name: "ix_organization_blocked_users_user_id",
                table: "organization_blocked_users",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_tournament_registration_attempts_active",
                table: "tournament_registration_attempts",
                columns: new[] { "tournament_id", "user_id" },
                unique: true,
                filter: "status = 'Confirmed'");

            migrationBuilder.CreateIndex(
                name: "ix_tournament_registration_attempts_registered_by_user_id",
                table: "tournament_registration_attempts",
                column: "registered_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_tournament_registration_attempts_status_changed_by_user_id",
                table: "tournament_registration_attempts",
                column: "status_changed_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_tournament_registration_attempts_tournament_id_status",
                table: "tournament_registration_attempts",
                columns: new[] { "tournament_id", "status" });

            migrationBuilder.CreateIndex(
                name: "ix_tournament_registration_attempts_user_id_registered_at_id",
                table: "tournament_registration_attempts",
                columns: new[] { "user_id", "registered_at", "id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "organization_blocked_users");

            migrationBuilder.DropTable(
                name: "tournament_registration_attempts");
        }
    }
}
