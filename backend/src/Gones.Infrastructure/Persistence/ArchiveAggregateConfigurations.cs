using Gones.Domain.Archive;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Gones.Infrastructure.Persistence;

/// <summary>
/// The three-tier archive tables. The <c>text</c> column types are deliberate: the length caps are
/// domain rules enforced by <c>ArchiveValidation.ValidateString</c>, and <c>HasMaxLength</c> would emit
/// <c>character varying(200)</c> instead — the same precedent as <see cref="PlayerStatisticsRowConfiguration"/>'s
/// <c>player_name</c>. These aggregates are not <c>VersionedEntity</c> subclasses, so their <c>Version</c>
/// is bumped by their own mutators rather than by <c>GonesDbContext.IncrementVersions</c>; the
/// concurrency token is declared here.
/// </summary>
internal sealed class ArchiveLeagueConfiguration : IEntityTypeConfiguration<ArchiveLeague>
{
    public void Configure(EntityTypeBuilder<ArchiveLeague> builder)
    {
        builder.ToTable("archive_leagues");
        builder.HasKey(league => league.DocumentId);
        builder.Property(league => league.DocumentId).HasColumnType("text");
        builder.Property(league => league.Name).HasColumnType("text");
        builder.Property(league => league.Version).IsConcurrencyToken();
        builder.HasIndex(league => new { league.DeletedAt, league.UpdatedAt, league.DocumentId })
            .IsDescending(false, true, false);
        builder.ToTable(table => table.HasCheckConstraint("ck_archive_league_version_positive", "version > 0"));
    }
}

internal sealed class ArchiveLeagueSeasonConfiguration : IEntityTypeConfiguration<ArchiveLeagueSeason>
{
    public void Configure(EntityTypeBuilder<ArchiveLeagueSeason> builder)
    {
        builder.ToTable("archive_league_seasons");
        builder.HasKey(season => season.DocumentId);
        builder.Property(season => season.DocumentId).HasColumnType("text");
        builder.Property(season => season.LeagueId).HasColumnType("text");
        builder.Property(season => season.Name).HasColumnType("text");
        builder.Property(season => season.Status).HasColumnType("text");
        builder.Property(season => season.Version).IsConcurrencyToken();
        // NoAction matches the binding DDL's bare REFERENCES; the EF default for a required
        // relationship would emit ON DELETE CASCADE.
        builder.HasOne<ArchiveLeague>()
            .WithMany()
            .HasForeignKey(season => season.LeagueId)
            .OnDelete(DeleteBehavior.NoAction);
        // Declared explicitly so the FK index carries the contract's name instead of an EF-invented duplicate.
        builder.HasIndex(season => season.LeagueId);
        builder.HasIndex(season => new { season.DeletedAt, season.UpdatedAt, season.DocumentId })
            .IsDescending(false, true, false);
        builder.ToTable(table =>
        {
            table.HasCheckConstraint("ck_archive_league_season_version_positive", "version > 0");
            table.HasCheckConstraint("ck_archive_league_season_status", "status IN ('active', 'completed')");
            table.HasCheckConstraint("ck_archive_league_season_counts_non_negative", "tournament_count >= 0 AND player_count >= 0");
            table.HasCheckConstraint(
                "ck_archive_league_season_count_dates",
                "(first_tournament_date IS NULL) = (last_tournament_date IS NULL) AND (first_tournament_date IS NULL OR first_tournament_date <= last_tournament_date)");
        });
    }
}

internal sealed class ArchiveTournamentConfiguration : IEntityTypeConfiguration<ArchiveTournament>
{
    public void Configure(EntityTypeBuilder<ArchiveTournament> builder)
    {
        builder.ToTable("archive_tournaments");
        builder.HasKey(tournament => tournament.DocumentId);
        builder.Property(tournament => tournament.DocumentId).HasColumnType("text");
        builder.Property(tournament => tournament.SeasonId).HasColumnType("text");
        builder.Property(tournament => tournament.Name).HasColumnType("text");
        builder.Property(tournament => tournament.Status).HasColumnType("text");
        builder.Property(tournament => tournament.Document).HasColumnType("jsonb");
        builder.Property(tournament => tournament.Version).IsConcurrencyToken();
        builder.HasOne<ArchiveLeagueSeason>()
            .WithMany()
            .HasForeignKey(tournament => tournament.SeasonId)
            .OnDelete(DeleteBehavior.NoAction);
        builder.HasIndex(tournament => tournament.SeasonId);
        builder.HasIndex(tournament => tournament.TournamentDate).IsDescending();
        builder.ToTable(table =>
        {
            table.HasCheckConstraint("ck_archive_tournament_version_positive", "version > 0");
            table.HasCheckConstraint("ck_archive_tournament_status", "status IN ('active', 'completed')");
            table.HasCheckConstraint("ck_archive_tournament_player_count_non_negative", "player_count >= 0");
            table.HasCheckConstraint("ck_archive_tournament_document_object", "jsonb_typeof(document) = 'object'");
            table.HasCheckConstraint("ck_archive_tournament_document_size", $"octet_length(document::text) <= {ArchiveTournament.MaximumDocumentBytes}");
            // tournament_date is deliberately omitted: every text-to-date conversion in PostgreSQL is
            // STABLE, and a CHECK constraint rejects a non-immutable expression. The projected column and
            // the document's tournamentDate are written from the same domain call.
            table.HasCheckConstraint(
                "ck_archive_tournament_document_metadata",
                "document ->> 'id' = document_id AND document ->> 'name' = name AND document ->> 'status' = status AND document ->> 'seasonId' IS NOT DISTINCT FROM season_id");
        });
    }
}
