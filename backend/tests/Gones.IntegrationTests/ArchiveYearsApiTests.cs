using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Gones.Api.Archive;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using NodaTime;

namespace Gones.IntegrationTests;

/// <summary>
/// The index that tells a client which year partitions exist, how many rows each holds and whether the
/// year can still change. <c>locked</c> is on the wire here — unlike on a Tournament row — because this
/// body is fetched every session and is never cached across a day boundary, which is also why the
/// current UTC day is part of its ETag.
/// </summary>
public sealed class ArchiveYearsApiTests : IAsyncLifetime
{
    private const string Path = "/api/archive/years";
    private const string CatalogCacheControl = "public, max-age=3600";
    private static readonly Instant Seeded = Instant.FromUtc(2031, 5, 1, 10, 0);

    private readonly PostgreSqlTestContainer postgres = new();
    private readonly MutableClock clock = new(Instant.FromUtc(2031, 12, 31, 12, 0));
    private WebApplicationFactory<Program>? factory;
    private HttpClient? client;

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using (var database = CreateContext())
        {
            await database.Database.MigrateAsync();
            await ArchiveTournamentYearCatalogApiTests.SeedParentsAsync(database);
            await Seed(database, "t-2028-a", "season-one", "Twenty Eight", "2028-07-04", Seeded, 4, deleted: false);
            await Seed(database, "t-2029-a", "season-one", "Twenty Nine", "2029-09-09", Instant.FromUtc(2031, 5, 1, 9, 0), 2, deleted: false);
            await Seed(database, "t-2030-a", "season-one", "March A", "2030-03-05", Seeded.Plus(Duration.FromHours(1)), 8, deleted: false);
            await Seed(database, "t-2030-b", "season-one", "March B", "2030-03-05", Seeded.Plus(Duration.FromHours(2)), 6, deleted: false);
            await Seed(database, "t-2030-c", null, "November", "2030-11-20", Seeded.Plus(Duration.FromHours(3)), 12, deleted: false);
            await Seed(database, "t-2031-a", "season-one", "January", "2031-01-15", Seeded.Plus(Duration.FromHours(4)), 5, deleted: false);
            await Seed(database, "t-2031-standalone", null, "Standalone", "2031-02-02", Seeded.Plus(Duration.FromHours(5)), 3, deleted: false);
            await Seed(database, "t-2031-gone", "season-one", "Removed", "2031-05-05", Seeded.Plus(Duration.FromHours(6)), 9, deleted: true);
        }

        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "t6-archive-years-index-signing-key");
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
            builder.UseSetting("Gones:PlayerStatistics:RebuildOnStartup", "false");
            // `locked` is derived from today, so the assertions need a day they control.
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IClock>();
                services.AddSingleton<IClock>(clock);
            });
        });
        client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
    }

    public async Task DisposeAsync()
    {
        client?.Dispose();
        if (factory is not null) await factory.DisposeAsync();
        await postgres.DisposeAsync();
    }

    [Fact]
    public async Task Lists_every_year_that_holds_a_Tournament_ascending()
    {
        var years = await ReadYearsAsync();

        Assert.Equal([2028, 2029, 2030, 2031], years.Select(entry => entry.GetProperty("year").GetInt32()).ToArray());
        // Exactly these keys. `locked` being present is the deliberate asymmetry with a Tournament row,
        // which must never carry it.
        foreach (var entry in years)
        {
            Assert.Equal(
                ["locked", "tournamentCount", "year"],
                entry.EnumerateObject().Select(property => property.Name).Order(StringComparer.Ordinal).ToArray());
        }
    }

    [Fact]
    public async Task Omits_a_year_with_no_Tournament()
    {
        var present = (await ReadYearsAsync()).Select(entry => entry.GetProperty("year").GetInt32()).ToArray();

        // A year with no row is absent, not an entry with a zero count: the client uses this list to
        // decide which partitions to fetch at all.
        Assert.DoesNotContain(2027, present);
        Assert.DoesNotContain(1999, present);
    }

    [Fact]
    public async Task Answers_an_empty_index_for_an_empty_archive()
    {
        await using (var database = CreateContext())
        {
            await database.Database.ExecuteSqlRawAsync("DELETE FROM archive_tournaments");
        }

        using var response = await Client.GetAsync(Path);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        // An archive with nothing in it answers an empty list, never null and never an error: this is
        // the state the app boots into before the first backfill, and the client fetches it anyway.
        Assert.Equal(JsonValueKind.Array, body.GetProperty("years").ValueKind);
        Assert.Empty(body.GetProperty("years").EnumerateArray());
        Assert.NotNull(response.Headers.ETag);
        Assert.Equal(CatalogCacheControl, response.Headers.CacheControl!.ToString());
    }

    [Fact]
    public async Task Counts_the_Tournaments_of_each_year()
    {
        var counts = (await ReadYearsAsync())
            .ToDictionary(entry => entry.GetProperty("year").GetInt32(), entry => entry.GetProperty("tournamentCount").GetInt32());

        Assert.Equal(1, counts[2028]);
        Assert.Equal(1, counts[2029]);
        Assert.Equal(3, counts[2030]);
        // t-2031-gone is soft deleted, so 2031 holds two visible rows and not three.
        Assert.Equal(2, counts[2031]);
    }

    [Fact]
    public async Task Marks_a_year_locked_only_when_its_last_day_is_more_than_365_days_old()
    {
        var atEndOf2031 = await ReadLockFlagsAsync();
        Assert.True(atEndOf2031[2029]);
        // 31 December 2030 is exactly 365 days before 31 December 2031, and exactly 365 is not locked.
        Assert.False(atEndOf2031[2030]);
        Assert.False(atEndOf2031[2031]);

        clock.Set(Instant.FromUtc(2032, 1, 1, 0, 0));

        var atNewYear = await ReadLockFlagsAsync();
        // One day later the same year is 366 days old, and the flag flips with no write to any row.
        Assert.True(atNewYear[2030]);
        Assert.False(atNewYear[2031]);
    }

    [Fact]
    public async Task Changes_its_ETag_when_the_day_changes()
    {
        var before = (await Client.GetAsync(Path)).Headers.ETag!.ToString();
        clock.Set(Instant.FromUtc(2032, 1, 1, 0, 0));
        var after = (await Client.GetAsync(Path)).Headers.ETag!.ToString();

        // No row changed, but the lock flags did. Without the day in the ETag a client holding
        // yesterday's copy would be answered 304 and go on believing 2030 is still editable.
        Assert.NotEqual(before, after);

        using var conditional = new HttpRequestMessage(HttpMethod.Get, Path);
        conditional.Headers.TryAddWithoutValidation("If-None-Match", before);
        using var replay = await Client.SendAsync(conditional);
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
    }

    [Fact]
    public async Task Answers_304_on_a_matching_ETag()
    {
        using var first = await Client.GetAsync(Path);
        var etag = first.Headers.ETag!.ToString();

        using var conditional = new HttpRequestMessage(HttpMethod.Get, Path);
        conditional.Headers.TryAddWithoutValidation("If-None-Match", etag);
        using var replay = await Client.SendAsync(conditional);

        Assert.Equal(HttpStatusCode.NotModified, replay.StatusCode);
        Assert.Equal(etag, replay.Headers.ETag!.ToString());
        Assert.Equal(CatalogCacheControl, replay.Headers.CacheControl!.ToString());
    }

    [Fact]
    public async Task Sets_the_catalog_cache_control()
    {
        using var response = await Client.GetAsync(Path);

        Assert.Equal(CatalogCacheControl, response.Headers.CacheControl!.ToString());
        Assert.NotNull(response.Headers.ETag);
        Assert.False(response.Headers.ETag!.IsWeak);
    }

    [Fact]
    public async Task Years_index_is_grouped_in_the_database()
    {
        await using var database = CreateContext();
        var sql = PublicArchiveEndpoints.YearCountsQuery(database).ToQueryString();

        // Counting in memory would mean loading every Tournament in the archive to answer a route the
        // client calls on every session.
        Assert.Contains("GROUP BY", sql, StringComparison.Ordinal);
        Assert.Contains("count(", sql, StringComparison.OrdinalIgnoreCase);
        // The jsonb document is the one column this route must never read.
        Assert.DoesNotContain("document", sql.Replace("document_id", string.Empty, StringComparison.Ordinal), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Is_anonymous()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, Path);
        Assert.Null(request.Headers.Authorization);

        using var response = await Client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private static Task Seed(
        GonesDbContext database, string id, string? seasonId, string name, string date,
        Instant updatedAt, int playerCount, bool deleted) =>
        ArchiveTournamentYearCatalogApiTests.SeedAsync(database, id, seasonId, name, date, updatedAt, playerCount, deleted);

    private async Task<JsonElement[]> ReadYearsAsync()
    {
        using var response = await Client.GetAsync(Path);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("years").EnumerateArray().ToArray();
    }

    private async Task<Dictionary<int, bool>> ReadLockFlagsAsync() =>
        (await ReadYearsAsync()).ToDictionary(
            entry => entry.GetProperty("year").GetInt32(),
            entry => entry.GetProperty("locked").GetBoolean());

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString()).Options);

    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");

    private sealed class MutableClock(Instant current) : IClock
    {
        public Instant GetCurrentInstant() => current;
        public void Set(Instant value) => current = value;
    }
}
