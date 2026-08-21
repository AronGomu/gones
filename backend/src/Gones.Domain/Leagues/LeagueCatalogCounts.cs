namespace Gones.Domain.Leagues;

/// <summary>
/// The two numbers the League Archive list card prints, denormalized onto the aggregate so the
/// public catalog can ship summary rows instead of whole documents (ADR 0042).
///
/// <para>Bump <see cref="Version"/> in the same commit as any change to how either number is
/// derived: the startup backfill repairs exactly the rows stamped with an older version.</para>
/// </summary>
public static class LeagueCatalogCounts
{
    public const int Version = 1;

    public static (int TournamentCount, int PlayerCount) From(LeagueDocument document)
    {
        ArgumentNullException.ThrowIfNull(document);
        return (document.Tournaments.Count, LeagueRules.CalculateLeagueResult(document).Rows.Count);
    }
}
