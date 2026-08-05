using System.Text.Json.Nodes;
using Gones.Domain.Leagues;
using Gones.Domain.Live;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using Npgsql;
using Testcontainers.PostgreSql;

namespace Gones.IntegrationTests;

public sealed class LiveAggregatePersistenceTests : IAsyncLifetime
{
    private readonly PostgreSqlContainer postgres = new PostgreSqlBuilder().WithImage("postgres:17-alpine").Build();

    public Task InitializeAsync() => postgres.StartAsync();
    public Task DisposeAsync() => postgres.DisposeAsync().AsTask();

    [Fact]
    public async Task Jsonb_envelope_round_trips_exact_source_with_indexed_metadata()
    {
        await using var database = CreateContext();
        await database.Database.MigrateAsync();
        var document = FixtureLive("roundtrip-live");
        var aggregate = LiveAggregate.Create(document, Instant.FromUtc(2026, 8, 5, 10, 0));
        database.LiveAggregates.Add(aggregate);
        await database.SaveChangesAsync();
        database.ChangeTracker.Clear();

        var persisted = await database.LiveAggregates.SingleAsync(item => item.DocumentId == document.Id);
        Assert.True(JsonNode.DeepEquals(LeagueJson.ToNode(document), LeagueJson.ToNode(persisted.ReadDocument())));
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(LeagueJson.Serialize(document)), JsonNode.Parse(persisted.CanonicalDocument)));
        Assert.Equal(document.Name, persisted.Name);
        Assert.Equal(document.TournamentDate, persisted.TournamentDate);
        Assert.Equal(document.Stage, persisted.Stage);
        Assert.Equal(1, persisted.Version);
        Assert.Equal("jsonb", await ScalarAsync(database, "SELECT udt_name FROM information_schema.columns WHERE table_name = 'live_aggregates' AND column_name = 'canonical_document'"));
        var indexes = await IndexesAsync(database);
        Assert.Contains(indexes, value => value.Contains("document_id", StringComparison.Ordinal) && value.Contains("UNIQUE", StringComparison.Ordinal));
        Assert.Contains(indexes, value => value.Contains("deleted_at", StringComparison.Ordinal) && value.Contains("updated_at", StringComparison.Ordinal));
        Assert.Contains(indexes, value => value.Contains("name", StringComparison.Ordinal));
        Assert.Contains(indexes, value => value.Contains("tournament_date", StringComparison.Ordinal));
        Assert.Contains(indexes, value => value.Contains("stage", StringComparison.Ordinal));
        Assert.Contains(indexes, value => value.Contains("version", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Duplicate_document_ids_are_rejected_and_apply_increments_version()
    {
        await using var database = CreateContext();
        await database.Database.MigrateAsync();
        var aggregate = LiveAggregate.Create(FixtureLive("versioned-live"), Instant.FromUtc(2026, 8, 5, 10, 0));
        database.LiveAggregates.Add(aggregate);
        await database.SaveChangesAsync();

        aggregate.Apply(FixtureLive("versioned-live") with { Stage = "standings", CurrentRoundNumber = 1 }, Instant.FromUtc(2026, 8, 5, 11, 0));
        await database.SaveChangesAsync();
        Assert.Equal(2, aggregate.Version);
        Assert.Equal("standings", aggregate.Stage);

        database.LiveAggregates.Add(LiveAggregate.Create(FixtureLive("versioned-live"), Instant.FromUtc(2026, 8, 5, 12, 0)));
        var duplicate = await Assert.ThrowsAsync<DbUpdateException>(() => database.SaveChangesAsync());
        Assert.Equal(PostgresErrorCodes.UniqueViolation, ((PostgresException)duplicate.InnerException!).SqlState);
    }

    [Fact]
    public async Task Soft_tombstone_hides_source_and_blocks_further_changes()
    {
        await using var database = CreateContext();
        await database.Database.MigrateAsync();
        var aggregate = LiveAggregate.Create(FixtureLive("deleted-live"), Instant.FromUtc(2026, 8, 5, 10, 0));
        database.LiveAggregates.Add(aggregate);
        await database.SaveChangesAsync();

        aggregate.SoftDelete(Instant.FromUtc(2026, 8, 5, 11, 0));
        await database.SaveChangesAsync();

        Assert.Equal(2, aggregate.Version);
        Assert.Equal(Instant.FromUtc(2026, 8, 5, 11, 0), aggregate.DeletedAt);
        Assert.Equal(0, await database.LiveAggregates.CountAsync(item => item.DeletedAt == null && item.DocumentId == "deleted-live"));
        Assert.Throws<InvalidOperationException>(() => aggregate.Apply(FixtureLive("deleted-live"), Instant.FromUtc(2026, 8, 5, 12, 0)));
        Assert.Throws<InvalidOperationException>(() => aggregate.SoftDelete(Instant.FromUtc(2026, 8, 5, 12, 0)));
    }

    [Fact]
    public void Malformed_mismatched_oversized_and_unbounded_documents_are_rejected()
    {
        var now = SystemClock.Instance.GetCurrentInstant();
        Assert.Throws<ArgumentException>(() => LiveAggregate.Create(FixtureLive("bad-stage") with { Stage = "paused" }, now));
        Assert.Throws<ArgumentException>(() => LiveAggregate.Create(FixtureLive("bad-type") with { Type = "single-elimination" }, now));
        Assert.Throws<ArgumentException>(() => LiveAggregate.Create(FixtureLive("") , now));
        Assert.Throws<ArgumentException>(() => LiveAggregate.FromCanonicalDocument(
            "expected", "Expected", "2026-08-05", "registration", "{\"id\":", now));
        Assert.Throws<ArgumentException>(() => LiveAggregate.FromCanonicalDocument(
            "expected", "Expected", "2026-08-05", "registration",
            LeagueJson.Serialize(FixtureLive("other")), now));
        Assert.Throws<ArgumentException>(() => LiveAggregate.Create(
            FixtureLive("too-many-players") with
            {
                Players = Enumerable.Range(0, LiveAggregate.MaximumPlayers + 1)
                    .Select(index => new LiveTournamentPlayerDocument($"p-{index}", $"Player {index}", false, false, 0, 0, 0, ""))
                    .ToArray()
            }, now));
        Assert.Throws<ArgumentException>(() => LiveAggregate.Create(
            FixtureLive("too-many-checkpoints") with
            {
                Checkpoints = Enumerable.Range(0, LiveAggregate.MaximumCheckpoints + 1)
                    .Select(index => new LiveTournamentCheckpointDocument($"c-{index}", "Backup", "2026-08-05T10:00:00.000Z", "round", 1, 3, true, [], []))
                    .ToArray()
            }, now));
        Assert.Throws<ArgumentException>(() => LiveAggregate.Create(
            FixtureLive("too-many-rounds") with
            {
                Rounds = Enumerable.Range(0, LiveAggregate.MaximumRounds + 1)
                    .Select(index => new LiveTournamentRoundDocument($"r-{index}", index + 1, [], false))
                    .ToArray()
            }, now));
        var oversized = FixtureLive("oversized") with
        {
            Name = "Oversized",
            Players = [new LiveTournamentPlayerDocument("p-big", "Big", false, false, 0, 0, 0, new string('x', LiveAggregate.MaximumDocumentBytes))]
        };
        Assert.Throws<ArgumentException>(() => LiveAggregate.Create(oversized, now));

        var exact = LiveAggregate.Create(FixtureLive("exact-live"), now);
        Assert.True(JsonNode.DeepEquals(LeagueJson.ToNode(FixtureLive("exact-live")), LeagueJson.ToNode(exact.ReadDocument())));
    }

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString()).Options);

    private static LiveTournamentDocument FixtureLive(string id) => new(
        id,
        "Roundtrip Live",
        "league-1",
        "2026-08-05",
        "swiss",
        3,
        false,
        true,
        424242,
        ["p-1", "p-2", "p-3"],
        "round",
        1,
        [
            new LiveTournamentPlayerDocument("p-1", "Alice", true, false, 0, 0, 0, "Tempo"),
            new LiveTournamentPlayerDocument("p-2", "Bob", false, false, 0, 0, 0, "Control"),
            new LiveTournamentPlayerDocument("p-3", "Carol", true, true, 1, 0, 1, "")
        ],
        [new LiveTournamentRoundDocument("r-1", 1, [
            new LiveTournamentRoundEntryDocument(new MatchRoundEntry("m-1", "1", "Alice", "Bob", 0, 0, "", ""), false),
            new LiveTournamentRoundEntryDocument(new ByeRoundEntry("b-1", "2", "Carol", ""), true)
        ], false)],
        [new LiveTournamentCheckpointDocument("c-1", "Pairing 1", "2026-08-05T10:00:00.000Z", "round", 1, 3, true,
            [new LiveTournamentPlayerDocument("p-1", "Alice", true, false, 0, 0, 0, "Tempo")],
            [])],
        null,
        1,
        "2026-08-05T09:00:00.000Z",
        "2026-08-05T10:00:00.000Z");

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
        command.CommandText = "SELECT indexdef FROM pg_indexes WHERE tablename = 'live_aggregates' ORDER BY indexname";
        await using var reader = await command.ExecuteReaderAsync();
        var values = new List<string>();
        while (await reader.ReadAsync()) values.Add(reader.GetString(0));
        return values.ToArray();
    }
}
