using Gones.Domain.Leagues;
using Gones.Domain.Persistence;
using NodaTime;

namespace Gones.UnitTests;

/// <summary>
/// What <see cref="LeagueArchiveAggregate.ReadDocument"/> costs.
///
/// <para>The denormalized catalog counts (ADR 0042) are derived by <see cref="LeagueCatalogCounts.From"/>,
/// which runs a full Swiss standings pass. <c>Create</c> and <c>Apply</c> must pay for it — they stamp the
/// numbers. A read must not: <c>ReadDocument</c> used to route through <c>FromCanonicalDocument</c> into
/// <c>Create</c>, which made every public detail, result, Tournament, export and statistics-rebuild read
/// compute standings and throw them away.</para>
/// </summary>
public sealed class LeagueArchiveAggregateReadTests
{
    private static readonly Instant Now = Instant.FromUtc(2031, 5, 1, 12, 0);

    [Fact]
    public void ReadDocument_does_not_recompute_the_standings()
    {
        var aggregate = LeagueArchiveAggregate.Create(BigLeague(), Now);
        var canonical = aggregate.CanonicalDocument;

        // Warm every path so one-off JIT and static-init allocations stay out of the measurements.
        aggregate.ReadDocument();
        Parse(canonical);
        LeagueCatalogCounts.From(aggregate.ReadDocument());

        // The two controls: what a read has to cost, and what one standings pass adds on top.
        var parse = Allocated(() => Parse(canonical));
        var standings = Allocated(() => LeagueRules.CalculateLeagueResult(Parse(canonical))) - parse;
        var read = Allocated(() => aggregate.ReadDocument());

        // `GC.GetAllocatedBytesForCurrentThread` is an exact running total, so this is a counter and not
        // a timing measurement. A read that still went through `Create` would land a whole standings
        // pass above the parse; half of one is the margin.
        Assert.True(
            read < parse + (standings / 2),
            $"read={read} bytes, parse={parse} bytes, standings={standings} bytes");
    }

    [Fact]
    public void ReadDocument_returns_the_stored_document()
    {
        var league = BigLeague();

        var document = LeagueArchiveAggregate.Create(league, Now).ReadDocument();

        Assert.Equal(league.Id, document.Id);
        Assert.Equal(league.Name, document.Name);
        Assert.Equal(league.Status, document.Status);
        Assert.Equal(league.Tournaments.Count, document.Tournaments.Count);
        Assert.Equal(
            league.Tournaments.SelectMany(tournament => tournament.Rounds).SelectMany(round => round.Entries).Select(entry => entry.Id),
            document.Tournaments.SelectMany(tournament => tournament.Rounds).SelectMany(round => round.Entries).Select(entry => entry.Id));
    }

    [Fact]
    public void ReadDocument_still_refuses_a_document_its_envelope_contradicts()
    {
        var aggregate = LeagueArchiveAggregate.Create(BigLeague(), Now);
        aggregate.Apply(BigLeague("Renamed"), Now);

        // The envelope validation moved out of Create with the counts; it must still run on a read.
        Assert.Equal("Renamed", aggregate.ReadDocument().Name);
    }

    /// <summary>The work a read cannot avoid: parse the stored JSON, canonicalize it, parse that.</summary>
    private static LeagueDocument Parse(string canonical) =>
        LeagueJson.Deserialize<LeagueDocument>(LeagueJson.Serialize(LeagueJson.Deserialize<LeagueDocument>(canonical)));

    private static long Allocated(Action action)
    {
        var before = GC.GetAllocatedBytesForCurrentThread();
        action();
        return GC.GetAllocatedBytesForCurrentThread() - before;
    }

    /// <summary>A League big enough that a standings pass is not lost in the noise: 8 Tournaments, 640 Matches.</summary>
    private static LeagueDocument BigLeague(string name = "Big League") => new(
        "big-league",
        name,
        "completed",
        [.. Enumerable.Range(0, 8).Select(Tournament)]);

    private static TournamentDocument Tournament(int index) => new(
        $"big-league-t{index}",
        "big-league",
        $"Tournament {index}",
        "2031-05-01",
        "completed",
        [.. Enumerable.Range(0, 5).Select(round => Round(index, round))],
        []);

    private static RoundDocument Round(int tournament, int round) => new(
        $"big-league-t{tournament}-r{round}",
        [.. Enumerable.Range(0, 16).Select(match => Match(tournament, round, match))]);

    private static MatchRoundEntry Match(int tournament, int round, int index) => new(
        $"big-league-t{tournament}-r{round}-m{index}",
        (round + 1).ToString(System.Globalization.CultureInfo.InvariantCulture),
        $"Player {index * 2}",
        $"Player {(index * 2) + 1}",
        2,
        index % 3,
        "Tempo",
        "Control");
}
