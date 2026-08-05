using System.Globalization;
using System.Text.Json;
using Gones.Domain.Leagues;

namespace Gones.Domain.Live;

/// <summary>
/// Exact C# port of the TypeScript Live Tournament normalizers in src/app/domain/live-tournament.ts.
/// JavaScript coercion semantics are mirrored deliberately; do not "clean up" without new golden fixtures.
/// </summary>
public static class LiveNormalizer
{
    public const string DefaultName = "Live Tournament";
    public const int MaximumCheckpoints = 80;

    public static LiveTournamentDocument Normalize(
        JsonElement input,
        Func<string> idFactory,
        string nowIso,
        string today)
    {
        var id = NullishString(input, "id") ?? idFactory();
        var createdAt = HasValue(input, "createdAt") ? StringValue(Value(input, "createdAt")) : nowIso;
        var updatedAt = HasValue(input, "updatedAt") ? StringValue(Value(input, "updatedAt")) : createdAt;
        var documentVersion = HasValue(input, "documentVersion") ? ToNonNegativeInteger(Value(input, "documentVersion")) : 1;
        if (documentVersion == 0) documentVersion = 1;
        return new LiveTournamentDocument(
            id,
            DefaultedName(input, "name", DefaultName),
            HasValue(input, "leagueId") ? StringValue(Value(input, "leagueId")) : string.Empty,
            TruthyStringOrFallback(input, "tournamentDate", today),
            HasValue(input, "type") ? StringValue(Value(input, "type")) : "swiss",
            (int)(HasValue(input, "roundCount") ? ToNonNegativeInteger(Value(input, "roundCount")) : 3),
            HasValue(input, "customRoundCount") && IsTruthy(Value(input, "customRoundCount")),
            Value(input, "paidTrackingEnabled") is not { ValueKind: JsonValueKind.False },
            HasValue(input, "pairingSeed") ? ToNonNegativeInteger(Value(input, "pairingSeed")) : 0,
            NormalizePlayerIdList(Value(input, "firstRoundPlayerOrder")),
            HasValue(input, "stage") ? StringValue(Value(input, "stage")) : "registration",
            (int)ToNonNegativeInteger(Value(input, "currentRoundNumber")),
            NormalizePlayers(ArrayItems(input, "players").Select(item => NormalizePlayerInput(item, idFactory)).ToArray()),
            ArrayItems(input, "rounds").Select((item, index) => NormalizeRound(item, index + 1, idFactory)).ToArray(),
            ArrayItems(input, "checkpoints").Select(item => NormalizeCheckpoint(item, idFactory, nowIso)).TakeLast(MaximumCheckpoints).ToArray(),
            NullishString(input, "finalizedTournamentId"),
            (int)Math.Max(1, documentVersion),
            createdAt,
            updatedAt);
    }

    public static LiveTournamentPlayerDocument NormalizePlayer(JsonElement input, Func<string> idFactory)
    {
        var partial = NormalizePlayerInput(input, idFactory);
        return CreatePlayer(partial);
    }

    public static LiveTournamentPlayerDocument CreatePlayer(LiveTournamentPlayerDocument player) => new(
        player.Id,
        LeagueNormalizer.TrimPlayerName(player.Name),
        player.Paid,
        player.Dropped,
        Math.Max(0, player.InitialWins),
        Math.Max(0, player.InitialDraws),
        Math.Max(0, player.InitialLosses),
        (player.Archetype ?? string.Empty).Trim());

    /// <summary>Mirrors normalizeLivePlayers: duplicate (case-insensitive) names receive " (n)" suffixes.</summary>
    public static IReadOnlyList<LiveTournamentPlayerDocument> NormalizePlayers(IReadOnlyList<LiveTournamentPlayerDocument> players)
    {
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        var normalized = new List<LiveTournamentPlayerDocument>(players.Count);
        foreach (var player in players)
        {
            var candidate = CreatePlayer(player);
            var key = candidate.Name.ToLowerInvariant();
            if (key.Length == 0)
            {
                normalized.Add(candidate);
                continue;
            }
            var nextCount = counts.GetValueOrDefault(key) + 1;
            counts[key] = nextCount;
            normalized.Add(nextCount == 1 ? candidate : candidate with { Name = $"{candidate.Name} ({nextCount})" });
        }
        return normalized;
    }

    public static LiveTournamentRoundDocument NormalizeRound(LiveTournamentRoundDocument round, int fallbackRoundNumber, Func<string> idFactory) => new(
        round.Id ?? idFactory(),
        round.RoundNumber > 0 ? round.RoundNumber : fallbackRoundNumber,
        round.Entries.Where(item => item?.Entry is not null).Select(NormalizeRoundEntry).ToArray(),
        round.Validated);

    public static LiveTournamentRoundEntryDocument NormalizeRoundEntry(LiveTournamentRoundEntryDocument item)
    {
        var entry = NormalizeEntry(item.Entry);
        return new LiveTournamentRoundEntryDocument(entry, entry is ByeRoundEntry || item.ResultEntered);
    }

    public static RoundEntry NormalizeEntry(RoundEntry entry) => entry switch
    {
        MatchRoundEntry match => match with
        {
            Table = match.Table ?? string.Empty,
            Player1Name = LeagueNormalizer.TrimPlayerName(match.Player1Name),
            Player2Name = LeagueNormalizer.TrimPlayerName(match.Player2Name),
            Player1Score = Math.Max(0, match.Player1Score),
            Player2Score = Math.Max(0, match.Player2Score),
            Player1DeckArchetype = LeagueNormalizer.NormalizeDeckArchetype(match.Player1DeckArchetype),
            Player2DeckArchetype = LeagueNormalizer.NormalizeDeckArchetype(match.Player2DeckArchetype)
        },
        ByeRoundEntry bye => bye with
        {
            Table = bye.Table ?? string.Empty,
            PlayerName = LeagueNormalizer.TrimPlayerName(bye.PlayerName),
            DeckArchetype = LeagueNormalizer.NormalizeDeckArchetype(bye.DeckArchetype)
        },
        InvalidRoundEntry invalid => invalid with
        {
            Player = LeagueNormalizer.TrimPlayerName(invalid.Player),
            Opponent = LeagueNormalizer.TrimPlayerName(invalid.Opponent)
        },
        _ => entry
    };

    public static LiveTournamentCheckpointDocument NormalizeCheckpoint(LiveTournamentCheckpointDocument checkpoint, Func<string> idFactory, string nowIso)
    {
        var stage = checkpoint.Stage == "standings" ? "standings" : "round";
        return new LiveTournamentCheckpointDocument(
            checkpoint.Id ?? idFactory(),
            string.IsNullOrEmpty(checkpoint.Label) ? DefaultCheckpointLabel(stage) : checkpoint.Label,
            string.IsNullOrEmpty(checkpoint.CreatedAt) ? nowIso : checkpoint.CreatedAt,
            stage,
            Math.Max(0, checkpoint.CurrentRoundNumber),
            Math.Max(0, checkpoint.RoundCount),
            checkpoint.PaidTrackingEnabled,
            NormalizePlayers(checkpoint.Players),
            checkpoint.Rounds.Select((round, index) => NormalizeRound(round, index + 1, idFactory)).ToArray());
    }

    internal static string DefaultCheckpointLabel(string stage) => stage == "round" ? "Pairing backup" : "Standing backup";

    private static LiveTournamentPlayerDocument NormalizePlayerInput(JsonElement input, Func<string> idFactory) => new(
        NullishString(input, "id") ?? idFactory(),
        LeagueNormalizer.TrimPlayerName(StringValue(Value(input, "name"))),
        IsTruthy(Value(input, "paid")),
        IsTruthy(Value(input, "dropped")),
        (int)ToNonNegativeInteger(Value(input, "initialWins")),
        (int)ToNonNegativeInteger(Value(input, "initialDraws")),
        (int)ToNonNegativeInteger(Value(input, "initialLosses")),
        StringValue(Value(input, "archetype")).Trim());

    private static LiveTournamentRoundDocument NormalizeRound(JsonElement input, int fallbackRoundNumber, Func<string> idFactory)
    {
        var id = NullishString(input, "id") ?? idFactory();
        var roundNumber = (int)ToNonNegativeInteger(Value(input, "roundNumber"));
        return new LiveTournamentRoundDocument(
            id,
            roundNumber > 0 ? roundNumber : fallbackRoundNumber,
            NormalizeRoundEntries(Value(input, "entries"), idFactory),
            IsTruthy(Value(input, "validated")));
    }

    private static IReadOnlyList<LiveTournamentRoundEntryDocument> NormalizeRoundEntries(JsonElement? entries, Func<string> idFactory)
    {
        if (entries is not { ValueKind: JsonValueKind.Array }) return [];
        var normalized = new List<LiveTournamentRoundEntryDocument>();
        foreach (var item in entries.Value.EnumerateArray())
        {
            var entryValue = Value(item, "entry");
            if (entryValue is not { ValueKind: JsonValueKind.Object }) continue;
            var kind = StringValue(Value(entryValue.Value, "kind"));
            if (kind is not ("match" or "bye" or "invalid")) continue;
            var entry = CreateRoundEntry(entryValue.Value, idFactory);
            normalized.Add(new LiveTournamentRoundEntryDocument(entry, entry is ByeRoundEntry || IsTruthy(Value(item, "resultEntered"))));
        }
        return normalized;
    }

    /// <summary>Mirrors createRoundEntry from models.ts when called without a table fallback.</summary>
    internal static RoundEntry CreateRoundEntry(JsonElement input, Func<string> idFactory)
    {
        var kind = StringValue(Value(input, "kind"));
        var id = NullishString(input, "id") ?? idFactory();
        var table = StringValue(Value(input, "table"));
        return kind switch
        {
            "bye" => new ByeRoundEntry(
                id,
                table,
                LeagueNormalizer.TrimPlayerName(StringValue(Value(input, "playerName"))),
                LeagueNormalizer.NormalizeDeckArchetype(StringValue(Value(input, "deckArchetype")))),
            "invalid" => new InvalidRoundEntry(
                id,
                StringValue(Value(input, "rawText")),
                table,
                LeagueNormalizer.TrimPlayerName(StringValue(Value(input, "player"))),
                StringValue(Value(input, "result")),
                LeagueNormalizer.TrimPlayerName(StringValue(Value(input, "opponent"))),
                StringValue(Value(input, "playerDecklist")),
                StringValue(Value(input, "opponentDecklist"))),
            _ => new MatchRoundEntry(
                id,
                table,
                LeagueNormalizer.TrimPlayerName(StringValue(Value(input, "player1Name"))),
                LeagueNormalizer.TrimPlayerName(StringValue(Value(input, "player2Name"))),
                (int)(HasValue(input, "player1Score") ? ToNonNegativeInteger(Value(input, "player1Score")) : 2),
                (int)ToNonNegativeInteger(Value(input, "player2Score")),
                LeagueNormalizer.NormalizeDeckArchetype(StringValue(Value(input, "player1DeckArchetype"))),
                LeagueNormalizer.NormalizeDeckArchetype(StringValue(Value(input, "player2DeckArchetype"))))
        };
    }

    private static LiveTournamentCheckpointDocument NormalizeCheckpoint(JsonElement input, Func<string> idFactory, string nowIso)
    {
        var stage = StringValue(Value(input, "stage")) == "standings" ? "standings" : "round";
        var id = NullishString(input, "id") ?? idFactory();
        var label = TruthyStringOrFallback(input, "label", DefaultCheckpointLabel(stage));
        var createdAt = TruthyStringOrFallback(input, "createdAt", nowIso);
        return new LiveTournamentCheckpointDocument(
            id,
            label,
            createdAt,
            stage,
            (int)ToNonNegativeInteger(Value(input, "currentRoundNumber")),
            (int)ToNonNegativeInteger(Value(input, "roundCount")),
            Value(input, "paidTrackingEnabled") is not { ValueKind: JsonValueKind.False },
            NormalizePlayers(ArrayItems(input, "players").Select(item => NormalizePlayerInput(item, idFactory)).ToArray()),
            ArrayItems(input, "rounds").Select((item, index) => NormalizeRound(item, index + 1, idFactory)).ToArray());
    }

    internal static IReadOnlyList<string> NormalizePlayerIdList(JsonElement? value)
    {
        if (value is not { ValueKind: JsonValueKind.Array }) return [];
        return NormalizePlayerIdList(value.Value.EnumerateArray().Select(item => StringValue(item)).ToArray());
    }

    internal static IReadOnlyList<string> NormalizePlayerIdList(IEnumerable<string> value)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var ids = new List<string>();
        foreach (var item in value)
        {
            var id = (item ?? string.Empty).Trim();
            if (id.Length == 0 || !seen.Add(id)) continue;
            ids.Add(id);
        }
        return ids;
    }

    private static string DefaultedName(JsonElement input, string name, string fallback)
    {
        var value = Value(input, name);
        var text = value is not null && IsTruthy(value) ? StringValue(value) : fallback;
        return DefaultedNameText(text, fallback);
    }

    private static string DefaultedNameText(string text, string fallback)
    {
        var trimmed = (text ?? string.Empty).Trim();
        return trimmed.Length == 0 ? fallback : trimmed;
    }

    private static string TruthyStringOrFallback(JsonElement input, string name, string fallback)
    {
        var value = Value(input, name);
        return value is not null && IsTruthy(value) ? StringValue(value) : fallback;
    }

    internal static long ToNonNegativeInteger(JsonElement? value)
    {
        double parsed;
        if (value is { ValueKind: JsonValueKind.Number })
        {
            parsed = value.Value.GetDouble();
        }
        else
        {
            var text = StringValue(value).Trim();
            parsed = text.Length == 0
                ? 0
                : double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var number) ? number : double.NaN;
        }
        return double.IsInteger(parsed) && parsed >= 0 ? (long)parsed : 0;
    }

    private static bool HasValue(JsonElement input, string name)
    {
        var value = Value(input, name);
        return value is not null && value.Value.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined);
    }

    private static IEnumerable<JsonElement> ArrayItems(JsonElement input, string name)
    {
        var value = Value(input, name);
        return value is { ValueKind: JsonValueKind.Array } ? value.Value.EnumerateArray().ToArray() : [];
    }

    private static string? NullishString(JsonElement input, string name)
    {
        var value = Value(input, name);
        return value is null || value.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined ? null : StringValue(value);
    }

    private static JsonElement? Value(JsonElement input, string name) =>
        input.ValueKind == JsonValueKind.Object && input.TryGetProperty(name, out var value) ? value : null;

    private static bool IsTruthy(JsonElement? value) => value is not null && value.Value.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined or JsonValueKind.False => false,
        JsonValueKind.String => value.Value.GetString()!.Length > 0,
        JsonValueKind.Number => value.Value.TryGetDouble(out var number) && number != 0 && !double.IsNaN(number),
        _ => true
    };

    private static string StringValue(JsonElement? value) => value is null || value.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined
        ? string.Empty
        : value.Value.ValueKind switch
        {
            JsonValueKind.String => value.Value.GetString() ?? string.Empty,
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => value.Value.GetRawText()
        };
}
