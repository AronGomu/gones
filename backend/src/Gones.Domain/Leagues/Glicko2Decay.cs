namespace Gones.Domain.Leagues;

/// <summary>
/// ADR 0043's second rating number: the rating itself drifting back toward the 1500 mean while a player
/// is idle. Exponential, with a 24-month half-life. Always computed during the rebuild, hidden behind
/// <c>Gones:PlayerStatistics:ExposeDecayedRating</c> by default.
///
/// <para>This is deliberately not the same thing as the deviation growth in <see cref="Glicko2.Skip"/>:
/// that widens the confidence interval and leaves the rating where it is, this moves the number.</para>
/// </summary>
public static class Glicko2Decay
{
    public const double HalfLifeMonths = 24.0;

    /// <summary>decayed = 1500 + (rating - 1500) * 0.5 ^ (idleMonths / 24)</summary>
    public static double Apply(double rating, double idleMonths) =>
        Glicko2.DefaultRating
        + (rating - Glicko2.DefaultRating) * Math.Pow(0.5, Math.Max(idleMonths, 0.0) / HalfLifeMonths);
}
