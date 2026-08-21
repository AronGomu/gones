using Gones.Domain.Leagues;
using Gones.Infrastructure.Persistence;

namespace Gones.UnitTests;

/// <summary>
/// The read model row is the only thing between the domain's numbers and the table. A field added to
/// <see cref="GlobalPlayerStatistics"/> and forgotten in <c>From</c> or <c>ToGlobalPlayerStatistics</c>
/// is silent — the build stays green and the column stays at its default — so the round trip is asserted
/// on the whole record rather than field by field.
/// </summary>
public sealed class PlayerStatisticsRowTests
{
    [Fact]
    public void Round_trips_every_rating_column()
    {
        var statistics = new GlobalPlayerStatistics(
            "Alice",
            12,
            7,
            4,
            1,
            0.5833333333333334,
            27,
            15,
            12,
            0.5555555555555556,
            new OpponentRecord("Bob", 1, 3),
            new OpponentRecord("Carol", 2, 2),
            new PlayerArchetypeUsage("Tempo", 6),
            1687.4213,
            84.1207,
            0.0593,
            1642.9981,
            44.4232,
            9,
            "2026-03-12",
            1604.7755);

        Assert.Equal(statistics, PlayerStatisticsRow.From(statistics).ToGlobalPlayerStatistics());
    }
}
