using NodaTime;

namespace Gones.Domain.Archive;

/// <summary>
/// Middle tier of the three-tier archive — what used to be called a League. Owns the four denormalized
/// counters its catalog row prints, so a catalog query never deserializes a Tournament document.
/// </summary>
public sealed class ArchiveLeagueSeason
{
    public const int MaximumDocumentIdLength = 200;
    public const int MaximumNameLength = 200;
    public const int MaximumStatusLength = 20;

    public required string DocumentId { get; init; }
    public string LeagueId { get; private set; } = null!;
    public string Name { get; private set; } = null!;
    public string Status { get; private set; } = null!;
    public Instant UpdatedAt { get; private set; }
    public int Version { get; private set; } = 1;
    public Instant? DeletedAt { get; private set; }

    public int TournamentCount { get; private set; }
    public int PlayerCount { get; private set; }
    public LocalDate? FirstTournamentDate { get; private set; }
    public LocalDate? LastTournamentDate { get; private set; }
    public int CountsVersion { get; private set; }

    /// <summary>
    /// Counts the writes that moved the four counters, so the catalog ETag has one strictly increasing
    /// input per row for the fields <see cref="Version"/> deliberately does not cover. The counters
    /// themselves cannot play that part: a Tournament moved between two Seasons is <c>-1</c> on one row
    /// and <c>+1</c> on the other, and a re-dated Tournament moves only the two dates, so a stamp summed
    /// over the counters answers <c>304</c> over a body that changed.
    /// </summary>
    public int CountsRevision { get; private set; }

    /// <summary>
    /// A Season is born with no Tournaments, so its counters are stamped at the current formula version:
    /// that zero is computed, not unknown.
    /// </summary>
    public static ArchiveLeagueSeason Create(string documentId, string leagueId, string name, string status, Instant now)
    {
        ArchiveValidation.ValidateString(documentId, "documentId", MaximumDocumentIdLength);
        ArchiveValidation.ValidateString(leagueId, "leagueId", MaximumDocumentIdLength);
        ArchiveValidation.ValidateString(name, "name", MaximumNameLength);
        ArchiveValidation.ValidateStatus(status, "Archive League Season");
        return new ArchiveLeagueSeason
        {
            DocumentId = documentId,
            LeagueId = leagueId,
            Name = name,
            Status = status,
            UpdatedAt = now,
            TournamentCount = 0,
            PlayerCount = 0,
            FirstTournamentDate = null,
            LastTournamentDate = null,
            CountsVersion = ArchiveCatalogCounts.Version,
            CountsRevision = 0
        };
    }

    public void Rename(string name, Instant now)
    {
        EnsureWritable();
        ArchiveValidation.ValidateString(name, "name", MaximumNameLength);
        if (name == Name) return;
        Name = name;
        UpdatedAt = now;
        Version = checked(Version + 1);
    }

    public void ChangeStatus(string status, Instant now)
    {
        EnsureWritable();
        ArchiveValidation.ValidateStatus(status, "Archive League Season");
        if (status == Status) return;
        Status = status;
        UpdatedAt = now;
        Version = checked(Version + 1);
    }

    public void MoveToLeague(string leagueId, Instant now)
    {
        EnsureWritable();
        ArchiveValidation.ValidateString(leagueId, "leagueId", MaximumDocumentIdLength);
        if (leagueId == LeagueId) return;
        LeagueId = leagueId;
        UpdatedAt = now;
        Version = checked(Version + 1);
    }

    public void SoftDelete(Instant now)
    {
        if (DeletedAt is not null) throw new InvalidOperationException("Archive League Season is already deleted.");
        DeletedAt = now;
        UpdatedAt = now;
        Version = checked(Version + 1);
    }

    /// <summary>
    /// Rewrites the denormalized counters from the Season's Tournaments. Deliberately touches neither
    /// <see cref="UpdatedAt"/> nor <see cref="Version"/>: concurrency is per row, and editing a
    /// Tournament must never invalidate a client's copy of its Season. <see cref="CountsRevision"/> is
    /// what carries the change to the catalog ETag instead.
    /// </summary>
    public void RefreshCatalogCounts(ArchiveSeasonCounts counts)
    {
        EnsureWritable();
        ArgumentNullException.ThrowIfNull(counts);
        // A recompute that lands on the same four numbers changed nothing a client can see, so it must
        // not move the ETag either: every Tournament write refreshes its Season, and most of them leave
        // the counters exactly where they were.
        if (TournamentCount == counts.TournamentCount
            && PlayerCount == counts.PlayerCount
            && FirstTournamentDate == counts.FirstTournamentDate
            && LastTournamentDate == counts.LastTournamentDate
            && CountsVersion == ArchiveCatalogCounts.Version) return;
        TournamentCount = counts.TournamentCount;
        PlayerCount = counts.PlayerCount;
        FirstTournamentDate = counts.FirstTournamentDate;
        LastTournamentDate = counts.LastTournamentDate;
        CountsVersion = ArchiveCatalogCounts.Version;
        CountsRevision = checked(CountsRevision + 1);
    }

    private void EnsureWritable()
    {
        if (DeletedAt is not null) throw new InvalidOperationException("Deleted archive League Season cannot be changed.");
    }
}
