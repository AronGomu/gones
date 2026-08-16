using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Gones.Domain.Leagues;

public static partial class LeagueNormalizer
{
    public const int GonesDataVersion = 4;
    public const string PlaceholderLeagueId = "placeholder-league";
    public const string PlaceholderLeagueName = "Unassigned Tournaments";

    private static readonly string[] UnassignedLeagueDisplayNames = [PlaceholderLeagueName, "Tournois non assignés"];
    private static readonly CultureInfo ComparisonCulture = CultureInfo.GetCultureInfo("en-US");

    public static LeagueDocument Normalize(JsonElement input, Func<string>? idFactory = null)
    {
        idFactory ??= () => Guid.NewGuid().ToString();
        var id = NullishString(input, "id") ?? idFactory();
        var status = NormalizeStatus(Value(input, "status"));
        var tournaments = Array(input, "tournaments")
            .Select(item => NormalizeTournament(item, id, idFactory))
            .ToArray();

        if (id == PlaceholderLeagueId)
            return new LeagueDocument(PlaceholderLeagueId, PlaceholderLeagueName, status, tournaments);

        return new LeagueDocument(id, DefaultedTrimmedString(input, "name", "New League"), status, tournaments);
    }

    public static LeagueDocument CreatePlaceholderLeague() =>
        new(PlaceholderLeagueId, PlaceholderLeagueName, "active", []);

    public static string NormalizeLeagueNameKey(string? name) => RemoveCombiningMarks((name ?? string.Empty).Trim().ToLowerInvariant());

    public static bool IsUnassignedLeagueName(string? name)
    {
        var key = NormalizeLeagueNameKey(name);
        return key.Length > 0 && UnassignedLeagueDisplayNames.Any(label => NormalizeLeagueNameKey(label) == key);
    }

    public static string TrimPlayerName(string? value) => (value ?? string.Empty).Trim();

    public static string NormalizeDeckArchetype(string? value)
    {
        var trimmed = WhitespaceRegex().Replace((value ?? string.Empty).Trim(), " ");
        return string.Equals(trimmed, "no archetype", StringComparison.OrdinalIgnoreCase) ? string.Empty : trimmed;
    }

    internal static int ComparePlayerNames(string left, string right) =>
        ComparisonCulture.CompareInfo.Compare(left, right, CompareOptions.None);

    internal static string PlayerNameKey(string? name) => TrimPlayerName(name).ToLower(ComparisonCulture);

    private static TournamentDocument NormalizeTournament(JsonElement input, string parentLeagueId, Func<string> idFactory)
    {
        var rounds = Array(input, "rounds").Select(item => NormalizeRound(item, idFactory)).ToArray();
        var leagueIdValue = StringValue(Value(input, "leagueId"));
        var leagueId = IsTruthy(Value(input, "leagueId")) ? leagueIdValue : parentLeagueId;
        var archetypeValue = Value(input, "playerArchetypes");
        var archetypes = archetypeValue is null || archetypeValue.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined
            ? DerivePlayerArchetypes(rounds)
            : NormalizePlayerArchetypes(archetypeValue.Value);

        return new TournamentDocument(
            NullishString(input, "id") ?? idFactory(),
            leagueId,
            DefaultedTrimmedString(input, "name", DateTime.Now.ToString("yyyy/MM/dd", CultureInfo.InvariantCulture)),
            StringValue(Value(input, "tournamentDate")),
            NormalizeTournamentStatus(Value(input, "status")),
            rounds,
            archetypes);
    }

    private static RoundDocument NormalizeRound(JsonElement input, Func<string> idFactory)
    {
        var entries = Array(input, "entries")
            .Select((item, index) => NormalizeEntry(item, (index + 1).ToString(CultureInfo.InvariantCulture), idFactory))
            .ToArray();
        return new RoundDocument(NullishString(input, "id") ?? idFactory(), entries);
    }

    private static RoundEntry NormalizeEntry(JsonElement input, string fallbackTable, Func<string> idFactory)
    {
        var kind = StringValue(Value(input, "kind"));
        var table = IsTruthy(Value(input, "table")) ? StringValue(Value(input, "table")) : fallbackTable;
        var id = NullishString(input, "id") ?? idFactory();
        return kind switch
        {
            "bye" => new ByeRoundEntry(
                id,
                table,
                TrimPlayerName(StringValue(Value(input, "playerName"))),
                NormalizeDeckArchetype(StringValue(Value(input, "deckArchetype")))),
            "invalid" => new InvalidRoundEntry(
                id,
                StringValue(Value(input, "rawText")),
                table,
                TrimPlayerName(StringValue(Value(input, "player"))),
                StringValue(Value(input, "result")),
                TrimPlayerName(StringValue(Value(input, "opponent"))),
                StringValue(Value(input, "playerDecklist")),
                StringValue(Value(input, "opponentDecklist"))),
            _ => new MatchRoundEntry(
                id,
                table,
                TrimPlayerName(StringValue(Value(input, "player1Name"))),
                TrimPlayerName(StringValue(Value(input, "player2Name"))),
                NormalizeScore(input, "player1Score", 2),
                NormalizeScore(input, "player2Score", 0),
                NormalizeDeckArchetype(StringValue(Value(input, "player1DeckArchetype"))),
                NormalizeDeckArchetype(StringValue(Value(input, "player2DeckArchetype"))))
        };
    }

    private static IReadOnlyList<PlayerArchetypeDocument> NormalizePlayerArchetypes(JsonElement input)
    {
        if (input.ValueKind != JsonValueKind.Array) return [];
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var rows = new List<PlayerArchetypeDocument>();
        foreach (var item in input.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object) continue;
            var playerName = TrimPlayerName(StringValue(Value(item, "playerName")));
            if (playerName.Length == 0 || !seen.Add(playerName)) continue;
            rows.Add(new PlayerArchetypeDocument(playerName, NormalizeDeckArchetype(StringValue(Value(item, "archetype")))));
        }
        rows.Sort((left, right) => ComparePlayerNames(left.PlayerName, right.PlayerName));
        return rows;
    }

    private static IReadOnlyList<PlayerArchetypeDocument> DerivePlayerArchetypes(IReadOnlyList<RoundDocument> rounds)
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var entry in rounds.SelectMany(round => round.Entries))
        {
            if (entry is MatchRoundEntry match)
            {
                Add(match.Player1Name, match.Player1DeckArchetype);
                Add(match.Player2Name, match.Player2DeckArchetype);
            }
            else if (entry is ByeRoundEntry bye) Add(bye.PlayerName, bye.DeckArchetype);
        }
        return map.Select(item => new PlayerArchetypeDocument(item.Key, item.Value)).ToArray();

        void Add(string name, string archetype)
        {
            var normalizedName = TrimPlayerName(name);
            if (normalizedName.Length > 0 && !map.ContainsKey(normalizedName))
                map.Add(normalizedName, NormalizeDeckArchetype(archetype));
        }
    }

    private static string NormalizeStatus(JsonElement? value)
    {
        var status = StringValue(value);
        return status is "completed" or "finished" ? "completed" : "active";
    }

    /// <summary>
    /// Deliberately the opposite default to <see cref="NormalizeStatus"/>: an archive document that predates the
    /// field is history, and history is complete. Only the literal "active" reads active; a missing, null or
    /// unknown value reads "completed", the same rule the backfill migration applies to stored documents.
    /// A League status never cascades here — the two flags are independent.
    /// </summary>
    public static string NormalizeTournamentStatus(JsonElement? value) => StringValue(value) == "active" ? "active" : "completed";

    private static string DefaultedTrimmedString(JsonElement input, string name, string fallback)
    {
        var value = Value(input, name);
        var text = IsTruthy(value) ? StringValue(value) : fallback;
        var trimmed = text.Trim();
        return trimmed.Length == 0 ? fallback : trimmed;
    }

    private static int NormalizeScore(JsonElement input, string name, int fallback)
    {
        if (input.ValueKind != JsonValueKind.Object || !input.TryGetProperty(name, out var value)) return fallback;
        var text = StringValue(value);
        if (double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var number)
            && number >= 0 && number <= int.MaxValue && number == Math.Truncate(number))
            return (int)number;
        return 0;
    }

    private static IEnumerable<JsonElement> Array(JsonElement input, string name)
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

    private static string RemoveCombiningMarks(string value)
    {
        var normalized = value.Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(normalized.Length);
        foreach (var rune in normalized.EnumerateRunes())
        {
            var category = Rune.GetUnicodeCategory(rune);
            if (category is not (UnicodeCategory.NonSpacingMark or UnicodeCategory.SpacingCombiningMark or UnicodeCategory.EnclosingMark))
                builder.Append(rune);
        }
        return builder.ToString();
    }

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();
}
