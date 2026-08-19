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
/// The League catalog: the whole archive in one long-lived cacheable body (ADR 0039), so the list page
/// reads it once instead of one detail request per League. Same shape as <c>/api/events/all</c> — a
/// configurable ceiling, a <c>truncated</c> flag, an ETag and an hour of public caching.
/// </summary>
public sealed class PublicLeagueCatalogApiTests : IAsyncLifetime
{
    private const string Path = "/api/leagues-archive/all";
    private static readonly Instant Seeded = Instant.FromUtc(2031, 5, 1, 12, 0);

    private readonly PostgreSqlTestContainer postgres = new();
    private readonly List<WebApplicationFactory<Program>> factories = [];

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using var database = CreateContext();
        await database.Database.MigrateAsync();
        // Three visible Leagues on distinct instants, so the newest-first ordering is observable.
        database.LeagueArchiveAggregates.Add(LeagueArchiveAggregate.Create(CatalogLeague("catalog-one", "Catalog One"), Seeded));
        database.LeagueArchiveAggregates.Add(LeagueArchiveAggregate.Create(CatalogLeague("catalog-two", "Catalog Two"), Seeded.Plus(Duration.FromHours(1))));
        database.LeagueArchiveAggregates.Add(LeagueArchiveAggregate.Create(CatalogLeague("catalog-three", "Catalog Three"), Seeded.Plus(Duration.FromHours(2))));
        database.LeagueArchiveAggregates.Add(LeagueArchiveAggregate.Create(new LeagueDocument("catalog-gone", "Catalog Gone", "completed", []), Seeded));
        await database.SaveChangesAsync();
        var deleted = await database.LeagueArchiveAggregates.SingleAsync(item => item.DocumentId == "catalog-gone");
        deleted.SoftDelete(Seeded.Plus(Duration.FromHours(3)));
        await database.SaveChangesAsync();
    }

    public async Task DisposeAsync()
    {
        foreach (var factory in factories) await factory.DisposeAsync();
        await postgres.DisposeAsync();
    }

    [Fact]
    public async Task Returns_every_visible_League_as_a_whole_document()
    {
        using var client = CreateClient();
        using var response = await client.GetAsync(Path);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray().ToArray();

        // Newest first, the seeded placeholder trailing, and the soft-deleted League absent from both
        // the rows and the count.
        Assert.Equal(
            ["catalog-three", "catalog-two", "catalog-one", "placeholder-league"],
            items.Select(item => item.GetProperty("id").GetString()!).ToArray());
        Assert.Equal(4, body.GetProperty("totalCount").GetInt32());
        Assert.False(body.GetProperty("truncated").GetBoolean());

        // The rows are whole detail documents: this is what removes the per-League follow-up request.
        var first = items[0];
        foreach (var field in new[] { "id", "name", "status", "tournaments", "documentVersion", "updatedAt" })
        {
            Assert.True(first.TryGetProperty(field, out _), $"missing {field}");
        }
        var tournaments = first.GetProperty("tournaments").EnumerateArray().ToArray();
        Assert.Single(tournaments);
        Assert.Equal(2, tournaments[0].GetProperty("rounds").EnumerateArray().First().GetProperty("entries").GetArrayLength());
    }

    [Fact]
    public async Task Matches_the_detail_endpoint_row_for_row()
    {
        using var client = CreateClient();
        var catalog = await (await client.GetAsync(Path)).Content.ReadFromJsonAsync<JsonElement>();
        var fromCatalog = catalog.GetProperty("items").EnumerateArray().Single(item => item.GetProperty("id").GetString() == "catalog-one");
        var fromDetail = await (await client.GetAsync("/api/leagues-archive/catalog-one")).Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(fromDetail.GetRawText(), fromCatalog.GetRawText());
    }

    [Fact]
    public async Task Caps_and_flags_truncation()
    {
        using var client = CreateClient(("Gones:Leagues:MaximumCatalogSize", "2"));
        using var response = await client.GetAsync(Path);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(2, body.GetProperty("items").GetArrayLength());
        Assert.True(body.GetProperty("truncated").GetBoolean());
        // The count is the whole archive, which is what makes the flag readable.
        Assert.Equal(4, body.GetProperty("totalCount").GetInt32());
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
    public async Task Changes_its_ETag_when_a_League_changes()
    {
        using var client = CreateClient();
        var before = (await client.GetAsync(Path)).Headers.ETag!.ToString();

        await using (var database = CreateContext())
        {
            var league = await database.LeagueArchiveAggregates.SingleAsync(item => item.DocumentId == "catalog-one");
            league.Apply(CatalogLeague("catalog-one", "Catalog One Renamed"), Seeded.Plus(Duration.FromDays(1)));
            await database.SaveChangesAsync();
        }

        Assert.NotEqual(before, (await client.GetAsync(Path)).Headers.ETag!.ToString());
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
        using var league = await client.GetAsync("/api/leagues-archive/catalog-one");
        Assert.Equal(HttpStatusCode.OK, league.StatusCode);
        Assert.Equal("catalog-one", (await league.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString());
    }

    private HttpClient CreateClient(params (string Key, string Value)[] settings)
    {
        var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "t-league-catalog-signing-key-value");
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
            foreach (var (key, value) in settings) builder.UseSetting(key, value);
        });
        factories.Add(factory);
        return factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
    }

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString()).Options);

    private static LeagueDocument CatalogLeague(string id, string name) => new(
        id,
        name,
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
