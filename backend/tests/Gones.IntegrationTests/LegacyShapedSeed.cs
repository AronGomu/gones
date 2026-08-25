using Gones.Domain.Archive;
using Gones.Domain.Leagues;
using Gones.Infrastructure.Persistence;
using NodaTime;

namespace Gones.IntegrationTests;

/// <summary>
/// Seeds the three tiers a flat League used to hold in one row, so a suite written against the retired
/// legacy aggregate table keeps its fixtures and its expected values.
///
/// The Season takes the legacy League's id and name, because that is what these suites assert on; the
/// parent League is minted around it, since a Season needs one. Each Tournament becomes its own row.
/// </summary>
internal static class LegacyShapedSeed
{
    public static void AddLegacyShapedLeague(this GonesDbContext database, LeagueDocument league, Instant now)
    {
        ArgumentNullException.ThrowIfNull(database);
        ArgumentNullException.ThrowIfNull(league);

        var leagueTierId = $"{league.Id}-league";
        if (!database.ArchiveLeagues.Local.Any(item => item.DocumentId == leagueTierId))
        {
            database.ArchiveLeagues.Add(ArchiveLeague.Create(leagueTierId, league.Name, now));
        }
        database.ArchiveLeagueSeasons.Add(ArchiveLeagueSeason.Create(league.Id, leagueTierId, league.Name, league.Status, now));
        foreach (var tournament in league.Tournaments)
        {
            database.ArchiveTournaments.Add(ArchiveTournament.Create(ToArchive(tournament, league.Id), now));
        }
    }

    /// <summary>A Tournament that belongs to no Season — what the retired placeholder League used to hold.</summary>
    public static void AddStandaloneTournament(this GonesDbContext database, TournamentDocument tournament, Instant now)
    {
        ArgumentNullException.ThrowIfNull(database);
        database.ArchiveTournaments.Add(ArchiveTournament.Create(ToArchive(tournament, null), now));
    }

    public static ArchiveTournamentDocument ToArchive(TournamentDocument tournament, string? seasonId)
    {
        ArgumentNullException.ThrowIfNull(tournament);
        return new ArchiveTournamentDocument(
            tournament.Id,
            tournament.Name,
            seasonId,
            tournament.TournamentDate,
            tournament.Status,
            tournament.Rounds,
            tournament.PlayerArchetypes);
    }
}
