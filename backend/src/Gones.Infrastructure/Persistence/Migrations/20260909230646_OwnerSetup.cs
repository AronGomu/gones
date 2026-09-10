using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class OwnerSetup : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "owner_setups",
                columns: table => new
                {
                    key = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    enabled = table.Column<bool>(type: "boolean", nullable: false),
                    owner_email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true),
                    environment = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    public_origin = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    token_hash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: true),
                    issued_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    expires_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    completed_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_owner_setups", x => x.key);
                    table.CheckConstraint("ck_owner_setup_singleton", "key = 'owner-setup'");
                });

            // Reference catalogs are allowed; prior identities/domain data never become fresh again.
            migrationBuilder.Sql("""
                INSERT INTO owner_setups (key, enabled)
                SELECT 'owner-setup', NOT (
                    EXISTS (SELECT 1 FROM asp_net_users) OR EXISTS (SELECT 1 FROM user_profiles)
                    OR EXISTS (SELECT 1 FROM account_action_tokens) OR EXISTS (SELECT 1 FROM refresh_sessions)
                    OR EXISTS (SELECT 1 FROM oauth_attempts) OR EXISTS (SELECT 1 FROM system_markers)
                    OR EXISTS (SELECT 1 FROM events) OR EXISTS (SELECT 1 FROM organizations)
                    OR EXISTS (SELECT 1 FROM archive_leagues) OR EXISTS (SELECT 1 FROM archive_league_seasons)
                    OR EXISTS (SELECT 1 FROM archive_tournaments) OR EXISTS (SELECT 1 FROM live_aggregates)
                    OR EXISTS (SELECT 1 FROM audit_records WHERE action IN
                        ('auth.register.succeeded', 'auth.external_identity.registered', 'account.deleted'))
                );
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "owner_setups");
        }
    }
}
