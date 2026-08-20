using Gones.Domain.Leagues;

namespace Gones.UnitTests;

/// <summary>
/// The Glicko-2 engine behind ADR 0043. The first test is the anchor: Mark Glickman's own published
/// worked example. Everything else pins a property the rest of the rating stack relies on.
/// </summary>
public sealed class Glicko2Tests
{
    /// <summary>
    /// Glickman, "Example of the Glicko-2 system": player (1500, 200, 0.06), tau 0.5, beating (1400, 30)
    /// then losing to (1550, 100) and (1700, 300).
    ///
    /// <para>The paper prints r' = 1464.06, RD' = 151.52, sigma' = 0.05999. Exact double arithmetic
    /// gives 1464.0506705393013, 151.5165241238573 and 0.0599959842864885 — the paper rounds its own
    /// intermediates to four decimals (its mu' = -0.2069 against an exact -0.20693807) and the error
    /// accumulates into the last printed digit of r'. The intermediates match his digit for digit:
    /// phi = 1.151292 (paper 1.1513); per opponent g/E = 0.9955/0.6395, 0.9531/0.4318, 0.7242/0.3028
    /// (paper 0.9955/0.639, 0.9531/0.432, 0.7242/0.303); v = 1.778977 (paper 1.7785);
    /// delta = -0.483933 (paper -0.4834).</para>
    ///
    /// <para>So the published numbers are asserted with a tolerance of one unit in their last printed
    /// place, and the exact doubles are pinned underneath as the regression anchor. Do not "tighten"
    /// the first three asserts to <c>Assert.Equal(1464.06, actual, 2)</c> — that overload rounds and
    /// cannot pass.</para>
    /// </summary>
    [Fact]
    public void Reproduces_the_published_worked_example()
    {
        var player = new Glicko2Rating(1500.0, 200.0, 0.06);

        var updated = Glicko2.Update(
            player,
            [
                new Glicko2Result(new Glicko2Rating(1400.0, 30.0, Glicko2.DefaultVolatility), 1.0, 1.0),
                new Glicko2Result(new Glicko2Rating(1550.0, 100.0, Glicko2.DefaultVolatility), 0.0, 1.0),
                new Glicko2Result(new Glicko2Rating(1700.0, 300.0, Glicko2.DefaultVolatility), 0.0, 1.0)
            ]);

        Assert.Equal(1464.06, updated.Rating, 0.01);
        Assert.Equal(151.52, updated.Deviation, 0.01);
        Assert.Equal(0.05999, updated.Volatility, 0.00001);

        Assert.Equal(1464.0506705393013, updated.Rating, 10);
        Assert.Equal(151.5165241238573, updated.Deviation, 10);
        Assert.Equal(0.0599959842864885, updated.Volatility, 12);
    }

    [Fact]
    public void Seed_is_the_published_default()
    {
        Assert.Equal(new Glicko2Rating(1500.0, 350.0, 0.06), Glicko2.Seed);
    }

    [Fact]
    public void An_empty_period_only_grows_the_deviation()
    {
        var player = new Glicko2Rating(1500.0, 200.0, 0.06);

        var updated = Glicko2.Update(player, []);

        Assert.Equal(player.Rating, updated.Rating);
        Assert.True(updated.Deviation > 200.0, $"expected the deviation to grow, got {updated.Deviation}");
        Assert.Equal(player.Volatility, updated.Volatility);
    }

    [Fact]
    public void Skip_matches_Update_with_no_results()
    {
        var player = new Glicko2Rating(1500.0, 200.0, 0.06);

        Assert.Equal(Glicko2.Skip(player), Glicko2.Update(player, []));
    }

    [Fact]
    public void Skip_never_exceeds_the_default_deviation()
    {
        var player = new Glicko2Rating(1500.0, 349.0, 0.06);

        for (var period = 0; period < 50; period++) player = Glicko2.Skip(player);

        Assert.True(player.Deviation <= Glicko2.DefaultDeviation, $"expected a clamped deviation, got {player.Deviation}");
    }

    [Fact]
    public void A_sweep_moves_the_rating_more_than_a_close_win()
    {
        var sweep = Sweep();
        var close = Close();

        Assert.True(sweep.Rating > close.Rating, $"expected the sweep to gain more, got {sweep.Rating} against {close.Rating}");
    }

    /// <summary>
    /// Assumption 13 and ADR 0043: the margin factor weights the rating sum <c>Sw</c> only, never the
    /// unweighted <c>S</c> that feeds v, delta, the volatility solve and therefore the new deviation. The
    /// two deviations agree to ten decimals — far tighter than any leak through the volatility solve
    /// could hide in, and deliberately not a bit-for-bit claim, which the algebra does not promise.
    /// </summary>
    [Fact]
    public void The_margin_factor_leaves_the_deviation_alone()
    {
        Assert.Equal(Close().Deviation, Sweep().Deviation, 10);
    }

    /// <summary>
    /// The other half of the same invariant. Without this, dropping the weighted sum entirely would
    /// leave <see cref="The_margin_factor_leaves_the_deviation_alone"/> green.
    /// </summary>
    [Fact]
    public void The_margin_factor_moves_the_rating()
    {
        Assert.NotEqual(Close().Rating, Sweep().Rating);
    }

    [Fact]
    public void A_draw_between_equals_barely_moves_the_rating()
    {
        var player = new Glicko2Rating(1500.0, 50.0, 0.06);

        var updated = Glicko2.Update(player, [new Glicko2Result(player, 0.5, 1.0)]);

        Assert.True(Math.Abs(updated.Rating - 1500.0) < 0.5, $"expected a near-still rating, got {updated.Rating}");
    }

    [Fact]
    public void Beating_a_stronger_opponent_gains_more()
    {
        var stronger = Win(new Glicko2Rating(1800.0, 50.0, 0.06));
        var weaker = Win(new Glicko2Rating(1200.0, 50.0, 0.06));

        Assert.True(stronger.Rating > weaker.Rating, $"expected {stronger.Rating} to beat {weaker.Rating}");
    }

    [Fact]
    public void A_high_deviation_opponent_moves_the_rating_less()
    {
        var uncertain = Win(new Glicko2Rating(1500.0, 350.0, 0.06));
        var settled = Win(new Glicko2Rating(1500.0, 30.0, 0.06));

        Assert.True(settled.Rating > uncertain.Rating, $"expected {settled.Rating} to beat {uncertain.Rating}");
    }

    /// <summary>
    /// A finiteness check proves nothing here: <c>SolveVolatility</c> returns <c>exp(lower / 2)</c> of a
    /// bracketed value, which is finite whether or not the Illinois iteration converged — the three
    /// <c>IsFinite</c> assertions this replaces stayed green at <c>MaximumIterations = 1</c>. So the
    /// converged triple is pinned instead: it is the regression anchor for the whole solve, and any
    /// change to the bracketing, the tolerance or the iteration cap moves it.
    /// </summary>
    [Fact]
    public void Converges_for_a_long_period()
    {
        var updated = Glicko2.Update(Glicko2.Seed, LongPeriod());

        Assert.Equal(1484.066243830998, updated.Rating, 6);
        Assert.Equal(69.46693135361231, updated.Deviation, 6);
        Assert.Equal(0.059996815991065815, updated.Volatility, 8);
    }

    [Fact]
    public void Is_deterministic()
    {
        Assert.Equal(Glicko2.Update(Glicko2.Seed, LongPeriod()), Glicko2.Update(Glicko2.Seed, LongPeriod()));
    }

    private static Glicko2Rating Sweep() => Glicko2.Update(
        Glicko2.Seed,
        [new Glicko2Result(new Glicko2Rating(1500.0, 50.0, 0.06), 1.0, MarginOfVictory.SweepFactor)]);

    private static Glicko2Rating Close() => Glicko2.Update(
        Glicko2.Seed,
        [new Glicko2Result(new Glicko2Rating(1500.0, 50.0, 0.06), 1.0, MarginOfVictory.CloseFactor)]);

    private static Glicko2Rating Win(Glicko2Rating opponent) =>
        Glicko2.Update(Glicko2.Seed, [new Glicko2Result(opponent, 1.0, 1.0)]);

    /// <summary>Forty results against a deterministic spread of opponents — no randomness, so a failure
    /// here is reproducible.</summary>
    private static IReadOnlyList<Glicko2Result> LongPeriod()
    {
        var results = new List<Glicko2Result>();
        for (var index = 0; index < 40; index++)
        {
            var opponent = new Glicko2Rating(1200.0 + (index * 37 % 700), 30.0 + (index * 17 % 320), 0.06);
            var score = (index % 3) switch { 0 => 1.0, 1 => 0.5, _ => 0.0 };
            results.Add(new Glicko2Result(opponent, score, index % 4 == 0 ? MarginOfVictory.SweepFactor : MarginOfVictory.CloseFactor));
        }

        return results;
    }
}
