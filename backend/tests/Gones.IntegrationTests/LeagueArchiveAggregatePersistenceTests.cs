using System.Text.Json.Nodes;
using Gones.Domain.Leagues;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using Npgsql;

namespace Gones.IntegrationTests;

public sealed class LeagueArchiveAggregatePersistenceTests : IAsyncLifetime
{
    private readonly PostgreSqlTestContainer postgres = new();

    public Task InitializeAsync() => postgres.StartAsync();
    public Task DisposeAsync() => postgres.DisposeAsync().AsTask();

    [Fact]
    public async Task Jsonb_envelope_round_trips_exact_source_with_indexed_metadata()
    {
        await using var database = CreateContext();
        await database.Database.MigrateAsync();
        var document = FixtureLeague("roundtrip-league");
        var aggregate = LeagueArchiveAggregate.Create(document, Instant.FromUtc(2026, 8, 3, 10, 0));
        database.LeagueArchiveAggregates.Add(aggregate);
        await database.SaveChangesAsync();
        database.ChangeTracker.Clear();

        var persisted = await database.LeagueArchiveAggregates.SingleAsync(item => item.DocumentId == document.Id);
        Assert.True(JsonNode.DeepEquals(LeagueJson.ToNode(document), LeagueJson.ToNode(persisted.ReadDocument())));
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(LeagueJson.Serialize(document)), JsonNode.Parse(persisted.CanonicalDocument)));
        Assert.Equal(document.Name, persisted.Name);
        Assert.Equal(document.Status, persisted.Status);
        Assert.Equal(1, persisted.Version);
        Assert.Equal("jsonb", await ScalarAsync(database, "SELECT udt_name FROM information_schema.columns WHERE table_name = 'league_archive_aggregates' AND column_name = 'canonical_document'"));
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

        var placeholders = await database.LeagueArchiveAggregates.Where(item => item.DocumentId == LeagueNormalizer.PlaceholderLeagueId).ToListAsync();
        var placeholder = Assert.Single(placeholders);
        Assert.True(JsonNode.DeepEquals(
            LeagueJson.ToNode(LeagueNormalizer.CreatePlaceholderLeague()),
            LeagueJson.ToNode(placeholder.ReadDocument())));
        Assert.False(await database.LeagueArchiveAggregates.AnyAsync(item => item.Name == "Tournois non assignés"));
        Assert.Throws<ArgumentException>(() => LeagueArchiveAggregate.Create(
            new LeagueDocument("translated-placeholder", "Tournois non assignés", "active", []),
            SystemClock.Instance.GetCurrentInstant()));

        database.LeagueArchiveAggregates.Add(LeagueArchiveAggregate.Create(LeagueNormalizer.CreatePlaceholderLeague(), SystemClock.Instance.GetCurrentInstant()));
        var duplicate = await Assert.ThrowsAsync<DbUpdateException>(() => database.SaveChangesAsync());
        Assert.Equal(PostgresErrorCodes.UniqueViolation, ((PostgresException)duplicate.InnerException!).SqlState);
    }

    [Fact]
    public async Task Soft_tombstone_hides_source_and_version_increments()
    {
        await using var database = CreateContext();
        await database.Database.MigrateAsync();
        var aggregate = LeagueArchiveAggregate.Create(FixtureLeague("deleted-league"), Instant.FromUtc(2026, 8, 3, 10, 0));
        database.LeagueArchiveAggregates.Add(aggregate);
        await database.SaveChangesAsync();

        aggregate.SoftDelete(Instant.FromUtc(2026, 8, 3, 11, 0));
        await database.SaveChangesAsync();

        Assert.Equal(2, aggregate.Version);
        Assert.Equal(Instant.FromUtc(2026, 8, 3, 11, 0), aggregate.DeletedAt);
        Assert.Equal(0, await database.LeagueArchiveAggregates.CountAsync(item => item.DeletedAt == null && item.DocumentId == "deleted-league"));
    }

    [Fact]
    public void Malformed_mismatched_and_oversized_documents_are_rejected()
    {
        Assert.Throws<ArgumentException>(() => LeagueArchiveAggregate.Create(
            new LeagueDocument("bad", "", "unknown", []), SystemClock.Instance.GetCurrentInstant()));
        Assert.Throws<ArgumentException>(() => LeagueArchiveAggregate.FromCanonicalDocument(
            "expected", "Expected", "active", "{\"id\":", SystemClock.Instance.GetCurrentInstant()));
        Assert.Throws<ArgumentException>(() => LeagueArchiveAggregate.FromCanonicalDocument(
            "expected", "Expected", "active", "{\"id\":\"other\",\"name\":\"Expected\",\"status\":\"active\",\"tournaments\":[]}", SystemClock.Instance.GetCurrentInstant()));
        Assert.Throws<ArgumentException>(() => LeagueArchiveAggregate.FromCanonicalDocument(
            "large", "Large", "active", $"{{\"id\":\"large\",\"name\":\"Large\",\"status\":\"active\",\"tournaments\":[],\"padding\":\"{new string('x', LeagueArchiveAggregate.MaximumDocumentBytes)}\"}}", SystemClock.Instance.GetCurrentInstant()));
    }

    /// <summary>
    /// First line of defence: Postgres itself refuses the contradiction. <c>Create</c> and <c>Apply</c>
    /// stamp <c>name</c>, <c>status</c> and <c>canonical_document</c> together, so no sequence of domain
    /// calls can produce a mismatched row; a raw <c>UPDATE</c> — a migration rewriting the column, a hand
    /// repair — is the only writer that could, and the check constraint stops it there.
    /// </summary>
    [Fact]
    public async Task Refuses_to_store_an_envelope_that_contradicts_its_document()
    {
        await using var database = CreateContext();
        await database.Database.MigrateAsync();
        await SeedAsync(database, "constraint-contradicted");

        var rejected = await Assert.ThrowsAsync<PostgresException>(() => RenameEnvelopeAsync(database, "constraint-contradicted"));

        Assert.Equal(PostgresErrorCodes.CheckViolation, rejected.SqlState);
        Assert.Equal(DocumentMetadataConstraint, rejected.ConstraintName);
    }

    /// <summary>
    /// Second line of defence: the domain guard on a read. <c>ReadDocument</c> stopped routing through
    /// <c>Create</c> when the catalog counts moved out of it (ADR 0042), and this is what says the
    /// envelope validation did not leave with them.
    ///
    /// <para>The check constraint above makes a contradicting row unwritable, so the constraint is
    /// dropped for the length of this test and put back afterwards. That is not a contrived state: a row
    /// written before a constraint existed, or restored from a dump that did not carry it, reaches
    /// <c>ReadDocument</c> exactly like this one — which is the whole reason the domain keeps its own
    /// check rather than trusting the schema.</para>
    /// </summary>
    [Fact]
    public async Task Read_refuses_a_row_whose_envelope_contradicts_its_document()
    {
        await using var database = CreateContext();
        await database.Database.MigrateAsync();
        await SeedAsync(database, "read-contradicted");

        await database.Database.ExecuteSqlRawAsync(
            $"ALTER TABLE league_archive_aggregates DROP CONSTRAINT {DocumentMetadataConstraint}");
        try
        {
            // Out of band: the envelope column moves, the document inside the jsonb does not.
            await RenameEnvelopeAsync(database, "read-contradicted");
            database.ChangeTracker.Clear();

            var contradicted = await database.LeagueArchiveAggregates
                .SingleAsync(item => item.DocumentId == "read-contradicted");
            Assert.Equal(RenamedEnvelope, contradicted.Name);
            Assert.Contains("Roundtrip League", contradicted.CanonicalDocument, StringComparison.Ordinal);

            var refused = Assert.Throws<ArgumentException>(contradicted.ReadDocument);
            Assert.Contains("League document metadata does not match its envelope.", refused.Message, StringComparison.Ordinal);
        }
        finally
        {
            await database.Database.ExecuteSqlRawAsync(
                "DELETE FROM league_archive_aggregates WHERE document_id = 'read-contradicted'");
            await database.Database.ExecuteSqlRawAsync(
                $"ALTER TABLE league_archive_aggregates ADD CONSTRAINT {DocumentMetadataConstraint} CHECK ({DocumentMetadataCheck})");
        }
    }

    private const string DocumentMetadataConstraint = "ck_league_aggregate_document_metadata";

    private const string DocumentMetadataCheck =
        "canonical_document ->> 'id' = document_id AND canonical_document ->> 'name' = name AND canonical_document ->> 'status' = status";

    private const string RenamedEnvelope = "Renamed Behind Its Own Back";

    private static async Task SeedAsync(GonesDbContext database, string documentId)
    {
        database.LeagueArchiveAggregates.Add(
            LeagueArchiveAggregate.Create(FixtureLeague(documentId), Instant.FromUtc(2026, 8, 3, 10, 0)));
        await database.SaveChangesAsync();
        database.ChangeTracker.Clear();
    }

    private static Task RenameEnvelopeAsync(GonesDbContext database, string documentId) =>
        database.Database.ExecuteSqlRawAsync(
            "UPDATE league_archive_aggregates SET name = {0} WHERE document_id = {1}",
            RenamedEnvelope,
            documentId);

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString()).Options);

    private static LeagueDocument FixtureLeague(string id) => new(
        id,
        "Roundtrip League",
        "active",
        [new TournamentDocument("tournament-1", id, "Result Tournament", "2026-08-03", "completed",
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
        command.CommandText = "SELECT indexdef FROM pg_indexes WHERE tablename = 'league_archive_aggregates' ORDER BY indexname";
        await using var reader = await command.ExecuteReaderAsync();
        var values = new List<string>();
        while (await reader.ReadAsync()) values.Add(reader.GetString(0));
        return values.ToArray();
    }
}
