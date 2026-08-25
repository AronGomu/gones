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
/// The paged rankings endpoint must order the rating it actually ships. <c>ToGlobalStatsRow</c> rounds
/// the stored double to an integer, and the client-side catalog in
/// <c>src/app/features/players/global-stats-query.ts</c> reproduces the ordering from that integer,
/// because the integer is all it is given. An endpoint that ordered the stored double instead put
/// 1600.4 above 1600.2 while the catalog, seeing 1600 twice, fell through to the Player Name — the two
/// rankings surfaces disagreeing about who is at position 1.
///
/// <para>Every row here differs from its partner only below the rounding boundary, and the
/// alphabetically first name always carries the <em>lower</em> stored value, so ordering the double and
/// ordering the wire integer produce opposite answers. The fixture is written straight to
/// <c>player_statistics</c> with the startup rebuild off, for the reason
/// <see cref="GlobalStatsRatingApiTests"/> gives: the assertion is one exact stored number, not whatever
/// a replay happens to compute.</para>
/// </summary>
public sealed class GlobalStatsRatingRoundingTests : IAsyncLifetime
{
    private const string Path = "/api/archive/global-player-statistics";

    private readonly PostgreSqlTestContainer postgres = new();
    private WebApplicationFactory<Program>? factory;
    private HttpClient? client;

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using (var database = CreateContext())
        {
            await database.Database.MigrateAsync();
            // Rounded: Alpha and Omega are both 1600, Under and Over are both 1400. Stored: Alpha < Omega
            // and Under < Over. Ordinal name order is Alpha, Omega, Over, Under.
            database.PlayerStatistics.Add(Row("Alpha", rating: 1600.2, decayedRating: 1400.2));
            database.PlayerStatistics.Add(Row("Omega", rating: 1600.4, decayedRating: 1400.4));
            database.PlayerStatistics.Add(Row("Over", rating: 1400.4, decayedRating: 1600.4));
            database.PlayerStatistics.Add(Row("Under", rating: 1400.2, decayedRating: 1600.2));
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
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "t20-rating-rounding-signing-key-value");
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
            builder.UseSetting("Gones:PlayerStatistics:RebuildOnStartup", "false");
            // The decayed sort is one of the three orderings under test, so the key that exposes it is on.
            builder.UseSetting("Gones:PlayerStatistics:ExposeDecayedRating", "true");
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
    public async Task Serves_the_two_boundary_players_as_the_same_integer()
    {
        // Without this the rest of the file proves nothing: the pairs have to be indistinguishable on the
        // wire before "the name decides" is a statement about anything.
        var rows = await RowsAsync($"{Path}?pageSize=100");
        Assert.Equal(1600, Rating(rows, "Alpha"));
        Assert.Equal(1600, Rating(rows, "Omega"));
        Assert.Equal(1400, Rating(rows, "Under"));
        Assert.Equal(1400, Rating(rows, "Over"));
    }

    [Fact]
    public async Task Breaks_a_rounded_rating_tie_on_the_name_in_the_default_order()
    {
        var names = await NamesAsync($"{Path}?pageSize=100");

        // Stored doubles descending would be Omega, Alpha, Over, Under.
        Assert.Equal(["Alpha", "Omega", "Over", "Under"], names);
    }

    [Fact]
    public async Task Breaks_a_rounded_rating_tie_on_the_name_on_an_explicit_rating_sort()
    {
        Assert.Equal(
            ["Alpha", "Omega", "Over", "Under"],
            await NamesAsync($"{Path}?pageSize=100&sort=rating&direction=desc"));

        // Ascending flips the pairs, never the tiebreak: the name stays ascending in both directions.
        Assert.Equal(
            ["Over", "Under", "Alpha", "Omega"],
            await NamesAsync($"{Path}?pageSize=100&sort=rating&direction=asc"));
    }

    [Fact]
    public async Task Breaks_a_rounded_rating_tie_on_the_name_on_a_decayed_rating_sort()
    {
        // The decayed column carries the same boundary pairs with the two ranks swapped.
        Assert.Equal(
            ["Over", "Under", "Alpha", "Omega"],
            await NamesAsync($"{Path}?pageSize=100&sort=decayedRating&direction=desc"));
    }

    private async Task<JsonElement[]> RowsAsync(string path)
    {
        using var response = await Client.GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("items").EnumerateArray().Select(item => item.Clone()).ToArray();
    }

    private async Task<string[]> NamesAsync(string path) =>
        [.. (await RowsAsync(path)).Select(item => item.GetProperty("playerName").GetString()!)];

    private static int Rating(IEnumerable<JsonElement> rows, string playerName) =>
        rows.Single(row => row.GetProperty("playerName").GetString() == playerName)
            .GetProperty("rating").GetInt32();

    /// <summary>Ranked and active as of any plausible clock, so all four sit in the same default bucket.</summary>
    private static PlayerStatisticsRow Row(string playerName, double rating, double decayedRating) => new()
    {
        ScopeKind = PlayerStatisticsScope.Global,
        ScopeId = PlayerStatisticsScope.GlobalScopeId,
        PlayerName = playerName,
        PlayedMatchCount = 10,
        MatchWins = 10,
        MatchLosses = 0,
        MatchDraws = 0,
        MatchWinrate = 1,
        PlayedGameCount = 20,
        GameWins = 20,
        GameLosses = 0,
        GameWinrate = 1,
        Rating = rating,
        RatingDeviation = 60.5,
        RatingVolatility = 0.06,
        PreviousRating = rating,
        LastRatingDelta = 0,
        TournamentsPlayed = 10,
        LastPlayedDate = DateTime.UtcNow.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture),
        DecayedRating = decayedRating
    };

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString()).Options);

    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");
}
