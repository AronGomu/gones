using System.Text.Json.Nodes;
using Gones.Domain.Leagues;

namespace Gones.UnitTests;

/// <summary>
/// Scope of the global statistics after ADR 0040: a Tournament is what is complete or not, so an active
/// League can contribute and a completed League can withhold.
/// </summary>
public sealed class LeagueRulesTests
{
    [Fact]
    public void Counts_a_completed_tournament_in_an_active_league()
    {
        var data = Data(League("active-league", "active", Tournament("done", "completed", Match("Alice", "Bob", 2, 1))));

        var rows = LeagueRules.CalculateGlobalPlayerStatistics(data);

        Assert.Equal(["Alice", "Bob"], rows.Select(row => row.PlayerName));
        Assert.Equal(1, rows.Single(row => row.PlayerName == "Alice").MatchWins);
    }

    [Fact]
    public void Skips_an_active_tournament_in_a_completed_league()
    {
        var data = Data(League("completed-league", "completed", Tournament("ongoing", "active", Match("Alice", "Bob", 2, 1))));

        Assert.Empty(LeagueRules.CalculateGlobalPlayerStatistics(data));
    }

    [Fact]
    public void Counts_only_completed_tournaments_of_a_mixed_league()
    {
        var data = Data(League(
            "mixed-league",
            "active",
            Tournament("done", "completed", Match("Alice", "Bob", 2, 0)),
            Tournament("ongoing", "active", Match("Alice", "Carol", 0, 2))));

        var rows = LeagueRules.CalculateGlobalPlayerStatistics(data);

        Assert.Equal(["Alice", "Bob"], rows.Select(row => row.PlayerName));
        var alice = rows.Single(row => row.PlayerName == "Alice");
        Assert.Equal(1, alice.PlayedMatchCount);
        Assert.Equal(1, alice.MatchWins);
        Assert.Equal(0, alice.MatchLosses);
        Assert.Equal(2, alice.PlayedGameCount);
    }

    /// <summary>
    /// The global counting pass and the per-player one are the same maths over the same accumulator, and
    /// only the per-player one publishes a match history. This pins that every counted field agrees, so
    /// dropping the history from the global path stays invisible in the numbers.
    /// </summary>
    [Fact]
    public void Global_statistics_match_the_per_player_counting_path()
    {
        var data = Data(League(
            "mixed-league",
            "active",
            Tournament("t1", "completed", Match("Alice", "Bob", 2, 1), Match("Carol", "Alice", 0, 2)),
            Tournament("t2", "completed", Match("Bob", "Carol", 2, 2))));

        var rows = LeagueRules.CalculateGlobalPlayerStatistics(data);

        Assert.Equal(["Alice", "Bob", "Carol"], rows.Select(row => row.PlayerName));
        foreach (var row in rows)
        {
            var expected = LeagueRules.CalculatePlayerStatistics(data, row.PlayerName);
            Assert.Equal(expected.PlayedMatchCount, row.PlayedMatchCount);
            Assert.Equal(expected.MatchWins, row.MatchWins);
            Assert.Equal(expected.MatchLosses, row.MatchLosses);
            Assert.Equal(expected.MatchDraws, row.MatchDraws);
            Assert.Equal(expected.PlayedGameCount, row.PlayedGameCount);
            Assert.Equal(expected.GameWins, row.GameWins);
            Assert.Equal(expected.GameLosses, row.GameLosses);
            Assert.Equal(expected.MatchWinrate, row.MatchWinrate);
            Assert.Equal(expected.GameWinrate, row.GameWinrate);
            Assert.Equal(expected.Nemesis, row.Nemesis);
            Assert.Equal(expected.Rival, row.Rival);
            Assert.Equal(expected.MostPlayedArchetype, row.MostPlayedArchetype);
        }
    }

    /// <summary>
    /// The batched Season read feeds Tournaments one at a time, so the accumulator has to land on exactly
    /// what the single-pass calculation lands on. Deep equality rather than field spot-checks: the whole
    /// body is the contract, dates and ordering included.
    /// </summary>
    [Fact]
    public void Accumulator_matches_the_single_pass_league_result()
    {
        TournamentDocument[] tournaments =
        [
            new("t-old", "season", "Tournament Old", "2026-03-01", "completed",
                [new RoundDocument("t-old-round", [Match("Alice", "Bob", 2, 1), Match("Carol", "Alice", 0, 2)])], []),
            // No Round at all, so it contributes no row and still makes the Season incomplete.
            new("t-empty", "season", "Tournament Empty", "2026-05-04", "active", [], []),
            // Three game wins is not a legal result, so the entry is skipped and incomplete is set.
            new("t-new", "season", "Tournament New", "2026-08-17", "completed",
                [new RoundDocument("t-new-round", [Match("Bob", "Carol", 3, 1)])], [])
        ];
        var league = new LeagueDocument("season-1", "Season One", "completed", tournaments);
        var accumulator = new LeagueRules.LeagueResultAccumulator();

        foreach (var tournament in tournaments) accumulator.Add(tournament);
        var accumulated = accumulator.Build("league");

        Assert.True(JsonNode.DeepEquals(
            LeagueJson.ToNode(accumulated),
            LeagueJson.ToNode(LeagueRules.CalculateLeagueResult(league))));
        Assert.True(accumulated.Incomplete);
        Assert.True(accumulated.Provisional);
    }

    [Fact]
    public void Accumulator_over_no_tournaments_builds_the_empty_result()
    {
        var result = new LeagueRules.LeagueResultAccumulator().Build("season");

        Assert.Equal("season", result.Scope);
        Assert.Equal(string.Empty, result.StartDate);
        Assert.Equal(string.Empty, result.EndDate);
        Assert.False(result.Incomplete);
        Assert.False(result.Provisional);
        Assert.Empty(result.Rows);
    }

    private static GonesData Data(params LeagueDocument[] leagues) => new(LeagueNormalizer.GonesDataVersion, leagues, []);

    private static LeagueDocument League(string id, string status, params TournamentDocument[] tournaments) =>
        new(id, id, status, tournaments);

    private static TournamentDocument Tournament(string id, string status, params RoundEntry[] entries) =>
        new(id, "league", id, "2030-01-01", status, [new RoundDocument($"{id}-round", entries)], []);

    private static MatchRoundEntry Match(string player1, string player2, int player1Score, int player2Score) =>
        new($"{player1}-{player2}", "1", player1, player2, player1Score, player2Score, string.Empty, string.Empty);
}
