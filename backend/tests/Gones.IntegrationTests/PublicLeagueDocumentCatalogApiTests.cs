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
/// The document catalog: the whole archive as whole documents, which is what the Settings export
/// needs (ADR 0042). It is the body <c>/api/leagues-archive/all</c> used to return, moved to its own
/// route rather than hidden behind a query flag — a flag would make two different bodies share one
/// ETag namespace on a <c>public, max-age=3600</c> response, which is a cache-poisoning shape.
/// </summary>
public sealed class PublicLeagueDocumentCatalogApiTests : IAsyncLifetime
{
    private const string Path = "/api/leagues-archive/all/documents";
    private const string SummaryPath = "/api/leagues-archive/all";
    private static readonly Instant Seeded = Instant.FromUtc(2031, 5, 1, 12, 0);

    private readonly PostgreSqlTestContainer postgres = new();
    private readonly List<WebApplicationFactory<Program>> factories = [];

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using var database = CreateContext();
        await database.Database.MigrateAsync();
        database.LeagueArchiveAggregates.Add(LeagueArchiveAggregate.Create(DocumentLeague("documents-one", "Documents One"), Seeded));
        database.LeagueArchiveAggregates.Add(LeagueArchiveAggregate.Create(DocumentLeague("documents-two", "Documents Two"), Seeded.Plus(Duration.FromHours(1))));
        database.LeagueArchiveAggregates.Add(LeagueArchiveAggregate.Create(DocumentLeague("documents-three", "Documents Three"), Seeded.Plus(Duration.FromHours(2))));
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

        Assert.Equal(
            ["documents-three", "documents-two", "documents-one", "placeholder-league"],
            items.Select(item => item.GetProperty("id").GetString()!).ToArray());
        Assert.Equal(4, body.GetProperty("totalCount").GetInt32());
        Assert.False(body.GetProperty("truncated").GetBoolean());

        // A row is the detail document byte for byte: this is the assertion the summary catalog gave up.
        var fromCatalog = items.Single(item => item.GetProperty("id").GetString() == "documents-one");
        var fromDetail = await (await client.GetAsync("/api/leagues-archive/documents-one")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(fromDetail.GetRawText(), fromCatalog.GetRawText());
        Assert.Equal(1, fromCatalog.GetProperty("tournaments").GetArrayLength());
    }

    [Fact]
    public async Task Uses_a_different_ETag_than_the_summary_catalog()
    {
        using var client = CreateClient();
        var documents = (await client.GetAsync(Path)).Headers.ETag!.ToString();
        var summary = (await client.GetAsync(SummaryPath)).Headers.ETag!.ToString();

        // The two routes derive their ETag from the same stamp, so only the distinct literal keeps a
        // client from being answered 304 with the other shape.
        Assert.NotEqual(summary, documents);
    }

    [Fact]
    public async Task Ignores_a_summary_ETag()
    {
        using var client = CreateClient();
        var summary = (await client.GetAsync(SummaryPath)).Headers.ETag!.ToString();

        using var conditional = new HttpRequestMessage(HttpMethod.Get, Path);
        conditional.Headers.TryAddWithoutValidation("If-None-Match", summary);
        using var response = await client.SendAsync(conditional);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True((await response.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("items")[0].TryGetProperty("tournaments", out _));
    }

    [Fact]
    public async Task Truncates_at_the_configured_ceiling()
    {
        using var client = CreateClient(("Gones:Leagues:MaximumCatalogSize", "2"));
        using var response = await client.GetAsync(Path);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(2, body.GetProperty("items").GetArrayLength());
        Assert.True(body.GetProperty("truncated").GetBoolean());
        Assert.Equal(4, body.GetProperty("totalCount").GetInt32());
    }

    [Fact]
    public async Task Sets_the_catalog_cache_control()
    {
        using var client = CreateClient();
        using var response = await client.GetAsync(Path);
        Assert.Equal("public, max-age=3600", response.Headers.CacheControl!.ToString());
        Assert.NotNull(response.Headers.ETag);
    }

    private HttpClient CreateClient(params (string Key, string Value)[] settings)
    {
        var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "t-league-documents-signing-key-value");
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
            foreach (var (key, value) in settings) builder.UseSetting(key, value);
        });
        factories.Add(factory);
        return factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
    }

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString()).Options);

    private static LeagueDocument DocumentLeague(string id, string name) => new(
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
