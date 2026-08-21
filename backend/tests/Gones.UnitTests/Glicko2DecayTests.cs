using Gones.Domain.Leagues;

namespace Gones.UnitTests;

/// <summary>
/// ADR 0043's second rating number: the rating itself drifting back toward the 1500 mean while a player
/// is idle. Always computed during the rebuild, hidden behind a configuration key by default.
/// </summary>
public sealed class Glicko2DecayTests
{
    [Fact]
    public void No_idle_time_leaves_the_rating_alone()
    {
        Assert.Equal(1700.0, Glicko2Decay.Apply(1700.0, 0.0), 10);
    }

    [Fact]
    public void One_half_life_halves_the_distance()
    {
        Assert.Equal(1600.0, Glicko2Decay.Apply(1700.0, 24.0), 10);
    }

    [Fact]
    public void Two_half_lives_quarter_it()
    {
        Assert.Equal(1550.0, Glicko2Decay.Apply(1700.0, 48.0), 10);
    }

    [Fact]
    public void Decays_upward_from_below_the_mean()
    {
        Assert.Equal(1400.0, Glicko2Decay.Apply(1300.0, 24.0), 10);
    }

    [Fact]
    public void The_mean_never_moves()
    {
        Assert.Equal(1500.0, Glicko2Decay.Apply(1500.0, 120.0), 10);
    }

    [Fact]
    public void Negative_idle_time_is_clamped_to_none()
    {
        // A clock skew between the request date and the last played date must not amplify a rating.
        Assert.Equal(1700.0, Glicko2Decay.Apply(1700.0, -12.0), 10);
    }
}
