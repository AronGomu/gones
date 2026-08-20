using Gones.Domain.Leagues;

namespace Gones.UnitTests;

/// <summary>
/// ADR 0043: a Match feeds the rating as a 1 / 0.5 / 0 Glicko score multiplied by a margin factor. The
/// two numbers are deliberately separate — the score keeps the deviation maths valid, the factor only
/// weights how far the rating moves.
/// </summary>
public sealed class MarginOfVictoryTests
{
    [Fact]
    public void Two_nil_is_a_sweep()
    {
        Assert.Equal(1.25, MarginOfVictory.Factor(2, 0));
    }

    [Fact]
    public void Two_one_is_close()
    {
        Assert.Equal(1.0, MarginOfVictory.Factor(2, 1));
    }

    [Fact]
    public void One_nil_is_close()
    {
        Assert.Equal(1.0, MarginOfVictory.Factor(1, 0));
    }

    [Fact]
    public void A_draw_is_close()
    {
        Assert.Equal(1.0, MarginOfVictory.Factor(1, 1));
        Assert.Equal(1.0, MarginOfVictory.Factor(2, 2));
    }

    [Fact]
    public void Score_is_one_for_a_win()
    {
        Assert.Equal(1.0, MarginOfVictory.Score(2, 0));
    }

    [Fact]
    public void Score_is_a_half_for_a_draw()
    {
        Assert.Equal(0.5, MarginOfVictory.Score(1, 1));
        Assert.Equal(0.5, MarginOfVictory.Score(2, 2));
    }

    [Fact]
    public void Score_is_zero_for_a_loss()
    {
        Assert.Equal(0.0, MarginOfVictory.Score(0, 2));
    }
}
