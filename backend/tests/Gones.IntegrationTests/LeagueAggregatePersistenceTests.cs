using System.Text.Json.Nodes;
using Gones.Domain.Leagues;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using Npgsql;
using Testcontainers.PostgreSql;

namespace Gones.IntegrationTests;

public sealed class LeagueAggregatePersistenceTests : IAsyncLifetime
{
    private readonly PostgreSqlContainer postgres = new PostgreSqlBuilder().WithImage("postgres:17-alpine").Build();

    public Task InitializeAsync() => postgres.StartAsync();
    public Task DisposeAsync() => postgres.DisposeAsync().AsTask();

    [Fact]
    public async Task Jsonb_envelope_round_trips_exact_source_with_indexed_metadata()
    {
        await using var database = CreateContext();
        await database.Database.MigrateAsync();
        var document = FixtureLeague("roundtrip-league");
        var aggregate = LeagueAggregate.Create(document, Instant.FromUtc(2026, 8, 3, 10, 0));
        database.LeagueAggregates.Add(aggregate);
        await database.SaveChangesAsync();
        database.ChangeTracker.Clear();

        var persisted = await database.LeagueAggregates.SingleAsync(item => item.DocumentId == document.Id);
        Assert.True(JsonNode.DeepEquals(LeagueJson.ToNode(document), LeagueJson.ToNode(persisted.ReadDocument())));
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(LeagueJson.Serialize(document)), JsonNode.Parse(persisted.CanonicalDocument)));
        Assert.Equal(document.Name, persisted.Name);
        Assert.Equal(document.Status, persisted.Status);
        Assert.Equal(1, persisted.Version);
        Assert.Equal("jsonb", await ScalarAsync(database, "SELECT udt_name FROM information_schema.columns WHERE table_name = 'league_aggregates' AND column_name = 'canonical_document'"));
        var indexes = await IndexesAsync(database);
        Assert.Contains(indexes, value => value.Contains("document_id", StringComparison.Ordinal) && value.Contains("UNIQUE", StringComparison.Ordinal));
        Assert.Contains(indexes, value => value.Contains("deleted_at", StringComparison.Ordinal) && value.Contains("updated_at", StringComparison.Ordinal));
        Assert.Contains(indexes, value => value.Contains("name", StringComparison.Ordinal));
        Assert.Contains(indexes, value => value.Contains("status", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Placeholder_is_fixed_unique_and_not_duplicated_by_translation()
    {
        await using var database = CreateContext();
        await database.Database.MigrateAsync();

        var placeholders = await database.LeagueAggregates.Where(item => item.DocumentId == LeagueNormalizer.PlaceholderLeagueId).ToListAsync();
        var placeholder = Assert.Single(placeholders);
        Assert.True(JsonNode.DeepEquals(
            LeagueJson.ToNode(LeagueNormalizer.CreatePlaceholderLeague()),
            LeagueJson.ToNode(placeholder.ReadDocument())));
        Assert.False(await database.LeagueAggregates.AnyAsync(item => item.Name == "Tournois non assignés"));
        Assert.Throws<ArgumentException>(() => LeagueAggregate.Create(
            new LeagueDocument("translated-placeholder", "Tournois non assignés", "active", []),
            SystemClock.Instance.GetCurrentInstant()));

        database.LeagueAggregates.Add(LeagueAggregate.Create(LeagueNormalizer.CreatePlaceholderLeague(), SystemClock.Instance.GetCurrentInstant()));
        var duplicate = await Assert.ThrowsAsync<DbUpdateException>(() => database.SaveChangesAsync());
        Assert.Equal(PostgresErrorCodes.UniqueViolation, ((PostgresException)duplicate.InnerException!).SqlState);
    }

    [Fact]
    public async Task Soft_tombstone_hides_source_and_version_increments()
    {
        await using var database = CreateContext();
        await database.Database.MigrateAsync();
        var aggregate = LeagueAggregate.Create(FixtureLeague("deleted-league"), Instant.FromUtc(2026, 8, 3, 10, 0));
        database.LeagueAggregates.Add(aggregate);
        await database.SaveChangesAsync();

        aggregate.SoftDelete(Instant.FromUtc(2026, 8, 3, 11, 0));
        await database.SaveChangesAsync();

        Assert.Equal(2, aggregate.Version);
        Assert.Equal(Instant.FromUtc(2026, 8, 3, 11, 0), aggregate.DeletedAt);
        Assert.Equal(0, await database.LeagueAggregates.CountAsync(item => item.DeletedAt == null && item.DocumentId == "deleted-league"));
    }

    [Fact]
    public void Malformed_mismatched_and_oversized_documents_are_rejected()
    {
        Assert.Throws<ArgumentException>(() => LeagueAggregate.Create(
            new LeagueDocument("bad", "", "unknown", []), SystemClock.Instance.GetCurrentInstant()));
        Assert.Throws<ArgumentException>(() => LeagueAggregate.FromCanonicalDocument(
            "expected", "Expected", "active", "{\"id\":", SystemClock.Instance.GetCurrentInstant()));
        Assert.Throws<ArgumentException>(() => LeagueAggregate.FromCanonicalDocument(
            "expected", "Expected", "active", "{\"id\":\"other\",\"name\":\"Expected\",\"status\":\"active\",\"tournaments\":[]}", SystemClock.Instance.GetCurrentInstant()));
        Assert.Throws<ArgumentException>(() => LeagueAggregate.FromCanonicalDocument(
            "large", "Large", "active", $"{{\"id\":\"large\",\"name\":\"Large\",\"status\":\"active\",\"tournaments\":[],\"padding\":\"{new string('x', LeagueAggregate.MaximumDocumentBytes)}\"}}", SystemClock.Instance.GetCurrentInstant()));
    }

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString()).Options);

    private static LeagueDocument FixtureLeague(string id) => new(
        id,
        "Roundtrip League",
        "active",
        [new TournamentDocument("tournament-1", id, "Result Tournament", "2026-08-03",
            [new RoundDocument("round-1", [new MatchRoundEntry("entry-1", "1", "Alice", "Bob", 2, 1, "Tempo", "Control")])],
            [new PlayerArchetypeDocument("Alice", "Tempo"), new PlayerArchetypeDocument("Bob", "Control")])]);

    private static async Task<string> ScalarAsync(GonesDbContext database, string sql)
    {
        await database.Database.OpenConnectionAsync();
        await using var command = database.Database.GetDbConnection().CreateCommand();
        command.CommandText = sql;
        return Convert.ToString(await command.ExecuteScalarAsync(), System.Globalization.CultureInfo.InvariantCulture)!;
    }

    private static async Task<string[]> IndexesAsync(GonesDbContext database)
    {
        await database.Database.OpenConnectionAsync();
        await using var command = database.Database.GetDbConnection().CreateCommand();
        command.CommandText = "SELECT indexdef FROM pg_indexes WHERE tablename = 'league_aggregates' ORDER BY indexname";
        await using var reader = await command.ExecuteReaderAsync();
        var values = new List<string>();
        while (await reader.ReadAsync()) values.Add(reader.GetString(0));
        return values.ToArray();
    }
}
