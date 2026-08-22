using Gones.Domain.Archive;
using Gones.Domain.Leagues;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.IntegrationTests;

/// <summary>
/// The three-tier fixture both archive read-through test classes seed. Written through the domain
/// rather than raw SQL, because these routes read the stored document and the denormalized
/// <c>player_count</c> together: only <see cref="ArchiveTournament.Create"/> stamps the two from the
/// same call, so a hand-written row could disagree with itself.
/// </summary>
internal static class ArchiveSeed
{
    internal static readonly Instant Seeded = Instant.FromUtc(2026, 1, 1, 0, 0);
    internal static readonly Instant Removed = Instant.FromUtc(2026, 8, 18, 10, 0);

    internal static async Task SeedAsync(GonesDbContext database)
    {
        database.ArchiveLeagues.Add(ArchiveLeague.Create("league-1", "League One", Seeded));
        database.ArchiveLeagueSeasons.Add(ArchiveLeagueSeason.Create("season-1", "league-1", "Season One", "completed", Seeded));
        database.ArchiveLeagueSeasons.Add(ArchiveLeagueSeason.Create("season-2", "league-1", "Season Two", "active", Seeded));
        database.ArchiveLeagueSeasons.Add(ArchiveLeagueSeason.Create("season-empty", "league-1", "Season Empty", "active", Seeded));
        database.ArchiveLeagueSeasons.Add(ArchiveLeagueSeason.Create("season-gone", "league-1", "Season Gone", "completed", Seeded));
        await database.SaveChangesAsync();

        database.ArchiveTournaments.Add(ArchiveTournament.Create(
            Tournament("t-old", "season-1", "Tournament Old", "2026-03-01", "Alice", "Bob", 2, 1),
            Instant.FromUtc(2026, 3, 1, 10, 0)));
        database.ArchiveTournaments.Add(ArchiveTournament.Create(
            Tournament("t-new", "season-1", "Tournament New", "2026-08-17", "Alice", "Cara", 2, 0),
            Instant.FromUtc(2026, 8, 17, 10, 0)));
        database.ArchiveTournaments.Add(ArchiveTournament.Create(
            Tournament("t-deleted", "season-1", "Tournament Deleted", "2026-05-01", "Dave", "Erin", 2, 0),
            Instant.FromUtc(2026, 5, 1, 10, 0)));
        database.ArchiveTournaments.Add(ArchiveTournament.Create(
            Tournament("t-foreign", "season-2", "Tournament Foreign", "2026-07-01", "Alice", "Bob", 2, 0),
            Instant.FromUtc(2026, 7, 1, 10, 0)));
        database.ArchiveTournaments.Add(ArchiveTournament.Create(
            Tournament("t-standalone", null, "Tournament Standalone", "2026-06-01", "Bob", "Cara", 2, 0),
            Instant.FromUtc(2026, 6, 1, 10, 0)));
        await database.SaveChangesAsync();

        // Soft-deleted after the fact rather than inserted deleted: a soft delete is what these routes
        // have to stay blind to, and the domain is the only thing that writes one.
        (await database.ArchiveLeagueSeasons.SingleAsync(row => row.DocumentId == "season-gone")).SoftDelete(Removed);
        (await database.ArchiveTournaments.SingleAsync(row => row.DocumentId == "t-deleted")).SoftDelete(Removed);
        await database.SaveChangesAsync();
    }

    /// <summary>One Tournament of one Round, one match, both players carrying an archetype.</summary>
    internal static ArchiveTournamentDocument Tournament(
        string id, string? seasonId, string name, string date, string player1, string player2, int score1, int score2) =>
        new(id, name, seasonId, date, "completed",
            [new RoundDocument($"{id}-round-1", [new MatchRoundEntry($"{id}-entry-1", "1", player1, player2, score1, score2, "Tempo", "Control")])],
            [new PlayerArchetypeDocument(player1, "Tempo"), new PlayerArchetypeDocument(player2, "Control")]);
}
