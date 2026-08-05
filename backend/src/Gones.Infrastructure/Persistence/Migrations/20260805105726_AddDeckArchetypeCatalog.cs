using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDeckArchetypeCatalog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "deck_archetypes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    normalized_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    deleted_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_deck_archetypes", x => x.id);
                    table.CheckConstraint("ck_version_positive", "version > 0");
                });

            migrationBuilder.CreateIndex(
                name: "ix_deck_archetypes_deleted_at_name",
                table: "deck_archetypes",
                columns: new[] { "deleted_at", "name" });

            migrationBuilder.CreateIndex(
                name: "ix_deck_archetypes_normalized_name",
                table: "deck_archetypes",
                column: "normalized_name",
                unique: true);

            migrationBuilder.Sql("""
                INSERT INTO deck_archetypes (id, name, normalized_name, created_at, updated_at, deleted_at, version)
                VALUES
                ('00000000-0000-0000-00c3-000000000001', 'Reanimator (Rakdos)', 'reanimator (rakdos)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000002', 'Tempo (Dimir)', 'tempo (dimir)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000003', 'Delver (Izzet)', 'delver (izzet)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000004', 'Show and Tell (Blue)', 'show and tell (blue)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000005', 'Sneak and Show (Izzet)', 'sneak and show (izzet)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000006', 'Cephalid Breakfast (Simic)', 'cephalid breakfast (simic)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000007', 'Dragon Stompy (Red)', 'dragon stompy (red)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000008', 'Eldrazi (Colorless)', 'eldrazi (colorless)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000009', 'Mystic Forge (Colorless)', 'mystic forge (colorless)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000010', 'Death and Taxes (White)', 'death and taxes (white)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000011', 'Control (UWx)', 'control (uwx)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000012', 'Lands (Gruul)', 'lands (gruul)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000013', 'Cloudpost (Blue)', 'cloudpost (blue)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000014', 'Oops All Spells (Jund)', 'oops all spells (jund)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000015', 'Nadu (Simic)', 'nadu (simic)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000016', 'Painter (Red)', 'painter (red)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000017', 'Doomsday (Dimir)', 'doomsday (dimir)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000018', 'Canadian Threshold (Temur)', 'canadian threshold (temur)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000019', 'Artifacts (Blue)', 'artifacts (blue)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000020', 'The EPIC Storm (Grixis)', 'the epic storm (grixis)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000021', 'Initiative Stompy (White)', 'initiative stompy (white)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000022', 'Energy (Mardu)', 'energy (mardu)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000023', 'Energy (Boros)', 'energy (boros)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000024', 'Maverick (Selesnya)', 'maverick (selesnya)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000025', 'Ninjas (Dimir)', 'ninjas (dimir)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000026', 'Control (Grixis)', 'control (grixis)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000027', 'Control (Sultai)', 'control (sultai)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000028', 'Control (Bant)', 'control (bant)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000029', 'Stoneblade (Azorius)', 'stoneblade (azorius)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000030', 'Cradle Control (Green)', 'cradle control (green)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000031', 'Stiflenought (Blue)', 'stiflenought (blue)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000032', 'Dark Depths (Golgari)', 'dark depths (golgari)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000033', 'Goblins (Red)', 'goblins (red)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000034', 'Merfolk (Blue)', 'merfolk (blue)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000035', 'Dredge (Black)', 'dredge (black)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000036', 'Elves (Green)', 'elves (green)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000037', 'Aluren (Sultai)', 'aluren (sultai)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000038', 'Infect (Simic)', 'infect (simic)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000039', 'Storm (Red)', 'storm (red)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000040', 'Turbo Depths (Golgari)', 'turbo depths (golgari)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000041', 'Affinity (Blue)', 'affinity (blue)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000042', 'Burn (Red)', 'burn (red)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000043', 'Humans (White)', 'humans (white)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000044', 'Pox (Black)', 'pox (black)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000045', 'Nic Fit (Golgari)', 'nic fit (golgari)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000046', 'Reanimator (Black)', 'reanimator (black)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000047', 'Omni-Tell (Blue)', 'omni-tell (blue)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000048', 'Control (Jeskai)', 'control (jeskai)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000049', 'Beanstalk Control (Bant)', 'beanstalk control (bant)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1)
                ON CONFLICT (normalized_name) DO NOTHING;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "deck_archetypes");
        }
    }
}
