using Gones.Domain.Leagues;
using NodaTime;

namespace Gones.UnitTests;

/// <summary>
/// The denormalized catalog counts (ADR 0042): the same two numbers the list card prints today, so the
/// public catalog can ship summary rows instead of whole documents. The player count is deliberately the
/// standings row count, not a name scan — that is the number the browser shows.
/// </summary>
public sealed class LeagueCatalogCountsTests
{
    private static readonly Instant Now = Instant.FromUtc(2031, 5, 1, 12, 0);

    [Fact]
    public void Counts_an_empty_League_as_zero()
    {
        Assert.Equal((0, 0), LeagueCatalogCounts.From(League("empty-league")));
    }

    [Fact]
    public void Counts_Tournaments_including_incomplete_ones()
    {
        var league = League(
            "three-league",
            Tournament("three-league", "one", Match("m1", "Ada", "Bo", 2, 0)),
            Tournament("three-league", "two", Match("m2", "Cy", "Dot", 2, 1)),
            Tournament("three-league", "empty"));

        Assert.Equal(3, LeagueCatalogCounts.From(league).TournamentCount);
    }

    [Fact]
    public void Counts_distinct_players_across_Tournaments()
    {
        // Ada plays in both Tournaments; the standings hold one row per player, so she counts once.
        var league = League(
            "shared-league",
            Tournament("shared-league", "one", Match("m1", "Ada", "Bo", 2, 0)),
            Tournament("shared-league", "two", Match("m2", "Ada", "Cy", 1, 2)));

        Assert.Equal(3, LeagueCatalogCounts.From(league).PlayerCount);
    }

    [Fact]
    public void Matches_CalculateLeagueResult_row_count()
    {
        var league = League(
            "parity-league",
            Tournament("parity-league", "one", Match("m1", "Ada", "Bo", 2, 0), Match("m2", "Cy", "Dot", 0, 2)),
            Tournament("parity-league", "two", Match("m3", "Ada", "Cy", 2, 1)));

        Assert.Equal(LeagueRules.CalculateLeagueResult(league).Rows.Count, LeagueCatalogCounts.From(league).PlayerCount);
    }

    [Fact]
    public void Create_stamps_the_current_counts_version()
    {
        var league = League("create-league", Tournament("create-league", "one", Match("m1", "Ada", "Bo", 2, 0)));

        var aggregate = LeagueArchiveAggregate.Create(league, Now);

        Assert.Equal(1, aggregate.TournamentCount);
        Assert.Equal(2, aggregate.PlayerCount);
        Assert.Equal(LeagueCatalogCounts.Version, aggregate.CountsVersion);
    }

    [Fact]
    public void Apply_recomputes_the_counts()
    {
        var aggregate = LeagueArchiveAggregate.Create(
            League("apply-league", Tournament("apply-league", "one", Match("m1", "Ada", "Bo", 2, 0))),
            Now);

        aggregate.Apply(
            League(
                "apply-league",
                Tournament("apply-league", "one", Match("m1", "Ada", "Bo", 2, 0)),
                Tournament("apply-league", "two", Match("m2", "Cy", "Dot", 2, 1)),
                Tournament("apply-league", "three")),
            Now.Plus(Duration.FromHours(1)));

        Assert.Equal(3, aggregate.TournamentCount);
        Assert.Equal(4, aggregate.PlayerCount);
        Assert.Equal(LeagueCatalogCounts.Version, aggregate.CountsVersion);
    }

    private static LeagueDocument League(string id, params TournamentDocument[] tournaments) =>
        new(id, $"League {id}", "completed", tournaments);

    private static TournamentDocument Tournament(string leagueId, string id, params RoundEntry[] entries) =>
        new(
            $"{leagueId}-{id}",
            leagueId,
            $"Tournament {id}",
            "2031-05-01",
            "completed",
            entries.Length == 0 ? [] : [new RoundDocument($"{leagueId}-{id}-r1", entries)],
            []);

    private static MatchRoundEntry Match(string id, string player1, string player2, int score1, int score2) =>
        new(id, "1", player1, player2, score1, score2, string.Empty, string.Empty);
}
