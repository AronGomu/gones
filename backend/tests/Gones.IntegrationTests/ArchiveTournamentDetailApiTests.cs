using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;

namespace Gones.IntegrationTests;

/// <summary>
/// The whole Tournament document and the two derived standings. A detail document is never stored in
/// a year partition — partitions hold slim summary rows — so these routes are the only way the client
/// ever sees Rounds and archetypes, and it fetches them read-through, one Tournament at a time.
/// </summary>
public sealed class ArchiveTournamentDetailApiTests : IAsyncLifetime
{
    private const string ReadThroughCacheControl = "public, max-age=60";

    private readonly PostgreSqlTestContainer postgres = new();
    private readonly List<WebApplicationFactory<Program>> factories = [];

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using var database = CreateContext();
        await database.Database.MigrateAsync();
        await ArchiveSeed.SeedAsync(database);
    }

    public async Task DisposeAsync()
    {
        foreach (var factory in factories) await factory.DisposeAsync();
        await postgres.DisposeAsync();
    }

    [Fact]
    public async Task Returns_the_whole_document_with_rounds_and_archetypes()
    {
        using var client = CreateClient();
        var body = await ReadAsync(client, "/api/archive/tournaments/t-new");

        Assert.Equal("t-new", body.GetProperty("id").GetString());
        Assert.Equal("Tournament New", body.GetProperty("name").GetString());
        Assert.Equal("season-1", body.GetProperty("seasonId").GetString());
        Assert.Equal("2026-08-17", body.GetProperty("tournamentDate").GetString());
        Assert.Equal("completed", body.GetProperty("status").GetString());
        Assert.Equal("Alice", body.GetProperty("rounds")[0].GetProperty("entries")[0].GetProperty("player1Name").GetString());
        Assert.Equal("Alice", body.GetProperty("playerArchetypes")[0].GetProperty("playerName").GetString());
        Assert.True(body.GetProperty("documentVersion").GetInt32() >= 1);
        Assert.NotEqual(JsonValueKind.Undefined, body.GetProperty("updatedAt").ValueKind);
    }

    [Fact]
    public async Task Serves_a_standalone_Tournament_with_a_null_seasonId()
    {
        using var client = CreateClient();
        var body = await ReadAsync(client, "/api/archive/tournaments/t-standalone");

        // null is what makes a Tournament top-level, so it is serialized rather than omitted.
        Assert.Equal(JsonValueKind.Null, body.GetProperty("seasonId").ValueKind);
    }

    [Fact]
    public async Task Answers_404_for_an_unknown_or_soft_deleted_Tournament()
    {
        using var client = CreateClient();
        using var missing = await client.GetAsync("/api/archive/tournaments/t-missing");
        using var deleted = await client.GetAsync("/api/archive/tournaments/t-deleted");

        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, deleted.StatusCode);
        Assert.Equal("application/problem+json", missing.Content.Headers.ContentType!.MediaType);
        Assert.Equal("application/problem+json", deleted.Content.Headers.ContentType!.MediaType);
    }

    [Fact]
    public async Task Answers_304_on_a_matching_ETag()
    {
        using var client = CreateClient();
        using var first = await client.GetAsync("/api/archive/tournaments/t-new");
        var etag = first.Headers.ETag!.ToString();

        using var conditional = new HttpRequestMessage(HttpMethod.Get, "/api/archive/tournaments/t-new");
        conditional.Headers.TryAddWithoutValidation("If-None-Match", etag);
        using var replay = await client.SendAsync(conditional);

        Assert.Equal(HttpStatusCode.NotModified, replay.StatusCode);
        Assert.Equal(etag, replay.Headers.ETag!.ToString());
        Assert.Equal(ReadThroughCacheControl, replay.Headers.CacheControl!.ToString());
    }

    [Fact]
    public async Task Computes_the_Tournament_result()
    {
        using var client = CreateClient();
        var body = await ReadAsync(client, "/api/archive/tournaments/t-new/result");
        var rows = body.GetProperty("rows");

        // The domain's own scope string: a Tournament result is a Tournament result at every tier.
        Assert.Equal("tournament", body.GetProperty("scope").GetString());
        Assert.Equal(2, rows.GetArrayLength());
        Assert.Equal("Alice", rows[0].GetProperty("playerName").GetString());
        Assert.Equal(1, rows[0].GetProperty("rank").GetInt32());
    }

    [Fact]
    public async Task Computes_the_Season_result_over_every_Tournament()
    {
        using var client = CreateClient();
        var body = await ReadAsync(client, "/api/archive/league-seasons/season-1/result");
        var rows = body.GetProperty("rows").EnumerateArray().ToArray();

        // `League` now names the top tier, so a Season's standings must not call themselves one.
        Assert.Equal("season", body.GetProperty("scope").GetString());
        Assert.Equal("2026-03-01", body.GetProperty("startDate").GetString());
        Assert.Equal("2026-08-17", body.GetProperty("endDate").GetString());

        var names = rows.Select(row => row.GetProperty("playerName").GetString()!).ToArray();
        Assert.Contains("Alice", names);
        Assert.Contains("Bob", names);
        Assert.Contains("Cara", names);
        // Alice played t-old and t-new; the soft-deleted t-deleted contributes nothing, and neither does
        // the foreign or the standalone Tournament.
        Assert.Equal(2, rows.Single(row => row.GetProperty("playerName").GetString() == "Alice").GetProperty("playedMatchCount").GetInt32());
        Assert.Equal(3, rows.Length);
    }

    /// <summary>
    /// The Season standings are the one archive read with no ceiling, because a dropped document changes
    /// the numbers rather than shortening the list. Forcing the batch to a single document turns the walk
    /// into three queries over a two-Tournament Season and pins that the answer is unchanged by it.
    /// </summary>
    [Fact]
    public async Task Computes_the_Season_result_in_batches_without_truncation()
    {
        using var batched = CreateClient(("Gones:Archive:SeasonResultBatchSize", "1"));
        using var whole = CreateClient();
        var body = await ReadAsync(batched, "/api/archive/league-seasons/season-1/result");
        var single = await ReadAsync(whole, "/api/archive/league-seasons/season-1/result");
        var rows = body.GetProperty("rows").EnumerateArray().ToArray();

        Assert.Equal("season", body.GetProperty("scope").GetString());
        Assert.Equal("2026-03-01", body.GetProperty("startDate").GetString());
        Assert.Equal("2026-08-17", body.GetProperty("endDate").GetString());
        Assert.Equal(3, rows.Length);
        // Alice played t-old and t-new, one per batch: a walk that stopped at the first page would show 1.
        Assert.Equal(2, rows.Single(row => row.GetProperty("playerName").GetString() == "Alice").GetProperty("playedMatchCount").GetInt32());
        // Two Tournaments is an exact multiple of a batch of one, so the third query comes back empty and
        // the body still has to match the one the default batch produces in a single page.
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(body.GetRawText()), JsonNode.Parse(single.GetRawText())));
    }

    [Fact]
    public async Task Answers_empty_rows_for_the_result_of_a_Season_with_no_Tournament()
    {
        using var client = CreateClient();
        var body = await ReadAsync(client, "/api/archive/league-seasons/season-empty/result");

        Assert.Equal(0, body.GetProperty("rows").GetArrayLength());
        Assert.Equal(string.Empty, body.GetProperty("startDate").GetString());
        Assert.Equal(string.Empty, body.GetProperty("endDate").GetString());
        Assert.False(body.GetProperty("incomplete").GetBoolean());
    }

    [Fact]
    public async Task Answers_404_for_a_result_of_an_unknown_id()
    {
        using var client = CreateClient();
        using var tournament = await client.GetAsync("/api/archive/tournaments/t-missing/result");
        using var season = await client.GetAsync("/api/archive/league-seasons/season-missing/result");
        using var gone = await client.GetAsync("/api/archive/league-seasons/season-gone/result");

        Assert.Equal(HttpStatusCode.NotFound, tournament.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, season.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, gone.StatusCode);
    }

    [Fact]
    public async Task Sets_the_catalog_cache_control_on_every_route()
    {
        using var client = CreateClient();
        string[] routes =
        [
            "/api/archive/league-seasons/season-1/tournaments",
            "/api/archive/league-seasons/season-1/result",
            "/api/archive/tournaments/t-new",
            "/api/archive/tournaments/t-new/result"
        ];

        foreach (var route in routes)
        {
            using var response = await client.GetAsync(route);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            // One minute, not the catalogs' hour: these bodies carry an edit, and an hour-long HTTP
            // cache would hide one with no way for the client to notice.
            Assert.Equal(ReadThroughCacheControl, response.Headers.CacheControl!.ToString());
            Assert.NotNull(response.Headers.ETag);
            Assert.False(response.Headers.ETag!.IsWeak);
        }
    }

    private static async Task<JsonElement> ReadAsync(HttpClient client, string url)
    {
        using var response = await client.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private HttpClient CreateClient(params (string Key, string Value)[] settings)
    {
        var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "t7-archive-detail-signing-key-value");
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
