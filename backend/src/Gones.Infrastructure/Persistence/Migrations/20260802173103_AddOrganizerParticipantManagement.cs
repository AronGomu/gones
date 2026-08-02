using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddOrganizerParticipantManagement : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_tournament_registration_status",
                table: "tournament_registration_attempts");

            migrationBuilder.AddColumn<Guid>(
                name: "blocked_by_user_id",
                table: "organization_blocked_users",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "reason",
                table: "organization_blocked_users",
                type: "character varying(500)",
                maxLength: 500,
                nullable: false,
                defaultValue: "Unspecified");

            migrationBuilder.AddColumn<Instant>(
                name: "unblocked_at",
                table: "organization_blocked_users",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "unblocked_by_user_id",
                table: "organization_blocked_users",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "ck_tournament_registration_status",
                table: "tournament_registration_attempts",
                sql: "status IN ('Confirmed', 'CancelledByUser', 'CancelledByTournament', 'RemovedByOrganizer')");

            migrationBuilder.CreateIndex(
                name: "ix_organization_blocked_users_blocked_by_user_id",
                table: "organization_blocked_users",
                column: "blocked_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_organization_blocked_users_unblocked_by_user_id",
                table: "organization_blocked_users",
                column: "unblocked_by_user_id");

            migrationBuilder.AddCheckConstraint(
                name: "ck_organization_block_inactive_metadata",
                table: "organization_blocked_users",
                sql: "(is_active AND unblocked_by_user_id IS NULL AND unblocked_at IS NULL) OR (NOT is_active AND unblocked_by_user_id IS NOT NULL AND unblocked_at IS NOT NULL)");

            migrationBuilder.AddForeignKey(
                name: "fk_organization_blocked_users_asp_net_users_blocked_by_user_id",
                table: "organization_blocked_users",
                column: "blocked_by_user_id",
                principalTable: "asp_net_users",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "fk_organization_blocked_users_asp_net_users_unblocked_by_user_id",
                table: "organization_blocked_users",
                column: "unblocked_by_user_id",
                principalTable: "asp_net_users",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_organization_blocked_users_asp_net_users_blocked_by_user_id",
                table: "organization_blocked_users");

            migrationBuilder.DropForeignKey(
                name: "fk_organization_blocked_users_asp_net_users_unblocked_by_user_id",
                table: "organization_blocked_users");

            migrationBuilder.DropCheckConstraint(
                name: "ck_tournament_registration_status",
                table: "tournament_registration_attempts");

            migrationBuilder.DropIndex(
                name: "ix_organization_blocked_users_blocked_by_user_id",
                table: "organization_blocked_users");

            migrationBuilder.DropIndex(
                name: "ix_organization_blocked_users_unblocked_by_user_id",
                table: "organization_blocked_users");

            migrationBuilder.DropCheckConstraint(
                name: "ck_organization_block_inactive_metadata",
                table: "organization_blocked_users");

            migrationBuilder.DropColumn(
                name: "blocked_by_user_id",
                table: "organization_blocked_users");

            migrationBuilder.DropColumn(
                name: "reason",
                table: "organization_blocked_users");

            migrationBuilder.DropColumn(
                name: "unblocked_at",
                table: "organization_blocked_users");

            migrationBuilder.DropColumn(
                name: "unblocked_by_user_id",
                table: "organization_blocked_users");

            migrationBuilder.Sql("UPDATE tournament_registration_attempts SET status = 'CancelledByTournament' WHERE status = 'RemovedByOrganizer'");

            migrationBuilder.AddCheckConstraint(
                name: "ck_tournament_registration_status",
                table: "tournament_registration_attempts",
                sql: "status IN ('Confirmed', 'CancelledByUser', 'CancelledByTournament')");
        }
    }
}
