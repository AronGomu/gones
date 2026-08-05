using System.Text;
using System.Text.Json;
using Gones.Domain.Leagues;
using Gones.Domain.Persistence;
using NodaTime;

namespace Gones.Domain.Live;

public sealed class LiveAggregate : VersionedEntity
{
    public const int MaximumDocumentIdLength = 200;
    public const int MaximumNameLength = 200;
    public const int MaximumStageLength = 20;
    public const int MaximumTournamentDateLength = 32;
    public const int MaximumDocumentBytes = 1_048_576;
    public const int MaximumPlayers = 500;
    public const int MaximumRounds = 200;
    public const int MaximumCheckpoints = LiveNormalizer.MaximumCheckpoints;
    public const int MaximumEntries = 100_000;

    public static readonly string[] Stages = ["registration", "round", "standings", "completed"];

    public required string DocumentId { get; init; }
    public string Name { get; private set; } = null!;
    public string TournamentDate { get; private set; } = null!;
    public string Stage { get; private set; } = null!;
    public Instant UpdatedAt { get; private set; }
    public Instant? DeletedAt { get; private set; }
    public string CanonicalDocument { get; private set; } = null!;

    public static LiveAggregate Create(LiveTournamentDocument document, Instant now)
    {
        ValidateDocument(document);
        return new LiveAggregate
        {
            DocumentId = document.Id,
            Name = document.Name,
            TournamentDate = document.TournamentDate,
            Stage = document.Stage,
            UpdatedAt = now,
            CanonicalDocument = SerializeBounded(document)
        };
    }

    public static LiveAggregate FromCanonicalDocument(
        string documentId,
        string name,
        string tournamentDate,
        string stage,
        string canonicalDocument,
        Instant updatedAt)
    {
        ValidateString(documentId, nameof(documentId), MaximumDocumentIdLength);
        ValidateString(name, nameof(name), MaximumNameLength);
        ValidateString(stage, nameof(stage), MaximumStageLength);
        ValidateString(tournamentDate, nameof(tournamentDate), MaximumTournamentDateLength);
        if (Encoding.UTF8.GetByteCount(canonicalDocument) > MaximumDocumentBytes)
            throw new ArgumentException($"Live Tournament document exceeds {MaximumDocumentBytes} bytes.", nameof(canonicalDocument));

        LiveTournamentDocument document;
        try
        {
            document = LeagueJson.Deserialize<LiveTournamentDocument>(canonicalDocument);
        }
        catch (Exception exception) when (exception is JsonException or NotSupportedException)
        {
            throw new ArgumentException("Live Tournament document is malformed.", nameof(canonicalDocument), exception);
        }

        ValidateDocument(document);
        if (document.Id != documentId || document.Name != name || document.TournamentDate != tournamentDate || document.Stage != stage)
            throw new ArgumentException("Live Tournament document metadata does not match its envelope.", nameof(canonicalDocument));
        return Create(document, updatedAt);
    }

    public LiveTournamentDocument ReadDocument()
    {
        var aggregate = FromCanonicalDocument(DocumentId, Name, TournamentDate, Stage, CanonicalDocument, UpdatedAt);
        return LeagueJson.Deserialize<LiveTournamentDocument>(aggregate.CanonicalDocument);
    }

    public void Apply(LiveTournamentDocument document, Instant now)
    {
        if (DeletedAt is not null) throw new InvalidOperationException("Deleted Live Tournament aggregate cannot be changed.");
        if (document.Id != DocumentId) throw new ArgumentException("Live Tournament document ID cannot change.", nameof(document));
        ValidateDocument(document);
        Name = document.Name;
        TournamentDate = document.TournamentDate;
        Stage = document.Stage;
        CanonicalDocument = SerializeBounded(document);
        UpdatedAt = now;
    }

    public void SoftDelete(Instant now)
    {
        if (DeletedAt is not null) throw new InvalidOperationException("Live Tournament aggregate is already deleted.");
        DeletedAt = now;
        UpdatedAt = now;
    }

    private static string SerializeBounded(LiveTournamentDocument document)
    {
        var canonical = LeagueJson.Serialize(document);
        if (Encoding.UTF8.GetByteCount(canonical) > MaximumDocumentBytes)
            throw new ArgumentException($"Live Tournament document exceeds {MaximumDocumentBytes} bytes.", nameof(document));
        return canonical;
    }

    private static void ValidateDocument(LiveTournamentDocument? document)
    {
        ArgumentNullException.ThrowIfNull(document);
        ValidateString(document.Id, "id", MaximumDocumentIdLength);
        ValidateString(document.Name, "name", MaximumNameLength);
        ValidateString(document.TournamentDate, "tournamentDate", MaximumTournamentDateLength);
        if (!Stages.Contains(document.Stage, StringComparer.Ordinal))
            throw new ArgumentException("Live Tournament stage must be registration, round, standings, or completed.", nameof(document));
        if (document.Type != "swiss")
            throw new ArgumentException("Live Tournament type must be swiss.", nameof(document));
        if (document.DocumentVersion < 1)
            throw new ArgumentException("Live Tournament document version must be at least 1.", nameof(document));
        if (document.Players is null || document.Players.Count > MaximumPlayers)
            throw new ArgumentException($"Live Tournament must contain at most {MaximumPlayers} Players.", nameof(document));
        if (document.FirstRoundPlayerOrder is null || document.FirstRoundPlayerOrder.Count > MaximumPlayers)
            throw new ArgumentException($"Live Tournament pairing order must contain at most {MaximumPlayers} Players.", nameof(document));
        if (document.Checkpoints is null || document.Checkpoints.Count > MaximumCheckpoints)
            throw new ArgumentException($"Live Tournament must contain at most {MaximumCheckpoints} Checkpoints.", nameof(document));

        var entryCount = 0;
        ValidatePlayers(document.Players, ref entryCount);
        ValidateRounds(document.Rounds, ref entryCount);
        foreach (var checkpoint in document.Checkpoints)
        {
            if (checkpoint is null)
                throw new ArgumentException("Live Tournament checkpoint is required.", nameof(document));
            ValidateString(checkpoint.Id, "checkpoint.id", MaximumDocumentIdLength);
            if (checkpoint.Stage is not ("round" or "standings"))
                throw new ArgumentException("Live Tournament checkpoint stage must be round or standings.", nameof(document));
            if (checkpoint.Players is null || checkpoint.Players.Count > MaximumPlayers)
                throw new ArgumentException($"Live Tournament checkpoint must contain at most {MaximumPlayers} Players.", nameof(document));
            ValidatePlayers(checkpoint.Players, ref entryCount);
            ValidateRounds(checkpoint.Rounds, ref entryCount);
        }
        if (entryCount > MaximumEntries)
            throw new ArgumentException($"Live Tournament must contain at most {MaximumEntries} Round Entries.", nameof(document));
    }

    private static void ValidatePlayers(IReadOnlyList<LiveTournamentPlayerDocument> players, ref int entryCount)
    {
        foreach (var player in players)
        {
            if (player is null) throw new ArgumentException("Live Tournament player is required.", nameof(players));
            ValidateString(player.Id, "player.id", MaximumDocumentIdLength);
            entryCount = checked(entryCount + 1);
        }
    }

    private static void ValidateRounds(IReadOnlyList<LiveTournamentRoundDocument> rounds, ref int entryCount)
    {
        if (rounds is null || rounds.Count > MaximumRounds)
            throw new ArgumentException($"Live Tournament must contain at most {MaximumRounds} Rounds.", nameof(rounds));
        foreach (var round in rounds)
        {
            if (round is null || round.Entries is null)
                throw new ArgumentException("Live Tournament round entries are required.", nameof(rounds));
            ValidateString(round.Id, "round.id", MaximumDocumentIdLength);
            entryCount = checked(entryCount + round.Entries.Count);
            foreach (var entry in round.Entries)
            {
                if (entry?.Entry is null) throw new ArgumentException("Live Tournament round entry is required.", nameof(rounds));
                ValidateString(entry.Entry.Id, "entry.id", MaximumDocumentIdLength);
            }
        }
    }

    private static void ValidateString(string? value, string field, int maximumLength)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > maximumLength)
            throw new ArgumentException($"{field} must contain 1 to {maximumLength} characters.", field);
    }
}
