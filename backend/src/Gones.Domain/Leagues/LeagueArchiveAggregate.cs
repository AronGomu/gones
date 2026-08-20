using System.Text;
using System.Text.Json;
using Gones.Domain.Persistence;
using NodaTime;

namespace Gones.Domain.Leagues;

public sealed class LeagueArchiveAggregate : VersionedEntity
{
    public const int MaximumDocumentIdLength = 200;
    public const int MaximumNameLength = 200;
    public const int MaximumStatusLength = 20;
    public const int MaximumDocumentBytes = 1_048_576;
    public const int MaximumTournaments = 1_000;
    public const int MaximumRoundsPerTournament = 1_000;
    public const int MaximumEntries = 100_000;

    public required string DocumentId { get; init; }
    public string Name { get; private set; } = null!;
    public string Status { get; private set; } = null!;
    public Instant UpdatedAt { get; private set; }
    public Instant? DeletedAt { get; private set; }
    public string CanonicalDocument { get; private set; } = null!;

    /// <summary>
    /// The two numbers the archive list card prints, denormalized so the catalog can ship summary rows
    /// instead of whole documents (ADR 0042). <see cref="CountsVersion"/> is the per-row formula version:
    /// <c>0</c> means never computed, which is what makes a stored <c>0</c> count unambiguous.
    ///
    /// <para>A migration that rewrites <c>canonical_document</c> in raw SQL — as
    /// <c>AddArchiveTournamentStatus</c> does — must also set <c>counts_version = 0</c> on the rows it
    /// touches if the rewrite can change either number. The startup backfill only visits rows stamped
    /// with an older version, so a document changed underneath a current stamp stays stale forever.</para>
    /// </summary>
    public int TournamentCount { get; private set; }
    public int PlayerCount { get; private set; }
    public int CountsVersion { get; private set; }

    public static LeagueArchiveAggregate Create(LeagueDocument document, Instant now)
    {
        ValidateDocument(document);
        var counts = LeagueCatalogCounts.From(document);
        return new LeagueArchiveAggregate
        {
            DocumentId = document.Id,
            Name = document.Name,
            Status = document.Status,
            UpdatedAt = now,
            CanonicalDocument = SerializeBounded(document),
            TournamentCount = counts.TournamentCount,
            PlayerCount = counts.PlayerCount,
            CountsVersion = LeagueCatalogCounts.Version
        };
    }

    public static LeagueArchiveAggregate FromCanonicalDocument(
        string documentId,
        string name,
        string status,
        string canonicalDocument,
        Instant updatedAt)
    {
        ValidateString(documentId, nameof(documentId), MaximumDocumentIdLength);
        ValidateString(name, nameof(name), MaximumNameLength);
        ValidateString(status, nameof(status), MaximumStatusLength);
        if (Encoding.UTF8.GetByteCount(canonicalDocument) > MaximumDocumentBytes)
            throw new ArgumentException($"League document exceeds {MaximumDocumentBytes} bytes.", nameof(canonicalDocument));

        LeagueDocument document;
        try
        {
            document = LeagueJson.Deserialize<LeagueDocument>(canonicalDocument);
        }
        catch (Exception exception) when (exception is JsonException or NotSupportedException)
        {
            throw new ArgumentException("League document is malformed.", nameof(canonicalDocument), exception);
        }

        ValidateDocument(document);
        if (document.Id != documentId || document.Name != name || document.Status != status)
            throw new ArgumentException("League document metadata does not match its envelope.", nameof(canonicalDocument));
        return Create(document, updatedAt);
    }

    public LeagueDocument ReadDocument()
    {
        var document = FromCanonicalDocument(DocumentId, Name, Status, CanonicalDocument, UpdatedAt);
        return LeagueJson.Deserialize<LeagueDocument>(document.CanonicalDocument);
    }

    public void Apply(LeagueDocument document, Instant now)
    {
        if (DeletedAt is not null) throw new InvalidOperationException("Deleted League aggregate cannot be changed.");
        if (document.Id != DocumentId) throw new ArgumentException("League document ID cannot change.", nameof(document));
        ValidateDocument(document);
        var counts = LeagueCatalogCounts.From(document);
        Name = document.Name;
        Status = document.Status;
        CanonicalDocument = SerializeBounded(document);
        UpdatedAt = now;
        TournamentCount = counts.TournamentCount;
        PlayerCount = counts.PlayerCount;
        CountsVersion = LeagueCatalogCounts.Version;
    }

    /// <summary>
    /// Recomputes the catalog counts from the stored document without touching <see cref="UpdatedAt"/>:
    /// the row's content did not change, only the numbers derived from it. This is the startup
    /// backfill's only entry point, so the maths lives in one place.
    /// </summary>
    public void RefreshCatalogCounts()
    {
        var counts = LeagueCatalogCounts.From(ReadDocument());
        TournamentCount = counts.TournamentCount;
        PlayerCount = counts.PlayerCount;
        CountsVersion = LeagueCatalogCounts.Version;
    }

    public void SoftDelete(Instant now)
    {
        if (DocumentId == LeagueNormalizer.PlaceholderLeagueId) throw new InvalidOperationException("Placeholder League cannot be deleted.");
        if (DeletedAt is not null) throw new InvalidOperationException("League aggregate is already deleted.");
        DeletedAt = now;
        UpdatedAt = now;
    }

    private static string SerializeBounded(LeagueDocument document)
    {
        var canonical = LeagueJson.Serialize(document);
        if (Encoding.UTF8.GetByteCount(canonical) > MaximumDocumentBytes)
            throw new ArgumentException($"League document exceeds {MaximumDocumentBytes} bytes.", nameof(document));
        return canonical;
    }

    private static void ValidateDocument(LeagueDocument? document)
    {
        ArgumentNullException.ThrowIfNull(document);
        ValidateString(document.Id, "id", MaximumDocumentIdLength);
        ValidateString(document.Name, "name", MaximumNameLength);
        if (document.Id == LeagueNormalizer.PlaceholderLeagueId && document.Name != LeagueNormalizer.PlaceholderLeagueName)
            throw new ArgumentException("Placeholder League name must remain canonical.", nameof(document));
        if (document.Id != LeagueNormalizer.PlaceholderLeagueId && LeagueNormalizer.IsUnassignedLeagueName(document.Name))
            throw new ArgumentException("Translated placeholder League duplicates are forbidden.", nameof(document));
        if (document.Status is not ("active" or "completed"))
            throw new ArgumentException("League status must be active or completed.", nameof(document));
        if (document.Tournaments is null || document.Tournaments.Count > MaximumTournaments)
            throw new ArgumentException($"League must contain at most {MaximumTournaments} Tournaments.", nameof(document));

        var entryCount = 0;
        foreach (var tournament in document.Tournaments)
        {
            if (tournament is null || tournament.LeagueId != document.Id)
                throw new ArgumentException("Tournament League ID must match League ID.", nameof(document));
            ValidateString(tournament.Id, "tournament.id", MaximumDocumentIdLength);
            ValidateString(tournament.Name, "tournament.name", MaximumNameLength);
            if (tournament.Rounds is null || tournament.Rounds.Count > MaximumRoundsPerTournament)
                throw new ArgumentException($"Tournament must contain at most {MaximumRoundsPerTournament} Rounds.", nameof(document));
            if (tournament.PlayerArchetypes is null)
                throw new ArgumentException("Tournament player archetypes are required.", nameof(document));
            foreach (var round in tournament.Rounds)
            {
                if (round is null || round.Entries is null)
                    throw new ArgumentException("Round entries are required.", nameof(document));
                ValidateString(round.Id, "round.id", MaximumDocumentIdLength);
                entryCount = checked(entryCount + round.Entries.Count);
                foreach (var entry in round.Entries)
                {
                    if (entry is null) throw new ArgumentException("Round entry is required.", nameof(document));
                    ValidateString(entry.Id, "entry.id", MaximumDocumentIdLength);
                }
            }
        }
        if (entryCount > MaximumEntries)
            throw new ArgumentException($"League must contain at most {MaximumEntries} Round Entries.", nameof(document));
    }

    private static void ValidateString(string? value, string field, int maximumLength)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > maximumLength)
            throw new ArgumentException($"{field} must contain 1 to {maximumLength} characters.", field);
    }
}
