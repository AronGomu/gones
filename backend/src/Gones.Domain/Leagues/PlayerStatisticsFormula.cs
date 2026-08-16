namespace Gones.Domain.Leagues;

/// <summary>
/// Version of the maths behind <see cref="LeagueRules.CalculateGlobalPlayerStatistics"/>, materialized
/// into <c>player_statistics</c>.
///
/// <para>ADR 0040: bump <see cref="Version"/> in the same commit as any change to that maths — a new
/// counted field, a changed winrate, a different scope. The stored version is what tells the startup
/// rebuild that every row it can see was computed by an older formula; forgetting the bump leaves those
/// rows stale with nothing anywhere to trigger a repair.</para>
/// </summary>
public static class PlayerStatisticsFormula
{
    public const int Version = 1;
}
