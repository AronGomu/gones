using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.IntegrationTests;

/// <summary>
/// The read-through a Season row falls back to when its years are not all cached. The client renders
/// this response and deliberately does not cache it: only the backfill queue writes a year partition,
/// and a second writer could leave a half-written year behind.
/// </summary>
public sealed class ArchiveSeasonTournamentsApiTests : IAsyncLifetime
{
    private const string Path = "/api/archive/league-seasons/season-1/tournaments";
    private const string ReadThroughCacheControl = "public, max-age=60";

    private readonly PostgreSqlTestContainer postgres = new();
    private readonly List<WebApplicationFactory<Program>> factories = [];

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using var database = CreateContext();
        await database.Database.MigrateAsync();
        await ArchiveSeed.SeedAsync(database);
    }

    public async Task DisposeAsync()
    {
        foreach (var factory in factories) await factory.DisposeAsync();
        await postgres.DisposeAsync();
    }

    [Fact]
    public async Task Returns_the_Season_tournaments_newest_first()
    {
        using var client = CreateClient();
        var body = await ReadAsync(client, Path);
        var items = body.GetProperty("items").EnumerateArray().ToArray();

        Assert.Equal(["t-new", "t-old"], items.Select(item => item.GetProperty("id").GetString()!).ToArray());
        Assert.Equal(2, body.GetProperty("totalCount").GetInt32());
        Assert.False(body.GetProperty("truncated").GetBoolean());

        // Exactly these keys: the read-through row is the same slim shape a year partition stores, so a
        // field creeping onto it would change two contracts at once.
        Assert.Equal(
            ["documentVersion", "id", "name", "playerCount", "seasonId", "status", "tournamentDate", "updatedAt"],
            items[0].EnumerateObject().Select(property => property.Name).Order(StringComparer.Ordinal).ToArray());
        Assert.Equal("2026-08-17", items[0].GetProperty("tournamentDate").GetString());
        Assert.Equal("season-1", items[0].GetProperty("seasonId").GetString());
        Assert.Equal(2, items[0].GetProperty("playerCount").GetInt32());
    }

    [Fact]
    public async Task Omits_soft_deleted_and_foreign_and_standalone_Tournaments()
    {
        using var client = CreateClient();
        var body = await ReadAsync(client, Path);
        var ids = Ids(body);

        // Membership is `season_id = season-1` exactly: a soft delete, another Season and a standalone
        // Tournament are three different ways to not belong here.
        Assert.DoesNotContain("t-deleted", ids);
        Assert.DoesNotContain("t-foreign", ids);
        Assert.DoesNotContain("t-standalone", ids);
        Assert.Equal(2, body.GetProperty("totalCount").GetInt32());
    }

    [Fact]
    public async Task Omits_rounds_and_archetypes_from_every_row()
    {
        using var client = CreateClient();
        var body = await ReadAsync(client, Path);

        foreach (var item in body.GetProperty("items").EnumerateArray())
        {
            // A catalog row is not a detail document: the jsonb column is never selected, so neither of
            // these can appear even by accident.
            Assert.False(item.TryGetProperty("rounds", out _));
            Assert.False(item.TryGetProperty("playerArchetypes", out _));
        }
    }

    [Fact]
    public async Task Answers_an_empty_page_for_a_Season_with_no_Tournament()
    {
        using var client = CreateClient();
        var body = await ReadAsync(client, "/api/archive/league-seasons/season-empty/tournaments");

        // An existing but empty Season is a valid, cacheable answer — not a 404.
        Assert.Equal(0, body.GetProperty("items").GetArrayLength());
        Assert.Equal(0, body.GetProperty("totalCount").GetInt32());
        Assert.False(body.GetProperty("truncated").GetBoolean());
    }

    [Fact]
    public async Task Answers_404_for_an_unknown_or_soft_deleted_Season()
    {
        using var client = CreateClient();
        using var missing = await client.GetAsync("/api/archive/league-seasons/season-missing/tournaments");
        using var gone = await client.GetAsync("/api/archive/league-seasons/season-gone/tournaments");

        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, gone.StatusCode);
        Assert.Equal("application/problem+json", missing.Content.Headers.ContentType!.MediaType);
        Assert.Equal("application/problem+json", gone.Content.Headers.ContentType!.MediaType);
    }

    [Fact]
    public async Task Answers_400_for_a_blank_or_oversized_Season_id()
    {
        using var client = CreateClient();
        using var oversized = await client.GetAsync($"/api/archive/league-seasons/{new string('x', 201)}/tournaments");
        using var blank = await client.GetAsync("/api/archive/league-seasons/%20/tournaments");

        // A malformed id is a bad request, not a missing resource: 404 would tell a caller the id was
        // merely unknown and invite a retry with the same broken value.
        Assert.Equal(HttpStatusCode.BadRequest, oversized.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, blank.StatusCode);
    }

    [Fact]
    public async Task Truncates_at_the_configured_ceiling()
    {
        using var client = CreateClient(("Gones:Archive:MaximumSeasonTournamentSize", "1"));
        var body = await ReadAsync(client, Path);

        Assert.Equal(1, body.GetProperty("items").GetArrayLength());
        Assert.Equal("t-new", body.GetProperty("items")[0].GetProperty("id").GetString());
        Assert.True(body.GetProperty("truncated").GetBoolean());
        // The count stays the whole Season, which is what makes the flag readable.
        Assert.Equal(2, body.GetProperty("totalCount").GetInt32());
    }

    [Fact]
    public async Task Answers_304_on_a_matching_ETag()
    {
        using var client = CreateClient();
        using var first = await client.GetAsync(Path);
        var etag = first.Headers.ETag!.ToString();

        using var conditional = new HttpRequestMessage(HttpMethod.Get, Path);
        conditional.Headers.TryAddWithoutValidation("If-None-Match", etag);
        using var replay = await client.SendAsync(conditional);

        Assert.Equal(HttpStatusCode.NotModified, replay.StatusCode);
        // A 304 still carries the whole caching contract.
        Assert.Equal(etag, replay.Headers.ETag!.ToString());
        Assert.Equal(ReadThroughCacheControl, replay.Headers.CacheControl!.ToString());
    }

    [Fact]
    public async Task Changes_its_ETag_when_a_Tournament_changes()
    {
        using var client = CreateClient();
        var before = (await client.GetAsync(Path)).Headers.ETag!.ToString();

        await using (var database = CreateContext())
        {
            var tournament = await database.ArchiveTournaments.SingleAsync(row => row.DocumentId == "t-new");
            tournament.Apply(
                ArchiveSeed.Tournament("t-new", "season-1", "Tournament Renamed", "2026-08-17", "Alice", "Cara", 2, 0),
                Instant.FromUtc(2026, 8, 19, 10, 0));
            await database.SaveChangesAsync();
        }

        // Every edit bumps the row's UpdatedAt and Version, so an edit that leaves the count alone must
        // still move the stamp — otherwise the client keeps rendering the old name for the whole TTL.
        Assert.NotEqual(before, (await client.GetAsync(Path)).Headers.ETag!.ToString());
    }

    private static string[] Ids(JsonElement body) =>
        body.GetProperty("items").EnumerateArray().Select(item => item.GetProperty("id").GetString()!).ToArray();

    private static async Task<JsonElement> ReadAsync(HttpClient client, string url)
    {
        using var response = await client.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(ReadThroughCacheControl, response.Headers.CacheControl!.ToString());
        Assert.NotNull(response.Headers.ETag);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private HttpClient CreateClient(params (string Key, string Value)[] settings)
    {
        var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "t7-archive-read-through-signing-key");
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
            builder.UseSetting("Gones:PlayerStatistics:RebuildOnStartup", "false");
            foreach (var (key, value) in settings) builder.UseSetting(key, value);
        });
        factories.Add(factory);
        return factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
    }

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString()).Options);
}
