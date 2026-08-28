using Gones.Api.Leagues;
using Gones.Domain.Leagues;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace Gones.IntegrationTests;

/// <summary>
/// The scoped half of the ADR 0040 rebuild: <c>player_statistics</c> holds one row per
/// <c>(scope, player)</c>, and every number in a scoped row was recomputed inside that scope rather
/// than filtered down from the global one.
///
/// <para>The archive is seeded with raw SQL against the three frozen table names, so the fixture states
/// what the rebuild reads — columns — instead of depending on which CLR type the archive aggregates
/// happen to be. The seed is deliberately lopsided: Alice wins everywhere except in <c>S2</c>, so a
/// League rating that was really a filtered global rating would be visible as a number above 1500 in a
/// scope she only lost in.</para>
/// </summary>
public sealed class ScopedPlayerStatisticsRebuildTests : IAsyncLifetime
{
    private readonly PostgreSqlTestContainer postgres = new();

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using var database = CreateContext();
        await database.Database.MigrateAsync();
        await SeedArchiveAsync(database);
    }

    public async Task DisposeAsync() => await postgres.DisposeAsync();

    [Fact]
    public async Task Writes_one_row_per_scope_and_player()
    {
        await RebuildAsync();

        var rows = await RowsAsync();
        var scopes = rows
            .Select(row => (row.ScopeKind, row.ScopeId))
            .Distinct()
            .OrderBy(scope => scope.ScopeKind, StringComparer.Ordinal)
            .ThenBy(scope => scope.ScopeId, StringComparer.Ordinal)
            .ToArray();
        Assert.Equal(
            [("global", ""), ("league", "L1"), ("league", "L2"), ("season", "S1"), ("season", "S2"), ("season", "S3")],
            scopes);
        Assert.All(rows, row => Assert.Equal(row.ScopeKind == "global", row.ScopeId.Length == 0));
    }

    [Fact]
    public async Task Counts_only_the_scopes_tournaments()
    {
        await RebuildAsync();

        var rows = await RowsAsync();
        Assert.Equal(5, Row(rows, "global", "", "Alice").PlayedMatchCount);
        Assert.Equal(3, Row(rows, "league", "L1", "Alice").PlayedMatchCount);
        Assert.Equal(1, Row(rows, "league", "L2", "Alice").PlayedMatchCount);
        Assert.Equal(2, Row(rows, "season", "S1", "Alice").PlayedMatchCount);
        Assert.Equal(1, Row(rows, "season", "S2", "Alice").PlayedMatchCount);
        Assert.Equal(1, Row(rows, "season", "S3", "Alice").PlayedMatchCount);
    }

    [Fact]
    public async Task Counts_tournaments_played_within_the_scope()
    {
        await RebuildAsync();

        var rows = await RowsAsync();
        Assert.Equal(5, Row(rows, "global", "", "Alice").TournamentsPlayed);
        Assert.Equal(2, Row(rows, "season", "S1", "Alice").TournamentsPlayed);
        Assert.Equal(1, Row(rows, "season", "S2", "Alice").TournamentsPlayed);
    }

    [Fact]
    public async Task Recomputes_the_rating_inside_the_scope_rather_than_filtering_the_global_one()
    {
        await RebuildAsync();

        var rows = await RowsAsync();
        // S2 holds Alice's only defeat. A scoped replay starts from the published seed and can only move
        // her down; a global rating filtered by scope would still read above 1500.
        Assert.True(Row(rows, "season", "S2", "Alice").Rating < 1500);
        Assert.True(Row(rows, "global", "", "Alice").Rating > 1500);
        Assert.NotEqual(Row(rows, "global", "", "Alice").Rating, Row(rows, "season", "S2", "Alice").Rating);
        Assert.Equal(1.0, Row(rows, "season", "S1", "Alice").MatchWinrate);
        Assert.Equal(0.8, Row(rows, "global", "", "Alice").MatchWinrate);
    }

    [Fact]
    public async Task Keeps_a_standalone_tournament_out_of_every_league_and_season_scope()
    {
        await RebuildAsync();

        var rows = await RowsAsync();
        var dana = rows.Where(row => row.PlayerName == "Dana").ToArray();
        Assert.Equal(("global", ""), (Assert.Single(dana).ScopeKind, dana[0].ScopeId));
        Assert.DoesNotContain(rows, row => row.ScopeKind != "global" && row.PlayerName == "Dana");
        // T-LONE is Alice's fifth Match globally and touches neither of her two S1 Tournaments.
        Assert.Equal(2, Row(rows, "season", "S1", "Alice").PlayedMatchCount);
    }

    [Fact]
    public async Task Ignores_active_and_deleted_tournaments_in_every_scope()
    {
        await RebuildAsync();

        var rows = await RowsAsync();
        foreach (var playerName in new[] { "Erin", "Frank", "Gina", "Hugo" })
        {
            Assert.DoesNotContain(rows, row => row.PlayerName == playerName);
        }
    }

    [Fact]
    public async Task Is_idempotent_across_scopes()
    {
        await RebuildAsync();
        var first = Projection(await RowsAsync());

        await RebuildAsync();

        Assert.Equal(first, Projection(await RowsAsync()));
    }

    /// <summary>
    /// Every column the seed produces, spelled out. The rebuild is free to get cheaper, never to get
    /// different: this pins the bytes so a refactor of how the archive is parsed and scoped has to keep
    /// the same rows, and is expected to be green on both sides of that change.
    /// </summary>
    [Fact]
    public async Task Pins_every_row_the_seed_produces()
    {
        await RebuildAsync();

        var rows = await RowsAsync();
        Assert.Equal(14, rows.Count);
        Assert.Equal(
            [
                ("global", "", "Alice"), ("global", "", "Bob"), ("global", "", "Carol"), ("global", "", "Dana"),
                ("league", "L1", "Alice"), ("league", "L1", "Bob"),
                ("league", "L2", "Alice"), ("league", "L2", "Carol"),
                ("season", "S1", "Alice"), ("season", "S1", "Bob"),
                ("season", "S2", "Alice"), ("season", "S2", "Bob"),
                ("season", "S3", "Alice"), ("season", "S3", "Carol")
            ],
            rows.Select(row => (row.ScopeKind, row.ScopeId, row.PlayerName)).ToArray());

        var aliceGlobal = Row(rows, "global", "", "Alice");
        Assert.Equal(5, aliceGlobal.PlayedMatchCount);
        Assert.Equal(4, aliceGlobal.MatchWins);
        Assert.Equal(1, aliceGlobal.MatchLosses);
        Assert.Equal(0, aliceGlobal.MatchDraws);
        Assert.Equal(0.8, aliceGlobal.MatchWinrate);
        Assert.Equal(11, aliceGlobal.PlayedGameCount);
        Assert.Equal(8, aliceGlobal.GameWins);
        Assert.Equal(3, aliceGlobal.GameLosses);
        Assert.Equal(8.0 / 11.0, aliceGlobal.GameWinrate);
        Assert.Equal(new OpponentRecord("Bob", 2, 1), aliceGlobal.Nemesis);
        Assert.Equal(new OpponentRecord("Bob", 2, 1), aliceGlobal.Rival);
        Assert.Null(aliceGlobal.MostPlayedArchetype);
        Assert.Equal(5, aliceGlobal.TournamentsPlayed);
        Assert.Equal("2030-05-05", aliceGlobal.LastPlayedDate);

        var aliceL1 = Row(rows, "league", "L1", "Alice");
        Assert.Equal(3, aliceL1.PlayedMatchCount);
        Assert.Equal(2, aliceL1.MatchWins);
        Assert.Equal(1, aliceL1.MatchLosses);
        Assert.Equal(0, aliceL1.MatchDraws);
        Assert.Equal(2.0 / 3.0, aliceL1.MatchWinrate);
        Assert.Equal(7, aliceL1.PlayedGameCount);
        Assert.Equal(4, aliceL1.GameWins);
        Assert.Equal(3, aliceL1.GameLosses);
        Assert.Equal(4.0 / 7.0, aliceL1.GameWinrate);
        Assert.Equal(3, aliceL1.TournamentsPlayed);
        Assert.Equal("2030-03-05", aliceL1.LastPlayedDate);

        var aliceS1 = Row(rows, "season", "S1", "Alice");
        Assert.Equal(2, aliceS1.PlayedMatchCount);
        Assert.Equal(2, aliceS1.MatchWins);
        Assert.Equal(0, aliceS1.MatchLosses);
        Assert.Equal(1.0, aliceS1.MatchWinrate);
        Assert.Equal(4, aliceS1.GameWins);
        Assert.Equal(1, aliceS1.GameLosses);
        Assert.Equal(2, aliceS1.TournamentsPlayed);
        Assert.Equal("2030-02-05", aliceS1.LastPlayedDate);

        var aliceS2 = Row(rows, "season", "S2", "Alice");
        Assert.Equal(1, aliceS2.PlayedMatchCount);
        Assert.Equal(0, aliceS2.MatchWins);
        Assert.Equal(1, aliceS2.MatchLosses);
        Assert.Equal(0.0, aliceS2.MatchWinrate);
        Assert.Equal(0, aliceS2.GameWins);
        Assert.Equal(2, aliceS2.GameLosses);
        Assert.Equal(1, aliceS2.TournamentsPlayed);
        Assert.Equal("2030-03-05", aliceS2.LastPlayedDate);

        var bobGlobal = Row(rows, "global", "", "Bob");
        Assert.Equal(3, bobGlobal.PlayedMatchCount);
        Assert.Equal(1, bobGlobal.MatchWins);
        Assert.Equal(2, bobGlobal.MatchLosses);
        Assert.Equal(1.0 / 3.0, bobGlobal.MatchWinrate);
        Assert.Equal(7, bobGlobal.PlayedGameCount);
        Assert.Equal(3, bobGlobal.GameWins);
        Assert.Equal(4, bobGlobal.GameLosses);
        Assert.Equal(new OpponentRecord("Alice", 1, 2), bobGlobal.Nemesis);
        Assert.Equal(new OpponentRecord("Alice", 1, 2), bobGlobal.Rival);
        Assert.Equal(3, bobGlobal.TournamentsPlayed);
        Assert.Equal("2030-03-05", bobGlobal.LastPlayedDate);

        var danaGlobal = Row(rows, "global", "", "Dana");
        Assert.Equal(1, danaGlobal.PlayedMatchCount);
        Assert.Equal(0, danaGlobal.MatchWins);
        Assert.Equal(1, danaGlobal.MatchLosses);
        Assert.Equal(new OpponentRecord("Alice", 0, 1), danaGlobal.Nemesis);
        Assert.Equal(1, danaGlobal.TournamentsPlayed);
        Assert.Equal("2030-05-05", danaGlobal.LastPlayedDate);
    }

    private static (string ScopeKind, string ScopeId, GlobalPlayerStatistics Statistics)[] Projection(
        IReadOnlyList<PlayerStatisticsRow> rows) =>
        [.. rows.Select(row => (row.ScopeKind, row.ScopeId, row.ToGlobalPlayerStatistics()))];

    private static PlayerStatisticsRow Row(IReadOnlyList<PlayerStatisticsRow> rows, string scopeKind, string scopeId, string playerName) =>
        rows.Single(row => row.ScopeKind == scopeKind && row.ScopeId == scopeId && row.PlayerName == playerName);

    private async Task RebuildAsync()
    {
        await using var database = CreateContext();
        await using var transaction = await database.Database.BeginTransactionAsync();
        await new PlayerStatisticsRebuildService(NullLogger<PlayerStatisticsRebuildService>.Instance)
            .RebuildAsync(database, CancellationToken.None);
        await database.SaveChangesAsync();
        await transaction.CommitAsync();
    }

    /// <summary>Every row, in the deterministic order the projection comparison needs.</summary>
    private async Task<IReadOnlyList<PlayerStatisticsRow>> RowsAsync()
    {
        await using var database = CreateContext();
        var rows = await database.PlayerStatistics.AsNoTracking().ToListAsync();
        return rows
            .OrderBy(row => row.ScopeKind, StringComparer.Ordinal)
            .ThenBy(row => row.ScopeId, StringComparer.Ordinal)
            .ThenBy(row => row.PlayerName, StringComparer.Ordinal)
            .ToList();
    }

    /// <summary>
    /// Two Leagues, three Seasons and seven Tournaments, written by column name. The last two are the
    /// negative cases: an active Tournament and a soft-deleted one, neither of which may reach any scope.
    /// </summary>
    private static async Task SeedArchiveAsync(GonesDbContext database)
    {
        await AddLeagueAsync(database, "L1");
        await AddLeagueAsync(database, "L2");
        await AddSeasonAsync(database, "S1", "L1");
        await AddSeasonAsync(database, "S2", "L1");
        await AddSeasonAsync(database, "S3", "L2");
        await AddTournamentAsync(database, "T-S1-a", "S1", "2030-01-05", "completed", "Alice", "Bob", 2, 0);
        await AddTournamentAsync(database, "T-S1-b", "S1", "2030-02-05", "completed", "Alice", "Bob", 2, 1);
        await AddTournamentAsync(database, "T-S2-a", "S2", "2030-03-05", "completed", "Bob", "Alice", 2, 0);
        await AddTournamentAsync(database, "T-S3-a", "S3", "2030-04-05", "completed", "Alice", "Carol", 2, 0);
        await AddTournamentAsync(database, "T-LONE", null, "2030-05-05", "completed", "Alice", "Dana", 2, 0);
        await AddTournamentAsync(database, "T-ACTIVE", "S1", "2030-06-05", "active", "Erin", "Frank", 2, 0);
        await AddTournamentAsync(database, "T-GONE", "S1", "2030-07-05", "completed", "Gina", "Hugo", 2, 0, deletedAt: "2030-07-06T00:00:00Z");
    }

    private static Task AddLeagueAsync(GonesDbContext database, string documentId) =>
        database.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO archive_leagues (document_id, name, created_at, updated_at, version, deleted_at)
            VALUES ({0}, {1}, now(), now(), 1, NULL)
            """,
            documentId,
            $"League {documentId}");

    private static Task AddSeasonAsync(GonesDbContext database, string documentId, string leagueId) =>
        database.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO archive_league_seasons (
                document_id, league_id, name, status, updated_at, version, deleted_at,
                tournament_count, player_count, first_tournament_date, last_tournament_date, counts_version)
            VALUES ({0}, {1}, {2}, 'completed', now(), 1, NULL, 0, 0, NULL, NULL, 1)
            """,
            documentId,
            leagueId,
            $"Season {documentId}");

    private static Task AddTournamentAsync(
        GonesDbContext database,
        string documentId,
        string? seasonId,
        string tournamentDate,
        string status,
        string player1,
        string player2,
        int player1Score,
        int player2Score,
        string? deletedAt = null)
    {
        // The stored JSON carries the same id, name, status and Season the columns do, because
        // ck_archive_tournament_document_metadata compares them.
        var document = LeagueJson.Serialize(new
        {
            id = documentId,
            name = $"Tournament {documentId}",
            seasonId,
            tournamentDate,
            status,
            rounds = new[]
            {
                new RoundDocument($"{documentId}-r1", [new MatchRoundEntry($"{documentId}-m1", "1", player1, player2, player1Score, player2Score, string.Empty, string.Empty)])
            },
            playerArchetypes = Array.Empty<PlayerArchetypeDocument>()
        });
        // The two nullable columns take an empty-string sentinel rather than a null parameter: EF's raw
        // SQL builder has no store type for a null it cannot infer, and neither a Season id nor a
        // timestamp is ever legitimately empty.
        return database.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO archive_tournaments (
                document_id, season_id, name, tournament_date, status, document,
                updated_at, version, deleted_at, player_count, counts_version)
            VALUES ({0}, NULLIF({1}, ''), {2}, CAST({3} AS date), {4}, CAST({5} AS jsonb), now(), 1, CAST(NULLIF({6}, '') AS timestamptz), 2, 1)
            """,
            documentId,
            seasonId ?? string.Empty,
            $"Tournament {documentId}",
            tournamentDate,
            status,
            document,
            deletedAt ?? string.Empty);
    }

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString()).Options);
}
