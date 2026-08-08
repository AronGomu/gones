using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class SplitProfileLocationAndBirthDate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_user_profile_birth_year",
                table: "user_profiles");

            migrationBuilder.RenameColumn(
                name: "location",
                table: "user_profiles",
                newName: "location_city");

            migrationBuilder.RenameColumn(
                name: "is_birth_year_public",
                table: "user_profiles",
                newName: "is_birth_date_public");

            migrationBuilder.Sql("UPDATE user_profiles SET location_city = left(location_city, 100) WHERE length(location_city) > 100;");

            migrationBuilder.AlterColumn<string>(
                name: "location_city",
                table: "user_profiles",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(200)",
                oldMaxLength: 200,
                oldNullable: true);

            migrationBuilder.AddColumn<string>(
                name: "location_country",
                table: "user_profiles",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "location_region",
                table: "user_profiles",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<LocalDate>(
                name: "birth_date",
                table: "user_profiles",
                type: "date",
                nullable: true);

            migrationBuilder.Sql("UPDATE user_profiles SET birth_date = make_date(birth_year, 1, 1) WHERE birth_year IS NOT NULL;");

            migrationBuilder.DropColumn(
                name: "birth_year",
                table: "user_profiles");

            migrationBuilder.AddCheckConstraint(
                name: "ck_user_profile_birth_date",
                table: "user_profiles",
                sql: "birth_date IS NULL OR birth_date >= DATE '1900-01-01'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_user_profile_birth_date",
                table: "user_profiles");

            migrationBuilder.AddColumn<int>(
                name: "birth_year",
                table: "user_profiles",
                type: "integer",
                nullable: true);

            migrationBuilder.Sql("UPDATE user_profiles SET birth_year = EXTRACT(YEAR FROM birth_date)::int WHERE birth_date IS NOT NULL;");

            migrationBuilder.DropColumn(
                name: "birth_date",
                table: "user_profiles");

            migrationBuilder.DropColumn(
                name: "location_country",
                table: "user_profiles");

            migrationBuilder.DropColumn(
                name: "location_region",
                table: "user_profiles");

            migrationBuilder.RenameColumn(
                name: "location_city",
                table: "user_profiles",
                newName: "location");

            migrationBuilder.RenameColumn(
                name: "is_birth_date_public",
                table: "user_profiles",
                newName: "is_birth_year_public");

            migrationBuilder.AlterColumn<string>(
                name: "location",
                table: "user_profiles",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(100)",
                oldMaxLength: 100,
                oldNullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "ck_user_profile_birth_year",
                table: "user_profiles",
                sql: "birth_year IS NULL OR birth_year >= 1900");
        }
    }
}
