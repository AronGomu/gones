namespace Gones.Domain.Leagues;

/// <summary>A player's rating, the confidence in it, and how erratic their results have been.</summary>
public readonly record struct Glicko2Rating(double Rating, double Deviation, double Volatility);

/// <summary>One Match as the rating sees it: who it was against, 1 / 0.5 / 0, and the margin weight.</summary>
public readonly record struct Glicko2Result(Glicko2Rating Opponent, double Score, double MarginFactor);

/// <summary>
/// Glicko-2 (ADR 0043), with the published defaults. One <see cref="Update"/> per rating period, which
/// in Gones is one calendar date.
///
/// <para>The algorithm, on the internal scale where <c>μ = (r - 1500) / 173.7178</c> and
/// <c>φ = RD / 173.7178</c>:</para>
/// <list type="number">
/// <item><description><c>g(φ) = 1 / sqrt(1 + 3φ²/π²)</c>, <c>E(μ, μⱼ, φⱼ) = 1 / (1 + exp(-g(φⱼ)(μ - μⱼ)))</c>.</description></item>
/// <item><description><c>v = [ Σ g(φⱼ)² · Eⱼ · (1 - Eⱼ) ]⁻¹</c>.</description></item>
/// <item><description><c>S = Σ g(φⱼ) · (sⱼ - Eⱼ)</c> and <c>Sw = Σ fⱼ · g(φⱼ) · (sⱼ - Eⱼ)</c>; <c>Δ = v · S</c>.</description></item>
/// <item><description><c>a = ln(σ²)</c>, <c>f(x) = [ eˣ (Δ² - φ² - v - eˣ) ] / [ 2 (φ² + v + eˣ)² ] - (x - a) / τ²</c>,
/// solved by the Illinois variant of regula falsi; <c>σ' = exp(x/2)</c>.</description></item>
/// <item><description><c>φ* = sqrt(φ² + σ'²)</c>, <c>φ' = 1 / sqrt(1/φ*² + 1/v)</c>, <c>μ' = μ + φ'² · Sw</c>.</description></item>
/// <item><description>Back out: <c>r' = 173.7178 · μ' + 1500</c>, <c>RD' = 173.7178 · φ'</c>.</description></item>
/// </list>
///
/// <para><b>Why two sums.</b> The margin-of-victory factor is a rating-only weight. It multiplies the
/// terms of <c>Sw</c>, which is used for <c>μ'</c> and nothing else. Everything that produces the new
/// deviation — <c>v</c>, <c>Δ</c>, the volatility solve, <c>φ*</c>, <c>φ'</c> — reads the unweighted
/// <c>S</c>. Do not collapse the two sums into one: routing the factor through <c>Δ</c> leaks it into
/// <c>σ'</c>, hence into <c>φ'</c>, and a 2-0 would come out making the engine <i>less</i> confident
/// than a 2-1. ADR 0043 states the opposite — "<c>v</c>, and therefore the new deviation, is computed
/// from the unweighted terms" — and <c>Glicko2Tests.The_margin_factor_leaves_the_deviation_alone</c>
/// pins it to ten decimals.</para>
/// </summary>
public static class Glicko2
{
    public const double DefaultRating = 1500.0;
    public const double DefaultDeviation = 350.0;
    public const double DefaultVolatility = 0.06;
    public const double Tau = 0.5;
    public const double Scale = 173.7178;
    public const double ConvergenceTolerance = 1e-6;
    public const int MaximumIterations = 100;

    /// <summary>An unrated player: the published defaults.</summary>
    public static Glicko2Rating Seed { get; } = new(DefaultRating, DefaultDeviation, DefaultVolatility);

    /// <summary>
    /// Folds one rating period's Matches into a new rating. An empty period is an idle period, so it
    /// behaves as <see cref="Skip"/>.
    /// </summary>
    public static Glicko2Rating Update(Glicko2Rating player, IReadOnlyList<Glicko2Result> results)
    {
        if (results.Count == 0) return Skip(player);

        var mu = (player.Rating - DefaultRating) / Scale;
        var phi = player.Deviation / Scale;

        var inverseVariance = 0.0;
        var sum = 0.0;
        var weightedSum = 0.0;
        foreach (var result in results)
        {
            var opponentMu = (result.Opponent.Rating - DefaultRating) / Scale;
            var opponentPhi = result.Opponent.Deviation / Scale;
            var g = G(opponentPhi);
            var expected = E(mu, opponentMu, opponentPhi);

            inverseVariance += g * g * expected * (1.0 - expected);
            var term = g * (result.Score - expected);
            sum += term;
            weightedSum += result.MarginFactor * term;
        }

        var variance = 1.0 / inverseVariance;
        var delta = variance * sum;

        var volatility = SolveVolatility(phi, variance, delta, player.Volatility);
        var preRatingPhi = Math.Sqrt(phi * phi + volatility * volatility);
        var newPhi = 1.0 / Math.Sqrt(1.0 / (preRatingPhi * preRatingPhi) + 1.0 / variance);
        var newMu = mu + newPhi * newPhi * weightedSum;

        return new Glicko2Rating(
            Scale * newMu + DefaultRating,
            Math.Min(Scale * newPhi, DefaultDeviation),
            volatility);
    }

    /// <summary>
    /// An idle rating period. The rating and the volatility stand; only the deviation grows, capped at
    /// the deviation of a player nobody has ever seen play.
    /// </summary>
    public static Glicko2Rating Skip(Glicko2Rating player)
    {
        var phi = player.Deviation / Scale;
        var grown = Scale * Math.Sqrt(phi * phi + player.Volatility * player.Volatility);

        return player with { Deviation = Math.Min(grown, DefaultDeviation) };
    }

    private static double G(double phi) => 1.0 / Math.Sqrt(1.0 + 3.0 * phi * phi / (Math.PI * Math.PI));

    private static double E(double mu, double muJ, double phiJ) => 1.0 / (1.0 + Math.Exp(-G(phiJ) * (mu - muJ)));

    /// <summary>
    /// Glickman's step 5: the Illinois variant of regula falsi on <c>f</c>, bracketed as the paper
    /// brackets it. <paramref name="delta"/> is the unweighted estimated improvement — see the note on
    /// the two sums in the class remarks.
    /// </summary>
    private static double SolveVolatility(double phi, double v, double delta, double sigma)
    {
        var a = Math.Log(sigma * sigma);
        var phiSquared = phi * phi;
        var deltaSquared = delta * delta;

        double F(double x)
        {
            var exp = Math.Exp(x);
            var denominator = phiSquared + v + exp;
            return exp * (deltaSquared - phiSquared - v - exp) / (2.0 * denominator * denominator) - (x - a) / (Tau * Tau);
        }

        var lower = a;
        double upper;
        if (deltaSquared > phiSquared + v)
        {
            upper = Math.Log(deltaSquared - phiSquared - v);
        }
        else
        {
            var step = 1;
            while (F(a - step * Tau) < 0.0) step++;
            upper = a - step * Tau;
        }

        var lowerValue = F(lower);
        var upperValue = F(upper);
        for (var iteration = 0; iteration < MaximumIterations && Math.Abs(upper - lower) > ConvergenceTolerance; iteration++)
        {
            var candidate = lower + (lower - upper) * lowerValue / (upperValue - lowerValue);
            var candidateValue = F(candidate);
            if (candidateValue * upperValue <= 0.0)
            {
                lower = upper;
                lowerValue = upperValue;
            }
            else
            {
                lowerValue /= 2.0;
            }

            upper = candidate;
            upperValue = candidateValue;
        }

        return Math.Exp(lower / 2.0);
    }
}
