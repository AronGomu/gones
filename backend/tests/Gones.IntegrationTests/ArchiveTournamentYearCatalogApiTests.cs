using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.IntegrationTests;

/// <summary>
/// The Tournament catalog, one calendar year per body. A whole-archive body is not an option: the
/// measured peak is about 17,500 Tournaments in a single year, so the wire unit is a year and each
/// year carries its own ETag, which is what lets a client revalidate one year without invalidating
/// the rest of the archive.
/// </summary>
public sealed class ArchiveTournamentYearCatalogApiTests : IAsyncLifetime
{
    private const string Path = "/api/archive/tournaments/all";
    private const string CatalogCacheControl = "public, max-age=3600";
    private static readonly Instant Seeded = Instant.FromUtc(2031, 5, 1, 10, 0);

    private readonly PostgreSqlTestContainer postgres = new();
    private readonly List<WebApplicationFactory<Program>> factories = [];

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using var database = CreateContext();
        await database.Database.MigrateAsync();
        await SeedParentsAsync(database);
        await SeedAsync(database, "t-2028-a", "season-one", "Twenty Eight", "2028-07-04", Seeded, 4, deleted: false);
        await SeedAsync(database, "t-2030-a", "season-one", "March A", "2030-03-05", Seeded.Plus(Duration.FromHours(1)), 8, deleted: false);
        await SeedAsync(database, "t-2030-b", "season-one", "March B", "2030-03-05", Seeded.Plus(Duration.FromHours(2)), 6, deleted: false);
        await SeedAsync(database, "t-2030-c", null, "November", "2030-11-20", Seeded.Plus(Duration.FromHours(3)), 12, deleted: false);
        await SeedAsync(database, "t-2031-a", "season-one", "January", "2031-01-15", Seeded.Plus(Duration.FromHours(4)), 5, deleted: false);
        await SeedAsync(database, "t-2031-standalone", null, "Standalone", "2031-02-02", Seeded.Plus(Duration.FromHours(5)), 3, deleted: false);
        await SeedAsync(database, "t-2031-gone", "season-one", "Removed", "2031-05-05", Seeded.Plus(Duration.FromHours(6)), 9, deleted: true);
    }

    public async Task DisposeAsync()
    {
        foreach (var factory in factories) await factory.DisposeAsync();
        await postgres.DisposeAsync();
    }

    [Fact]
    public async Task Returns_only_the_requested_year()
    {
        using var client = CreateClient();
        using var response = await client.GetAsync($"{Path}?year=2031");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        // 2028 and 2030 exist and must not leak into this body: the year is the unit of transfer.
        Assert.Equal(["t-2031-standalone", "t-2031-a"], Ids(body));
        Assert.Equal(2, body.GetProperty("totalCount").GetInt32());
        Assert.False(body.GetProperty("truncated").GetBoolean());
    }

    [Fact]
    public async Task Orders_by_date_descending_then_id_ascending()
    {
        using var client = CreateClient();
        var body = await ReadAsync(client, $"{Path}?year=2030");

        // t-2030-a and t-2030-b share 2030-03-05, so their order is decided by the ordinal id tiebreak
        // alone — which is what makes repeated calls byte-identical.
        Assert.Equal(["t-2030-c", "t-2030-a", "t-2030-b"], Ids(body));
    }

    [Fact]
    public async Task Returns_an_empty_partition_for_a_year_with_no_rows()
    {
        using var client = CreateClient();
        using var response = await client.GetAsync($"{Path}?year=1999");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        // An empty year is a valid, cacheable answer — not a 404.
        Assert.Empty(body.GetProperty("items").EnumerateArray());
        Assert.Equal(0, body.GetProperty("totalCount").GetInt32());
        Assert.False(body.GetProperty("truncated").GetBoolean());
        Assert.NotNull(response.Headers.ETag);
        Assert.Equal(CatalogCacheControl, response.Headers.CacheControl!.ToString());
    }

    [Fact]
    public async Task Excludes_a_soft_deleted_Tournament()
    {
        using var client = CreateClient();
        var body = await ReadAsync(client, $"{Path}?year=2031");

        // A soft delete leaves the row in place, so the count has to filter it too.
        Assert.DoesNotContain("t-2031-gone", Ids(body));
        Assert.Equal(2, body.GetProperty("totalCount").GetInt32());
    }

    [Fact]
    public async Task Carries_every_summary_field()
    {
        using var client = CreateClient();
        var body = await ReadAsync(client, $"{Path}?year=2031");
        var items = body.GetProperty("items").EnumerateArray().ToArray();

        // Exactly these keys: a field creeping onto the row is a body every browser caches for an hour.
        foreach (var item in items)
        {
            Assert.Equal(
                ["documentVersion", "id", "name", "playerCount", "seasonId", "status", "tournamentDate", "updatedAt"],
                item.EnumerateObject().Select(property => property.Name).Order(StringComparer.Ordinal).ToArray());
        }

        var january = items.Single(item => item.GetProperty("id").GetString() == "t-2031-a");
        Assert.Equal("January", january.GetProperty("name").GetString());
        Assert.Equal("2031-01-15", january.GetProperty("tournamentDate").GetString());
        Assert.Equal("completed", january.GetProperty("status").GetString());
        Assert.True(january.GetProperty("documentVersion").GetInt32() >= 1);
    }

    [Fact]
    public async Task Reports_a_standalone_Tournament_with_a_null_season()
    {
        using var client = CreateClient();
        var body = await ReadAsync(client, $"{Path}?year=2031");
        var items = body.GetProperty("items").EnumerateArray().ToArray();

        // seasonId is the only nullable field on the row, and null is what makes a Tournament top-level.
        Assert.Equal(
            JsonValueKind.Null,
            items.Single(item => item.GetProperty("id").GetString() == "t-2031-standalone").GetProperty("seasonId").ValueKind);
        Assert.Equal(
            "season-one",
            items.Single(item => item.GetProperty("id").GetString() == "t-2031-a").GetProperty("seasonId").GetString());
    }

    [Fact]
    public async Task Reads_the_denormalized_player_count()
    {
        using var client = CreateClient();
        var body = await ReadAsync(client, $"{Path}?year=2030");
        var items = body.GetProperty("items").EnumerateArray().ToArray();

        // The seed writes player_count in SQL over documents that hold no Rounds at all, so a count
        // derived from the stored JSON would answer 0 here and could not match.
        Assert.Equal(12, items.Single(item => item.GetProperty("id").GetString() == "t-2030-c").GetProperty("playerCount").GetInt32());
        Assert.Equal(8, items.Single(item => item.GetProperty("id").GetString() == "t-2030-a").GetProperty("playerCount").GetInt32());
    }

    [Fact]
    public async Task Omits_the_document_and_the_lock_flag_from_every_row()
    {
        using var client = CreateClient();
        var body = await ReadAsync(client, $"{Path}?year=2030");

        foreach (var item in body.GetProperty("items").EnumerateArray())
        {
            // `locked` is deliberately absent: a row cached today as unlocked becomes locked later with
            // no refetch, so the client derives the flag from tournamentDate instead. `rounds` and
            // `playerArchetypes` belong to the detail document, which is never stored in a partition.
            foreach (var forbidden in new[] { "locked", "rounds", "playerArchetypes", "document" })
            {
                Assert.False(
                    item.TryGetProperty(forbidden, out _),
                    $"{item.GetProperty("id").GetString()} still carries {forbidden}");
            }
        }
    }

    [Fact]
    public async Task Rejects_a_missing_year()
    {
        using var client = CreateClient();
        using var response = await client.GetAsync(Path);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType!.MediaType);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("invalid_request", body.GetProperty("code").GetString());
        Assert.Equal("Query parameter 'year' is required.", body.GetProperty("message").GetString());
    }

    [Fact]
    public async Task Rejects_a_blank_year()
    {
        using var client = CreateClient();
        using var response = await client.GetAsync($"{Path}?year=");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType!.MediaType);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("invalid_request", body.GetProperty("code").GetString());
        Assert.Equal("Query parameter 'year' is required.", body.GetProperty("message").GetString());
    }

    [Fact]
    public async Task Rejects_a_non_integer_year()
    {
        using var client = CreateClient();
        using var response = await client.GetAsync($"{Path}?year=abc");

        // Bound as a string and parsed by hand: an int? parameter would let minimal-API binding answer
        // first with its own bare 400, relabelled `malformed_request`.
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("invalid_request", body.GetProperty("code").GetString());
        Assert.Equal("Query parameter 'year' must be an integer between 1 and 9999.", body.GetProperty("message").GetString());
    }

    [Theory]
    [InlineData("0")]
    [InlineData("10000")]
    [InlineData("-2031")]
    public async Task Rejects_a_year_outside_the_supported_range(string year)
    {
        using var client = CreateClient();
        using var response = await client.GetAsync($"{Path}?year={year}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("invalid_request", body.GetProperty("code").GetString());
        Assert.Equal("Query parameter 'year' must be an integer between 1 and 9999.", body.GetProperty("message").GetString());
    }

    [Fact]
    public async Task Truncates_at_the_configured_ceiling()
    {
        using var client = CreateClient(("Gones:Archive:MaximumTournamentYearSize", "2"));
        var body = await ReadAsync(client, $"{Path}?year=2030");

        Assert.Equal(2, body.GetProperty("items").GetArrayLength());
        Assert.True(body.GetProperty("truncated").GetBoolean());
        // The count stays the whole year, which is what makes the flag readable.
        Assert.Equal(3, body.GetProperty("totalCount").GetInt32());
    }

    [Fact]
    public async Task Reports_no_truncation_when_the_year_ends_exactly_on_the_ceiling()
    {
        using var client = CreateClient(("Gones:Archive:MaximumTournamentYearSize", "3"));
        var body = await ReadAsync(client, $"{Path}?year=2030");

        // Truncation is decided by the ceiling + 1 fetch, so a year that ends exactly on the ceiling is
        // whole. Without the extra row this case is indistinguishable from a cut-off year.
        Assert.Equal(3, body.GetProperty("items").GetArrayLength());
        Assert.False(body.GetProperty("truncated").GetBoolean());
        Assert.Equal(3, body.GetProperty("totalCount").GetInt32());
    }

    [Fact]
    public async Task Answers_304_on_a_matching_ETag()
    {
        using var client = CreateClient();
        using var first = await client.GetAsync($"{Path}?year=2030");
        var etag = first.Headers.ETag!.ToString();

        using var conditional = new HttpRequestMessage(HttpMethod.Get, $"{Path}?year=2030");
        conditional.Headers.TryAddWithoutValidation("If-None-Match", etag);
        using var replay = await client.SendAsync(conditional);

        Assert.Equal(HttpStatusCode.NotModified, replay.StatusCode);
        // A 304 still carries the whole caching contract.
        Assert.Equal(etag, replay.Headers.ETag!.ToString());
        Assert.Equal(CatalogCacheControl, replay.Headers.CacheControl!.ToString());
    }

    [Fact]
    public async Task Gives_each_year_its_own_ETag()
    {
        using var client = CreateClient();
        var twentyThirtyBefore = (await client.GetAsync($"{Path}?year=2030")).Headers.ETag!.ToString();
        var twentyThirtyOneBefore = (await client.GetAsync($"{Path}?year=2031")).Headers.ETag!.ToString();
        Assert.NotEqual(twentyThirtyBefore, twentyThirtyOneBefore);

        await using (var database = CreateContext())
        {
            await SeedAsync(
                database, "t-2031-new", null, "Added", "2031-03-03", Seeded.Plus(Duration.FromDays(2)), 7, deleted: false);
        }

        // The whole point of partitioning: a write inside 2031 must leave 2030 revalidating for free.
        Assert.Equal(twentyThirtyBefore, (await client.GetAsync($"{Path}?year=2030")).Headers.ETag!.ToString());
        Assert.NotEqual(twentyThirtyOneBefore, (await client.GetAsync($"{Path}?year=2031")).Headers.ETag!.ToString());
    }

    [Fact]
    public async Task Sets_the_catalog_cache_control()
    {
        using var client = CreateClient();
        using var response = await client.GetAsync($"{Path}?year=2030");

        Assert.Equal(CatalogCacheControl, response.Headers.CacheControl!.ToString());
        Assert.NotNull(response.Headers.ETag);
        Assert.False(response.Headers.ETag!.IsWeak);
    }

    [Fact]
    public async Task Is_anonymous()
    {
        using var client = CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{Path}?year=2030");
        Assert.Null(request.Headers.Authorization);

        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private static string[] Ids(JsonElement body) =>
        body.GetProperty("items").EnumerateArray().Select(item => item.GetProperty("id").GetString()!).ToArray();

    private static async Task<JsonElement> ReadAsync(HttpClient client, string url)
    {
        using var response = await client.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    /// <summary>
    /// The League and the Season a seeded Tournament points at. <c>season_id</c> carries a restricting
    /// foreign key, so a Tournament of <c>season-one</c> cannot exist without them.
    /// </summary>
    internal static async Task SeedParentsAsync(GonesDbContext database)
    {
        await database.Database.ExecuteSqlRawAsync("""
            INSERT INTO archive_leagues (document_id, name, created_at, updated_at, version, deleted_at)
            VALUES ({0}, {1}, {2}, {3}, {4}, NULL)
            """, "league-one", "League One", Seeded, Seeded, 1);
        await database.Database.ExecuteSqlRawAsync("""
            INSERT INTO archive_league_seasons
                (document_id, league_id, name, status, updated_at, version, deleted_at,
                 tournament_count, player_count, first_tournament_date, last_tournament_date, counts_version)
            VALUES ({0}, {1}, {2}, {3}, {4}, {5}, NULL, {6}, {7}, NULL, NULL, {8})
            """, "season-one", "league-one", "Season One", "completed", Seeded, 1, 0, 0, 1);
    }

    /// <summary>
    /// One archive Tournament row, written in SQL rather than through <c>ArchiveTournament.Create</c>.
    /// The stored document is deliberately minimal — no Rounds, no archetypes — while
    /// <c>player_count</c> is written to a number the document could never produce, so a route that
    /// derived the count from the JSON would fail the assertions rather than pass them by accident.
    /// <c>deleted_at</c> is written the same way, because a soft delete has to be invisible to a read
    /// that never loads the aggregate.
    /// </summary>
    internal static Task SeedAsync(
        GonesDbContext database, string id, string? seasonId, string name, string date,
        Instant updatedAt, int playerCount, bool deleted)
    {
        // ck_archive_tournament_document_metadata compares the document against the columns, and the
        // domain omits a null seasonId from the JSON rather than writing null, so a standalone
        // Tournament drops the key entirely.
        var season = seasonId is null ? string.Empty : $"\"seasonId\":{JsonSerializer.Serialize(seasonId)},";
        var document =
            $$"""
              {"id":{{JsonSerializer.Serialize(id)}},"name":{{JsonSerializer.Serialize(name)}},{{season}}"tournamentDate":"{{date}}","status":"completed","rounds":[],"playerArchetypes":[]}
              """;
        return database.Database.ExecuteSqlRawAsync("""
            INSERT INTO archive_tournaments
                (document_id, season_id, name, tournament_date, status, document, updated_at, version,
                 deleted_at, player_count, counts_version)
            VALUES ({0}, {1}, {2}, CAST({3} AS date), {4}, CAST({5} AS jsonb), {6}, {7}, {8}, {9}, {10})
            """, id, seasonId!, name, date, "completed", document, updatedAt, 1, deleted ? updatedAt : null!, playerCount, 1);
    }

    private HttpClient CreateClient(params (string Key, string Value)[] settings)
    {
        var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "t6-archive-year-catalog-signing-key");
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
            builder.UseSetting("Gones:PlayerStatistics:RebuildOnStartup", "false");
            foreach (var (key, value) in settings) builder.UseSetting(key, value);
        });
        factories.Add(factory);
        return factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
    }

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString()).Options);
}
