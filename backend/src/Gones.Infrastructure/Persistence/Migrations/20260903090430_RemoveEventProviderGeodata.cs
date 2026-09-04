using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RemoveEventProviderGeodata : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "latitude",
                table: "events");

            migrationBuilder.DropColumn(
                name: "longitude",
                table: "events");

            migrationBuilder.DropColumn(
                name: "provider_place_id",
                table: "events");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new System.NotSupportedException("Dropped Event provider geodata cannot be reconstructed.");
        }
    }
}
