using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Backfills the new <c>status</c> field on every Archive Tournament inside
    /// <c>league_archive_aggregates.canonical_document</c>. There is no schema change: the document is a
    /// single <c>jsonb</c> column, so the field is added row by row inside the stored JSON.
    ///
    /// <para><b>Why <c>completed</c> and not <c>active</c>.</b> This is the opposite default to the League
    /// <c>status</c>, and deliberately so: an archive document that predates the field is history, and
    /// history is complete. Statistics are meant to read completed Tournaments, so defaulting the other way
    /// would silently drop every Tournament that exists today out of every statistic. The domain normaliser
    /// (<c>LeagueNormalizer.NormalizeTournamentStatus</c>) applies the same rule to a document that arrives
    /// without the field — a restore, an import, an old export — so a row this migration never saw still
    /// reads <c>completed</c>.</para>
    ///
    /// <para><b>Order is preserved.</b> Tournament order is visible in the UI, so the array is rebuilt with
    /// <c>WITH ORDINALITY</c> and an explicit <c>ORDER BY</c> rather than relying on unordered
    /// <c>jsonb_agg</c> input.</para>
    ///
    /// <para><b>Idempotent.</b> The predicate selects only documents holding a Tournament without a
    /// <c>status</c>, and untouched Tournaments keep whatever they already carry, so re-running this
    /// selects nothing.</para>
    ///
    /// <para><b><c>Down</c> is a deliberate no-op.</b> Gones is unreleased and the field cannot be
    /// un-invented: once the application writes documents carrying <c>status</c>, stripping it back out
    /// would lose an Organizer's real choice, not restore a previous state.</para>
    /// </summary>
    public partial class AddArchiveTournamentStatus : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                UPDATE league_archive_aggregates AS aggregate
                SET canonical_document = jsonb_set(
                    aggregate.canonical_document,
                    '{tournaments}',
                    (SELECT jsonb_agg(
                                CASE WHEN tournament ? 'status' THEN tournament
                                     ELSE tournament || '{"status":"completed"}'::jsonb END
                                ORDER BY position)
                     FROM jsonb_array_elements(aggregate.canonical_document -> 'tournaments')
                          WITH ORDINALITY AS elements(tournament, position)))
                WHERE jsonb_typeof(aggregate.canonical_document -> 'tournaments') = 'array'
                  AND EXISTS (
                      SELECT 1
                      FROM jsonb_array_elements(aggregate.canonical_document -> 'tournaments') AS tournament
                      WHERE NOT tournament ? 'status');
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Deliberately empty: see the summary above. Gones is unreleased and the field cannot be
            // un-invented — dropping it would erase a real choice rather than restore a previous state.
        }
    }
}
