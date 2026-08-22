using Gones.Domain.Archive;
using Gones.Domain.Leagues;
using NodaTime;

namespace Gones.UnitTests;

/// <summary>
/// The denormalized three-tier archive catalog counts, so a catalog query never deserializes a document.
/// Both player counts are the Swiss standings row count — the same number the browser prints — and not a
/// name scan, so the two stacks cannot disagree.
/// </summary>
public sealed class ArchiveCatalogCountsTests
{
    [Fact]
    public void Counts_an_empty_Season_as_zero_with_no_dates()
    {
        Assert.Equal(new ArchiveSeasonCounts(0, 0, null, null), ArchiveCatalogCounts.ForSeason("s1", []));
    }

    [Fact]
    public void Counts_Tournaments_including_incomplete_ones()
    {
        var counts = ArchiveCatalogCounts.ForSeason(
            "s1",
            [
                Tournament("t1", "s1", "2026-01-02", Match("m1", "Ada", "Bo", 2, 0)),
                Tournament("t2", "s1", "2026-03-04", Match("m2", "Cy", "Dot", 2, 1)),
                Tournament("t3", "s1", "2026-07-08")
            ]);

        Assert.Equal(3, counts.TournamentCount);
    }

    [Fact]
    public void Counts_distinct_players_across_a_Season()
    {
        // Ada plays in both Tournaments; the standings hold one row per player, so she counts once.
        var counts = ArchiveCatalogCounts.ForSeason(
            "s1",
            [
                Tournament("t1", "s1", "2026-01-02", Match("m1", "Ada", "Bo", 2, 0)),
                Tournament("t2", "s1", "2026-03-04", Match("m2", "Ada", "Cy", 1, 2))
            ]);

        Assert.Equal(3, counts.PlayerCount);
    }

    [Fact]
    public void Matches_CalculateLeagueResult_row_count()
    {
        ArchiveTournamentDocument[] tournaments =
        [
            Tournament("t1", "s1", "2026-01-02", Match("m1", "Ada", "Bo", 2, 0), Match("m2", "Cy", "Dot", 0, 2)),
            Tournament("t2", "s1", "2026-03-04", Match("m3", "Ada", "Cy", 2, 1))
        ];
        var league = new LeagueDocument(
            "s1",
            "s1",
            "completed",
            [.. tournaments.Select(tournament => ArchiveDocumentAdapter.ToLegacyTournament(tournament, "s1"))]);

        Assert.Equal(
            LeagueRules.CalculateLeagueResult(league).Rows.Count,
            ArchiveCatalogCounts.ForSeason("s1", tournaments).PlayerCount);
    }

    [Fact]
    public void Reports_the_first_and_last_Tournament_dates()
    {
        var counts = ArchiveCatalogCounts.ForSeason(
            "s1",
            [
                Tournament("t1", "s1", "2026-03-04", Match("m1", "Ada", "Bo", 2, 0)),
                Tournament("t2", "s1", "2026-01-02", Match("m2", "Cy", "Dot", 2, 1)),
                Tournament("t3", "s1", "2026-07-08", Match("m3", "Ada", "Cy", 2, 1))
            ]);

        Assert.Equal(new LocalDate(2026, 1, 2), counts.FirstTournamentDate);
        Assert.Equal(new LocalDate(2026, 7, 8), counts.LastTournamentDate);
    }

    [Fact]
    public void Counts_one_Tournament_players_with_the_standings_row_count()
    {
        var tournament = Tournament(
            "t1",
            "s1",
            "2026-01-02",
            Match("m1", "Ada", "Bo", 2, 0),
            Match("m2", "Cy", "Dot", 0, 2));

        Assert.Equal(4, ArchiveCatalogCounts.ForTournament(tournament).PlayerCount);
        Assert.Equal(
            LeagueRules.CalculateTournamentResult(ArchiveDocumentAdapter.ToLegacyTournament(tournament, "s1")).Rows.Count,
            ArchiveCatalogCounts.ForTournament(tournament).PlayerCount);
    }

    [Fact]
    public void Counts_a_standalone_Tournament()
    {
        var tournament = Tournament("t1", null, "2026-01-02", Match("m1", "Ada", "Bo", 2, 0));

        Assert.Equal(2, ArchiveCatalogCounts.ForTournament(tournament).PlayerCount);
    }

    [Fact]
    public void Counts_an_empty_Tournament_as_zero()
    {
        Assert.Equal(0, ArchiveCatalogCounts.ForTournament(Tournament("t1", "s1", "2026-01-02")).PlayerCount);
    }

    private static ArchiveTournamentDocument Tournament(string id, string? seasonId, string date, params RoundEntry[] entries) =>
        new(id, $"Tournament {id}", seasonId, date, "completed",
            entries.Length == 0 ? [] : [new RoundDocument($"{id}-r1", entries)], []);

    private static MatchRoundEntry Match(string id, string player1, string player2, int score1, int score2) =>
        new(id, "1", player1, player2, score1, score2, string.Empty, string.Empty);
}
