using System.Text.Json;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Gones.IntegrationTests;

/// <summary>
/// The <c>AddArchiveTournamentStatus</c> backfill, exercised the way it will actually run: the database
/// is first migrated to the revision that precedes it, legacy documents with no <c>status</c> on their
/// Archive Tournaments are written into that schema, and only then is the backfill applied. Seeding after
/// a full <c>MigrateAsync()</c> would prove nothing, because the backfill would already have run against
/// an empty database.
///
/// The backfill carries no schema change — it rewrites the <c>canonical_document</c> jsonb — so the rows
/// are seeded with raw SQL rather than the DbContext, whose serializer already emits the new field.
/// </summary>
public sealed class ArchiveTournamentStatusBackfillTests : IAsyncLifetime
{
    /// <summary>The revision immediately before <c>AddArchiveTournamentStatus</c>.</summary>
    private const string BeforeBackfill = "20260816105213_RemoveOrganizationOwnership";

    private readonly PostgreSqlTestContainer postgres = new();

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using var database = CreateContext();
        await database.Database.MigrateAsync(BeforeBackfill);
        await SeedLegacyDocumentsAsync(database);
        await database.Database.MigrateAsync();
    }

    public Task DisposeAsync() => postgres.DisposeAsync().AsTask();

    [Fact]
    public async Task Every_stored_tournament_reads_completed()
    {
        Assert.Equal(0L, await ScalarAsync("""
            SELECT count(*) FROM league_archive_aggregates AS aggregate
            WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(aggregate.canonical_document -> 'tournaments') AS tournament
                          WHERE tournament ->> 'status' IS DISTINCT FROM 'completed');
            """));
        Assert.Equal(3L, await ScalarAsync("""
            SELECT count(*) FROM league_archive_aggregates AS aggregate,
                 jsonb_array_elements(aggregate.canonical_document -> 'tournaments') AS tournament
            WHERE tournament ->> 'status' = 'completed';
            """));
    }

    [Fact]
    public async Task Tournament_order_survives_the_rewrite()
    {
        var names = await ScalarTextAsync("""
            SELECT (SELECT string_agg(tournament ->> 'name', ',' ORDER BY position)
                    FROM jsonb_array_elements(aggregate.canonical_document -> 'tournaments')
                         WITH ORDINALITY AS elements(tournament, position))
            FROM league_archive_aggregates AS aggregate WHERE document_id = 'legacy-league';
            """);
        Assert.Equal("Day 1,Day 2", names);
    }

    [Fact]
    public async Task An_empty_tournament_list_is_left_alone()
    {
        var tournaments = await ScalarTextAsync("""
            SELECT canonical_document -> 'tournaments' FROM league_archive_aggregates WHERE document_id = 'legacy-empty-league';
            """);
        Assert.Equal("[]", tournaments);
    }

    [Fact]
    public async Task The_backfilled_document_still_loads_as_a_domain_document()
    {
        await using var database = CreateContext();
        var aggregate = await database.LeagueArchiveAggregates.SingleAsync(item => item.DocumentId == "legacy-league");
        Assert.All(aggregate.ReadDocument().Tournaments, tournament => Assert.Equal("completed", tournament.Status));
    }

    private static async Task SeedLegacyDocumentsAsync(GonesDbContext database)
    {
        await InsertAsync(database, "legacy-league", "Legacy League", "completed", """
            {"id":"legacy-league","name":"Legacy League","status":"completed","tournaments":[
              {"id":"legacy-t1","leagueId":"legacy-league","name":"Day 1","tournamentDate":"2026-01-01",
               "rounds":[{"id":"legacy-r1","entries":[{"kind":"match","id":"legacy-e1","table":"1","player1Name":"Alice","player2Name":"Bob","player1Score":2,"player2Score":1,"player1DeckArchetype":"","player2DeckArchetype":""}]}],
               "playerArchetypes":[]},
              {"id":"legacy-t2","leagueId":"legacy-league","name":"Day 2","tournamentDate":"2026-01-08",
               "rounds":[],"playerArchetypes":[]}]}
            """);
        await InsertAsync(database, "legacy-active-league", "Legacy Active League", "active", """
            {"id":"legacy-active-league","name":"Legacy Active League","status":"active","tournaments":[
              {"id":"legacy-t3","leagueId":"legacy-active-league","name":"Ongoing","tournamentDate":"2026-02-01",
               "rounds":[],"playerArchetypes":[]}]}
            """);
        await InsertAsync(database, "legacy-empty-league", "Legacy Empty League", "active", """
            {"id":"legacy-empty-league","name":"Legacy Empty League","status":"active","tournaments":[]}
            """);
    }

    private static async Task InsertAsync(GonesDbContext database, string documentId, string name, string status, string canonicalDocument)
    {
        // Compact the literal so the seeded column holds exactly the pre-migration shape, and prove it: no
        // seeded Tournament may already carry the field the backfill is supposed to add.
        using var parsed = JsonDocument.Parse(canonicalDocument);
        Assert.All(
            parsed.RootElement.GetProperty("tournaments").EnumerateArray(),
            tournament => Assert.False(tournament.TryGetProperty("status", out _)));
        await database.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO league_archive_aggregates (id, document_id, name, status, updated_at, deleted_at, canonical_document, version)
            VALUES (gen_random_uuid(), @p0, @p1, @p2, now(), NULL, CAST(@p3 AS jsonb), 1);
            """,
            new NpgsqlParameter("p0", documentId),
            new NpgsqlParameter("p1", name),
            new NpgsqlParameter("p2", status),
            new NpgsqlParameter("p3", JsonSerializer.Serialize(parsed.RootElement)));
    }

    private async Task<long> ScalarAsync(string sql) => Convert.ToInt64(await RawScalarAsync(sql), System.Globalization.CultureInfo.InvariantCulture);

    private async Task<string> ScalarTextAsync(string sql) => (await RawScalarAsync(sql))?.ToString() ?? string.Empty;

    private async Task<object?> RawScalarAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(postgres.GetConnectionString());
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        return await command.ExecuteScalarAsync();
    }

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString()).Options);
}
