using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Gones.Domain.Leagues;

namespace Gones.UnitTests;

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
        Assert.Equal(
            manifest.RootElement.GetProperty("paritySha256").GetString(),
            Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(parityText))));

        var processed = new Dictionary<string, int>(StringComparer.Ordinal);
        Process("normalization", testCase =>
        {
            var next = 1;
            var actual = LeagueNormalizer.Normalize(testCase.GetProperty("input"), () => $"normalized-{next++}");
            AssertJson(testCase.GetProperty("expected"), LeagueJson.ToNode(actual));
        });
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
            var input = LeagueJson.Deserialize<TournamentDocument>(testCase.GetProperty("input"));
            AssertJson(testCase.GetProperty("expected"), LeagueJson.ToNode(LeagueRules.GetWarnings(input)));
        });
        Process("tournamentResults", testCase =>
        {
            var input = LeagueJson.Deserialize<TournamentDocument>(testCase.GetProperty("input"));
            AssertJson(testCase.GetProperty("expected"), LeagueJson.ToNode(LeagueRules.CalculateTournamentResult(input)));
        });
        Process("leagueResults", testCase =>
        {
            var input = LeagueJson.Deserialize<LeagueDocument>(testCase.GetProperty("input"));
            AssertJson(testCase.GetProperty("expected"), LeagueJson.ToNode(LeagueRules.CalculateLeagueResult(input)));
        });
        Process("playerStatistics", testCase =>
        {
            var input = testCase.GetProperty("input");
            var data = LeagueJson.Deserialize<GonesData>(input.GetProperty("data"));
            var filters = LeagueJson.Deserialize<PlayerStatisticsFilters>(input.GetProperty("filters"));
            var actual = LeagueRules.CalculatePlayerStatistics(data, input.GetProperty("playerName").GetString()!, filters);
            AssertJson(testCase.GetProperty("expected"), LeagueJson.ToNode(actual));
        });
        Process("globalPlayerStatistics", testCase =>
        {
            var data = LeagueJson.Deserialize<GonesData>(testCase.GetProperty("input"));
            AssertJson(testCase.GetProperty("expected"), LeagueJson.ToNode(LeagueRules.CalculateGlobalPlayerStatistics(data)));
        });
        Process("renames", testCase =>
        {
            var input = testCase.GetProperty("input");
            var league = LeagueJson.Deserialize<LeagueDocument>(input.GetProperty("league"));
            var actual = LeagueRules.RenamePlayer(league, input.GetProperty("fromName").GetString()!, input.GetProperty("toName").GetString()!);
            AssertJson(testCase.GetProperty("expected"), LeagueJson.ToNode(actual));
        });
        Process("placeholders", testCase =>
        {
            var input = testCase.GetProperty("input");
            var names = new[] { "  Été League  ", "ÉTÉ LEAGUE", " Tournois non assignés " };
            var labels = new[] { "Unassigned Tournaments", " Tournois non assignés ", "Other" };
            var actual = new PlaceholderFixtureOutput(
                LeagueNormalizer.Normalize(input, () => "unused"),
                LeagueNormalizer.CreatePlaceholderLeague(),
                names.Select(LeagueNormalizer.NormalizeLeagueNameKey).ToArray(),
                labels.Select(LeagueNormalizer.IsUnassignedLeagueName).ToArray());
            AssertJson(testCase.GetProperty("expected"), LeagueJson.ToNode(actual));
        });

        var expectedCounts = manifest.RootElement.GetProperty("caseCounts");
        Assert.Equal(expectedCounts.EnumerateObject().Count(), processed.Count);
        foreach (var count in expectedCounts.EnumerateObject())
        {
            Assert.True(processed.TryGetValue(count.Name, out var actualCount));
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
    public void Serializer_round_trips_generated_leagues_without_json_drift()
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
            var league = new LeagueDocument(
                $"league-{index}",
                $"League {index}",
                index % 2 == 0 ? "active" : "completed",
                [new TournamentDocument($"tournament-{index}", $"league-{index}", $"Tournament {index}", "2026-01-01", index % 2 == 0 ? "active" : "completed", [new RoundDocument($"round-{index}", [entry])], [new PlayerArchetypeDocument($"Player {index}", "Red Aggro")])]);

            var json = LeagueJson.Serialize(league);
            var restored = LeagueJson.Deserialize<LeagueDocument>(json);
            Assert.True(JsonNode.DeepEquals(JsonNode.Parse(json), LeagueJson.ToNode(restored)));
        }
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
            var candidate = Path.Combine(directory.FullName, "fixtures", "league-domain", "v1");
            if (Directory.Exists(candidate)) return candidate;
        }
        throw new DirectoryNotFoundException("fixtures/league-domain/v1");
    }

    private sealed record PlaceholderFixtureOutput(
        LeagueDocument League,
        LeagueDocument Created,
        string[] NameKeys,
        bool[] Unassigned);
}
