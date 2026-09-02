using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class UseEventMarkdown : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "body_html",
                table: "events");

            migrationBuilder.AddColumn<string>(
                name: "body_markdown",
                table: "events",
                type: "character varying(20000)",
                maxLength: 20000,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "body_markdown",
                table: "events");

            migrationBuilder.AddColumn<string>(
                name: "body_html",
                table: "events",
                type: "character varying(10000)",
                maxLength: 10000,
                nullable: true);
        }
    }
}
