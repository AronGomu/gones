using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Gones.Domain.Leagues;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.IntegrationTests;

/// <summary>
/// The rankings catalog: the whole read model in one long-lived cacheable body, so a public read-mostly
/// page can filter and sort in the browser instead of paying a round trip per interaction. Same shape as
/// <c>/api/events/all</c> — a configurable ceiling, a <c>truncated</c> flag, an ETag and an hour of
/// public caching.
/// </summary>
public sealed class GlobalStatsCatalogApiTests : IAsyncLifetime
{
    private const string Path = "/api/leagues-archive/global-player-statistics/all";
    private static readonly Instant Seeded = Instant.FromUtc(2031, 4, 1, 12, 0);

    private readonly PostgreSqlTestContainer postgres = new();
    private readonly List<WebApplicationFactory<Program>> factories = [];

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using var database = CreateContext();
        await database.Database.MigrateAsync();
        database.LeagueArchiveAggregates.Add(LeagueArchiveAggregate.Create(CatalogLeague(), Seeded));
        await database.SaveChangesAsync();
    }

    public async Task DisposeAsync()
    {
        foreach (var factory in factories) await factory.DisposeAsync();
        await postgres.DisposeAsync();
    }

    [Fact]
    public async Task Returns_every_row()
    {
        using var client = CreateClient();
        using var response = await client.GetAsync(Path);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray().ToArray();

        Assert.Equal(6, items.Length);
        Assert.Equal(items.Length, body.GetProperty("totalCount").GetInt32());
        Assert.False(body.GetProperty("truncated").GetBoolean());

        // Ordered by played Matches descending, then ordinally by name; position numbers that order.
        Assert.Equal(
            ["Ada", "Bo", "Cy", "Dot", "Eve", "Fay"],
            items.Select(item => item.GetProperty("playerName").GetString()!).ToArray());
        Assert.Equal([1, 2, 3, 4, 5, 6], items.Select(item => item.GetProperty("position").GetInt32()).ToArray());
        Assert.Equal(3, items[0].GetProperty("playedMatchCount").GetInt32());
        Assert.Equal(1, items[^1].GetProperty("playedMatchCount").GetInt32());

        // Every column the paged endpoint returns, in the same shape.
        Assert.Equal("Tempo", items[0].GetProperty("mostPlayedArchetype").GetProperty("name").GetString());
        foreach (var field in new[]
                 {
                     "position", "playerName", "playedMatchCount", "matchWins", "matchLosses", "matchDraws",
                     "matchWinrate", "playedGameCount", "gameWins", "gameLosses", "gameWinrate",
                     "nemesis", "rival", "mostPlayedArchetype"
                 })
        {
            Assert.True(items[0].TryGetProperty(field, out _), $"missing {field}");
        }
    }

    [Fact]
    public async Task Caps_and_flags_truncation()
    {
        using var client = CreateClient(("Gones:GlobalStats:MaximumCatalogSize", "2"));
        using var response = await client.GetAsync(Path);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(2, body.GetProperty("items").GetArrayLength());
        Assert.True(body.GetProperty("truncated").GetBoolean());
        // The count is the whole read model, which is what makes the flag readable.
        Assert.Equal(6, body.GetProperty("totalCount").GetInt32());
    }

    [Fact]
    public async Task Sets_the_cache_headers()
    {
        using var client = CreateClient();
        using var response = await client.GetAsync(Path);
        Assert.Equal("public, max-age=3600", response.Headers.CacheControl!.ToString());
        Assert.NotNull(response.Headers.ETag);
    }

    [Fact]
    public async Task Answers_304()
    {
        using var client = CreateClient();
        using var first = await client.GetAsync(Path);
        var etag = first.Headers.ETag!.ToString();

        using var conditional = new HttpRequestMessage(HttpMethod.Get, Path);
        conditional.Headers.TryAddWithoutValidation("If-None-Match", etag);
        using var replay = await client.SendAsync(conditional);
        Assert.Equal(HttpStatusCode.NotModified, replay.StatusCode);
        // A 304 still carries the caching contract.
        Assert.Equal(etag, replay.Headers.ETag!.ToString());
        Assert.Equal("public, max-age=3600", replay.Headers.CacheControl!.ToString());
    }

    [Fact]
    public async Task Is_anonymous()
    {
        using var client = CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, Path);
        Assert.Null(request.Headers.Authorization);
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Does_not_shadow_a_league_route()
    {
        using var client = CreateClient();
        using var league = await client.GetAsync("/api/leagues-archive/catalog-league");
        Assert.Equal(HttpStatusCode.OK, league.StatusCode);
        Assert.Equal("catalog-league", (await league.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString());
    }

    private HttpClient CreateClient(params (string Key, string Value)[] settings)
    {
        var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "t23-global-stats-catalog-key-value");
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
            foreach (var (key, value) in settings) builder.UseSetting(key, value);
        });
        factories.Add(factory);
        return factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
    }

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString()).Options);

    /// <summary>Six players on three distinct played-Match counts, so the ordering is observable.</summary>
    private static LeagueDocument CatalogLeague() => new(
        "catalog-league",
        "Catalog League",
        "completed",
        [
            new TournamentDocument("catalog-tournament", "catalog-league", "Finished Day", "2031-04-01", "completed",
                [
                    new RoundDocument("catalog-r1",
                    [
                        new MatchRoundEntry("catalog-m1", "1", "Ada", "Bo", 2, 0, "Tempo", "Control"),
                        new MatchRoundEntry("catalog-m2", "2", "Cy", "Dot", 2, 1, string.Empty, string.Empty)
                    ]),
                    new RoundDocument("catalog-r2",
                    [
                        new MatchRoundEntry("catalog-m3", "1", "Ada", "Cy", 2, 1, "Tempo", string.Empty),
                        new MatchRoundEntry("catalog-m4", "2", "Bo", "Eve", 2, 0, "Control", string.Empty)
                    ]),
                    new RoundDocument("catalog-r3",
                    [
                        new MatchRoundEntry("catalog-m5", "1", "Ada", "Fay", 2, 0, "Tempo", string.Empty)
                    ])
                ],
                [new PlayerArchetypeDocument("Ada", "Tempo"), new PlayerArchetypeDocument("Bo", "Control")])
        ]);
}
