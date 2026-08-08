using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddTournamentProposals : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "tournament_proposals",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    submitted_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    payload_json = table.Column<string>(type: "jsonb", nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    decided_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    decided_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    rejection_reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_tournament_proposals", x => x.id);
                    table.CheckConstraint("ck_tournament_proposal_decision", "(status = 'Pending' AND decided_at IS NULL AND rejection_reason IS NULL) OR (status <> 'Pending' AND decided_at IS NOT NULL)");
                    table.CheckConstraint("ck_tournament_proposal_expiry", "expires_at > created_at");
                    table.CheckConstraint("ck_tournament_proposal_status", "status IN ('Pending', 'Approved', 'Rejected')");
                    table.CheckConstraint("ck_version_positive", "version > 0");
                    table.ForeignKey(
                        name: "fk_tournament_proposals_asp_net_users_decided_by_user_id",
                        column: x => x.decided_by_user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_tournament_proposals_asp_net_users_submitted_by_user_id",
                        column: x => x.submitted_by_user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "tournament_proposal_recipients",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    proposal_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    token_hash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    sent_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_tournament_proposal_recipients", x => x.id);
                    table.CheckConstraint("ck_tournament_proposal_recipient_token_hash", "token_hash ~ '^[0-9a-f]{64}$'");
                    table.CheckConstraint("ck_version_positive", "version > 0");
                    table.ForeignKey(
                        name: "fk_tournament_proposal_recipients_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_tournament_proposal_recipients_tournament_proposals_proposa~",
                        column: x => x.proposal_id,
                        principalTable: "tournament_proposals",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_tournament_proposal_recipients_proposal_id_user_id",
                table: "tournament_proposal_recipients",
                columns: new[] { "proposal_id", "user_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_tournament_proposal_recipients_token_hash",
                table: "tournament_proposal_recipients",
                column: "token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_tournament_proposal_recipients_user_id",
                table: "tournament_proposal_recipients",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_tournament_proposals_decided_by_user_id",
                table: "tournament_proposals",
                column: "decided_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_tournament_proposals_status_expires_at",
                table: "tournament_proposals",
                columns: new[] { "status", "expires_at" });

            migrationBuilder.CreateIndex(
                name: "ix_tournament_proposals_submitted_by_user_id",
                table: "tournament_proposals",
                column: "submitted_by_user_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "tournament_proposal_recipients");

            migrationBuilder.DropTable(
                name: "tournament_proposals");
        }
    }
}
