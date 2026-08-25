using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Gones.Domain.Archive;
using Gones.Domain.Leagues;

namespace Gones.UnitTests;

/// <summary>
/// The C# half of the cross-stack domain parity corpus. `src/app/domain/archive-parity-fixtures.test.ts`
/// emits language-neutral fixtures from the three-tier TypeScript shapes; this replays every one of
/// them through the C# domain, so a rule that drifts on one side fails here instead of quietly
/// disagreeing in production.
///
/// The corpus moved from `fixtures/league-domain/v1` to `fixtures/archive-domain/v5/parity` with the
/// archive rebuild (T19): the flat `LeagueDocument`/`GonesData` inputs it used are retired on the
/// TypeScript side. The standings engine here still speaks those records, so each archive-shaped
/// input is bridged through <see cref="ArchiveDocumentAdapter"/> — the same one conversion the API
/// uses, never a second implementation.
/// </summary>
public sealed class LeagueParityTests
{
    private static readonly string FixtureDirectory = FindFixtureDirectory();

    [Fact]
    public void Every_frozen_typescript_output_has_csharp_parity()
    {
        var parityText = File.ReadAllText(Path.Combine(FixtureDirectory, "parity.json"));
        using var parity = JsonDocument.Parse(parityText);
        using var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(FixtureDirectory, "manifest.json")));

        Assert.Equal(1, manifest.RootElement.GetProperty("fixtureVersion").GetInt32());
        Assert.Equal("TypeScript", manifest.RootElement.GetProperty("source").GetProperty("language").GetString());
        Assert.Equal(5, manifest.RootElement.GetProperty("source").GetProperty("sourceDataVersion").GetInt32());
        Assert.Equal(
            manifest.RootElement.GetProperty("paritySha256").GetString(),
            Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(parityText))));

        var processed = new Dictionary<string, int>(StringComparer.Ordinal);
        Process("csvImports", testCase =>
        {
            var input = testCase.GetProperty("input");
            var prefix = input.GetProperty("idPrefix").GetString();
            var next = 1;
            var actual = RoundCsvAdapter.Import(input.GetProperty("text").GetString()!, () => $"{prefix}-{next++}");
            AssertJson(testCase.GetProperty("expected"), LeagueJson.ToNode(actual));
        });
        Process("validations", testCase =>
        {
            var input = LeagueJson.Deserialize<RoundEntry>(testCase.GetProperty("input"));
            AssertJson(testCase.GetProperty("expected"), LeagueJson.ToNode(LeagueRules.Validate(input)));
        });
        Process("warnings", testCase =>
        {
            var input = LegacyTournament(testCase.GetProperty("input"));
            AssertJson(testCase.GetProperty("expected"), LeagueJson.ToNode(LeagueRules.GetWarnings(input)));
        });
        Process("tournamentResults", testCase =>
        {
            var input = LegacyTournament(testCase.GetProperty("input"));
            AssertJson(testCase.GetProperty("expected"), LeagueJson.ToNode(LeagueRules.CalculateTournamentResult(input)));
        });
        Process("leagueSeasonResults", testCase =>
        {
            // A Season's standings are one pass over its Tournaments, which is what the carrier League is.
            var league = CarrierLeague(testCase.GetProperty("input"));
            AssertJson(testCase.GetProperty("expected"), LeagueJson.ToNode(LeagueRules.CalculateLeagueResult(league)));
        });
        Process("playerStatistics", testCase =>
        {
            var input = testCase.GetProperty("input");
            var data = CarrierData(input.GetProperty("tournaments"));
            var filters = ParityFilters(input.GetProperty("filters"));
            var actual = LeagueRules.CalculatePlayerStatistics(data, input.GetProperty("playerName").GetString()!, filters);
            AssertJson(testCase.GetProperty("expected"), CountsOnly(LeagueJson.ToNode(actual)));
        });
        Process("globalPlayerStatistics", testCase =>
        {
            var data = CarrierData(testCase.GetProperty("input"));
            AssertJson(testCase.GetProperty("expected"), LeagueJson.ToNode(LeagueRules.CalculateGlobalPlayerStatistics(data)));
        });
        Process("renames", testCase =>
        {
            var input = testCase.GetProperty("input");
            var tournament = ArchiveTournament(input.GetProperty("tournament"));
            var actual = ArchiveTournamentCommands.RenamePlayer(
                tournament,
                input.GetProperty("fromName").GetString()!,
                input.GetProperty("toName").GetString()!);
            AssertJson(testCase.GetProperty("expected"), LeagueJson.ToNode(actual));
        });

        var expectedCounts = manifest.RootElement.GetProperty("caseCounts");
        Assert.Equal(expectedCounts.EnumerateObject().Count(), processed.Count);
        foreach (var count in expectedCounts.EnumerateObject())
        {
            Assert.True(processed.TryGetValue(count.Name, out var actualCount), $"Fixture class '{count.Name}' was not replayed.");
            Assert.Equal(count.Value.GetInt32(), actualCount);
        }

        void Process(string propertyName, Action<JsonElement> assertion)
        {
            var cases = parity.RootElement.GetProperty(propertyName).EnumerateArray().ToArray();
            foreach (var testCase in cases) assertion(testCase);
            processed.Add(propertyName, cases.Length);
        }
    }

    [Fact]
    public void Score_and_result_properties_hold_for_generated_matches()
    {
        var random = new Random(2901);
        for (var index = 0; index < 250; index++)
        {
            var leftScore = random.Next(0, 3);
            var rightScore = random.Next(0, 3);
            var tournament = Tournament("Alice", leftScore, "Bob", rightScore);
            var result = LeagueRules.CalculateTournamentResult(tournament);
            var alice = Assert.Single(result.Rows, row => row.PlayerName == "Alice");
            var bob = Assert.Single(result.Rows, row => row.PlayerName == "Bob");

            Assert.Equal(leftScore + rightScore, alice.GameWins + alice.GameLosses);
            Assert.Equal(alice.GameWins, bob.GameLosses);
            Assert.Equal(alice.GameLosses, bob.GameWins);
            Assert.Equal(leftScore == rightScore ? 2 : 3, alice.Points + bob.Points);

            var swapped = LeagueRules.CalculateTournamentResult(Tournament("Bob", rightScore, "Alice", leftScore));
            Assert.Equal(alice.Points, Assert.Single(swapped.Rows, row => row.PlayerName == "Alice").Points);
            Assert.Equal(bob.Points, Assert.Single(swapped.Rows, row => row.PlayerName == "Bob").Points);
        }
    }

    [Fact]
    public void Serializer_round_trips_generated_archive_tournaments_without_json_drift()
    {
        var random = new Random(2902);
        for (var index = 0; index < 100; index++)
        {
            RoundEntry entry = (index % 3) switch
            {
                0 => new MatchRoundEntry($"m-{index}", (index + 1).ToString(), $"Player {index}", $"Opponent {index}", random.Next(0, 3), random.Next(0, 3), "Red Aggro", "Blue Control"),
                1 => new ByeRoundEntry($"b-{index}", (index + 1).ToString(), $"Player {index}", "Earth"),
                _ => new InvalidRoundEntry($"i-{index}", "raw,row", (index + 1).ToString(), $"Player {index}", "?", $"Opponent {index}", "Raw A", "Raw B")
            };
            // Every third Tournament stands alone, so the null Season crosses the serializer too.
            var tournament = new ArchiveTournamentDocument(
                $"tournament-{index}",
                $"Tournament {index}",
                index % 3 == 0 ? null : $"season-{index}",
                "2026-01-01",
                index % 2 == 0 ? "active" : "completed",
                [new RoundDocument($"round-{index}", [entry])],
                [new PlayerArchetypeDocument($"Player {index}", "Red Aggro")]);

            var json = LeagueJson.Serialize(tournament);
            var restored = LeagueJson.Deserialize<ArchiveTournamentDocument>(json);
            Assert.True(JsonNode.DeepEquals(JsonNode.Parse(json), LeagueJson.ToNode(restored)));
        }
    }

    private static ArchiveTournamentDocument ArchiveTournament(JsonElement element) =>
        LeagueJson.Deserialize<ArchiveTournamentDocument>(element);

    private static TournamentDocument LegacyTournament(JsonElement element) =>
        ArchiveDocumentAdapter.ToLegacyTournament(ArchiveTournament(element), string.Empty);

    /// <summary>
    /// The carrier the standings engine still takes. `CalculateLeagueResult` reads only the Tournament
    /// list, so the carrier's own id, name and status never reach an assertion.
    /// </summary>
    private static LeagueDocument CarrierLeague(JsonElement tournaments) =>
        new("parity-season", "Parity Season", "active", [.. tournaments.EnumerateArray().Select(LegacyTournament)]);

    private static GonesData CarrierData(JsonElement tournaments) =>
        new(5, [CarrierLeague(tournaments)], []);

    /// <summary>
    /// The TypeScript filter names the Season; `PlayerStatisticsFilters.LeagueId` is the same slot on
    /// this side, because the carrier League *is* the Season.
    /// </summary>
    private static PlayerStatisticsFilters ParityFilters(JsonElement filters) =>
        new(
            filters.TryGetProperty("seasonId", out var seasonId) ? "parity-season" : null,
            filters.TryGetProperty("tournamentId", out var tournamentId) ? tournamentId.GetString() : null,
            filters.TryGetProperty("opponentName", out var opponentName) ? opponentName.GetString() : null);

    /// <summary>
    /// Drops `matches`: a match carries its context object, and the two stacks disagree on that shape
    /// by design — this record still names a carrier League, TypeScript names the Archive Tournament.
    /// The numbers the rule exists to produce are what this class asserts.
    /// </summary>
    private static JsonNode? CountsOnly(JsonNode? statistics)
    {
        if (statistics is JsonObject json) json.Remove("matches");
        return statistics;
    }

    private static TournamentDocument Tournament(string leftName, int leftScore, string rightName, int rightScore) =>
        new("property-tournament", "property-league", "Property", "2026-01-01", "completed",
            [new RoundDocument("round", [new MatchRoundEntry("match", "1", leftName, rightName, leftScore, rightScore, "", "")])], []);

    private static void AssertJson(JsonElement expected, JsonNode? actual)
    {
        var expectedNode = JsonNode.Parse(expected.GetRawText());
        Assert.True(JsonNode.DeepEquals(expectedNode, actual), $"Expected: {expectedNode}\nActual: {actual}");
    }

    private static string FindFixtureDirectory()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            var candidate = Path.Combine(directory.FullName, "fixtures", "archive-domain", "v5", "parity");
            if (Directory.Exists(candidate)) return candidate;
        }
        throw new DirectoryNotFoundException("fixtures/archive-domain/v5/parity");
    }
}
