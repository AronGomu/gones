using Gones.Domain.Leagues;

namespace Gones.UnitTests;

/// <summary>
/// The ADR 0043 replay, as <see cref="LeagueRules.CalculateGlobalPlayerStatistics"/> runs it. The rating
/// period is one calendar date, so the tests that matter are the ones that prove order does not: Matches
/// inside a period, Tournaments inside a date, and dates declared out of order all have to land on the
/// same numbers.
///
/// <para>Every case pins the clock. Idle deviation growth and the decayed rating are measured from the
/// last played date to the rebuild clock, so a test that let it default to today would drift.</para>
/// </summary>
public sealed class PlayerRatingReplayTests
{
    /// <summary>Late enough that nothing below is idle, unless the case says so.</summary>
    private static readonly DateOnly AsOf = new(2026, 3, 20);

    [Fact]
    public void An_unplayed_player_is_absent()
    {
        var data = Data(League("league", Tournament("t1", "2026-03-05", "active", Match("Alice", "Bob", 2, 0))));

        Assert.Empty(LeagueRules.CalculateGlobalPlayerStatistics(data, AsOf));
    }

    [Fact]
    public void A_single_win_moves_both_players_off_the_seed()
    {
        var rows = Replay(Data(League("league", Tournament("t1", "2026-03-05", Match("Alice", "Bob", 2, 0)))));

        var alice = rows["Alice"];
        var bob = rows["Bob"];
        Assert.True(alice.Rating > Glicko2.DefaultRating, $"Alice was {alice.Rating}.");
        Assert.True(bob.Rating < Glicko2.DefaultRating, $"Bob was {bob.Rating}.");
        Assert.True(alice.RatingDeviation < Glicko2.DefaultDeviation, $"Alice's deviation was {alice.RatingDeviation}.");
        Assert.True(bob.RatingDeviation < Glicko2.DefaultDeviation, $"Bob's deviation was {bob.RatingDeviation}.");
        Assert.Equal(1, alice.TournamentsPlayed);
        Assert.Equal("2026-03-05", alice.LastPlayedDate);
    }

    /// <summary>
    /// Rule 4: every Match in a period is evaluated against the ratings held before the period started,
    /// which is the whole reason a Round has no order and two Tournaments on one date need no tiebreak.
    /// </summary>
    [Fact]
    public void Match_order_inside_a_period_does_not_matter()
    {
        var forwards = Replay(Data(League("league", Tournament(
            "t1",
            "2026-03-05",
            Match("Alice", "Bob", 2, 0),
            Match("Carol", "Alice", 2, 1)))));
        var backwards = Replay(Data(League("league", Tournament(
            "t1",
            "2026-03-05",
            Match("Carol", "Alice", 2, 1),
            Match("Alice", "Bob", 2, 0)))));

        AssertSameRatings(forwards, backwards, 10);
    }

    [Fact]
    public void Two_same_date_Tournaments_form_one_period()
    {
        var split = Replay(Data(League(
            "league",
            Tournament("t1", "2026-03-05", Match("Alice", "Bob", 2, 0)),
            Tournament("t2", "2026-03-05", Match("Carol", "Alice", 2, 1)))));
        var merged = Replay(Data(League("league", Tournament(
            "t1",
            "2026-03-05",
            Match("Alice", "Bob", 2, 0),
            Match("Carol", "Alice", 2, 1)))));

        AssertSameRatings(split, merged, 10);
        // The period is shared; the Tournament count is not.
        Assert.Equal(2, split["Alice"].TournamentsPlayed);
        Assert.Equal(1, merged["Alice"].TournamentsPlayed);
    }

    [Fact]
    public void Periods_replay_in_date_order()
    {
        var newestFirst = Replay(Data(League(
            "league",
            Tournament("t2", "2026-03-05", Match("Alice", "Carol", 2, 1)),
            Tournament("t1", "2026-03-01", Match("Alice", "Bob", 2, 0)))));
        var oldestFirst = Replay(Data(League(
            "league",
            Tournament("t1", "2026-03-01", Match("Alice", "Bob", 2, 0)),
            Tournament("t2", "2026-03-05", Match("Alice", "Carol", 2, 1)))));

        AssertSameRatings(newestFirst, oldestFirst, 10);
        Assert.Equal("2026-03-05", newestFirst["Alice"].LastPlayedDate);
    }

    [Fact]
    public void Byes_never_move_a_rating()
    {
        var withBye = Replay(Data(League(
            "league",
            Tournament("t1", "2026-03-05", Match("Alice", "Bob", 2, 0), Bye("Carol")),
            Tournament("t2", "2026-03-12", Match("Carol", "Dana", 2, 1)))));
        var withoutBye = Replay(Data(League(
            "league",
            Tournament("t1", "2026-03-05", Match("Alice", "Bob", 2, 0)),
            Tournament("t2", "2026-03-12", Match("Carol", "Dana", 2, 1)))));

        AssertSameRatings(withBye, withoutBye, 10);
        // Carol sat out the first Tournament, so it is not one of hers.
        Assert.Equal(1, withBye["Carol"].TournamentsPlayed);
        Assert.Equal("2026-03-12", withBye["Carol"].LastPlayedDate);
    }

    [Fact]
    public void Zero_zero_is_excluded_from_the_rating()
    {
        var rows = Replay(Data(League("league", Tournament("t1", "2026-03-05", Match("Alice", "Bob", 0, 0)))));

        foreach (var name in new[] { "Alice", "Bob" })
        {
            var row = rows[name];
            Assert.Equal(Glicko2.Seed.Rating, row.Rating);
            Assert.Equal(Glicko2.Seed.Deviation, row.RatingDeviation);
            Assert.Equal(Glicko2.Seed.Volatility, row.RatingVolatility);
            Assert.Equal(0, row.TournamentsPlayed);
            Assert.Null(row.LastPlayedDate);
            // Still a played Match everywhere else in ADR 0040.
            Assert.Equal(1, row.PlayedMatchCount);
        }
    }

    [Fact]
    public void One_one_is_a_draw()
    {
        var rows = Replay(Data(League("league", Tournament("t1", "2026-03-05", Match("Alice", "Bob", 1, 1)))));

        foreach (var name in new[] { "Alice", "Bob" })
        {
            var row = rows[name];
            Assert.InRange(row.Rating, Glicko2.DefaultRating - 0.5, Glicko2.DefaultRating + 0.5);
            Assert.True(row.RatingDeviation < Glicko2.DefaultDeviation, $"{name}'s deviation was {row.RatingDeviation}.");
        }
    }

    [Fact]
    public void A_sweep_moves_more_than_a_close_win()
    {
        var sweep = Replay(Data(League("league", Tournament("t1", "2026-03-05", Match("Alice", "Bob", 2, 0)))));
        var close = Replay(Data(League("league", Tournament("t1", "2026-03-05", Match("Alice", "Bob", 2, 1)))));

        Assert.True(
            sweep["Alice"].Rating > close["Alice"].Rating,
            $"A 2-0 gave {sweep["Alice"].Rating} and a 2-1 gave {close["Alice"].Rating}.");
        // The margin factor is a rating-only weight: the deviation has to be identical (ADR 0043).
        Assert.Equal(close["Alice"].RatingDeviation, sweep["Alice"].RatingDeviation, 10);
    }

    [Fact]
    public void Counts_distinct_tournaments_played()
    {
        var rows = Replay(Data(League(
            "league",
            Tournament("t1", "2026-03-01", Match("Alice", "Bob", 2, 0)),
            Tournament("t2", "2026-03-05", Match("Alice", "Carol", 2, 1), Match("Alice", "Dana", 0, 2)),
            Tournament("t3", "2026-03-08", Match("Alice", "Bob", 1, 2)),
            Tournament("t4", "2026-03-12", Match("Bob", "Carol", 2, 0)))));

        Assert.Equal(3, rows["Alice"].TournamentsPlayed);
        Assert.Equal(3, rows["Bob"].TournamentsPlayed);
    }

    [Fact]
    public void Does_not_count_a_bye_only_tournament()
    {
        var rows = Replay(Data(League(
            "league",
            Tournament("t1", "2026-03-01", Match("Alice", "Bob", 2, 0), Bye("Carol")),
            Tournament("t2", "2026-03-05", Match("Carol", "Dana", 2, 0)))));

        Assert.Equal(1, rows["Carol"].TournamentsPlayed);
    }

    [Fact]
    public void Records_the_delta_across_the_last_period()
    {
        var rows = Replay(Data(League(
            "league",
            Tournament("t1", "2026-03-05", Match("Alice", "Bob", 2, 0)),
            Tournament("t2", "2026-03-12", Match("Alice", "Carol", 0, 2)))));
        var afterTheFirstDateOnly = Replay(Data(League(
            "league",
            Tournament("t1", "2026-03-05", Match("Alice", "Bob", 2, 0)))));

        var alice = rows["Alice"];
        Assert.Equal(afterTheFirstDateOnly["Alice"].Rating, alice.PreviousRating, 10);
        Assert.Equal(alice.Rating - alice.PreviousRating, alice.LastRatingDelta, 10);
        Assert.True(alice.LastRatingDelta < 0, $"Alice lost the second period but moved {alice.LastRatingDelta}.");
    }

    [Fact]
    public void Records_the_last_played_date()
    {
        var rows = Replay(Data(League(
            "league",
            Tournament("t1", "2026-03-05", Match("Alice", "Bob", 2, 0)),
            Tournament("t2", "2026-03-12", Match("Alice", "Carol", 0, 2)))));

        Assert.Equal("2026-03-12", rows["Alice"].LastPlayedDate);
        Assert.Equal("2026-03-05", rows["Bob"].LastPlayedDate);
    }

    [Fact]
    public void Skips_a_tournament_with_no_date()
    {
        var withUndated = Replay(Data(League(
            "league",
            Tournament("t1", "2026-03-05", Match("Alice", "Bob", 2, 0)),
            Tournament("t2", string.Empty, Match("Alice", "Bob", 0, 2)))));
        var withoutUndated = Replay(Data(League(
            "league",
            Tournament("t1", "2026-03-05", Match("Alice", "Bob", 2, 0)))));

        AssertSameRatings(withUndated, withoutUndated, 10);
        Assert.Equal(1, withUndated["Alice"].TournamentsPlayed);
        // The undated Tournament still counts everywhere else in ADR 0040.
        Assert.Equal(2, withUndated["Alice"].PlayedMatchCount);
        Assert.Equal(1, withoutUndated["Alice"].PlayedMatchCount);
    }

    [Fact]
    public void Ignores_incomplete_tournaments()
    {
        var withActive = Replay(Data(League(
            "league",
            Tournament("t1", "2026-03-05", Match("Alice", "Bob", 2, 0)),
            Tournament("t2", "2026-03-12", "active", Match("Alice", "Bob", 0, 2)))));
        var completedOnly = Replay(Data(League(
            "league",
            Tournament("t1", "2026-03-05", Match("Alice", "Bob", 2, 0)))));

        AssertSameRatings(withActive, completedOnly, 10);
        Assert.Equal(1, withActive["Alice"].TournamentsPlayed);
    }

    [Fact]
    public void Is_deterministic_across_runs()
    {
        var data = Data(League(
            "league",
            Tournament("t1", "2026-03-01", Match("Alice", "Bob", 2, 0), Match("Carol", "Dana", 1, 1)),
            Tournament("t2", "2026-03-05", Match("Alice", "Carol", 2, 1), Match("Bob", "Dana", 0, 2))));

        Assert.Equal(
            LeagueRules.CalculateGlobalPlayerStatistics(data, AsOf),
            LeagueRules.CalculateGlobalPlayerStatistics(data, AsOf));
    }

    /// <summary>
    /// The reason the rebuild replays everything instead of appending: editing a Tournament that is not
    /// the newest one has to land on the same numbers as an archive that always looked that way.
    /// </summary>
    [Fact]
    public void Self_heals_after_an_old_tournament_edit()
    {
        var before = Data(League(
            "league",
            Tournament("t1", "2026-03-01", Match("Alice", "Bob", 2, 0)),
            Tournament("t2", "2026-03-05", Match("Alice", "Carol", 2, 1))));
        var edited = Data(League(
            "league",
            Tournament("t1", "2026-03-01", Match("Alice", "Bob", 0, 2)),
            Tournament("t2", "2026-03-05", Match("Alice", "Carol", 2, 1))));

        var replayed = LeagueRules.CalculateGlobalPlayerStatistics(edited, AsOf);

        Assert.Equal(LeagueRules.CalculateGlobalPlayerStatistics(edited, AsOf), replayed);
        Assert.NotEqual(LeagueRules.CalculateGlobalPlayerStatistics(before, AsOf), replayed);
    }

    /// <summary>Rule 8, first half: idle growth is applied once at the end, per month since the last date.</summary>
    [Fact]
    public void Grows_the_deviation_of_an_idle_player()
    {
        var data = Data(League("league", Tournament("t1", "2026-03-05", Match("Alice", "Bob", 2, 0))));

        var fresh = Replay(data, new DateOnly(2026, 3, 20));
        var idle = Replay(data, new DateOnly(2027, 3, 20));

        Assert.True(
            idle["Alice"].RatingDeviation > fresh["Alice"].RatingDeviation,
            $"Idle deviation was {idle["Alice"].RatingDeviation}, fresh was {fresh["Alice"].RatingDeviation}.");
        // Growth widens the interval; it never moves the number.
        Assert.Equal(fresh["Alice"].Rating, idle["Alice"].Rating, 10);
    }

    /// <summary>Rule 8, second half: the decayed rating drifts toward 1500 with a 24-month half-life.</summary>
    [Fact]
    public void Decays_an_idle_rating_toward_the_mean()
    {
        var data = Data(League("league", Tournament("t1", "2026-03-05", Match("Alice", "Bob", 2, 0))));

        var fresh = Replay(data, new DateOnly(2026, 3, 20));
        var idle = Replay(data, new DateOnly(2028, 3, 20));

        Assert.Equal(fresh["Alice"].Rating, fresh["Alice"].DecayedRating, 10);
        Assert.Equal(
            Glicko2.DefaultRating + (idle["Alice"].Rating - Glicko2.DefaultRating) * 0.5,
            idle["Alice"].DecayedRating,
            10);
    }

    private static IReadOnlyDictionary<string, GlobalPlayerStatistics> Replay(GonesData data, DateOnly? asOf = null) =>
        LeagueRules.CalculateGlobalPlayerStatistics(data, asOf ?? AsOf).ToDictionary(row => row.PlayerName, StringComparer.Ordinal);

    private static void AssertSameRatings(
        IReadOnlyDictionary<string, GlobalPlayerStatistics> left,
        IReadOnlyDictionary<string, GlobalPlayerStatistics> right,
        int precision)
    {
        Assert.Equal(left.Keys.Order(StringComparer.Ordinal), right.Keys.Order(StringComparer.Ordinal));
        foreach (var (name, row) in left)
        {
            var other = right[name];
            Assert.Equal(row.Rating, other.Rating, precision);
            Assert.Equal(row.RatingDeviation, other.RatingDeviation, precision);
            Assert.Equal(row.RatingVolatility, other.RatingVolatility, precision);
            Assert.Equal(row.PreviousRating, other.PreviousRating, precision);
            Assert.Equal(row.LastRatingDelta, other.LastRatingDelta, precision);
            Assert.Equal(row.DecayedRating, other.DecayedRating, precision);
        }
    }

    private static GonesData Data(params LeagueDocument[] leagues) => new(LeagueNormalizer.GonesDataVersion, leagues, []);

    private static LeagueDocument League(string id, params TournamentDocument[] tournaments) =>
        new(id, id, "active", tournaments);

    private static TournamentDocument Tournament(string id, string date, params RoundEntry[] entries) =>
        Tournament(id, date, "completed", entries);

    private static TournamentDocument Tournament(string id, string date, string status, params RoundEntry[] entries) =>
        new(id, "league", id, date, status, [new RoundDocument($"{id}-round", entries)], []);

    private static MatchRoundEntry Match(string player1, string player2, int player1Score, int player2Score) =>
        new($"{player1}-{player2}-{player1Score}{player2Score}", "1", player1, player2, player1Score, player2Score, string.Empty, string.Empty);

    private static ByeRoundEntry Bye(string playerName) => new($"bye-{playerName}", "1", playerName, string.Empty);
}
