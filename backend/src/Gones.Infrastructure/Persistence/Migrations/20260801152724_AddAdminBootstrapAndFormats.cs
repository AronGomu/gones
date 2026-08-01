using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAdminBootstrapAndFormats : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "system_markers",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    consumed_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    consumed_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_system_markers", x => x.id);
                    table.CheckConstraint("ck_version_positive", "version > 0");
                });

            migrationBuilder.CreateTable(
                name: "tournament_formats",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    slug = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    sort_order = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    deleted_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_tournament_formats", x => x.id);
                    table.CheckConstraint("ck_tournament_format_sort_order", "sort_order >= 0");
                    table.CheckConstraint("ck_version_positive", "version > 0");
                });

            migrationBuilder.CreateIndex(
                name: "ix_asp_net_users_global_role",
                table: "asp_net_users",
                column: "global_role");

            migrationBuilder.AddCheckConstraint(
                name: "ck_asp_net_users_global_role",
                table: "asp_net_users",
                sql: "global_role IN ('User', 'Organizer', 'Admin')");

            migrationBuilder.CreateIndex(
                name: "ix_system_markers_key",
                table: "system_markers",
                column: "key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_tournament_formats_deleted_at_sort_order_name",
                table: "tournament_formats",
                columns: new[] { "deleted_at", "sort_order", "name" });

            migrationBuilder.CreateIndex(
                name: "ix_tournament_formats_slug",
                table: "tournament_formats",
                column: "slug",
                unique: true);

            migrationBuilder.Sql("""
                INSERT INTO tournament_formats (id, name, slug, sort_order, created_at, updated_at, deleted_at, version)
                VALUES ('00000000-0000-0000-0000-0000000000f1', 'Legacy', 'legacy', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1)
                ON CONFLICT (slug) DO NOTHING;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "system_markers");

            migrationBuilder.DropTable(
                name: "tournament_formats");

            migrationBuilder.DropIndex(
                name: "ix_asp_net_users_global_role",
                table: "asp_net_users");

            migrationBuilder.DropCheckConstraint(
                name: "ck_asp_net_users_global_role",
                table: "asp_net_users");
        }
    }
}
