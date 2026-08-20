using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Gones.Application.Concurrency;
using Gones.Domain.Leagues;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.IntegrationTests;

/// <summary>
/// The public rankings endpoint after it moved onto the ADR 0040 read model. The bar is parity: the
/// same request has to answer with exactly what the domain computes over the same archives, now that
/// Postgres does the filtering, the ordering and the paging.
///
/// <para>The seed is deliberately mixed — an active League holding a completed Tournament, a completed
/// League holding a running one — because the scope moved with this change. The endpoint used to filter
/// on the League status and now filters on the Tournament status, which is the rule the read model and
/// the domain already share.</para>
/// </summary>
public sealed class GlobalStatsApiTests : IAsyncLifetime
{
    private const string Path = "/api/leagues-archive/global-player-statistics";
    private static readonly Guid Actor = Guid.Parse("10000000-0000-0000-0000-000000000023");
    private static readonly Instant Seeded = Instant.FromUtc(2031, 1, 1, 12, 0);
    private static readonly string[] SortColumns =
    [
        "playedMatchCount", "matchWins", "matchLosses", "matchDraws", "matchWinrate",
        "playedGameCount", "gameWins", "gameLosses", "gameWinrate"
    ];

    private readonly PostgreSqlTestContainer postgres = new();
    private WebApplicationFactory<Program>? factory;
    private HttpClient? client;

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using (var database = CreateContext())
        {
            await database.Database.MigrateAsync();
            database.Users.Add(new ApplicationUser
            {
                Id = Actor,
                UserName = "global-stats-actor",
                NormalizedUserName = "GLOBAL-STATS-ACTOR",
                Email = "global-stats-actor@example.test",
                NormalizedEmail = "GLOBAL-STATS-ACTOR@EXAMPLE.TEST",
                SecurityStamp = Guid.NewGuid().ToString("N"),
                ConcurrencyStamp = Guid.NewGuid().ToString("N")
            });
            database.LeagueArchiveAggregates.Add(LeagueArchiveAggregate.Create(CompletedLeague(), Seeded));
            database.LeagueArchiveAggregates.Add(LeagueArchiveAggregate.Create(ActiveLeague(), Seeded));
            database.LeagueArchiveAggregates.Add(LeagueArchiveAggregate.Create(DeletedLeague(), Seeded));
            await database.SaveChangesAsync();
            var deleted = await database.LeagueArchiveAggregates.SingleAsync(item => item.DocumentId == "gs-deleted");
            deleted.SoftDelete(Seeded);
            await database.SaveChangesAsync();
        }

        // Creating the client starts the host, whose startup rebuild fills player_statistics.
        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "t23-global-stats-signing-key-value");
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
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
    public async Task Matches_the_previous_computation()
    {
        var expected = InDefaultOrder(await ExpectedAsync());

        using var response = await Client.GetAsync($"{Path}?page=1&pageSize=100");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(expected.Length, body.GetProperty("totalCount").GetInt32());

        var items = body.GetProperty("items").EnumerateArray().ToArray();
        Assert.Equal(expected.Length, items.Length);
        for (var index = 0; index < expected.Length; index++)
        {
            Assert.Equal(index + 1, items[index].GetProperty("position").GetInt32());
            AssertRow(expected[index], items[index]);
        }

        // The row-for-row comparison above is what proves the ordinal name tiebreak: 'lyon' is placed
        // where StringComparer.Ordinal puts it, not where the database's own en_US collation would.
        var names = items.Select(item => item.GetProperty("playerName").GetString()!).ToArray();
        Assert.Contains("lyon", names);

        // The corrected scope, in both directions: a completed Tournament of an active League counts,
        // a running Tournament of a completed League does not, and a deleted League never does.
        Assert.Contains("ActiveLeaguePlayer", names);
        Assert.DoesNotContain("Unfinished1", names);
        Assert.DoesNotContain("DeletedLeaguePlayer", names);
        // A Bye is not a played Match, so a player who only ever had one has no row at all.
        Assert.DoesNotContain("Solo", names);
    }

    [Fact]
    public async Task Pages()
    {
        using var response = await Client.GetAsync($"{Path}?page=2&pageSize=10");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray().ToArray();
        Assert.Equal(10, items.Length);
        Assert.Equal(11, items[0].GetProperty("position").GetInt32());
        Assert.Equal(20, items[^1].GetProperty("position").GetInt32());
        Assert.Equal(2, body.GetProperty("page").GetInt32());
        Assert.Equal(10, body.GetProperty("pageSize").GetInt32());

        // The page is the slice of the full ordering it claims to be.
        using var whole = await Client.GetAsync($"{Path}?page=1&pageSize=100");
        var wholeNames = (await whole.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("items").EnumerateArray().Select(item => item.GetProperty("playerName").GetString()).ToArray();
        Assert.Equal(
            wholeNames.Skip(10).Take(10).ToArray(),
            items.Select(item => item.GetProperty("playerName").GetString()).ToArray());
    }

    [Fact]
    public async Task Sorts_by_every_allowed_column()
    {
        foreach (var column in SortColumns)
        {
            foreach (var direction in new[] { "asc", "desc" })
            {
                using var response = await Client.GetAsync($"{Path}?pageSize=100&sort={column}&direction={direction}");
                Assert.Equal(HttpStatusCode.OK, response.StatusCode);
                var body = await response.Content.ReadFromJsonAsync<JsonElement>();
                Assert.Equal(column, body.GetProperty("sort").GetString());
                Assert.Equal(direction, body.GetProperty("direction").GetString());

                var items = body.GetProperty("items").EnumerateArray().ToArray();
                var values = items.Select(item => Sortable(item.GetProperty(column))).ToArray();
                var present = values.TakeWhile(value => value is not null).Select(value => value!.Value).ToArray();
                // A null winrate is last whichever way the column is sorted, so the values before the
                // first null are the ordered ones and everything after it must be null too.
                Assert.All(values.Skip(present.Length), value => Assert.Null(value));
                var ordered = direction == "asc" ? present.Order().ToArray() : present.OrderDescending().ToArray();
                Assert.Equal(ordered, present);

                // Equal values fall back to the ordinal name order.
                for (var index = 1; index < items.Length; index++)
                {
                    if (values[index] != values[index - 1]) continue;
                    Assert.True(
                        string.CompareOrdinal(
                            items[index - 1].GetProperty("playerName").GetString(),
                            items[index].GetProperty("playerName").GetString()) < 0,
                        $"{column} {direction}: tied rows are not in ordinal name order.");
                }
            }
        }
    }

    [Fact]
    public async Task Rejects_an_unknown_sort()
    {
        using var response = await Client.GetAsync($"{Path}?sort=hax");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("sort", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Rejects_a_bad_page_size()
    {
        using var response = await Client.GetAsync($"{Path}?pageSize=7");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("pageSize", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Rejects_an_over_long_search()
    {
        using var response = await Client.GetAsync($"{Path}?search={new string('x', 201)}");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("search", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Filters_case_insensitively()
    {
        using var response = await Client.GetAsync($"{Path}?pageSize=100&search=LY");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var names = body.GetProperty("items").EnumerateArray().Select(item => item.GetProperty("playerName").GetString()!).ToArray();
        Assert.Contains("lyon", names);
        Assert.Equal(names.Length, body.GetProperty("totalCount").GetInt32());
        Assert.All(names, name => Assert.Contains("ly", name, StringComparison.OrdinalIgnoreCase));

        // A wildcard in the search text is matched literally, not as a pattern.
        using var wildcard = await Client.GetAsync($"{Path}?pageSize=100&search=%25");
        Assert.Equal(0, (await wildcard.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("totalCount").GetInt32());
    }

    [Fact]
    public async Task Returns_an_empty_page_beyond_the_end()
    {
        using var first = await Client.GetAsync($"{Path}?pageSize=100");
        var total = (await first.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("totalCount").GetInt32();

        using var response = await Client.GetAsync($"{Path}?page=999&pageSize=100");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Empty(body.GetProperty("items").EnumerateArray());
        Assert.Equal(total, body.GetProperty("totalCount").GetInt32());
        Assert.Equal(999, body.GetProperty("page").GetInt32());
    }

    [Fact]
    public async Task Answers_304_on_a_matching_etag()
    {
        using var first = await Client.GetAsync($"{Path}?pageSize=10");
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var etag = first.Headers.ETag!.ToString();

        using var conditional = new HttpRequestMessage(HttpMethod.Get, $"{Path}?pageSize=10");
        conditional.Headers.TryAddWithoutValidation("If-None-Match", etag);
        using var replay = await Client.SendAsync(conditional);
        Assert.Equal(HttpStatusCode.NotModified, replay.StatusCode);
    }

    [Fact]
    public async Task Changes_the_etag_after_a_rebuild()
    {
        using var before = await Client.GetAsync($"{Path}?pageSize=10");
        var etag = before.Headers.ETag!.ToString();

        // The edit goes to the running League: a completed one has to be reopened before its source
        // data can change, and reopening is not what this test is about.
        using var league = await Client.GetAsync("/api/leagues-archive/gs-active");
        var version = (await league.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("documentVersion").GetInt64();

        // An archive edit that leaves the player count alone: only the read model's own stamp can tell
        // the ETag that these numbers moved.
        var command = new
        {
            editTournament = (object?)null,
            status = (string?)null,
            addRounds = new[]
            {
                new
                {
                    roundId = Guid.NewGuid().ToString("D"),
                    entries = new[]
                    {
                        new
                        {
                            kind = "match",
                            id = "gs-added-match",
                            table = "1",
                            player1Name = "ActiveLeaguePlayer",
                            player2Name = "ActiveLeagueRival",
                            player1Score = 2,
                            player2Score = 0,
                            player1DeckArchetype = string.Empty,
                            player2DeckArchetype = string.Empty
                        }
                    }
                }
            },
            deleteRoundIds = Array.Empty<string>(),
            replaceRounds = Array.Empty<object>(),
            updateArchetypes = Array.Empty<object>()
        };
        using var edit = new HttpRequestMessage(HttpMethod.Post, "/api/leagues-archive/gs-active/tournaments-archive/gs-a1/edit-batch")
        {
            Content = new StringContent(JsonSerializer.Serialize(command), Encoding.UTF8, "application/json")
        };
        edit.Headers.TryAddWithoutValidation("X-Test-User", Actor.ToString("D"));
        edit.Headers.TryAddWithoutValidation("X-Test-Roles", "Organizer");
        edit.Headers.TryAddWithoutValidation("If-Match", StrongETag.Encode(version));
        using var applied = await Client.SendAsync(edit);
        Assert.Equal(HttpStatusCode.OK, applied.StatusCode);

        using var after = await Client.GetAsync($"{Path}?pageSize=10");
        Assert.NotEqual(etag, after.Headers.ETag!.ToString());

        using var stale = new HttpRequestMessage(HttpMethod.Get, $"{Path}?pageSize=10");
        stale.Headers.TryAddWithoutValidation("If-None-Match", etag);
        using var revalidated = await Client.SendAsync(stale);
        Assert.Equal(HttpStatusCode.OK, revalidated.StatusCode);

        using var refreshed = await Client.GetAsync($"{Path}?pageSize=100&search=ActiveLeaguePlayer");
        var edited = (await refreshed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("items")[0];
        Assert.Equal(2, edited.GetProperty("playedMatchCount").GetInt32());
    }

    /// <summary>
    /// The default order of ADR 0043, restated here independently of the endpoint: active ranked players
    /// by rating, then inactive ranked ones by rating, then the provisional ones by Tournaments played
    /// and Matches played. The twelve-month line is derived from the same clock the server reads rather
    /// than hardcoded, so this oracle does not rot when the fixture's dates age past it.
    /// </summary>
    private static GlobalPlayerStatistics[] InDefaultOrder(IEnumerable<GlobalPlayerStatistics> rows)
    {
        var cutoff = DateTime.UtcNow.Date.AddMonths(-12).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        static int Provisional(GlobalPlayerStatistics row) => row.TournamentsPlayed < 5 ? 2 : 0;
        int Bucket(GlobalPlayerStatistics row) =>
            Provisional(row) == 2 ? 2
            : row.LastPlayedDate is null || string.CompareOrdinal(row.LastPlayedDate, cutoff) <= 0 ? 1
            : 0;
        return rows
            .OrderBy(Bucket)
            .ThenByDescending(row => Provisional(row) == 2 ? 0d : row.Rating)
            .ThenByDescending(row => Provisional(row) == 2 ? row.TournamentsPlayed : 0)
            .ThenByDescending(row => Provisional(row) == 2 ? row.PlayedMatchCount : 0)
            .ThenBy(row => row.PlayerName, StringComparer.Ordinal)
            .ToArray();
    }

    private static double? Sortable(JsonElement value) =>
        value.ValueKind == JsonValueKind.Null ? null : value.GetDouble();

    private static void AssertRow(GlobalPlayerStatistics expected, JsonElement actual)
    {
        Assert.Equal(expected.PlayerName, actual.GetProperty("playerName").GetString());
        Assert.Equal(expected.PlayedMatchCount, actual.GetProperty("playedMatchCount").GetInt32());
        Assert.Equal(expected.MatchWins, actual.GetProperty("matchWins").GetInt32());
        Assert.Equal(expected.MatchLosses, actual.GetProperty("matchLosses").GetInt32());
        Assert.Equal(expected.MatchDraws, actual.GetProperty("matchDraws").GetInt32());
        Assert.Equal(expected.MatchWinrate, Sortable(actual.GetProperty("matchWinrate")));
        Assert.Equal(expected.PlayedGameCount, actual.GetProperty("playedGameCount").GetInt32());
        Assert.Equal(expected.GameWins, actual.GetProperty("gameWins").GetInt32());
        Assert.Equal(expected.GameLosses, actual.GetProperty("gameLosses").GetInt32());
        Assert.Equal(expected.GameWinrate, Sortable(actual.GetProperty("gameWinrate")));
        AssertOpponent(expected.Nemesis, actual.GetProperty("nemesis"));
        AssertOpponent(expected.Rival, actual.GetProperty("rival"));
        var archetype = actual.GetProperty("mostPlayedArchetype");
        if (expected.MostPlayedArchetype is null)
        {
            Assert.Equal(JsonValueKind.Null, archetype.ValueKind);
            return;
        }
        Assert.Equal(expected.MostPlayedArchetype.Name, archetype.GetProperty("name").GetString());
        Assert.Equal(expected.MostPlayedArchetype.MatchCount, archetype.GetProperty("matchCount").GetInt32());
    }

    private static void AssertOpponent(OpponentRecord? expected, JsonElement actual)
    {
        if (expected is null)
        {
            Assert.Equal(JsonValueKind.Null, actual.ValueKind);
            return;
        }
        Assert.Equal(expected.Name, actual.GetProperty("name").GetString());
        Assert.Equal(expected.Wins, actual.GetProperty("wins").GetInt32());
        Assert.Equal(expected.Losses, actual.GetProperty("losses").GetInt32());
    }

    /// <summary>What the domain computes right now over every live archive — the endpoint must equal it.</summary>
    private async Task<IReadOnlyList<GlobalPlayerStatistics>> ExpectedAsync()
    {
        await using var database = CreateContext();
        var aggregates = await database.LeagueArchiveAggregates.AsNoTracking()
            .Where(item => item.DeletedAt == null)
            .ToListAsync();
        var data = new GonesData(LeagueNormalizer.GonesDataVersion, aggregates.Select(item => item.ReadDocument()).ToList(), []);
        return LeagueRules.CalculateGlobalPlayerStatistics(data);
    }

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString()).Options);

    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");

    private static LeagueDocument CompletedLeague()
    {
        var rounds = new List<RoundDocument>
        {
            new("gs-r1",
            [
                new MatchRoundEntry("gs-m1", "1", "Ada", "Bo", 2, 0, "Tempo", "Control"),
                // Lower case on purpose: the name tiebreak has to order it after every capitalised
                // name, which the database's own collation would not.
                new MatchRoundEntry("gs-m2", "2", "lyon", "Mira", 2, 1, string.Empty, string.Empty),
                new MatchRoundEntry("gs-m3", "3", "Nils", "Otto", 1, 2, string.Empty, string.Empty),
                // Nobody won a Game, so both players end with a null game winrate.
                new MatchRoundEntry("gs-m4", "4", "Pia", "Quinn", 0, 0, string.Empty, string.Empty),
                new ByeRoundEntry("gs-b1", "5", "Solo", string.Empty)
            ]),
            new("gs-r2",
            [
                new MatchRoundEntry("gs-m5", "1", "Ada", "lyon", 1, 2, "Tempo", string.Empty),
                new MatchRoundEntry("gs-m6", "2", "Bo", "Mira", 2, 0, "Control", string.Empty),
                new MatchRoundEntry("gs-m7", "3", "Nils", "Uma", 2, 0, string.Empty, string.Empty),
                new MatchRoundEntry("gs-m8", "4", "Otto", "Vik", 1, 1, string.Empty, string.Empty)
            ])
        };
        // Enough distinct players that the second page of ten is a full one.
        rounds.Add(new RoundDocument("gs-r3", Enumerable.Range(1, 8)
            .Select(index => (RoundEntry)new MatchRoundEntry(
                $"gs-mf{index}", $"{index}", $"Filler{index:D2}A", $"Filler{index:D2}B", 2, index % 3, string.Empty, string.Empty))
            .ToArray()));
        return new LeagueDocument("gs-completed", "Global Stats Completed League", "completed",
        [
            new TournamentDocument("gs-t1", "gs-completed", "Finished Day", "2031-01-01", "completed", rounds,
                [new PlayerArchetypeDocument("Ada", "Tempo"), new PlayerArchetypeDocument("Bo", "Control")]),
            // Still running inside a completed League: out of every statistic until it is completed.
            new TournamentDocument("gs-t2", "gs-completed", "Running Day", "2031-01-08", "active",
                [new RoundDocument("gs-r4", [new MatchRoundEntry("gs-m9", "1", "Unfinished1", "Unfinished2", 2, 0, string.Empty, string.Empty)])],
                [])
        ]);
    }

    private static LeagueDocument ActiveLeague() => new(
        "gs-active",
        "Global Stats Active League",
        "active",
        [
            // A completed Tournament of a running League: history that counts (ADR 0040).
            new TournamentDocument("gs-a1", "gs-active", "Finished Day", "2031-02-01", "completed",
                [new RoundDocument("gs-r5", [new MatchRoundEntry("gs-m10", "1", "ActiveLeaguePlayer", "ActiveLeagueRival", 2, 1, string.Empty, string.Empty)])],
                [])
        ]);

    private static LeagueDocument DeletedLeague() => new(
        "gs-deleted",
        "Global Stats Deleted League",
        "completed",
        [
            new TournamentDocument("gs-d1", "gs-deleted", "Erased Day", "2031-03-01", "completed",
                [new RoundDocument("gs-r6", [new MatchRoundEntry("gs-m11", "1", "DeletedLeaguePlayer", "DeletedLeagueRival", 2, 0, string.Empty, string.Empty)])],
                [])
        ]);
}
