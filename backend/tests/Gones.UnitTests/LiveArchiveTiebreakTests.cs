using Gones.Domain.Leagues;
using Gones.Domain.Live;

namespace Gones.UnitTests;

public sealed class LiveArchiveTiebreakTests
{
    [Fact]
    public void Live_match_wins_tiebreak_diverges_from_archive_ranking_on_finalize()
    {
        var next = 0;
        string Id() => $"id-{++next}";
        var players = new[] { "Amy", "Zoe", "Ben", "Cal", "Dev", "Eli", "Fay", "Gus", "Hal" }
            .Select(name => new LiveTournamentPlayerDocument(Id(), name, true, false, 0, 0, 0, string.Empty))
            .ToArray();
        LiveTournamentRoundEntryDocument Match(string player1, string player2, int score1, int score2) =>
            new(new MatchRoundEntry(Id(), string.Empty, player1, player2, score1, score2, string.Empty, string.Empty), true);
        var rounds = new IReadOnlyList<LiveTournamentRoundEntryDocument>[]
        {
            [Match("Zoe", "Ben", 2, 1), Match("Amy", "Dev", 1, 1), Match("Gus", "Eli", 2, 0)],
            [Match("Cal", "Zoe", 2, 1), Match("Amy", "Eli", 1, 1), Match("Gus", "Dev", 2, 0), Match("Hal", "Fay", 2, 0)],
            [Match("Amy", "Fay", 1, 1), Match("Gus", "Cal", 2, 0)],
            [Match("Hal", "Cal", 2, 0)]
        }
            .Select((entries, index) => new LiveTournamentRoundDocument(Id(), index + 1, entries, true))
            .ToArray();
        var tournament = new LiveTournamentDocument(
            Id(), "Tiebreak Pin", "league-1", "2026-08-27", "swiss", 4, true, true, 0, [],
            "standings", 4, players, rounds, [], null, 1,
            "2026-08-27T00:00:00.000Z", "2026-08-27T00:00:00.000Z");

        var live = LiveRules.CalculateStandings(tournament);
        var amyLive = live.Single(row => row.PlayerName == "Amy");
        var zoeLive = live.Single(row => row.PlayerName == "Zoe");
        // Guard: all four shared tiebreak keys tie exactly; only MatchWins differs.
        Assert.Equal(3, amyLive.Points);
        Assert.Equal(3, zoeLive.Points);
        Assert.Equal(0.5, amyLive.GameWinPercentage);
        Assert.Equal(0.5, zoeLive.GameWinPercentage);
        Assert.Equal(zoeLive.OpponentsMatchWinPercentage, amyLive.OpponentsMatchWinPercentage);
        Assert.Equal(zoeLive.OpponentsGameWinPercentage, amyLive.OpponentsGameWinPercentage);
        Assert.Equal(0, amyLive.MatchWins);
        Assert.Equal(1, zoeLive.MatchWins);
        // Live-only tiebreak: more match wins ranks higher.
        Assert.True(zoeLive.Rank < amyLive.Rank);

        var archive = LeagueRules.CalculateTournamentResult(LiveRules.Finalize(tournament, Id, "2026/08/27"));
        var amyArchive = archive.Rows.Single(row => row.PlayerName == "Amy");
        var zoeArchive = archive.Rows.Single(row => row.PlayerName == "Zoe");
        // Archive chain has no match-wins key: the same rounds fall through to player name.
        Assert.True(amyArchive.Rank < zoeArchive.Rank);
    }
}
