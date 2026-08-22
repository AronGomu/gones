using Gones.Domain.Leagues;

namespace Gones.Domain.Archive;

/// <summary>
/// Bridges a three-tier Tournament onto the Swiss standings engine in <see cref="LeagueRules"/>, which
/// still speaks <see cref="TournamentDocument"/>. One conversion in one place, so the archive rebuild
/// never grows a second standings implementation.
/// </summary>
public static class ArchiveDocumentAdapter
{
    /// <param name="leagueId">
    /// Stamped onto <see cref="TournamentDocument.LeagueId"/>, which the standings passes never read but
    /// which the legacy record requires. Pass the Season ID, or <see cref="string.Empty"/> for a
    /// standalone Tournament.
    /// </param>
    public static TournamentDocument ToLegacyTournament(ArchiveTournamentDocument tournament, string leagueId)
    {
        ArgumentNullException.ThrowIfNull(tournament);
        ArgumentNullException.ThrowIfNull(leagueId);
        return new TournamentDocument(
            tournament.Id,
            leagueId,
            tournament.Name,
            tournament.TournamentDate,
            tournament.Status,
            tournament.Rounds,
            tournament.PlayerArchetypes);
    }
}
