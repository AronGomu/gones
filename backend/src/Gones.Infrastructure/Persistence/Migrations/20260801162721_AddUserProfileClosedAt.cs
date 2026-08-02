using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddUserProfileClosedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Instant>(
                name: "closed_at",
                table: "user_profiles",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "closed_at",
                table: "user_profiles");
        }
    }
}
