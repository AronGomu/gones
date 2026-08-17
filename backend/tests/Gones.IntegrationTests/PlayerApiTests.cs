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
/// One player, whole: the materialized statistics row plus a flat match history, so the player page
/// stops downloading every League document to recompute numbers the server already holds. The
/// statistics half must equal the <c>player_statistics</c> row it is read from, and the history half
/// must carry ids and names instead of the documents they came from.
/// </summary>
public sealed class PlayerApiTests : IAsyncLifetime
{
    private static readonly Instant Seeded = Instant.FromUtc(2031, 5, 2, 12, 0);

    private readonly PostgreSqlTestContainer postgres = new();
    private readonly List<WebApplicationFactory<Program>> factories = [];

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using var database = CreateContext();
        await database.Database.MigrateAsync();
        database.LeagueArchiveAggregates.Add(LeagueArchiveAggregate.Create(PlayerLeague(), Seeded));
        await database.SaveChangesAsync();
    }

    public async Task DisposeAsync()
    {
        foreach (var factory in factories) await factory.DisposeAsync();
        await postgres.DisposeAsync();
    }

    [Fact]
    public async Task Returns_statistics_and_history()
    {
        using var client = CreateClient();
        using var response = await client.GetAsync("/api/players/Ada");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        var statistics = body.GetProperty("statistics");
        Assert.Equal("Ada", statistics.GetProperty("playerName").GetString());
        Assert.Equal(3, statistics.GetProperty("playedMatchCount").GetInt32());
        Assert.Equal(3, statistics.GetProperty("matchWins").GetInt32());

        // Three played Matches and the Bye, newest first: round 3, then round 2 ordinally by opponent,
        // then round 1. The Bye is history but never a played Match.
        Assert.Equal(
            ["Jean Dupont", "Bye", "Cy", "Bo"],
            body.GetProperty("matches").EnumerateArray().Select(match => match.GetProperty("opponentName").GetString()!).ToArray());
        Assert.Equal(4, body.GetProperty("totalMatchCount").GetInt32());
        Assert.False(body.GetProperty("truncated").GetBoolean());
    }

    [Fact]
    public async Task Agrees_with_the_rankings_row()
    {
        using var client = CreateClient();
        var body = await client.GetFromJsonAsync<JsonElement>("/api/players/Ada");
        var statistics = body.GetProperty("statistics");

        await using var database = CreateContext();
        var row = await database.PlayerStatistics.AsNoTracking().SingleAsync(candidate => candidate.PlayerName == "Ada");

        Assert.Equal(row.PlayedMatchCount, statistics.GetProperty("playedMatchCount").GetInt32());
        Assert.Equal(row.MatchWins, statistics.GetProperty("matchWins").GetInt32());
        Assert.Equal(row.MatchLosses, statistics.GetProperty("matchLosses").GetInt32());
        Assert.Equal(row.MatchDraws, statistics.GetProperty("matchDraws").GetInt32());
        Assert.Equal(row.PlayedGameCount, statistics.GetProperty("playedGameCount").GetInt32());
        Assert.Equal(row.GameWins, statistics.GetProperty("gameWins").GetInt32());
        Assert.Equal(row.GameLosses, statistics.GetProperty("gameLosses").GetInt32());
        Assert.Equal(row.MatchWinrate, statistics.GetProperty("matchWinrate").GetDouble());
        Assert.Equal(row.GameWinrate, statistics.GetProperty("gameWinrate").GetDouble());
        Assert.Equal(row.Rival!.Name, statistics.GetProperty("rival").GetProperty("name").GetString());
        Assert.Equal(row.MostPlayedArchetype!.Name, statistics.GetProperty("mostPlayedArchetype").GetProperty("name").GetString());
        // Ada never lost, so there is no Nemesis, and the wire keeps the null rather than dropping it.
        Assert.Null(row.Nemesis);
        Assert.Equal(JsonValueKind.Null, statistics.GetProperty("nemesis").ValueKind);
    }

    [Fact]
    public async Task Flattens_league_and_tournament()
    {
        using var client = CreateClient();
        var body = await client.GetFromJsonAsync<JsonElement>("/api/players/Ada");
        var match = body.GetProperty("matches").EnumerateArray().First();

        Assert.Equal("player-league", match.GetProperty("leagueId").GetString());
        Assert.Equal("Player League", match.GetProperty("leagueName").GetString());
        Assert.Equal("pt-done", match.GetProperty("tournamentId").GetString());
        Assert.Equal("Finished Day", match.GetProperty("tournamentName").GetString());
        Assert.Equal("2031-05-02", match.GetProperty("tournamentDate").GetString());
        Assert.Equal(2, match.GetProperty("roundIndex").GetInt32());

        // The whole point of the endpoint: no embedded documents on the wire.
        Assert.False(match.TryGetProperty("league", out _));
        Assert.False(match.TryGetProperty("tournament", out _));
        Assert.False(match.TryGetProperty("rounds", out _));
    }

    [Fact]
    public async Task Carries_both_archetypes()
    {
        using var client = CreateClient();
        var body = await client.GetFromJsonAsync<JsonElement>("/api/players/Ada");
        var match = MatchAgainst(body, "Bo");

        Assert.Equal("Tempo", match.GetProperty("ownArchetype").GetString());
        Assert.Equal("Control", match.GetProperty("opponentArchetype").GetString());
    }

    [Fact]
    public async Task Leaves_an_unknown_archetype_empty()
    {
        using var client = CreateClient();
        var body = await client.GetFromJsonAsync<JsonElement>("/api/players/Cy");
        var match = MatchAgainst(body, "Dot");

        // Neither the entry nor the roster records one; the page renders a placeholder for "" and would
        // render the word "null" for a null.
        Assert.Equal(string.Empty, match.GetProperty("ownArchetype").GetString());
        Assert.Equal(string.Empty, match.GetProperty("opponentArchetype").GetString());
    }

    [Fact]
    public async Task Falls_back_to_the_tournament_roster()
    {
        using var client = CreateClient();
        var body = await client.GetFromJsonAsync<JsonElement>("/api/players/Ada");
        var match = MatchAgainst(body, "Cy");

        // The entry records nothing for either side; only Ada is on the roster.
        Assert.Equal("Tempo", match.GetProperty("ownArchetype").GetString());
        Assert.Equal(string.Empty, match.GetProperty("opponentArchetype").GetString());
    }

    [Fact]
    public async Task Includes_byes()
    {
        using var client = CreateClient();
        var body = await client.GetFromJsonAsync<JsonElement>("/api/players/Ada");
        var bye = Assert.Single(
            body.GetProperty("matches").EnumerateArray(),
            match => match.GetProperty("kind").GetString() == "bye");

        Assert.Equal("Bye", bye.GetProperty("opponentName").GetString());
        Assert.Equal(2, bye.GetProperty("ownScore").GetInt32());
        Assert.Equal(0, bye.GetProperty("opponentScore").GetInt32());
        Assert.Equal("Tempo", bye.GetProperty("ownArchetype").GetString());
        Assert.Equal(string.Empty, bye.GetProperty("opponentArchetype").GetString());
    }

    [Fact]
    public async Task Excludes_active_tournaments()
    {
        using var client = CreateClient();

        // Zed only ever played in the Tournament that is still running.
        using var unfinished = await client.GetAsync("/api/players/Zed");
        Assert.Equal(HttpStatusCode.NotFound, unfinished.StatusCode);

        // And that Match is absent from the history of the player who did play elsewhere, even though
        // the League itself is active — the scope is the Tournament, not the League.
        var body = await client.GetFromJsonAsync<JsonElement>("/api/players/Ada");
        Assert.DoesNotContain(
            body.GetProperty("matches").EnumerateArray(),
            match => match.GetProperty("opponentName").GetString() == "Zed");
    }

    [Fact]
    public async Task Not_found_for_an_unknown_player()
    {
        using var client = CreateClient();
        using var response = await client.GetAsync("/api/players/nobody");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Is_case_insensitive_on_the_name()
    {
        using var client = CreateClient();
        using var response = await client.GetAsync("/api/players/ADA");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        // The canonical spelling comes back, not the one that was asked for.
        Assert.Equal("Ada", body.GetProperty("statistics").GetProperty("playerName").GetString());
        Assert.Equal(4, body.GetProperty("matches").GetArrayLength());
    }

    [Fact]
    public async Task Url_decodes_a_spaced_name()
    {
        using var client = CreateClient();
        using var response = await client.GetAsync("/api/players/Jean%20Dupont");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal("Jean Dupont", body.GetProperty("statistics").GetProperty("playerName").GetString());
        Assert.Equal(1, body.GetProperty("statistics").GetProperty("playedMatchCount").GetInt32());
    }

    [Fact]
    public async Task Caps_the_history()
    {
        using var client = CreateClient(("Gones:PlayerHistory:MaximumSize", "2"));
        var body = await client.GetFromJsonAsync<JsonElement>("/api/players/Ada");

        Assert.Equal(2, body.GetProperty("matches").GetArrayLength());
        Assert.True(body.GetProperty("truncated").GetBoolean());
        // The count is the whole history, which is what makes the flag readable, and the cap keeps the
        // newest entries rather than an arbitrary two.
        Assert.Equal(4, body.GetProperty("totalMatchCount").GetInt32());
        Assert.Equal(
            ["Jean Dupont", "Bye"],
            body.GetProperty("matches").EnumerateArray().Select(match => match.GetProperty("opponentName").GetString()!).ToArray());
    }

    [Fact]
    public async Task Sets_the_cache_headers()
    {
        using var client = CreateClient();
        using var response = await client.GetAsync("/api/players/Ada");
        Assert.Equal("public, max-age=3600", response.Headers.CacheControl!.ToString());
        Assert.NotNull(response.Headers.ETag);
    }

    [Fact]
    public async Task Answers_304()
    {
        using var client = CreateClient();
        using var first = await client.GetAsync("/api/players/Ada");
        var etag = first.Headers.ETag!.ToString();

        using var conditional = new HttpRequestMessage(HttpMethod.Get, "/api/players/Ada");
        conditional.Headers.TryAddWithoutValidation("If-None-Match", etag);
        using var replay = await client.SendAsync(conditional);
        Assert.Equal(HttpStatusCode.NotModified, replay.StatusCode);
        Assert.Equal(etag, replay.Headers.ETag!.ToString());
        Assert.Equal("public, max-age=3600", replay.Headers.CacheControl!.ToString());
    }

    [Fact]
    public async Task Is_anonymous()
    {
        using var client = CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/players/Ada");
        Assert.Null(request.Headers.Authorization);
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private static JsonElement MatchAgainst(JsonElement body, string opponentName) =>
        body.GetProperty("matches").EnumerateArray()
            .Single(match => match.GetProperty("opponentName").GetString() == opponentName);

    private HttpClient CreateClient(params (string Key, string Value)[] settings)
    {
        var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "t25-player-endpoints-signing-key-value");
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
            foreach (var (key, value) in settings) builder.UseSetting(key, value);
        });
        factories.Add(factory);
        return factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
    }

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString()).Options);

    /// <summary>
    /// An active League with one completed Tournament and one still running: the completed one is
    /// history, the running one is not, whatever the League's own status says.
    /// </summary>
    private static LeagueDocument PlayerLeague() => new(
        "player-league",
        "Player League",
        "active",
        [
            new TournamentDocument("pt-done", "player-league", "Finished Day", "2031-05-02", "completed",
                [
                    new RoundDocument("pt-done-r1",
                    [
                        new MatchRoundEntry("pt-m1", "1", "Ada", "Bo", 2, 0, "Tempo", "Control"),
                        new MatchRoundEntry("pt-m2", "2", "Cy", "Dot", 2, 1, string.Empty, string.Empty)
                    ]),
                    new RoundDocument("pt-done-r2",
                    [
                        new MatchRoundEntry("pt-m3", "1", "Ada", "Cy", 2, 1, string.Empty, string.Empty),
                        new ByeRoundEntry("pt-b1", "2", "Ada", string.Empty)
                    ]),
                    new RoundDocument("pt-done-r3",
                    [
                        new MatchRoundEntry("pt-m4", "1", "Jean Dupont", "Ada", 0, 2, string.Empty, string.Empty)
                    ])
                ],
                [new PlayerArchetypeDocument("Ada", "Tempo"), new PlayerArchetypeDocument("Bo", "Control")]),
            new TournamentDocument("pt-open", "player-league", "Open Day", "2031-05-09", "active",
                [
                    new RoundDocument("pt-open-r1",
                    [
                        new MatchRoundEntry("pt-m5", "1", "Zed", "Ada", 2, 0, "Ramp", "Tempo")
                    ])
                ],
                [new PlayerArchetypeDocument("Zed", "Ramp")])
        ]);
}
