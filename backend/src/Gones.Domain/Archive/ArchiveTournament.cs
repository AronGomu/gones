using System.Text;
using System.Text.Json;
using Gones.Domain.Leagues;
using NodaTime;
using NodaTime.Text;

namespace Gones.Domain.Archive;

/// <summary>
/// Bottom tier of the three-tier archive, now top-level: every Tournament is its own row and
/// <see cref="SeasonId"/> is <c>null</c> for a standalone one. The envelope columns are projections of
/// the stored document, written from the same domain call so they cannot drift.
/// </summary>
public sealed class ArchiveTournament
{
    public const int MaximumDocumentIdLength = 200;
    public const int MaximumNameLength = 200;
    public const int MaximumStatusLength = 20;
    public const int MaximumDocumentBytes = 1_048_576;
    public const int MaximumRounds = 1_000;
    public const int MaximumEntries = 100_000;

    public required string DocumentId { get; init; }
    public string? SeasonId { get; private set; }
    public string Name { get; private set; } = null!;
    public LocalDate TournamentDate { get; private set; }
    public string Status { get; private set; } = null!;
    public string Document { get; private set; } = null!;
    public Instant UpdatedAt { get; private set; }
    public int Version { get; private set; } = 1;
    public Instant? DeletedAt { get; private set; }

    public int PlayerCount { get; private set; }
    public int CountsVersion { get; private set; }

    public static ArchiveTournament Create(ArchiveTournamentDocument document, Instant now)
    {
        ValidateDocument(document);
        var date = ParseTournamentDate(document.TournamentDate);
        // Store the normalized Season ID inside the document too, so the JSON and the column agree and
        // the ck_archive_tournament_document_metadata check constraint holds.
        var normalized = document with
        {
            SeasonId = ArchiveValidation.NormalizeSeasonId(document.SeasonId, MaximumDocumentIdLength)
        };
        return new ArchiveTournament
        {
            DocumentId = normalized.Id,
            SeasonId = normalized.SeasonId,
            Name = normalized.Name,
            TournamentDate = date,
            Status = normalized.Status,
            Document = SerializeBounded(normalized),
            UpdatedAt = now,
            PlayerCount = ArchiveCatalogCounts.ForTournament(normalized).PlayerCount,
            CountsVersion = ArchiveCatalogCounts.Version
        };
    }

    /// <summary>Edits name, date, status, Rounds and archetypes. Refuses a Season change — that is <see cref="MoveToSeason"/>.</summary>
    public void Apply(ArchiveTournamentDocument document, Instant now)
    {
        EnsureWritable();
        if (document.Id != DocumentId)
            throw new ArgumentException("Tournament document ID cannot change.", nameof(document));
        if (ArchiveValidation.NormalizeSeasonId(document.SeasonId, MaximumDocumentIdLength) != SeasonId)
            throw new ArgumentException("Tournament Season ID cannot change; use MoveToSeason.", nameof(document));
        ApplyAndMove(document, SeasonId, now);
    }

    /// <summary>
    /// Edits content and Season together, in a single version bump. <see cref="Apply"/> plus
    /// <see cref="MoveToSeason"/> would bump twice, and one staged edit batch that both edits and moves
    /// a Tournament owes its caller exactly one bump (ADR 0037). <see cref="Apply"/> delegates here with
    /// the current Season, so there is one write path and one idempotency rule.
    /// </summary>
    /// <param name="seasonId">The Season to end up in; <c>null</c> detaches to standalone.</param>
    public void ApplyAndMove(ArchiveTournamentDocument document, string? seasonId, Instant now)
    {
        EnsureWritable();
        if (document.Id != DocumentId)
            throw new ArgumentException("Tournament document ID cannot change.", nameof(document));
        ValidateDocument(document);
        var date = ParseTournamentDate(document.TournamentDate);
        // The stored JSON and the season_id column move together, or
        // ck_archive_tournament_document_metadata rejects the write. LeagueJson omits a null, so a
        // detach drops the key rather than nulling it.
        var target = ArchiveValidation.NormalizeSeasonId(seasonId, MaximumDocumentIdLength);
        var normalized = document with { SeasonId = target };
        var canonical = SerializeBounded(normalized);
        // A replayed command is idempotent: nothing changed, so nothing is bumped.
        if (canonical == Document && normalized.Name == Name && date == TournamentDate && normalized.Status == Status && target == SeasonId)
            return;

        SeasonId = target;
        Name = normalized.Name;
        TournamentDate = date;
        Status = normalized.Status;
        Document = canonical;
        UpdatedAt = now;
        Version = checked(Version + 1);
        PlayerCount = ArchiveCatalogCounts.ForTournament(normalized).PlayerCount;
        CountsVersion = ArchiveCatalogCounts.Version;
    }

    /// <summary>The move operation, and the way a Tournament is detached to standalone with <c>null</c>.</summary>
    public void MoveToSeason(string? seasonId, Instant now)
    {
        EnsureWritable();
        var target = ArchiveValidation.NormalizeSeasonId(seasonId, MaximumDocumentIdLength);
        if (target == SeasonId) return;
        // Moving a Tournament changes no player, so the counts stand.
        var moved = ReadDocument() with { SeasonId = target };
        SeasonId = target;
        Document = SerializeBounded(moved);
        UpdatedAt = now;
        Version = checked(Version + 1);
    }

    public void SoftDelete(Instant now)
    {
        if (DeletedAt is not null) throw new InvalidOperationException("Archive Tournament is already deleted.");
        DeletedAt = now;
        UpdatedAt = now;
        Version = checked(Version + 1);
    }

    /// <summary>
    /// Recomputes <see cref="PlayerCount"/> from the stored document without touching
    /// <see cref="UpdatedAt"/> or <see cref="Version"/>: the row's content did not change, only the
    /// number derived from it.
    /// </summary>
    public void RefreshCatalogCounts()
    {
        EnsureWritable();
        PlayerCount = ArchiveCatalogCounts.ForTournament(ReadDocument()).PlayerCount;
        CountsVersion = ArchiveCatalogCounts.Version;
    }

    /// <summary>
    /// The stored document, canonicalized the way a write would store it. Deliberately does <b>not</b>
    /// route through <see cref="Create"/>: that path runs a full Swiss standings pass to stamp the
    /// counts, and a read stamps nothing, so it has no counts to compute.
    /// </summary>
    public ArchiveTournamentDocument ReadDocument()
    {
        try
        {
            return LeagueJson.Deserialize<ArchiveTournamentDocument>(Document);
        }
        catch (Exception exception) when (exception is JsonException or NotSupportedException)
        {
            throw new ArgumentException("Tournament document is malformed.", "document", exception);
        }
    }

    private void EnsureWritable()
    {
        if (DeletedAt is not null) throw new InvalidOperationException("Deleted archive Tournament cannot be changed.");
    }

    private static string SerializeBounded(ArchiveTournamentDocument document)
    {
        var canonical = LeagueJson.Serialize(document);
        if (Encoding.UTF8.GetByteCount(canonical) > MaximumDocumentBytes)
            throw new ArgumentException($"Tournament document exceeds {MaximumDocumentBytes} bytes.", nameof(document));
        return canonical;
    }

    private static LocalDate ParseTournamentDate(string? value)
    {
        ArchiveValidation.ValidateString(value, "tournamentDate", 32);
        var parse = LocalDatePattern.Iso.Parse(value!);
        if (!parse.Success)
            throw new ArgumentException("Tournament date must be an ISO YYYY-MM-DD date.", "tournamentDate");
        return parse.Value;
    }

    private static void ValidateDocument(ArchiveTournamentDocument? document)
    {
        ArgumentNullException.ThrowIfNull(document);
        ArchiveValidation.ValidateString(document.Id, "id", MaximumDocumentIdLength);
        ArchiveValidation.ValidateString(document.Name, "name", MaximumNameLength);
        ArchiveValidation.ValidateStatus(document.Status, "Archive Tournament");
        if (document.Rounds is null || document.Rounds.Count > MaximumRounds)
            throw new ArgumentException($"Tournament must contain at most {MaximumRounds} Rounds.", nameof(document));
        if (document.PlayerArchetypes is null)
            throw new ArgumentException("Tournament player archetypes are required.", nameof(document));

        var entryCount = 0;
        foreach (var round in document.Rounds)
        {
            if (round is null || round.Entries is null)
                throw new ArgumentException("Round entries are required.", nameof(document));
            ArchiveValidation.ValidateString(round.Id, "round.id", MaximumDocumentIdLength);
            entryCount = checked(entryCount + round.Entries.Count);
            foreach (var entry in round.Entries)
            {
                if (entry is null) throw new ArgumentException("Round entry is required.", nameof(document));
                ArchiveValidation.ValidateString(entry.Id, "entry.id", MaximumDocumentIdLength);
            }
        }
        if (entryCount > MaximumEntries)
            throw new ArgumentException($"Tournament must contain at most {MaximumEntries} Round Entries.", nameof(document));
    }
}
