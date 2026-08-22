using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Gones.Domain.Leagues;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using NodaTime;

namespace Gones.IntegrationTests;

/// <summary>
/// The scoped rankings routes: the same stored read model as the legacy rankings, addressed by the
/// partition it was computed in.
///
/// <para><c>player_statistics</c> is seeded directly rather than rebuilt, because every case here is a
/// statement about which stored rows a scope selects; the rebuild is asserted in
/// <see cref="ScopedPlayerStatisticsRebuildTests"/>. The startup rebuild is switched off so it cannot
/// erase the fixture, the meta row is stamped by hand so the ETag has a stamp, and the clock is frozen
/// because <c>provisional</c> and <c>inactive</c> come from the request clock.</para>
/// </summary>
public sealed class ArchiveScopedStatisticsApiTests : IAsyncLifetime
{
    private const string Path = "/api/archive/global-player-statistics";
    private const string CatalogPath = "/api/archive/global-player-statistics/all";
    private const string CatalogCacheControl = "public, max-age=3600";

    private static readonly Instant Today = Instant.FromUtc(2031, 6, 15, 12, 0);

    /// <summary>Every field the row object carries on the wire, in contract order.</summary>
    private static readonly string[] RowFields =
    [
        "position", "playerName", "playedMatchCount", "matchWins", "matchLosses", "matchDraws",
        "matchWinrate", "playedGameCount", "gameWins", "gameLosses", "gameWinrate", "nemesis", "rival",
        "mostPlayedArchetype", "rating", "ratingDeviation", "previousRating", "lastRatingDelta",
        "tournamentsPlayed", "lastPlayedDate", "provisional", "inactive", "decayedRating"
    ];

    private static readonly string[] EnvelopeFields = ["items", "page", "pageSize", "totalCount", "sort", "direction"];

    /// <summary>Every accepted sort key: the contract's short names plus the legacy column spellings.</summary>
    private static readonly string[] SortKeys =
    [
        "rating", "name", "matches", "wins", "losses", "winrate", "tournaments",
        "playedMatchCount", "matchWins", "matchLosses", "matchDraws", "matchWinrate",
        "playedGameCount", "gameWins", "gameLosses", "gameWinrate", "tournamentsPlayed"
    ];

    private readonly PostgreSqlTestContainer postgres = new();
    private readonly MutableClock clock = new(Today);
    private WebApplicationFactory<Program>? factory;
    private HttpClient? client;

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using (var database = CreateContext())
        {
            await database.Database.MigrateAsync();
            foreach (var row in Seed()) database.PlayerStatistics.Add(row);
            database.PlayerStatisticsMeta.Add(new PlayerStatisticsMeta
            {
                FormulaVersion = PlayerStatisticsFormula.Version,
                RebuiltAt = Instant.FromUtc(2031, 6, 14, 0, 0)
            });
            await database.SaveChangesAsync();
        }

        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "t8-scoped-statistics-signing-key-value");
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
            // The fixture is the assertion. A rebuild over an empty archive would erase it.
            builder.UseSetting("Gones:PlayerStatistics:RebuildOnStartup", "false");
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
    public async Task Defaults_to_the_global_scope()
    {
        var body = await OkAsync(Path);
        Assert.Equal(3, body.GetProperty("totalCount").GetInt32());
        Assert.Equal(["Alice", "Bob", "Carol"], Names(body));
    }

    [Fact]
    public async Task Serves_a_league_scope()
    {
        var body = await OkAsync($"{Path}?scopeKind=league&scopeId=L1");
        Assert.Equal(2, body.GetProperty("totalCount").GetInt32());
        Assert.Equal(["Alice", "Bob"], Names(body));
    }

    [Fact]
    public async Task Serves_a_season_scope()
    {
        var body = await OkAsync($"{Path}?scopeKind=season&scopeId=S1");
        Assert.Equal(1, body.GetProperty("totalCount").GetInt32());
        Assert.Equal(["Alice"], Names(body));
    }

    [Fact]
    public async Task Answers_an_unknown_scope_id_with_an_empty_page()
    {
        var body = await OkAsync($"{Path}?scopeKind=league&scopeId=does-not-exist");
        Assert.Equal(0, body.GetProperty("totalCount").GetInt32());
        Assert.Empty(body.GetProperty("items").EnumerateArray());
        Assert.Equal(1, body.GetProperty("page").GetInt32());
    }

    [Fact]
    public async Task Answers_an_unknown_scope_id_with_an_empty_catalog()
    {
        var body = await OkAsync($"{CatalogPath}?scopeKind=season&scopeId=nope");
        Assert.Equal(0, body.GetProperty("totalCount").GetInt32());
        Assert.Empty(body.GetProperty("items").EnumerateArray());
        Assert.False(body.GetProperty("truncated").GetBoolean());
    }

    [Fact]
    public async Task Ignores_a_scope_id_on_the_global_scope()
    {
        var scoped = await OkAsync($"{Path}?scopeKind=global&scopeId=L1");
        var plain = await OkAsync(Path);
        Assert.Equal(plain.GetRawText(), scoped.GetRawText());
    }

    [Fact]
    public async Task Rejects_an_unknown_scope_kind()
    {
        using var response = await Client.GetAsync($"{Path}?scopeKind=continent");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.EndsWith("validation_failed", problem.GetProperty("type").GetString(), StringComparison.Ordinal);
        Assert.True(problem.GetProperty("errors").TryGetProperty("scopeKind", out _));
    }

    [Fact]
    public async Task Rejects_a_league_scope_without_an_id()
    {
        using var response = await Client.GetAsync($"{Path}?scopeKind=league");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(problem.GetProperty("errors").TryGetProperty("scopeId", out _));
    }

    [Fact]
    public async Task Keeps_the_legacy_field_names()
    {
        var body = await OkAsync($"{Path}?scopeKind=league&scopeId=L1");
        Assert.Equal(EnvelopeFields, body.EnumerateObject().Select(property => property.Name).ToArray());
        var row = body.GetProperty("items").EnumerateArray().First();
        Assert.Equal(RowFields, row.EnumerateObject().Select(property => property.Name).ToArray());
    }

    [Fact]
    public async Task Caches_each_scope_under_its_own_etag()
    {
        using var global = await Client.GetAsync(Path);
        using var league = await Client.GetAsync($"{Path}?scopeKind=league&scopeId=L1");
        Assert.Equal(HttpStatusCode.OK, global.StatusCode);
        Assert.Equal(HttpStatusCode.OK, league.StatusCode);
        var globalETag = global.Headers.ETag!.ToString();
        var leagueETag = league.Headers.ETag!.ToString();
        Assert.NotEqual(globalETag, leagueETag);
        Assert.Equal(CatalogCacheControl, global.Headers.CacheControl!.ToString());
        Assert.Equal(CatalogCacheControl, league.Headers.CacheControl!.ToString());

        Assert.Equal(HttpStatusCode.NotModified, (await ReplayAsync(Path, globalETag)).Status);
        Assert.Equal(HttpStatusCode.NotModified, (await ReplayAsync($"{Path}?scopeKind=league&scopeId=L1", leagueETag)).Status);
        // One scope's ETag can never validate another's body.
        var crossed = await ReplayAsync($"{Path}?scopeKind=league&scopeId=L1", globalETag);
        Assert.Equal(HttpStatusCode.OK, crossed.Status);
        Assert.Equal(CatalogCacheControl, crossed.CacheControl);
    }

    [Fact]
    public async Task Sorts_by_every_allowlisted_key_inside_the_scope()
    {
        foreach (var sort in SortKeys)
        {
            foreach (var direction in new[] { "asc", "desc" })
            {
                var body = await OkAsync($"{Path}?scopeKind=league&scopeId=L1&sort={sort}&direction={direction}");
                Assert.Equal(2, body.GetProperty("totalCount").GetInt32());
                Assert.Equal(sort, body.GetProperty("sort").GetString());
            }
        }

        using var rejected = await Client.GetAsync($"{Path}?scopeKind=league&scopeId=L1&sort=continent");
        Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
    }

    private async Task<JsonElement> OkAsync(string path)
    {
        using var response = await Client.GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.Clone();
    }

    private async Task<(HttpStatusCode Status, string? CacheControl)> ReplayAsync(string path, string etag)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.TryAddWithoutValidation("If-None-Match", etag);
        using var response = await Client.SendAsync(request);
        return (response.StatusCode, response.Headers.CacheControl?.ToString());
    }

    private static string[] Names(JsonElement body) =>
        [.. body.GetProperty("items").EnumerateArray()
            .Select(item => item.GetProperty("playerName").GetString()!)
            .Order(StringComparer.Ordinal)];

    /// <summary>
    /// Six rows across three scopes. Alice appears in all three with different numbers, which is the
    /// case a scope filter that read the wrong partition would show up in.
    /// </summary>
    private static IEnumerable<PlayerStatisticsRow> Seed() =>
    [
        Row(PlayerStatisticsScope.Global, PlayerStatisticsScope.GlobalScopeId, "Alice", 1700, 9, 12),
        Row(PlayerStatisticsScope.Global, PlayerStatisticsScope.GlobalScopeId, "Bob", 1550, 7, 10),
        Row(PlayerStatisticsScope.Global, PlayerStatisticsScope.GlobalScopeId, "Carol", 1480, 6, 8),
        Row(PlayerStatisticsScope.League, "L1", "Alice", 1620, 5, 6),
        Row(PlayerStatisticsScope.League, "L1", "Bob", 1490, 5, 5),
        Row(PlayerStatisticsScope.Season, "S1", "Alice", 1530, 3, 3)
    ];

    private static PlayerStatisticsRow Row(
        string scopeKind,
        string scopeId,
        string playerName,
        double rating,
        int tournamentsPlayed,
        int matches) => new()
        {
            ScopeKind = scopeKind,
            ScopeId = scopeId,
            PlayerName = playerName,
            PlayedMatchCount = matches,
            MatchWins = matches - 1,
            MatchLosses = 1,
            MatchDraws = 0,
            MatchWinrate = (double)(matches - 1) / matches,
            PlayedGameCount = matches * 2,
            GameWins = matches,
            GameLosses = matches,
            GameWinrate = 0.5,
            Rating = rating,
            RatingDeviation = 60.5,
            RatingVolatility = 0.06,
            PreviousRating = rating - 10,
            LastRatingDelta = 10,
            TournamentsPlayed = tournamentsPlayed,
            LastPlayedDate = "2031-06-01",
            DecayedRating = rating
        };

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString()).Options);

    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");

    private sealed class MutableClock(Instant current) : IClock
    {
        public Instant GetCurrentInstant() => current;
    }
}
