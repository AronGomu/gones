using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddTemporaryEventImages : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "event_image_object_deletions",
                columns: table => new
                {
                    object_key = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    image_id = table.Column<Guid>(type: "uuid", nullable: false),
                    attempts = table.Column<int>(type: "integer", nullable: false),
                    next_attempt_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    last_error = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_event_image_object_deletions", x => x.object_key);
                    table.CheckConstraint("ck_event_image_object_deletions_attempts", "attempts >= 0");
                });

            migrationBuilder.CreateTable(
                name: "event_images",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    uploaded_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    state = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    event_id = table.Column<Guid>(type: "uuid", nullable: true),
                    proposal_id = table.Column<Guid>(type: "uuid", nullable: true),
                    sort_order = table.Column<int>(type: "integer", nullable: true),
                    alt_text = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    width = table.Column<int>(type: "integer", nullable: false),
                    height = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_event_images", x => x.id);
                    table.CheckConstraint("ck_event_images_alt_text", "alt_text IS NULL OR length(alt_text) <= 300");
                    table.CheckConstraint("ck_event_images_dimensions", "width > 0 AND height > 0");
                    table.CheckConstraint("ck_event_images_ownership", "(state='Temporary' AND event_id IS NULL AND proposal_id IS NULL AND sort_order IS NULL AND expires_at IS NOT NULL) OR (state='ProposalOwned' AND event_id IS NULL AND proposal_id IS NOT NULL AND sort_order IS NOT NULL AND expires_at IS NOT NULL) OR (state='EventOwned' AND event_id IS NOT NULL AND proposal_id IS NULL AND sort_order IS NOT NULL AND expires_at IS NULL)");
                    table.CheckConstraint("ck_event_images_state", "state IN ('Temporary','ProposalOwned','EventOwned')");
                    table.ForeignKey(
                        name: "fk_event_images_asp_net_users_uploaded_by_user_id",
                        column: x => x.uploaded_by_user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_event_images_event_proposals_proposal_id",
                        column: x => x.proposal_id,
                        principalTable: "event_proposals",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_event_images_events_event_id",
                        column: x => x.event_id,
                        principalTable: "events",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_event_image_object_deletions_image_id",
                table: "event_image_object_deletions",
                column: "image_id");

            migrationBuilder.CreateIndex(
                name: "ix_event_image_object_deletions_next_attempt_at",
                table: "event_image_object_deletions",
                column: "next_attempt_at");

            migrationBuilder.CreateIndex(
                name: "ix_event_images_event_id_sort_order",
                table: "event_images",
                columns: new[] { "event_id", "sort_order" },
                unique: true,
                filter: "event_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_event_images_proposal_id_sort_order",
                table: "event_images",
                columns: new[] { "proposal_id", "sort_order" },
                unique: true,
                filter: "proposal_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_event_images_state_expires_at",
                table: "event_images",
                columns: new[] { "state", "expires_at" });

            migrationBuilder.CreateIndex(
                name: "ix_event_images_uploaded_by_user_id_state",
                table: "event_images",
                columns: new[] { "uploaded_by_user_id", "state" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "event_image_object_deletions");

            migrationBuilder.DropTable(
                name: "event_images");
        }
    }
}
