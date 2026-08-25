using Gones.Domain.Archive;
using Gones.Domain.Leagues;
using NodaTime;

namespace Gones.UnitTests;

/// <summary>
/// The three-tier archive aggregates — League, League Season, Tournament. Concurrency is per row: every
/// state-changing call bumps that row's own <c>Version</c> by exactly one, a no-op call bumps nothing,
/// and a counter refresh bumps nothing because counters are derived rather than authored.
/// </summary>
public sealed class ArchiveAggregateTests
{
    private static readonly Instant Now = Instant.FromUtc(2026, 5, 4, 12, 0);
    private static readonly Instant Later = Now.Plus(Duration.FromHours(1));

    [Fact]
    public void League_Create_starts_at_version_one()
    {
        var league = ArchiveLeague.Create("l1", "Lyon", Now);

        Assert.Equal("Lyon", league.Name);
        Assert.Equal(1, league.Version);
        Assert.Equal(Now, league.CreatedAt);
        Assert.Equal(Now, league.UpdatedAt);
        Assert.Null(league.DeletedAt);
    }

    [Fact]
    public void League_Create_rejects_a_blank_name()
    {
        var exception = Assert.Throws<ArgumentException>(() => ArchiveLeague.Create("l1", "  ", Now));

        Assert.StartsWith("name must contain 1 to 200 characters.", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void League_Rename_bumps_the_version_and_the_timestamp()
    {
        var league = ArchiveLeague.Create("l1", "Lyon", Now);

        league.Rename("Lyon 2", Later);

        Assert.Equal("Lyon 2", league.Name);
        Assert.Equal(2, league.Version);
        Assert.Equal(Later, league.UpdatedAt);
        Assert.Equal(Now, league.CreatedAt);
    }

    [Fact]
    public void League_Rename_to_the_same_name_changes_nothing()
    {
        var league = ArchiveLeague.Create("l1", "Lyon", Now);

        league.Rename("Lyon", Later);

        Assert.Equal(1, league.Version);
        Assert.Equal(Now, league.UpdatedAt);
    }

    [Fact]
    public void League_SoftDelete_stamps_the_deletion()
    {
        var league = ArchiveLeague.Create("l1", "Lyon", Now);

        league.SoftDelete(Later);

        Assert.Equal(Later, league.DeletedAt);
        Assert.Equal(Later, league.UpdatedAt);
        Assert.Equal(2, league.Version);
    }

    [Fact]
    public void A_deleted_League_refuses_a_rename()
    {
        var league = ArchiveLeague.Create("l1", "Lyon", Now);
        league.SoftDelete(Later);

        var exception = Assert.Throws<InvalidOperationException>(() => league.Rename("Lyon 2", Later));

        Assert.Equal("Deleted archive League cannot be changed.", exception.Message);
    }

    [Fact]
    public void A_deleted_League_refuses_a_second_delete()
    {
        var league = ArchiveLeague.Create("l1", "Lyon", Now);
        league.SoftDelete(Later);

        var exception = Assert.Throws<InvalidOperationException>(() => league.SoftDelete(Later));

        Assert.Equal("Archive League is already deleted.", exception.Message);
    }

    [Fact]
    public void Season_Create_stamps_zero_counts_at_the_current_version()
    {
        var season = ArchiveLeagueSeason.Create("s1", "l1", "2026", "active", Now);

        Assert.Equal(0, season.TournamentCount);
        Assert.Equal(0, season.PlayerCount);
        Assert.Null(season.FirstTournamentDate);
        Assert.Null(season.LastTournamentDate);
        Assert.Equal(ArchiveCatalogCounts.Version, season.CountsVersion);
        Assert.Equal(0, season.CountsRevision);
        Assert.Equal(1, season.Version);
    }

    [Fact]
    public void Season_Create_requires_a_League()
    {
        var exception = Assert.Throws<ArgumentException>(
            () => ArchiveLeagueSeason.Create("s1", "", "2026", "active", Now));

        Assert.StartsWith("leagueId must contain 1 to 200 characters.", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Season_Create_rejects_an_unknown_status()
    {
        var exception = Assert.Throws<ArgumentException>(
            () => ArchiveLeagueSeason.Create("s1", "l1", "2026", "archived", Now));

        Assert.StartsWith(
            "Archive League Season status must be active or completed.",
            exception.Message,
            StringComparison.Ordinal);
    }

    [Fact]
    public void Season_ChangeStatus_bumps_the_version()
    {
        var season = ArchiveLeagueSeason.Create("s1", "l1", "2026", "active", Now);

        season.ChangeStatus("completed", Later);

        Assert.Equal("completed", season.Status);
        Assert.Equal(2, season.Version);
        Assert.Equal(Later, season.UpdatedAt);
    }

    [Fact]
    public void Season_MoveToLeague_bumps_the_version()
    {
        var season = ArchiveLeagueSeason.Create("s1", "l1", "2026", "active", Now);

        season.MoveToLeague("l2", Later);

        Assert.Equal("l2", season.LeagueId);
        Assert.Equal(2, season.Version);
    }

    [Fact]
    public void Season_MoveToLeague_to_the_same_League_changes_nothing()
    {
        var season = ArchiveLeagueSeason.Create("s1", "l1", "2026", "active", Now);

        season.MoveToLeague("l1", Later);

        Assert.Equal(1, season.Version);
        Assert.Equal(Now, season.UpdatedAt);
    }

    [Fact]
    public void Season_RefreshCatalogCounts_writes_the_counters_without_bumping_the_row()
    {
        var season = ArchiveLeagueSeason.Create("s1", "l1", "2026", "active", Now);
        var first = new LocalDate(2026, 1, 2);
        var last = new LocalDate(2026, 7, 8);

        season.RefreshCatalogCounts(new ArchiveSeasonCounts(3, 7, first, last));

        Assert.Equal(3, season.TournamentCount);
        Assert.Equal(7, season.PlayerCount);
        Assert.Equal(first, season.FirstTournamentDate);
        Assert.Equal(last, season.LastTournamentDate);
        Assert.Equal(ArchiveCatalogCounts.Version, season.CountsVersion);
        Assert.Equal(1, season.Version);
        Assert.Equal(Now, season.UpdatedAt);
        // The row is untouched, so the catalog stamp needs this to move instead.
        Assert.Equal(1, season.CountsRevision);
    }

    /// <summary>
    /// The counters cannot carry their own change to the catalog ETag — a Tournament moved between two
    /// Seasons is <c>-1</c> here and <c>+1</c> there, and a re-dated Tournament moves no counter at all
    /// — so every write that lands on different numbers has to move something that only ever grows.
    /// </summary>
    [Fact]
    public void Season_RefreshCatalogCounts_counts_every_write_that_changes_a_printed_number()
    {
        var season = ArchiveLeagueSeason.Create("s1", "l1", "2026", "active", Now);
        var date = new LocalDate(2026, 1, 2);

        season.RefreshCatalogCounts(new ArchiveSeasonCounts(2, 7, date, date));
        season.RefreshCatalogCounts(new ArchiveSeasonCounts(1, 7, date, date));
        season.RefreshCatalogCounts(new ArchiveSeasonCounts(1, 7, date, new LocalDate(2026, 3, 4)));

        Assert.Equal(3, season.CountsRevision);
    }

    [Fact]
    public void Season_RefreshCatalogCounts_over_the_same_numbers_leaves_the_catalog_alone()
    {
        var season = ArchiveLeagueSeason.Create("s1", "l1", "2026", "active", Now);
        var counts = new ArchiveSeasonCounts(3, 7, new LocalDate(2026, 1, 2), new LocalDate(2026, 7, 8));
        season.RefreshCatalogCounts(counts);

        season.RefreshCatalogCounts(counts);

        // Every Tournament write refreshes its Season and most leave the numbers where they were:
        // bumping here would expire every client's catalog copy for nothing.
        Assert.Equal(1, season.CountsRevision);
    }

    [Fact]
    public void A_deleted_Season_refuses_a_rename()
    {
        var season = ArchiveLeagueSeason.Create("s1", "l1", "2026", "active", Now);
        season.SoftDelete(Later);

        var exception = Assert.Throws<InvalidOperationException>(() => season.Rename("2027", Later));

        Assert.Equal("Deleted archive League Season cannot be changed.", exception.Message);
    }

    [Fact]
    public void Tournament_Create_projects_the_envelope_and_the_counts()
    {
        var document = Tournament("t1", "s1", "2026-05-04", Match("m1", "Ada", "Bo", 2, 0));

        var tournament = ArchiveTournament.Create(document, Now);

        Assert.Equal(document.Name, tournament.Name);
        Assert.Equal(document.Status, tournament.Status);
        Assert.Equal("s1", tournament.SeasonId);
        Assert.Equal(new LocalDate(2026, 5, 4), tournament.TournamentDate);
        Assert.Equal(2, tournament.PlayerCount);
        Assert.Equal(ArchiveCatalogCounts.Version, tournament.CountsVersion);
        Assert.Equal(1, tournament.Version);
    }

    [Fact]
    public void Tournament_Create_accepts_a_standalone_Tournament()
    {
        var tournament = ArchiveTournament.Create(
            Tournament("t1", null, "2026-05-04", Match("m1", "Ada", "Bo", 2, 0)),
            Now);

        Assert.Null(tournament.SeasonId);
        Assert.Null(tournament.ReadDocument().SeasonId);
    }

    [Fact]
    public void Tournament_Create_normalizes_a_blank_Season_to_standalone()
    {
        var tournament = ArchiveTournament.Create(
            Tournament("t1", "   ", "2026-05-04", Match("m1", "Ada", "Bo", 2, 0)),
            Now);

        Assert.Null(tournament.SeasonId);
    }

    [Fact]
    public void Tournament_Create_rejects_a_non_ISO_date()
    {
        var exception = Assert.Throws<ArgumentException>(
            () => ArchiveTournament.Create(Tournament("t1", "s1", "04/05/2026", Match("m1", "Ada", "Bo", 2, 0)), Now));

        Assert.StartsWith("Tournament date must be an ISO YYYY-MM-DD date.", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Tournament_Create_rejects_an_unknown_status()
    {
        var document = Tournament("t1", "s1", "2026-05-04", Match("m1", "Ada", "Bo", 2, 0)) with { Status = "draft" };

        var exception = Assert.Throws<ArgumentException>(() => ArchiveTournament.Create(document, Now));

        Assert.StartsWith(
            "Archive Tournament status must be active or completed.",
            exception.Message,
            StringComparison.Ordinal);
    }

    [Fact]
    public void Tournament_Create_rejects_too_many_Rounds()
    {
        var document = Tournament("t1", "s1", "2026-05-04") with
        {
            Rounds = [.. Enumerable.Range(0, 1001).Select(round => new RoundDocument($"t1-r{round}", []))]
        };

        var exception = Assert.Throws<ArgumentException>(() => ArchiveTournament.Create(document, Now));

        Assert.StartsWith("Tournament must contain at most 1000 Rounds.", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void ReadDocument_returns_the_stored_document()
    {
        var document = Tournament("t1", "s1", "2026-05-04", Match("m1", "Ada", "Bo", 2, 0), Match("m2", "Cy", "Dot", 0, 2));

        var stored = ArchiveTournament.Create(document, Now).ReadDocument();

        Assert.Equal(document.Id, stored.Id);
        Assert.Equal(document.Name, stored.Name);
        Assert.Equal(document.SeasonId, stored.SeasonId);
        Assert.Equal(document.TournamentDate, stored.TournamentDate);
        Assert.Equal(document.Status, stored.Status);
        Assert.Equal(
            document.Rounds.SelectMany(round => round.Entries).Select(entry => entry.Id),
            stored.Rounds.SelectMany(round => round.Entries).Select(entry => entry.Id));
    }

    [Fact]
    public void Tournament_Apply_recomputes_the_player_count()
    {
        var tournament = ArchiveTournament.Create(
            Tournament("t1", "s1", "2026-05-04", Match("m1", "Ada", "Bo", 2, 0)),
            Now);

        tournament.Apply(
            Tournament("t1", "s1", "2026-05-04", Match("m1", "Ada", "Bo", 2, 0), Match("m2", "Cy", "Dot", 0, 2)),
            Later);

        Assert.Equal(4, tournament.PlayerCount);
        Assert.Equal(ArchiveCatalogCounts.Version, tournament.CountsVersion);
        Assert.Equal(2, tournament.Version);
        Assert.Equal(Later, tournament.UpdatedAt);
    }

    [Fact]
    public void Tournament_Apply_with_an_identical_document_changes_nothing()
    {
        var document = Tournament("t1", "s1", "2026-05-04", Match("m1", "Ada", "Bo", 2, 0));
        var tournament = ArchiveTournament.Create(document, Now);

        tournament.Apply(document, Later);

        Assert.Equal(1, tournament.Version);
        Assert.Equal(Now, tournament.UpdatedAt);
    }

    [Fact]
    public void Tournament_Apply_rejects_a_document_ID_change()
    {
        var tournament = ArchiveTournament.Create(
            Tournament("t1", "s1", "2026-05-04", Match("m1", "Ada", "Bo", 2, 0)),
            Now);

        var exception = Assert.Throws<ArgumentException>(
            () => tournament.Apply(Tournament("t2", "s1", "2026-05-04", Match("m1", "Ada", "Bo", 2, 0)), Later));

        Assert.StartsWith("Tournament document ID cannot change.", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Tournament_Apply_rejects_a_Season_change()
    {
        var tournament = ArchiveTournament.Create(
            Tournament("t1", "s1", "2026-05-04", Match("m1", "Ada", "Bo", 2, 0)),
            Now);

        var exception = Assert.Throws<ArgumentException>(
            () => tournament.Apply(Tournament("t1", "s2", "2026-05-04", Match("m1", "Ada", "Bo", 2, 0)), Later));

        Assert.StartsWith("Tournament Season ID cannot change; use MoveToSeason.", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void ApplyAndMove_edits_and_moves_in_exactly_one_bump()
    {
        var tournament = ArchiveTournament.Create(
            Tournament("t1", "s1", "2026-05-04", Match("m1", "Ada", "Bo", 2, 0)),
            Now);

        tournament.ApplyAndMove(
            Tournament("t1", "s1", "2026-06-05", Match("m1", "Ada", "Bo", 2, 0), Match("m2", "Cy", "Dot", 0, 2)) with { Name = "Renamed" },
            "s2",
            Later);

        Assert.Equal("s2", tournament.SeasonId);
        Assert.Equal("s2", tournament.ReadDocument().SeasonId);
        Assert.Equal("Renamed", tournament.Name);
        Assert.Equal(new LocalDate(2026, 6, 5), tournament.TournamentDate);
        Assert.Equal(4, tournament.PlayerCount);
        Assert.Equal(2, tournament.Version);
        Assert.Equal(Later, tournament.UpdatedAt);
    }

    [Fact]
    public void ApplyAndMove_detaches_and_edits_in_exactly_one_bump()
    {
        var tournament = ArchiveTournament.Create(
            Tournament("t1", "s1", "2026-05-04", Match("m1", "Ada", "Bo", 2, 0)),
            Now);

        tournament.ApplyAndMove(Tournament("t1", "s1", "2026-05-04", Match("m1", "Ada", "Bo", 2, 0)) with { Name = "Renamed" }, null, Later);

        Assert.Null(tournament.SeasonId);
        // The document key is dropped rather than nulled, or the metadata check constraint would abort.
        Assert.Null(tournament.ReadDocument().SeasonId);
        Assert.Equal("Renamed", tournament.Name);
        Assert.Equal(2, tournament.Version);
    }

    [Fact]
    public void ApplyAndMove_with_nothing_to_change_bumps_nothing()
    {
        var document = Tournament("t1", "s1", "2026-05-04", Match("m1", "Ada", "Bo", 2, 0));
        var tournament = ArchiveTournament.Create(document, Now);

        tournament.ApplyAndMove(document, "s1", Later);

        Assert.Equal(1, tournament.Version);
        Assert.Equal(Now, tournament.UpdatedAt);
    }

    [Fact]
    public void ApplyAndMove_rejects_a_document_ID_change()
    {
        var tournament = ArchiveTournament.Create(
            Tournament("t1", "s1", "2026-05-04", Match("m1", "Ada", "Bo", 2, 0)),
            Now);

        var exception = Assert.Throws<ArgumentException>(
            () => tournament.ApplyAndMove(Tournament("t2", "s1", "2026-05-04", Match("m1", "Ada", "Bo", 2, 0)), "s2", Later));

        Assert.StartsWith("Tournament document ID cannot change.", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void MoveToSeason_rewrites_the_stored_document()
    {
        var tournament = ArchiveTournament.Create(
            Tournament("t1", "s1", "2026-05-04", Match("m1", "Ada", "Bo", 2, 0)),
            Now);

        tournament.MoveToSeason("s2", Later);

        Assert.Equal("s2", tournament.SeasonId);
        Assert.Equal("s2", tournament.ReadDocument().SeasonId);
        Assert.Equal(2, tournament.Version);
        Assert.Equal(2, tournament.PlayerCount);
    }

    [Fact]
    public void MoveToSeason_null_detaches_to_standalone()
    {
        var tournament = ArchiveTournament.Create(
            Tournament("t1", "s1", "2026-05-04", Match("m1", "Ada", "Bo", 2, 0)),
            Now);

        tournament.MoveToSeason(null, Later);

        Assert.Null(tournament.SeasonId);
        Assert.Null(tournament.ReadDocument().SeasonId);
        Assert.Equal(2, tournament.Version);
    }

    [Fact]
    public void MoveToSeason_to_the_current_Season_changes_nothing()
    {
        var tournament = ArchiveTournament.Create(
            Tournament("t1", "s1", "2026-05-04", Match("m1", "Ada", "Bo", 2, 0)),
            Now);

        tournament.MoveToSeason("s1", Later);

        Assert.Equal(1, tournament.Version);
        Assert.Equal(Now, tournament.UpdatedAt);
    }

    [Fact]
    public void Tournament_RefreshCatalogCounts_does_not_bump_the_row()
    {
        var tournament = ArchiveTournament.Create(
            Tournament("t1", "s1", "2026-05-04", Match("m1", "Ada", "Bo", 2, 0)),
            Now);

        tournament.RefreshCatalogCounts();

        Assert.Equal(2, tournament.PlayerCount);
        Assert.Equal(ArchiveCatalogCounts.Version, tournament.CountsVersion);
        Assert.Equal(1, tournament.Version);
        Assert.Equal(Now, tournament.UpdatedAt);
    }

    [Fact]
    public void A_deleted_Tournament_refuses_a_write()
    {
        var document = Tournament("t1", "s1", "2026-05-04", Match("m1", "Ada", "Bo", 2, 0));
        var tournament = ArchiveTournament.Create(document, Now);
        tournament.SoftDelete(Later);

        var exception = Assert.Throws<InvalidOperationException>(() => tournament.Apply(document, Later));

        Assert.Equal("Deleted archive Tournament cannot be changed.", exception.Message);
    }

    /// <summary>
    /// A read must not pay for the standings. <c>Create</c> and <c>Apply</c> stamp the player count and
    /// therefore run a full Swiss pass; <c>ReadDocument</c> stamps nothing, so it has nothing to compute.
    /// </summary>
    [Fact]
    public void ReadDocument_does_not_recompute_the_standings()
    {
        var aggregate = ArchiveTournament.Create(BigTournament(), Now);
        var canonical = aggregate.Document;

        // Warm every path so one-off JIT and static-init allocations stay out of the measurements.
        aggregate.ReadDocument();
        Parse(canonical);
        ArchiveCatalogCounts.ForTournament(aggregate.ReadDocument());

        var parse = Allocated(() => Parse(canonical));
        var standings = Allocated(() => ArchiveCatalogCounts.ForTournament(Parse(canonical))) - parse;
        var read = Allocated(() => aggregate.ReadDocument());

        Assert.True(
            read < parse + (standings / 2),
            $"read={read} bytes, parse={parse} bytes, standings={standings} bytes");
    }

    /// <summary>The work a read cannot avoid: parse the stored JSON, canonicalize it, parse that.</summary>
    private static ArchiveTournamentDocument Parse(string canonical) =>
        LeagueJson.Deserialize<ArchiveTournamentDocument>(
            LeagueJson.Serialize(LeagueJson.Deserialize<ArchiveTournamentDocument>(canonical)));

    private static long Allocated(Action action)
    {
        var before = GC.GetAllocatedBytesForCurrentThread();
        action();
        return GC.GetAllocatedBytesForCurrentThread() - before;
    }

    /// <summary>Big enough that a standings pass is not lost in the noise: 5 Rounds, 80 Matches.</summary>
    private static ArchiveTournamentDocument BigTournament() => new(
        "big-tournament",
        "Big Tournament",
        "big-season",
        "2026-05-04",
        "completed",
        [.. Enumerable.Range(0, 5).Select(BigRound)],
        []);

    private static RoundDocument BigRound(int round) => new(
        $"big-tournament-r{round}",
        [.. Enumerable.Range(0, 16).Select(match => new MatchRoundEntry(
            $"big-tournament-r{round}-m{match}",
            (round + 1).ToString(System.Globalization.CultureInfo.InvariantCulture),
            $"Player {match * 2}",
            $"Player {(match * 2) + 1}",
            2,
            match % 3,
            "Tempo",
            "Control"))]);

    private static ArchiveTournamentDocument Tournament(string id, string? seasonId, string date, params RoundEntry[] entries) =>
        new(id, $"Tournament {id}", seasonId, date, "completed",
            entries.Length == 0 ? [] : [new RoundDocument($"{id}-r1", entries)], []);

    private static MatchRoundEntry Match(string id, string player1, string player2, int score1, int score2) =>
        new(id, "1", player1, player2, score1, score2, string.Empty, string.Empty);
}
