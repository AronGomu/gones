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
        [new TournamentDocument("result-tournament", "api-league", "Result Tournament", "2026-08-03", "completed",
            [new RoundDocument("round-1", [new MatchRoundEntry("entry-1", "1", "Alice", "Bob", 2, 1, "Tempo", "Control")])],
            [new PlayerArchetypeDocument("Alice", "Tempo"), new PlayerArchetypeDocument("Bob", "Control")])]);

    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");
}

public sealed class PublicLeagueApiTests_GlobalPlayerStatistics : IAsyncLifetime
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
            database.LeagueArchiveAggregates.Add(LeagueArchiveAggregate.Create(CompletedLeague(), Instant.FromUtc(2026, 1, 1, 0, 0)));
            database.LeagueArchiveAggregates.Add(LeagueArchiveAggregate.Create(ActiveLeague(), Instant.FromUtc(2026, 1, 2, 0, 0)));
            database.LeagueArchiveAggregates.Add(LeagueArchiveAggregate.Create(PagingLeague(), Instant.FromUtc(2026, 1, 3, 0, 0)));
            database.LeagueArchiveAggregates.Add(LeagueArchiveAggregate.Create(new LeagueDocument("glb-deleted", "Deleted League", "completed",
                [new TournamentDocument("dt1", "glb-deleted", "Deleted Tournament", "2026-01-01", "completed",
                    [new RoundDocument("dr1", [new MatchRoundEntry("de1", "1", "DeletedLeaguePlayer", "AnotherDeletedPlayer", 2, 0, "", "")])],
                    [])]), Instant.FromUtc(2026, 1, 4, 0, 0)));
            await database.SaveChangesAsync();
            var deleted = await database.LeagueArchiveAggregates.SingleAsync(a => a.DocumentId == "glb-deleted");
            deleted.SoftDelete(Instant.FromUtc(2026, 1, 4, 12, 0));
            await database.SaveChangesAsync();
        }
        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_PROVIDER", "Local");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "c30-global-stats-signing-key-value");
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
    public async Task Authority_includes_only_completed_tournaments_of_nondeleted_leagues()
    {
        using var response = await Client.GetAsync("/api/leagues-archive/global-player-statistics?pageSize=100");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("public", response.Headers.CacheControl!.ToString());
        Assert.NotNull(response.Headers.ETag);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var names = body.GetProperty("items").EnumerateArray().Select(r => r.GetProperty("playerName").GetString()!).ToHashSet();
        // from glb-completed only
        Assert.Contains("Alice", names);
        Assert.Contains("alice", names);
        // ByePlayer appeared only as a ByeRoundEntry → skipped by CalculateGlobalPlayerStatistics
        Assert.DoesNotContain("ByePlayer", names);
        // ADR 0040: the scope is the Tournament, not the League. glb-active is a running League whose
        // Tournament t3 is completed, so its Matches are history and they count.
        Assert.Contains("ActiveOnlyPlayer", names);
        Assert.Contains("AnotherActivePlayer", names);
        // A deleted League still contributes nothing, whatever its Tournaments say.
        Assert.DoesNotContain("DeletedLeaguePlayer", names);
    }

    [Fact]
    public async Task Eligibility_bye_only_player_is_excluded()
    {
        using var response = await Client.GetAsync("/api/leagues-archive/global-player-statistics?pageSize=100&search=ByePlayer");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, body.GetProperty("totalCount").GetInt32());
    }

    [Fact]
    public async Task Identity_Alice_and_alice_are_separate_players()
    {
        using var response = await Client.GetAsync("/api/leagues-archive/global-player-statistics?pageSize=100");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var names = body.GetProperty("items").EnumerateArray().Select(r => r.GetProperty("playerName").GetString()!).ToList();
        Assert.Contains("Alice", names);
        Assert.Contains("alice", names);
        Assert.NotEqual(names.IndexOf("Alice"), names.IndexOf("alice"));
    }

    [Fact]
    public async Task Default_sort_is_matchWins_desc_gameWins_desc_matchDraws_desc_name_asc()
    {
        using var response = await Client.GetAsync("/api/leagues-archive/global-player-statistics?pageSize=10");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray().ToArray();
        // Alice has MW=2, should be first in completed league results
        // Find first item among glb-completed players (search by name to isolate)
        using var r2 = await Client.GetAsync("/api/leagues-archive/global-player-statistics?pageSize=100&search=Alice");
        var b2 = await r2.Content.ReadFromJsonAsync<JsonElement>();
        var aliceRow = b2.GetProperty("items").EnumerateArray().First(r => r.GetProperty("playerName").GetString() == "Alice");
        Assert.Equal(2, aliceRow.GetProperty("matchWins").GetInt32());
        Assert.Equal(0, aliceRow.GetProperty("matchLosses").GetInt32());
        // Verify sort and direction echoed (default = null)
        Assert.True(b2.GetProperty("sort").ValueKind == JsonValueKind.Null);
        Assert.True(b2.GetProperty("direction").ValueKind == JsonValueKind.Null);
        Assert.Equal(1, b2.GetProperty("page").GetInt32());
        // Alice is position 1 (highest MW among Alice results)
        Assert.Equal(1, aliceRow.GetProperty("position").GetInt32());
    }

    [Fact]
    public async Task Explicit_sort_matchWins_asc_puts_lowest_first()
    {
        using var r = await Client.GetAsync("/api/leagues-archive/global-player-statistics?pageSize=100&sort=matchWins&direction=asc");
        var body = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("matchWins", body.GetProperty("sort").GetString());
        Assert.Equal("asc", body.GetProperty("direction").GetString());
        var items = body.GetProperty("items").EnumerateArray().ToArray();
        // First item must have MW=0 (ascending order puts lowest first)
        Assert.Equal(0, items[0].GetProperty("matchWins").GetInt32());
        // Alice (MW=2) must NOT be first
        Assert.NotEqual("Alice", items[0].GetProperty("playerName").GetString());
        // Verify Alice is on the last page (she has the highest MW=2)
        var total = body.GetProperty("totalCount").GetInt32();
        using var lastPage = await Client.GetAsync($"/api/leagues-archive/global-player-statistics?page={total / 100 + 1}&pageSize=100&sort=matchWins&direction=asc");
        var lastBody = await lastPage.Content.ReadFromJsonAsync<JsonElement>();
        var lastItems = lastBody.GetProperty("items").EnumerateArray().ToArray();
        Assert.Equal("Alice", lastItems[^1].GetProperty("playerName").GetString());
        Assert.Equal(2, lastItems[^1].GetProperty("matchWins").GetInt32());
    }

    [Fact]
    public async Task Explicit_sort_matchWins_desc_puts_highest_first()
    {
        using var r = await Client.GetAsync("/api/leagues-archive/global-player-statistics?pageSize=100&sort=matchWins&direction=desc");
        var body = await r.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray().ToArray();
        // Alice has MW=2 (highest among all players); she must be first
        Assert.Equal("Alice", items[0].GetProperty("playerName").GetString());
        Assert.Equal(1, items[0].GetProperty("position").GetInt32());
    }

    [Fact]
    public async Task Explicit_sort_gameWinrate_null_last_both_directions()
    {
        // Zero1 and Zero2 have a 0-0 match → PlayedGameCount=0 → GameWinrate=null → always last
        using var asc = await Client.GetAsync("/api/leagues-archive/global-player-statistics?pageSize=100&search=Zero&sort=gameWinrate&direction=asc");
        var ascBody = await asc.Content.ReadFromJsonAsync<JsonElement>();
        var ascItems = ascBody.GetProperty("items").EnumerateArray().ToArray();
        Assert.Equal(2, ascBody.GetProperty("totalCount").GetInt32());
        Assert.True(ascItems[0].GetProperty("gameWinrate").ValueKind == JsonValueKind.Null);
        Assert.True(ascItems[1].GetProperty("gameWinrate").ValueKind == JsonValueKind.Null);

        // Among all players sorted by gameWinrate, Zero1/Zero2 should be on the last page
        using var allAsc = await Client.GetAsync("/api/leagues-archive/global-player-statistics?pageSize=100&sort=gameWinrate&direction=asc");
        var allAscBody = await allAsc.Content.ReadFromJsonAsync<JsonElement>();
        var totalAllAsc = allAscBody.GetProperty("totalCount").GetInt32();
        // Fetch last page to verify Zero1/Zero2 are at the end
        using var lastPageAsc = await Client.GetAsync($"/api/leagues-archive/global-player-statistics?page={totalAllAsc / 100 + 1}&pageSize=100&sort=gameWinrate&direction=asc");
        var lastAscItems = (await lastPageAsc.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("items").EnumerateArray().ToArray();
        var lastAscNames = lastAscItems.Select(r => r.GetProperty("playerName").GetString()!).ToHashSet();
        Assert.Contains("Zero1", lastAscNames);
        Assert.Contains("Zero2", lastAscNames);
        // Verify they are last and have null gameWinrate
        Assert.Equal(JsonValueKind.Null, lastAscItems[^1].GetProperty("gameWinrate").ValueKind);
        Assert.Equal(JsonValueKind.Null, lastAscItems[^2].GetProperty("gameWinrate").ValueKind);

        using var desc = await Client.GetAsync("/api/leagues-archive/global-player-statistics?pageSize=100&sort=gameWinrate&direction=desc");
        var descBody = await desc.Content.ReadFromJsonAsync<JsonElement>();
        var totalAllDesc = descBody.GetProperty("totalCount").GetInt32();
        using var lastPageDesc = await Client.GetAsync($"/api/leagues-archive/global-player-statistics?page={totalAllDesc / 100 + 1}&pageSize=100&sort=gameWinrate&direction=desc");
        var lastDescItems = (await lastPageDesc.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("items").EnumerateArray().ToArray();
        var lastDescNames = lastDescItems.Select(r => r.GetProperty("playerName").GetString()!).ToHashSet();
        Assert.Contains("Zero1", lastDescNames);
        Assert.Contains("Zero2", lastDescNames);
    }

    [Fact]
    public async Task Search_is_case_insensitive_substring()
    {
        // "alice" search should match both "Alice" (capital A) and "alice" (lowercase)
        using var r = await Client.GetAsync("/api/leagues-archive/global-player-statistics?pageSize=100&search=alice");
        var body = await r.Content.ReadFromJsonAsync<JsonElement>();
        var names = body.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("playerName").GetString()!).ToHashSet();
        Assert.Contains("Alice", names);
        Assert.Contains("alice", names);
        // Partial match: "Alic" should also find Alice and alice
        using var r2 = await Client.GetAsync("/api/leagues-archive/global-player-statistics?pageSize=100&search=Alic");
        var body2 = await r2.Content.ReadFromJsonAsync<JsonElement>();
        var names2 = body2.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("playerName").GetString()!).ToHashSet();
        Assert.Contains("Alice", names2);
        Assert.Contains("alice", names2);
    }

    [Fact]
    public async Task Paging_default_100_with_101_results()
    {
        // Pager players: 101 unique players from glb-paging
        using var page1 = await Client.GetAsync("/api/leagues-archive/global-player-statistics?pageSize=100&search=Pager");
        Assert.Equal(HttpStatusCode.OK, page1.StatusCode);
        var body1 = await page1.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(101, body1.GetProperty("totalCount").GetInt32());
        Assert.Equal(100, body1.GetProperty("pageSize").GetInt32());
        Assert.Equal(100, body1.GetProperty("items").GetArrayLength());
        Assert.Equal(1, body1.GetProperty("items")[0].GetProperty("position").GetInt32());
        Assert.Equal(100, body1.GetProperty("items")[99].GetProperty("position").GetInt32());

        using var page2 = await Client.GetAsync("/api/leagues-archive/global-player-statistics?page=2&pageSize=100&search=Pager");
        var body2 = await page2.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, body2.GetProperty("items").GetArrayLength());
        Assert.Equal(101, body2.GetProperty("items")[0].GetProperty("position").GetInt32());

        // Default pageSize=100 (no pageSize param)
        using var defaultPage = await Client.GetAsync("/api/leagues-archive/global-player-statistics?search=Pager");
        var defaultBody = await defaultPage.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(100, defaultBody.GetProperty("pageSize").GetInt32());
        Assert.Equal(100, defaultBody.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task Position_reflects_search_result_rank_not_global_rank()
    {
        // Alice has MW=2; searching "Alice" she should be position 1
        using var r = await Client.GetAsync("/api/leagues-archive/global-player-statistics?pageSize=100&search=Alice");
        var body = await r.Content.ReadFromJsonAsync<JsonElement>();
        var aliceItem = body.GetProperty("items").EnumerateArray().First(i => i.GetProperty("playerName").GetString() == "Alice");
        Assert.Equal(1, aliceItem.GetProperty("position").GetInt32());

        // Without search, Alice is still position 1 among all players (MW=2 is highest)
        using var all = await Client.GetAsync("/api/leagues-archive/global-player-statistics?pageSize=100&sort=matchWins&direction=desc");
        var allBody = await all.Content.ReadFromJsonAsync<JsonElement>();
        var aliceAllItem = allBody.GetProperty("items").EnumerateArray().First(i => i.GetProperty("playerName").GetString() == "Alice");
        Assert.Equal(1, aliceAllItem.GetProperty("position").GetInt32());
    }

    [Fact]
    public async Task Response_includes_all_14_columns_plus_pagination()
    {
        using var r = await Client.GetAsync("/api/leagues-archive/global-player-statistics?pageSize=10&search=Alice");
        var body = await r.Content.ReadFromJsonAsync<JsonElement>();
        var item = body.GetProperty("items")[0];
        // 13 domain fields
        Assert.True(item.TryGetProperty("playerName", out _));
        Assert.True(item.TryGetProperty("playedMatchCount", out _));
        Assert.True(item.TryGetProperty("matchWins", out _));
        Assert.True(item.TryGetProperty("matchLosses", out _));
        Assert.True(item.TryGetProperty("matchDraws", out _));
        Assert.True(item.TryGetProperty("matchWinrate", out _));
        Assert.True(item.TryGetProperty("playedGameCount", out _));
        Assert.True(item.TryGetProperty("gameWins", out _));
        Assert.True(item.TryGetProperty("gameLosses", out _));
        Assert.True(item.TryGetProperty("gameWinrate", out _));
        Assert.True(item.TryGetProperty("nemesis", out _));
        Assert.True(item.TryGetProperty("rival", out _));
        Assert.True(item.TryGetProperty("mostPlayedArchetype", out _));
        // Column 14: position
        Assert.True(item.TryGetProperty("position", out _));
        // Pagination envelope
        Assert.True(body.TryGetProperty("page", out _));
        Assert.True(body.TryGetProperty("pageSize", out _));
        Assert.True(body.TryGetProperty("totalCount", out _));
        Assert.True(body.TryGetProperty("sort", out _));
        Assert.True(body.TryGetProperty("direction", out _));
        // Alice's nemesis is null (never lost); rival is non-null (played Bob and Carol)
        var aliceRow = body.GetProperty("items").EnumerateArray().First(i => i.GetProperty("playerName").GetString() == "Alice");
        Assert.Equal(JsonValueKind.Null, aliceRow.GetProperty("nemesis").ValueKind);
        Assert.NotEqual(JsonValueKind.Null, aliceRow.GetProperty("rival").ValueKind);
        Assert.Equal("Tempo", aliceRow.GetProperty("mostPlayedArchetype").GetProperty("name").GetString());
    }

    [Fact]
    public async Task Invalid_parameters_return_400()
    {
        Assert.Equal(HttpStatusCode.BadRequest, (await Client.GetAsync("/api/leagues-archive/global-player-statistics?pageSize=20")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Client.GetAsync("/api/leagues-archive/global-player-statistics?sort=invalidColumn")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Client.GetAsync("/api/leagues-archive/global-player-statistics?direction=sideways")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Client.GetAsync($"/api/leagues-archive/global-player-statistics?search={new string('x', 201)}")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Client.GetAsync("/api/leagues-archive/global-player-statistics?page=0")).StatusCode);
    }

    [Fact]
    public async Task ETag_returns_304_on_repeat_request()
    {
        using var first = await Client.GetAsync("/api/leagues-archive/global-player-statistics?pageSize=10");
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var etag = first.Headers.ETag!.ToString();
        Assert.NotNull(etag);
        using var conditional = new HttpRequestMessage(HttpMethod.Get, "/api/leagues-archive/global-player-statistics?pageSize=10");
        conditional.Headers.TryAddWithoutValidation("If-None-Match", etag);
        using var cached = await Client.SendAsync(conditional);
        Assert.Equal(HttpStatusCode.NotModified, cached.StatusCode);
    }

    [Fact]
    public async Task ETag_changes_when_query_changes()
    {
        using var r1 = await Client.GetAsync("/api/leagues-archive/global-player-statistics?pageSize=10");
        using var r2 = await Client.GetAsync("/api/leagues-archive/global-player-statistics?pageSize=10&search=Alice");
        Assert.NotEqual(r1.Headers.ETag!.ToString(), r2.Headers.ETag!.ToString());
    }

    [Fact]
    public async Task Existing_league_public_endpoints_unchanged()
    {
        // Verify the global-player-statistics route does not shadow /api/leagues-archive/{id}
        using var list = await Client.GetAsync("/api/leagues-archive?pageSize=20");
        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        var body = await list.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("items", out _));
        // glb-completed, glb-active, glb-paging are all present (not deleted)
        Assert.True(body.GetProperty("totalCount").GetInt32() >= 3);
    }

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString()).Options);

    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");

    private static LeagueDocument CompletedLeague() => new(
        "glb-completed",
        "Completed League",
        "completed",
        [
            new TournamentDocument("t1", "glb-completed", "Tournament One", "2026-01-01", "completed",
                [
                    new RoundDocument("r1",
                    [
                        new MatchRoundEntry("e1", "1", "Alice", "Bob", 2, 1, "Tempo", "Control"),
                        new ByeRoundEntry("e2", "2", "ByePlayer", ""),
                        new MatchRoundEntry("e3", "3", "carol", "Dave", 1, 1, "", "")
                    ]),
                    new RoundDocument("r2",
                    [
                        new MatchRoundEntry("e4", "1", "Bob", "Carol", 2, 0, "Control", ""),
                        new MatchRoundEntry("e5", "2", "alice", "Eve", 2, 0, "Aggro", "")
                    ]),
                    new RoundDocument("r3",
                    [
                        new MatchRoundEntry("e6", "1", "Zero1", "Zero2", 0, 0, "", "")
                    ])
                ],
                [new PlayerArchetypeDocument("Alice", "Tempo"), new PlayerArchetypeDocument("Bob", "Control")]),
            new TournamentDocument("t2", "glb-completed", "Tournament Two", "2026-01-08", "completed",
                [
                    new RoundDocument("r4",
                    [
                        new MatchRoundEntry("e7", "1", "Alice", "Carol", 2, 0, "Tempo", "")
                    ])
                ],
                [])
        ]);

    private static LeagueDocument ActiveLeague() => new(
        "glb-active",
        "Active League",
        "active",
        [
            new TournamentDocument("t3", "glb-active", "Active Tournament", "2026-01-01", "completed",
                [
                    new RoundDocument("r5",
                    [
                        new MatchRoundEntry("e8", "1", "ActiveOnlyPlayer", "AnotherActivePlayer", 2, 0, "", "")
                    ])
                ],
                [])
        ]);

    private static LeagueDocument PagingLeague()
    {
        var rounds = new List<RoundDocument>();
        for (var i = 1; i <= 50; i++)
        {
            var p1 = $"Pager{i * 2 - 1:D4}";
            var p2 = $"Pager{i * 2:D4}";
            rounds.Add(new RoundDocument($"pr{i}", [new MatchRoundEntry($"pe{i}", "1", p1, p2, 2, 0, "", "")]));
        }
        // Round 51: Pager0101 beats Pager0001, giving Pager0001 a loss and introducing Pager0101
        rounds.Add(new RoundDocument("pr51", [new MatchRoundEntry("pe51", "1", "Pager0101", "Pager0001", 2, 0, "", "")]));
        return new LeagueDocument("glb-paging", "Paging League", "completed",
            [new TournamentDocument("pt1", "glb-paging", "Paging Tournament", "2026-01-01", "completed", rounds.ToArray(), [])]);
    }
}
