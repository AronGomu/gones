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

public sealed class PublicLeagueApiTests : IAsyncLifetime
{
    private readonly PostgreSqlTestContainer postgres = new();
    private WebApplicationFactory<Program>? factory;
    private HttpClient? client;

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using (var database = CreateContext())
        {
            await database.Database.MigrateAsync();
            database.LeagueArchiveAggregates.Add(LeagueArchiveAggregate.Create(FixtureLeague(), Instant.FromUtc(2026, 8, 3, 10, 0)));
            database.LeagueArchiveAggregates.Add(LeagueArchiveAggregate.Create(new LeagueDocument("deleted", "Deleted", "completed", []), Instant.FromUtc(2026, 8, 3, 9, 0)));
            await database.SaveChangesAsync();
            var deleted = await database.LeagueArchiveAggregates.SingleAsync(item => item.DocumentId == "deleted");
            deleted.SoftDelete(Instant.FromUtc(2026, 8, 3, 11, 0));
            await database.SaveChangesAsync();
        }
        factory = CreateFactory();
        client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
    }

    public async Task DisposeAsync()
    {
        client?.Dispose();
        if (factory is not null) await factory.DisposeAsync();
        await postgres.DisposeAsync();
    }

    [Fact]
    public async Task List_detail_and_nested_source_reads_are_public_paged_cacheable_and_tombstone_safe()
    {
        using var list = await Client.GetAsync("/api/leagues-archive?page=1&pageSize=1&status=active&search=API");
        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        Assert.Contains("public", list.Headers.CacheControl!.ToString());
        Assert.NotNull(list.Headers.ETag);
        var listBody = await list.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, listBody.GetProperty("pageSize").GetInt32());
        Assert.Equal(1, listBody.GetProperty("totalCount").GetInt32());
        var summary = listBody.GetProperty("items")[0];
        Assert.Equal("api-league", summary.GetProperty("id").GetString());
        Assert.Equal(1, summary.GetProperty("documentVersion").GetInt64());
        Assert.False(summary.TryGetProperty("canonicalDocument", out _));

        using var detail = await Client.GetAsync("/api/leagues-archive/api-league");
        Assert.Equal(HttpStatusCode.OK, detail.StatusCode);
        Assert.Equal("api-league", (await detail.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString());
        Assert.NotNull(detail.Headers.ETag);
        using var conditional = new HttpRequestMessage(HttpMethod.Get, "/api/leagues-archive/api-league");
        conditional.Headers.TryAddWithoutValidation("If-None-Match", detail.Headers.ETag!.ToString());
        using var notModified = await Client.SendAsync(conditional);
        Assert.Equal(HttpStatusCode.NotModified, notModified.StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await Client.GetAsync("/api/leagues-archive/api-league/result")).StatusCode);
        using var tournament = await Client.GetAsync("/api/leagues-archive/api-league/tournaments-archive/result-tournament");
        Assert.Equal("Result Tournament", (await tournament.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("name").GetString());
        using var tournamentResult = await Client.GetAsync("/api/leagues-archive/api-league/tournaments-archive/result-tournament/result");
        Assert.Equal("Alice", (await tournamentResult.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("rows")[0].GetProperty("playerName").GetString());
        using var stats = await Client.GetAsync("/api/leagues-archive/api-league/players/Alice/statistics?opponentName=Bob");
        Assert.Equal(1, (await stats.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("playedMatchCount").GetInt32());

        Assert.Equal(HttpStatusCode.NotFound, (await Client.GetAsync("/api/leagues-archive/deleted")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Client.GetAsync("/api/leagues-archive?pageSize=101")).StatusCode);
        using var literalWildcard = await Client.GetAsync("/api/leagues-archive?search=API%25");
        Assert.Equal(0, (await literalWildcard.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("totalCount").GetInt32());
        Assert.Equal(HttpStatusCode.BadRequest, (await Client.GetAsync($"/api/leagues-archive/{new string('x', LeagueArchiveAggregate.MaximumDocumentIdLength + 1)}")).StatusCode);
    }

    [Fact]
    public async Task Public_exports_project_full_existing_source_without_derived_or_private_data()
    {
        using var leagueExport = await Client.GetAsync("/api/leagues-archive/api-league/export");
        Assert.Equal(HttpStatusCode.OK, leagueExport.StatusCode);
        Assert.Equal("attachment", leagueExport.Content.Headers.ContentDisposition!.DispositionType);
        var leagueJson = await leagueExport.Content.ReadAsStringAsync();
        using var league = JsonDocument.Parse(leagueJson);
        Assert.Equal("league", league.RootElement.GetProperty("kind").GetString());
        Assert.Equal(4, league.RootElement.GetProperty("gonesDataVersion").GetInt32());
        Assert.Equal("api-league", league.RootElement.GetProperty("league").GetProperty("id").GetString());
        Assert.False(league.RootElement.TryGetProperty("result", out _));
        Assert.False(league.RootElement.TryGetProperty("warnings", out _));
        Assert.DoesNotContain("email", leagueJson, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("token", leagueJson, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("documentVersion", leagueJson, StringComparison.Ordinal);
        Assert.Equal(1, league.RootElement.GetProperty("league").GetProperty("tournaments").GetArrayLength());
        Assert.Equal(1, league.RootElement.GetProperty("league").GetProperty("tournaments")[0].GetProperty("rounds")[0].GetProperty("entries").GetArrayLength());
    }

    private WebApplicationFactory<Program> CreateFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_PROVIDER", "Local");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "c30-public-league-signing-key-value");
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
        });

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString()).Options);

    private static LeagueDocument FixtureLeague() => new(
        "api-league",
        "API League",
        "active",
        [new TournamentDocument("result-tournament", "api-league", "Result Tournament", "2026-08-03",
            [new RoundDocument("round-1", [new MatchRoundEntry("entry-1", "1", "Alice", "Bob", 2, 1, "Tempo", "Control")])],
            [new PlayerArchetypeDocument("Alice", "Tempo"), new PlayerArchetypeDocument("Bob", "Control")])]);

    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");
}
