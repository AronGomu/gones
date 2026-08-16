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

    private static GonesData Data(params LeagueDocument[] leagues) => new(LeagueNormalizer.GonesDataVersion, leagues, []);

    private static LeagueDocument League(string id, string status, params TournamentDocument[] tournaments) =>
        new(id, id, status, tournaments);

    private static TournamentDocument Tournament(string id, string status, params RoundEntry[] entries) =>
        new(id, "league", id, "2030-01-01", status, [new RoundDocument($"{id}-round", entries)], []);

    private static MatchRoundEntry Match(string player1, string player2, int player1Score, int player2Score) =>
        new($"{player1}-{player2}", "1", player1, player2, player1Score, player2Score, string.Empty, string.Empty);
}
