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
/// The rating half of the public rankings (ADR 0043): the stored Glicko-2 columns as the wire sees
/// them, the two flags that are derived at read time rather than stored, and the three-bucket default
/// order those flags produce.
///
/// <para>The seed writes <c>player_statistics</c> directly instead of replaying archives, because every
/// case here is a statement about one exact stored rating, tournament count or last-played date; a
/// rebuild would only ever produce whatever the engine happens to compute. The startup rebuild is
/// switched off so it cannot overwrite the fixture, and the meta row is stamped by hand so the ETag has
/// the read-model stamp it would have after a real rebuild.</para>
///
/// <para><c>Today</c> is frozen through the injected clock: <c>provisional</c> and <c>inactive</c> are
/// derived from the request clock, so a test that read the real one would change its answer overnight.</para>
/// </summary>
public sealed class GlobalStatsRatingApiTests : IAsyncLifetime
{
    private const string Path = "/api/leagues-archive/global-player-statistics";
    private const string CatalogPath = "/api/leagues-archive/global-player-statistics/all";

    /// <summary>The frozen request clock. Twelve months back from this date is 2030-06-15.</summary>
    private static readonly Instant Today = Instant.FromUtc(2031, 6, 15, 12, 0);

    /// <summary>The whole default order, bucket by bucket, as the endpoint must serve it.</summary>
    private static readonly string[] DefaultOrder =
    [
        // Bucket 0 — active ranked, rating descending.
        "Active1900", "Alice", "alice", "DeltaPlayer", "RatingRounder", "Fifth", "RecentEleven",
        // Bucket 1 — inactive ranked, rating descending, below every active player.
        "Inactive2000", "NeverPlayed", "IdleTwelve",
        // Bucket 2 — provisional, tournaments played descending, then played Matches descending.
        "Provisional1900", "ProvTiedMore", "ProvTiedLess", "ProvisionalIdle"
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
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "t15-rating-statistics-signing-key-value");
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
    public async Task Serves_the_rating_as_an_integer()
    {
        var row = await RowAsync("RatingRounder");
        Assert.Equal(JsonValueKind.Number, row.GetProperty("rating").ValueKind);
        Assert.Equal(1524, row.GetProperty("rating").GetInt32());
        Assert.Equal(60.5, row.GetProperty("ratingDeviation").GetDouble());
    }

    [Fact]
    public async Task Serves_the_delta_across_the_last_period()
    {
        var row = await RowAsync("DeltaPlayer");
        Assert.Equal(1560, row.GetProperty("rating").GetInt32());
        Assert.Equal(1532, row.GetProperty("previousRating").GetInt32());
        Assert.Equal(28, row.GetProperty("lastRatingDelta").GetInt32());
    }

    [Fact]
    public async Task Flags_a_player_under_five_tournaments_as_provisional()
    {
        var row = await RowAsync("Provisional1900");
        Assert.Equal(4, row.GetProperty("tournamentsPlayed").GetInt32());
        Assert.True(row.GetProperty("provisional").GetBoolean());
        Assert.False(row.GetProperty("inactive").GetBoolean());
    }

    [Fact]
    public async Task Does_not_flag_a_fifth_tournament_as_provisional()
    {
        var row = await RowAsync("Fifth");
        Assert.Equal(5, row.GetProperty("tournamentsPlayed").GetInt32());
        Assert.False(row.GetProperty("provisional").GetBoolean());
    }

    [Fact]
    public async Task Flags_a_player_idle_for_twelve_months_as_inactive()
    {
        // 2030-06-14 is one day past the twelve-month line from the frozen 2031-06-15.
        var row = await RowAsync("IdleTwelve");
        Assert.Equal("2030-06-14", row.GetProperty("lastPlayedDate").GetString());
        Assert.Equal(6, row.GetProperty("tournamentsPlayed").GetInt32());
        Assert.True(row.GetProperty("inactive").GetBoolean());
        Assert.False(row.GetProperty("provisional").GetBoolean());
    }

    [Fact]
    public async Task Does_not_flag_a_recent_player_as_inactive()
    {
        var row = await RowAsync("RecentEleven");
        Assert.Equal("2030-07-15", row.GetProperty("lastPlayedDate").GetString());
        Assert.False(row.GetProperty("inactive").GetBoolean());
    }

    [Fact]
    public async Task Flags_a_player_who_never_played_as_inactive()
    {
        var row = await RowAsync("NeverPlayed");
        Assert.Equal(JsonValueKind.Null, row.GetProperty("lastPlayedDate").ValueKind);
        Assert.True(row.GetProperty("inactive").GetBoolean());
    }

    [Fact]
    public async Task Never_flags_a_provisional_player_as_inactive()
    {
        var row = await RowAsync("ProvisionalIdle");
        Assert.Equal(2, row.GetProperty("tournamentsPlayed").GetInt32());
        Assert.Equal("2028-06-15", row.GetProperty("lastPlayedDate").GetString());
        Assert.True(row.GetProperty("provisional").GetBoolean());
        Assert.False(row.GetProperty("inactive").GetBoolean());
    }

    [Fact]
    public async Task Orders_active_ranked_players_first_by_rating()
    {
        var names = await DefaultNamesAsync();
        Assert.Equal(DefaultOrder, names);

        var active = names.Take(7).ToArray();
        Assert.Equal(["Active1900", "Alice", "alice", "DeltaPlayer", "RatingRounder", "Fifth", "RecentEleven"], active);
    }

    [Fact]
    public async Task Orders_inactive_ranked_players_after_active_ones()
    {
        var names = await DefaultNamesAsync();
        // Inactive2000 carries the highest rating in the table and still sits below every active player.
        var highestRated = Array.IndexOf(names, "Inactive2000");
        foreach (var active in new[] { "Active1900", "Alice", "alice", "DeltaPlayer", "RatingRounder", "Fifth", "RecentEleven" })
        {
            Assert.True(Array.IndexOf(names, active) < highestRated, $"{active} must rank above the inactive Inactive2000.");
        }
        Assert.Equal(["Inactive2000", "NeverPlayed", "IdleTwelve"], names.Skip(7).Take(3).ToArray());
    }

    [Fact]
    public async Task Orders_provisional_players_last()
    {
        var names = await DefaultNamesAsync();
        // A 1900 rating does not lift a provisional player out of the last bucket.
        Assert.Equal(10, Array.IndexOf(names, "Provisional1900"));
        Assert.Equal(["Provisional1900", "ProvTiedMore", "ProvTiedLess", "ProvisionalIdle"], names.Skip(10).ToArray());
    }

    [Fact]
    public async Task Orders_provisional_players_by_tournaments_then_matches()
    {
        var names = await DefaultNamesAsync();
        // Equal tournaments played; ProvTiedLess has the higher rating and still loses on played Matches.
        Assert.True(Array.IndexOf(names, "ProvTiedMore") < Array.IndexOf(names, "ProvTiedLess"));
        Assert.True(Array.IndexOf(names, "Provisional1900") < Array.IndexOf(names, "ProvTiedMore"));
        Assert.True(Array.IndexOf(names, "ProvTiedLess") < Array.IndexOf(names, "ProvisionalIdle"));
    }

    [Fact]
    public async Task Breaks_every_tie_on_the_ordinal_player_name()
    {
        var names = await DefaultNamesAsync();
        // Alice and alice are the same row but for the name, so only the ordinal collation separates them.
        Assert.Equal(Array.IndexOf(names, "Alice") + 1, Array.IndexOf(names, "alice"));
    }

    [Fact]
    public async Task Sorts_by_rating_on_request()
    {
        using var response = await Client.GetAsync($"{Path}?pageSize=100&sort=rating&direction=asc");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("rating", body.GetProperty("sort").GetString());

        var items = body.GetProperty("items").EnumerateArray().ToArray();
        var ratings = items.Select(item => item.GetProperty("rating").GetInt32()).ToArray();
        Assert.Equal(ratings.Order().ToArray(), ratings);
        // Buckets are ignored on an explicit sort: the lowest-rated player is provisional and leads.
        Assert.Equal("ProvTiedMore", items[0].GetProperty("playerName").GetString());
        Assert.Equal("Inactive2000", items[^1].GetProperty("playerName").GetString());
    }

    [Fact]
    public async Task Sorts_by_tournaments_played_on_request()
    {
        using var response = await Client.GetAsync($"{Path}?pageSize=100&sort=tournamentsPlayed");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("tournamentsPlayed", body.GetProperty("sort").GetString());

        var items = body.GetProperty("items").EnumerateArray().ToArray();
        var counts = items.Select(item => item.GetProperty("tournamentsPlayed").GetInt32()).ToArray();
        Assert.Equal(counts.OrderDescending().ToArray(), counts);
        Assert.Equal("Active1900", items[0].GetProperty("playerName").GetString());
        Assert.Equal("ProvisionalIdle", items[^1].GetProperty("playerName").GetString());

        // Tied counts still fall back to the ordinal name order.
        for (var index = 1; index < items.Length; index++)
        {
            if (counts[index] != counts[index - 1]) continue;
            Assert.True(
                string.CompareOrdinal(
                    items[index - 1].GetProperty("playerName").GetString(),
                    items[index].GetProperty("playerName").GetString()) < 0,
                "tied tournament counts are not in ordinal name order.");
        }
    }

    [Fact]
    public async Task Rejects_an_unknown_sort()
    {
        using var response = await Client.GetAsync($"{Path}?sort=bogus");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("sort", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Keeps_the_game_columns_in_the_payload()
    {
        // T6 dropped these four from the rankings table; the tie-break still reads them off the wire.
        var row = await RowAsync("Active1900");
        Assert.Equal(40, row.GetProperty("playedGameCount").GetInt32());
        Assert.Equal(30, row.GetProperty("gameWins").GetInt32());
        Assert.Equal(10, row.GetProperty("gameLosses").GetInt32());
        Assert.Equal(0.75, row.GetProperty("gameWinrate").GetDouble());
    }

    [Fact]
    public async Task Leaves_the_decayed_rating_null_until_the_key_is_on()
    {
        var row = await RowAsync("Active1900");
        Assert.Equal(JsonValueKind.Null, row.GetProperty("decayedRating").ValueKind);
    }

    [Fact]
    public async Task Serves_the_rating_on_the_catalog_too()
    {
        using var response = await Client.GetAsync(CatalogPath);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray().ToArray();

        // The catalog is not a ranking: it stays ordered by played Matches (ADR 0039) and only the
        // fields grew.
        Assert.Equal("Active1900", items[0].GetProperty("playerName").GetString());
        var counts = items.Select(item => item.GetProperty("playedMatchCount").GetInt32()).ToArray();
        Assert.Equal(counts.OrderDescending().ToArray(), counts);

        var provisional = items.Single(item => item.GetProperty("playerName").GetString() == "Provisional1900");
        Assert.True(provisional.GetProperty("provisional").GetBoolean());
        Assert.Equal(1900, provisional.GetProperty("rating").GetInt32());
    }

    [Fact]
    public async Task Changes_the_ETag_across_a_day_boundary()
    {
        using var before = await Client.GetAsync($"{Path}?pageSize=100");
        var etag = before.Headers.ETag!.ToString();
        using var catalogBefore = await Client.GetAsync(CatalogPath);
        var catalogEtag = catalogBefore.Headers.ETag!.ToString();

        // Nothing in the read model moved; only the clock did. An inactive flag that turns over at
        // midnight cannot be served out of a body cached the day before.
        clock.Set(Today.Plus(Duration.FromDays(1)));

        using var after = await Client.GetAsync($"{Path}?pageSize=100");
        Assert.NotEqual(etag, after.Headers.ETag!.ToString());
        using var catalogAfter = await Client.GetAsync(CatalogPath);
        Assert.NotEqual(catalogEtag, catalogAfter.Headers.ETag!.ToString());

        using var stale = new HttpRequestMessage(HttpMethod.Get, $"{Path}?pageSize=100");
        stale.Headers.TryAddWithoutValidation("If-None-Match", etag);
        using var revalidated = await Client.SendAsync(stale);
        Assert.Equal(HttpStatusCode.OK, revalidated.StatusCode);

        clock.Set(Today);
    }

    private async Task<JsonElement> RowAsync(string playerName)
    {
        using var response = await Client.GetAsync($"{Path}?pageSize=100");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("items").EnumerateArray()
            .Single(item => item.GetProperty("playerName").GetString() == playerName)
            .Clone();
    }

    private async Task<string[]> DefaultNamesAsync()
    {
        using var response = await Client.GetAsync($"{Path}?pageSize=100");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("items").EnumerateArray()
            .Select(item => item.GetProperty("playerName").GetString()!)
            .ToArray();
    }

    /// <summary>
    /// Fourteen rows chosen so that every bucket, every tiebreak and every flag boundary has a witness.
    /// Twelve months back from the frozen clock is 2030-06-15, so 2030-06-14 is inactive and 2030-07-15
    /// is not.
    /// </summary>
    private static IEnumerable<PlayerStatisticsRow> Seed() =>
    [
        Row("Active1900", 1900, 1900, 10, "2031-06-01", matches: 20, games: 40, gameWins: 30, gameLosses: 10),
        Row("Alice", 1600, 1600, 6, "2031-06-01", matches: 12),
        Row("alice", 1600, 1600, 6, "2031-06-01", matches: 12),
        Row("DeltaPlayer", 1560, 1532, 6, "2031-06-01", matches: 11),
        Row("RatingRounder", 1523.7, 1523.7, 6, "2031-06-01", matches: 10),
        Row("Fifth", 1500, 1500, 5, "2031-06-01", matches: 9),
        Row("RecentEleven", 1455, 1455, 6, "2030-07-15", matches: 8),
        Row("Inactive2000", 2000, 2000, 7, "2029-01-01", matches: 14),
        Row("NeverPlayed", 1500, 1500, 6, null, matches: 6),
        Row("IdleTwelve", 1450, 1450, 6, "2030-06-14", matches: 7),
        Row("Provisional1900", 1900, 1900, 4, "2031-06-01", matches: 3),
        Row("ProvTiedMore", 1200, 1200, 3, "2031-06-01", matches: 5),
        Row("ProvTiedLess", 1250, 1250, 3, "2031-06-01", matches: 4),
        Row("ProvisionalIdle", 1300, 1300, 2, "2028-06-15", matches: 2)
    ];

    private static PlayerStatisticsRow Row(
        string playerName,
        double rating,
        double previousRating,
        int tournamentsPlayed,
        string? lastPlayedDate,
        int matches,
        int games = 0,
        int gameWins = 0,
        int gameLosses = 0) => new()
        {
            PlayerName = playerName,
            PlayedMatchCount = matches,
            MatchWins = matches,
            MatchLosses = 0,
            MatchDraws = 0,
            MatchWinrate = matches == 0 ? null : 1,
            PlayedGameCount = games,
            GameWins = gameWins,
            GameLosses = gameLosses,
            GameWinrate = games == 0 ? null : (double)gameWins / (gameWins + gameLosses),
            Rating = rating,
            RatingDeviation = 60.5,
            RatingVolatility = 0.06,
            PreviousRating = previousRating,
            LastRatingDelta = rating - previousRating,
            TournamentsPlayed = tournamentsPlayed,
            LastPlayedDate = lastPlayedDate,
            DecayedRating = rating
        };

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString()).Options);

    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");

    private sealed class MutableClock(Instant current) : IClock
    {
        public Instant GetCurrentInstant() => current;
        public void Set(Instant value) => current = value;
    }
}
