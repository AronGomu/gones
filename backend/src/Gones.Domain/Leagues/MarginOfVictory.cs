namespace Gones.Domain.Leagues;

/// <summary>
/// ADR 0043: how one Match enters the rating. <see cref="Score"/> is the Glicko score term and stays
/// 1 / 0.5 / 0 so the deviation maths stays valid; <see cref="Factor"/> is the separate margin weight
/// that <see cref="Glicko2.Update"/> applies to the rating sum only.
/// </summary>
public static class MarginOfVictory
{
    public const double SweepFactor = 1.25;
    public const double CloseFactor = 1.0;

    /// <summary>1.25 when the Match was won by two games or more, 1.0 otherwise.</summary>
    public static double Factor(int ownScore, int opponentScore) =>
        Math.Abs(ownScore - opponentScore) >= 2 ? SweepFactor : CloseFactor;

    /// <summary>1 / 0.5 / 0. Callers must exclude 0-0 before asking (see remarks).</summary>
    /// <remarks>
    /// 0-0 answers 0.5 like any other draw, and that answer is wrong for the rating: validation accepts
    /// 0-0, but it is byte-identical to a Match nobody scored, so scoring it would invent a result. The
    /// caller filters it out (grill round 2, Q4). It still counts in the ADR 0040 statistics.
    /// </remarks>
    public static double Score(int ownScore, int opponentScore) =>
        ownScore == opponentScore ? 0.5 : ownScore > opponentScore ? 1.0 : 0.0;
}
