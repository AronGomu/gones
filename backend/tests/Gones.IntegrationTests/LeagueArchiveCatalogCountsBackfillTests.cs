using Gones.Domain.Leagues;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.IntegrationTests;

/// <summary>
/// The startup repair for the denormalized catalog counts (ADR 0042): the migration creates the columns
/// at <c>counts_version = 0</c>, and this is what turns them into numbers something may read. Each test
/// owns its own document IDs and boots its own host, so the cases do not depend on each other's order.
/// </summary>
public sealed class LeagueArchiveCatalogCountsBackfillTests : IAsyncLifetime
{
    private static readonly Instant Seeded = Instant.FromUtc(2031, 5, 1, 12, 0);

    private readonly PostgreSqlTestContainer postgres = new();
    private readonly List<WebApplicationFactory<Program>> factories = [];

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using var database = CreateContext();
        await database.Database.MigrateAsync();
    }

    public async Task DisposeAsync()
    {
        foreach (var factory in factories) await factory.DisposeAsync();
        await postgres.DisposeAsync();
    }

    [Fact]
    public async Task Repairs_rows_left_at_an_older_counts_version()
    {
        await SeedAsync("backfill-stale");
        await StaleAsync("backfill-stale");

        await StartAsync();

        var repaired = await ReadAsync("backfill-stale");
        // The seeded document holds one Tournament and four distinct players, which is what the list
        // card prints for it.
        Assert.Equal(1, repaired.TournamentCount);
        Assert.Equal(4, repaired.PlayerCount);
        Assert.Equal(LeagueCatalogCounts.Version, repaired.CountsVersion);
    }

    [Fact]
    public async Task Leaves_current_rows_untouched()
    {
        await SeedAsync("backfill-current");

        await StartAsync();
        var afterFirstStart = await ReadAsync("backfill-current");
        await StartAsync();
        var afterSecondStart = await ReadAsync("backfill-current");

        // A row already at the current version is not rewritten, so neither the concurrency token nor
        // the timestamp the archive orders by moves.
        Assert.Equal(afterFirstStart.Version, afterSecondStart.Version);
        Assert.Equal(afterFirstStart.UpdatedAt, afterSecondStart.UpdatedAt);
        Assert.Equal(LeagueCatalogCounts.Version, afterSecondStart.CountsVersion);
    }

    [Fact]
    public async Task Skips_soft_deleted_rows()
    {
        await SeedAsync("backfill-deleted");
        await using (var database = CreateContext())
        {
            var aggregate = await database.LeagueArchiveAggregates.SingleAsync(item => item.DocumentId == "backfill-deleted");
            aggregate.SoftDelete(Seeded.Plus(Duration.FromHours(1)));
            await database.SaveChangesAsync();
        }
        await StaleAsync("backfill-deleted");

        using var client = await StartAsync();

        var untouched = await ReadAsync("backfill-deleted");
        Assert.Equal(0, untouched.CountsVersion);
        Assert.Equal(0, untouched.TournamentCount);
        Assert.Equal(0, untouched.PlayerCount);
        // The host still serves: a deleted row is skipped, not a failure.
        Assert.True((await client.GetAsync("/api/leagues-archive/all")).IsSuccessStatusCode);
    }

    [Fact]
    public async Task Does_not_run_when_disabled()
    {
        await SeedAsync("backfill-disabled");
        await StaleAsync("backfill-disabled");

        using var client = await StartAsync(("Gones:Leagues:BackfillCatalogCountsOnStartup", "false"));

        var stale = await ReadAsync("backfill-disabled");
        Assert.Equal(0, stale.CountsVersion);
        Assert.Equal(0, stale.TournamentCount);
        Assert.True((await client.GetAsync("/api/leagues-archive/all")).IsSuccessStatusCode);
    }

    private async Task SeedAsync(string documentId)
    {
        await using var database = CreateContext();
        database.LeagueArchiveAggregates.Add(LeagueArchiveAggregate.Create(League(documentId), Seeded));
        await database.SaveChangesAsync();
    }

    /// <summary>Puts a row back in the shape the migration leaves behind: counted by nothing, at version 0.</summary>
    private async Task StaleAsync(string documentId)
    {
        await using var database = CreateContext();
        await database.Database.ExecuteSqlRawAsync(
            "UPDATE league_archive_aggregates SET tournament_count = 0, player_count = 0, counts_version = 0 WHERE document_id = {0}",
            documentId);
    }

    private async Task<LeagueArchiveAggregate> ReadAsync(string documentId)
    {
        await using var database = CreateContext();
        return await database.LeagueArchiveAggregates.AsNoTracking().SingleAsync(item => item.DocumentId == documentId);
    }

    private async Task<HttpClient> StartAsync(params (string Key, string Value)[] settings)
    {
        var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "t-catalog-counts-backfill-signing-key");
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
            foreach (var (key, value) in settings) builder.UseSetting(key, value);
        });
        factories.Add(factory);
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        // CreateClient starts the host, which is what runs the hosted services; the call above returns
        // only once every one of them has finished starting.
        await Task.Yield();
        return client;
    }

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString()).Options);

    private static LeagueDocument League(string id) => new(
        id,
        $"League {id}",
        "completed",
        [
            new TournamentDocument($"{id}-tournament", id, "Finished Day", "2031-05-01", "completed",
                [
                    new RoundDocument($"{id}-r1",
                    [
                        new MatchRoundEntry($"{id}-m1", "1", "Ada", "Bo", 2, 0, "Tempo", "Control"),
                        new MatchRoundEntry($"{id}-m2", "2", "Cy", "Dot", 2, 1, string.Empty, string.Empty)
                    ])
                ],
                [new PlayerArchetypeDocument("Ada", "Tempo")])
        ]);
}
