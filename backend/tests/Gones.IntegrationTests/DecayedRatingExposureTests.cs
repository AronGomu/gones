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
/// <c>Gones:PlayerStatistics:ExposeDecayedRating</c> is the single switch that projects the stored
/// <c>decayedRating</c> column onto the wire. The column is always computed and stored by the rebuild
/// (ADR 0043); the switch is presentation only, so flipping it needs no rebuild.
/// </summary>
public sealed class DecayedRatingExposureTests : IAsyncLifetime
{
    private const string RankingsPath = "/api/leagues-archive/global-player-statistics";
    private const string CatalogPath = "/api/leagues-archive/global-player-statistics/all";
    private const string PlayerPath = "/api/players/Alice";

    private readonly PostgreSqlTestContainer postgres = new();
    private readonly List<WebApplicationFactory<Program>> factories = [];

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using var database = CreateContext();
        await database.Database.MigrateAsync();
        database.PlayerStatistics.Add(SeedRow("Alice", rating: 1623, decayedRating: 1623.06));
        database.PlayerStatisticsMeta.Add(new PlayerStatisticsMeta
        {
            FormulaVersion = PlayerStatisticsFormula.Version,
            RebuiltAt = Instant.FromUtc(2031, 6, 14, 0, 0)
        });
        await database.SaveChangesAsync();
    }

    public async Task DisposeAsync()
    {
        foreach (var factory in factories) await factory.DisposeAsync();
        await postgres.DisposeAsync();
    }

    [Fact]
    public async Task Hides_the_decayed_rating_by_default()
    {
        using var client = CreateClient(exposeDecayedRating: null);
        using var response = await client.GetAsync($"{RankingsPath}?pageSize=100");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.All(body.GetProperty("items").EnumerateArray(),
            item => Assert.Equal(JsonValueKind.Null, item.GetProperty("decayedRating").ValueKind));
    }

    [Fact]
    public async Task Serves_the_decayed_rating_when_enabled()
    {
        using var client = CreateClient(exposeDecayedRating: true);
        using var response = await client.GetAsync($"{RankingsPath}?pageSize=100");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var item = body.GetProperty("items").EnumerateArray().Single();
        Assert.Equal(JsonValueKind.Number, item.GetProperty("decayedRating").ValueKind);
        // 1623.06 → rounds to 1623
        Assert.Equal(1623, item.GetProperty("decayedRating").GetInt32());
    }

    [Fact]
    public async Task Serves_it_on_the_catalog_route_too()
    {
        using var client = CreateClient(exposeDecayedRating: true);
        using var response = await client.GetAsync(CatalogPath);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var item = body.GetProperty("items").EnumerateArray().Single();
        Assert.Equal(JsonValueKind.Number, item.GetProperty("decayedRating").ValueKind);
    }

    [Fact]
    public async Task Serves_it_on_the_player_page()
    {
        using var client = CreateClient(exposeDecayedRating: true);
        using var response = await client.GetAsync(PlayerPath);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Number, body.GetProperty("statistics").GetProperty("decayedRating").ValueKind);
    }

    [Fact]
    public async Task Rejects_the_decayed_sort_when_disabled()
    {
        using var client = CreateClient(exposeDecayedRating: null);
        using var response = await client.GetAsync($"{RankingsPath}?sort=decayedRating");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Accepts_the_decayed_sort_when_enabled()
    {
        using var client = CreateClient(exposeDecayedRating: true);
        using var response = await client.GetAsync($"{RankingsPath}?pageSize=100&sort=decayedRating&direction=desc");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("decayedRating", body.GetProperty("sort").GetString());
    }

    [Fact]
    public async Task Uses_a_different_ETag_per_mode()
    {
        using var clientOff = CreateClient(exposeDecayedRating: null);
        using var responseOff = await clientOff.GetAsync($"{RankingsPath}?pageSize=100");
        var etagOff = responseOff.Headers.ETag!.ToString();

        using var clientOn = CreateClient(exposeDecayedRating: true);
        using var responseOn = await clientOn.GetAsync($"{RankingsPath}?pageSize=100");
        var etagOn = responseOn.Headers.ETag!.ToString();

        Assert.NotEqual(etagOff, etagOn);
    }

    [Fact]
    public async Task Needs_no_rebuild_to_flip()
    {
        // Key off: decayedRating null, formula version stays at 2.
        using var clientOff = CreateClient(exposeDecayedRating: null);
        using var responseOff = await clientOff.GetAsync($"{RankingsPath}?pageSize=100");
        var bodyOff = await responseOff.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Null,
            bodyOff.GetProperty("items").EnumerateArray().Single().GetProperty("decayedRating").ValueKind);

        // Key on, same data, startup rebuild disabled: decayedRating appears.
        using var clientOn = CreateClient(exposeDecayedRating: true);
        using var responseOn = await clientOn.GetAsync($"{RankingsPath}?pageSize=100");
        var bodyOn = await responseOn.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Number,
            bodyOn.GetProperty("items").EnumerateArray().Single().GetProperty("decayedRating").ValueKind);

        // Formula version is unchanged: no rebuild ran.
        await using var database = CreateContext();
        var meta = await database.PlayerStatisticsMeta.AsNoTracking().SingleAsync();
        Assert.Equal(PlayerStatisticsFormula.Version, meta.FormulaVersion);
    }

    private static PlayerStatisticsRow SeedRow(string playerName, double rating, double decayedRating) => new()
    {
        PlayerName = playerName,
        PlayedMatchCount = 10,
        MatchWins = 7,
        MatchLosses = 2,
        MatchDraws = 1,
        MatchWinrate = 0.7,
        PlayedGameCount = 20,
        GameWins = 14,
        GameLosses = 6,
        GameWinrate = 0.7,
        Rating = rating,
        RatingDeviation = 60.5,
        RatingVolatility = 0.06,
        PreviousRating = rating,
        LastRatingDelta = 0,
        TournamentsPlayed = 10,
        LastPlayedDate = "2031-06-01",
        DecayedRating = decayedRating
    };

    private HttpClient CreateClient(bool? exposeDecayedRating)
    {
        var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "t19-decayed-rating-signing-key-value");
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
            // Fixture is the assertion. Startup rebuild would overwrite it.
            builder.UseSetting("Gones:PlayerStatistics:RebuildOnStartup", "false");
            if (exposeDecayedRating is not null)
                builder.UseSetting("Gones:PlayerStatistics:ExposeDecayedRating", exposeDecayedRating.Value ? "true" : "false");
        });
        factories.Add(factory);
        return factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
    }

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString()).Options);
}
