using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Gones.Domain.Leagues;
using Gones.Domain.Live;

namespace Gones.UnitTests;

public sealed class LiveParityTests
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

        var clock = parity.RootElement.GetProperty("clock");
        var nowIso = clock.GetProperty("nowIso").GetString()!;
        var today = clock.GetProperty("today").GetString()!;
        var defaultTournamentName = today.Replace('-', '/');

        var processed = new Dictionary<string, int>(StringComparer.Ordinal);
        var registrationUuids = FixedUuidFactory();
        Process("registrations", testCase =>
        {
            var actual = LiveNormalizer.NormalizePlayer(testCase.GetProperty("input"), registrationUuids);
            AssertJson(testCase.GetProperty("expected"), LeagueJson.ToNode(actual));
        });
        Process("normalizations", testCase =>
        {
            var actual = LiveNormalizer.Normalize(testCase.GetProperty("input"), FixedUuidFactory(), nowIso, today);
            AssertJson(testCase.GetProperty("expected"), LeagueJson.ToNode(actual));
        });
        Process("shuffles", testCase =>
        {
            var input = testCase.GetProperty("input");
            var items = input.GetProperty("items").EnumerateArray().Select(item => item.GetString()!).ToArray();
            var actual = LiveRules.SeededShuffle(items, input.GetProperty("seed").GetInt64());
            AssertJson(testCase.GetProperty("expected"), LeagueJson.ToNode(actual));
        });
        Process("roundGenerations", testCase =>
        {
            var input = testCase.GetProperty("input");
            var tournament = LeagueJson.Deserialize<LiveTournamentDocument>(input.GetProperty("tournament"));
            var actual = LiveRules.GenerateNextSwissRound(
                tournament,
                PrefixedIdFactory(input.GetProperty("idPrefix").GetString()!),
                RandomSeed(input),
                nowIso);
            AssertJson(testCase.GetProperty("expected"), LeagueJson.ToNode(actual));
        });
        Process("roundRegenerations", testCase =>
        {
            var input = testCase.GetProperty("input");
            var tournament = LeagueJson.Deserialize<LiveTournamentDocument>(input.GetProperty("tournament"));
            var actual = LiveRules.RegenerateCurrentSwissRound(
                tournament,
                PrefixedIdFactory(input.GetProperty("idPrefix").GetString()!),
                RandomSeed(input),
                nowIso);
            AssertJson(testCase.GetProperty("expected"), LeagueJson.ToNode(actual));
        });
        Process("roundCancellations", testCase =>
        {
            var tournament = LeagueJson.Deserialize<LiveTournamentDocument>(testCase.GetProperty("input").GetProperty("tournament"));
            AssertJson(testCase.GetProperty("expected"), LeagueJson.ToNode(LiveRules.CancelCurrentSwissRound(tournament, nowIso)));
        });
        Process("roundValidations", testCase =>
        {
            var tournament = LeagueJson.Deserialize<LiveTournamentDocument>(testCase.GetProperty("input").GetProperty("tournament"));
            var actual = LiveRules.ValidateCurrentSwissRound(tournament, nowIso, FixedUuidFactory());
            AssertJson(testCase.GetProperty("expected"), LeagueJson.ToNode(actual));
        });
        Process("scoreUpdates", testCase =>
        {
            var input = testCase.GetProperty("input");
            var tournament = LeagueJson.Deserialize<LiveTournamentDocument>(input.GetProperty("tournament"));
            var actual = LiveRules.UpdateRoundEntryResult(
                tournament,
                input.GetProperty("roundId").GetString()!,
                input.GetProperty("entryId").GetString()!,
                input.GetProperty("player1Score").GetDouble(),
                input.GetProperty("player2Score").GetDouble(),
                nowIso);
            AssertJson(testCase.GetProperty("expected"), LeagueJson.ToNode(actual));
        });
        Process("scoreIssues", testCase =>
        {
            var input = testCase.GetProperty("input");
            var kind = input.GetProperty("kind").GetString()!;
            var player1Score = input.TryGetProperty("player1Score", out var score1) ? score1.GetDouble() : 0;
            var player2Score = input.TryGetProperty("player2Score", out var score2) ? score2.GetDouble() : 0;
            var actual = LiveRules.MatchScoreIssue(kind, player1Score, player2Score);
            var expected = testCase.GetProperty("expected");
            Assert.Equal(expected.ValueKind == JsonValueKind.Null ? null : expected.GetString(), actual);
        });
        Process("standings", testCase =>
        {
            var input = testCase.GetProperty("input");
            var tournament = LeagueJson.Deserialize<LiveTournamentDocument>(input.GetProperty("tournament"));
            var throughRound = input.GetProperty("throughRound");
            var actual = throughRound.ValueKind == JsonValueKind.Null
                ? LiveRules.CalculateStandings(tournament)
                : LiveRules.CalculateStandingsThroughRound(tournament, throughRound.GetInt32());
            AssertJson(testCase.GetProperty("expected"), LeagueJson.ToNode(actual));
        });
        Process("restores", testCase =>
        {
            var input = testCase.GetProperty("input");
            var tournament = LeagueJson.Deserialize<LiveTournamentDocument>(input.GetProperty("tournament"));
            var actual = LiveRules.RestoreCheckpoint(tournament, input.GetProperty("checkpointId").GetString()!, nowIso);
            AssertJson(testCase.GetProperty("expected"), LeagueJson.ToNode(actual));
        });
        Process("completions", testCase =>
        {
            var input = testCase.GetProperty("input");
            var tournament = LeagueJson.Deserialize<LiveTournamentDocument>(input.GetProperty("tournament"));
            var actual = LiveRules.Finalize(tournament, PrefixedIdFactory(input.GetProperty("idPrefix").GetString()!), defaultTournamentName);
            AssertJson(testCase.GetProperty("expected"), LeagueJson.ToNode(actual));
        });
        Process("roundCountRules", testCase =>
        {
            Assert.Equal(testCase.GetProperty("expected").GetInt32(), LiveRules.ExpectedSwissRoundCount(testCase.GetProperty("input").GetInt32()));
        });
        Process("stateRules", testCase =>
        {
            var tournament = LeagueJson.Deserialize<LiveTournamentDocument>(testCase.GetProperty("input").GetProperty("tournament"));
            var actual = new StateRuleOutput(
                LiveRules.CanStart(tournament),
                LiveRules.Finished(tournament),
                LiveRules.AutoSwissRoundCount(tournament),
                LiveRules.ActivePlayers(tournament).Select(player => player.Id).ToArray(),
                LiveRules.UnpaidActivePlayers(tournament).Select(player => player.Id).ToArray(),
                LiveRules.CurrentRoundComplete(tournament));
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
    public void Serializer_round_trips_generated_live_documents_without_json_drift()
    {
        var random = new Random(3301);
        for (var index = 0; index < 100; index++)
        {
            var document = new LiveTournamentDocument(
                $"live-{index}",
                $"Live {index}",
                index % 2 == 0 ? $"league-{index}" : "",
                "2026-08-05",
                "swiss",
                3,
                index % 2 == 0,
                index % 3 != 0,
                (uint)random.Next(),
                [$"p-{index}-1", $"p-{index}-2"],
                index % 2 == 0 ? "round" : "standings",
                1,
                [new LiveTournamentPlayerDocument($"p-{index}-1", $"Player {index}", true, false, 1, 0, 2, "Red Aggro")],
                [new LiveTournamentRoundDocument($"r-{index}", 1, [
                    new LiveTournamentRoundEntryDocument(new MatchRoundEntry($"m-{index}", "1", "A", "B", random.Next(0, 3), random.Next(0, 3), "", ""), true),
                    new LiveTournamentRoundEntryDocument(new ByeRoundEntry($"b-{index}", "2", "C", "Earth"), true)
                ], index % 2 == 0)],
                [new LiveTournamentCheckpointDocument($"c-{index}", "Pairing 1", "2026-08-05T10:00:00.000Z", "round", 1, 3, true, [], [])],
                index % 4 == 0 ? $"final-{index}" : null,
                index + 1,
                "2026-08-05T09:00:00.000Z",
                "2026-08-05T10:00:00.000Z");

            var json = LeagueJson.Serialize(document);
            var restored = LeagueJson.Deserialize<LiveTournamentDocument>(json);
            Assert.True(JsonNode.DeepEquals(JsonNode.Parse(json), LeagueJson.ToNode(restored)));
        }
    }

    [Fact]
    public void Standings_points_and_game_totals_stay_consistent_for_generated_results()
    {
        var random = new Random(3302);
        for (var index = 0; index < 200; index++)
        {
            var leftScore = random.Next(0, 3);
            var rightScore = random.Next(0, 3);
            var tournament = TwoPlayerTournament(leftScore, rightScore);
            var rows = LiveRules.CalculateStandings(tournament);
            var alice = Assert.Single(rows, row => row.PlayerName == "Alice");
            var bob = Assert.Single(rows, row => row.PlayerName == "Bob");

            Assert.Equal(leftScore + rightScore, alice.GameWins + alice.GameLosses);
            Assert.Equal(alice.GameWins, bob.GameLosses);
            Assert.Equal(leftScore == rightScore ? 2 : 3, alice.Points + bob.Points);
            Assert.Equal(1, alice.PlayedMatchCount);
            Assert.Equal([1, 2], rows.Select(row => row.Rank).Order().ToArray());
        }
    }

    private static LiveTournamentDocument TwoPlayerTournament(int leftScore, int rightScore) => new(
        "property-live",
        "Property",
        "",
        "2026-08-05",
        "swiss",
        1,
        false,
        true,
        1,
        ["pa", "pb"],
        "standings",
        1,
        [
            new LiveTournamentPlayerDocument("pa", "Alice", true, false, 0, 0, 0, ""),
            new LiveTournamentPlayerDocument("pb", "Bob", true, false, 0, 0, 0, "")
        ],
        [new LiveTournamentRoundDocument("r1", 1, [
            new LiveTournamentRoundEntryDocument(new MatchRoundEntry("m1", "1", "Alice", "Bob", leftScore, rightScore, "", ""), true)
        ], true)],
        [],
        null,
        1,
        "2026-08-05T09:00:00.000Z",
        "2026-08-05T10:00:00.000Z");

    private static Func<string> FixedUuidFactory()
    {
        var next = 0;
        return () => $"fixed-uuid-{++next}";
    }

    private static Func<string> PrefixedIdFactory(string prefix)
    {
        var next = 0;
        return () => $"{prefix}-{++next}";
    }

    private static Func<long> RandomSeed(JsonElement input)
    {
        var value = input.GetProperty("randomSeed");
        if (value.ValueKind == JsonValueKind.Null)
        {
            return () => throw new InvalidOperationException("randomSeed must not be consumed for this fixture case.");
        }
        var seed = value.GetInt64();
        return () => seed;
    }

    private static void AssertJson(JsonElement expected, JsonNode? actual)
    {
        var expectedNode = JsonNode.Parse(expected.GetRawText());
        Assert.True(JsonNode.DeepEquals(expectedNode, actual), $"Expected: {expectedNode}\nActual: {actual}");
    }

    private static string FindFixtureDirectory()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            var candidate = Path.Combine(directory.FullName, "fixtures", "live-domain", "v1");
            if (Directory.Exists(candidate)) return candidate;
        }
        throw new DirectoryNotFoundException("fixtures/live-domain/v1");
    }

    private sealed record StateRuleOutput(
        bool CanStart,
        bool Finished,
        int AutoRoundCount,
        IReadOnlyList<string> ActivePlayerIds,
        IReadOnlyList<string> UnpaidActivePlayerIds,
        bool CurrentRoundComplete);
}
