using Gones.Domain.Leagues;
using NodaTime;
using NodaTime.Text;

namespace Gones.Domain.Archive;

/// <summary>The four numbers a League Season row prints, denormalized onto the aggregate.</summary>
public sealed record ArchiveSeasonCounts(
    int TournamentCount,
    int PlayerCount,
    LocalDate? FirstTournamentDate,
    LocalDate? LastTournamentDate);

/// <summary>The one number a Tournament row prints, denormalized onto the aggregate.</summary>
public sealed record ArchiveTournamentCounts(int PlayerCount);

/// <summary>
/// The denormalized archive catalog counts, so a catalog query never deserializes a document.
///
/// <para>Both player counts are the Swiss standings row count — the same number the browser prints —
/// and not a name scan, so the two stacks cannot disagree. Bump <see cref="Version"/> in the same
/// commit as any change to how any of these numbers is derived: a stored <c>counts_version</c> of
/// <c>0</c> means "never computed", which is what makes a stored <c>0</c> count unambiguous.</para>
/// </summary>
public static class ArchiveCatalogCounts
{
    public const int Version = 1;

    public static ArchiveTournamentCounts ForTournament(ArchiveTournamentDocument tournament)
    {
        ArgumentNullException.ThrowIfNull(tournament);
        var legacy = ArchiveDocumentAdapter.ToLegacyTournament(tournament, tournament.SeasonId ?? string.Empty);
        return new ArchiveTournamentCounts(LeagueRules.CalculateTournamentResult(legacy).Rows.Count);
    }

    /// <param name="seasonId">Stamped onto the synthetic League so the standings input is self-consistent.</param>
    public static ArchiveSeasonCounts ForSeason(string seasonId, IReadOnlyList<ArchiveTournamentDocument> tournaments)
    {
        ArgumentNullException.ThrowIfNull(tournaments);
        // CalculateLeagueResult reads only Tournaments; Name and Status are inert placeholders. It also
        // hands back the min and max Tournament date, which is exactly the pair the Season row prints.
        var league = new LeagueDocument(
            seasonId,
            seasonId,
            "completed",
            [.. tournaments.Select(tournament => ArchiveDocumentAdapter.ToLegacyTournament(tournament, seasonId))]);
        var result = LeagueRules.CalculateLeagueResult(league);
        return new ArchiveSeasonCounts(
            tournaments.Count,
            result.Rows.Count,
            ParseOrNull(result.StartDate),
            ParseOrNull(result.EndDate));
    }

    private static LocalDate? ParseOrNull(string value)
    {
        if (value.Length == 0) return null;
        var parse = LocalDatePattern.Iso.Parse(value);
        return parse.Success ? parse.Value : null;
    }
}
