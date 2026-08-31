using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RestrictEventImageOwnerDeletes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_event_images_event_proposals_proposal_id",
                table: "event_images");

            migrationBuilder.DropForeignKey(
                name: "fk_event_images_events_event_id",
                table: "event_images");

            migrationBuilder.AddForeignKey(
                name: "fk_event_images_event_proposals_proposal_id",
                table: "event_images",
                column: "proposal_id",
                principalTable: "event_proposals",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "fk_event_images_events_event_id",
                table: "event_images",
                column: "event_id",
                principalTable: "events",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_event_images_event_proposals_proposal_id",
                table: "event_images");

            migrationBuilder.DropForeignKey(
                name: "fk_event_images_events_event_id",
                table: "event_images");

            migrationBuilder.AddForeignKey(
                name: "fk_event_images_event_proposals_proposal_id",
                table: "event_images",
                column: "proposal_id",
                principalTable: "event_proposals",
                principalColumn: "id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "fk_event_images_events_event_id",
                table: "event_images",
                column: "event_id",
                principalTable: "events",
                principalColumn: "id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
