using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddExternalOAuth : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "external_identities",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    provider = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    provider_subject = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    provider_email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true),
                    provider_email_verified = table.Column<bool>(type: "boolean", nullable: false),
                    provider_email_updated_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_external_identities", x => x.id);
                    table.CheckConstraint("ck_version_positive", "version > 0");
                    table.ForeignKey(
                        name: "fk_external_identities_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "oauth_attempts",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    provider = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    purpose = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    state_hash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    correlation_hash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    completion_hash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: true),
                    email_verification_hash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: true),
                    provider_subject = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    provider_email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true),
                    provider_email_verified = table.Column<bool>(type: "boolean", nullable: false),
                    proposed_email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true),
                    proposed_username = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    proposed_first_name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    proposed_last_name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    consumed_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_oauth_attempts", x => x.id);
                    table.CheckConstraint("ck_version_positive", "version > 0");
                    table.ForeignKey(
                        name: "fk_oauth_attempts_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_external_identities_provider_provider_subject",
                table: "external_identities",
                columns: new[] { "provider", "provider_subject" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_external_identities_user_id_provider",
                table: "external_identities",
                columns: new[] { "user_id", "provider" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_oauth_attempts_completion_hash",
                table: "oauth_attempts",
                column: "completion_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_oauth_attempts_email_verification_hash",
                table: "oauth_attempts",
                column: "email_verification_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_oauth_attempts_expires_at",
                table: "oauth_attempts",
                column: "expires_at");

            migrationBuilder.CreateIndex(
                name: "ix_oauth_attempts_state_hash",
                table: "oauth_attempts",
                column: "state_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_oauth_attempts_user_id",
                table: "oauth_attempts",
                column: "user_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "external_identities");

            migrationBuilder.DropTable(
                name: "oauth_attempts");
        }
    }
}
