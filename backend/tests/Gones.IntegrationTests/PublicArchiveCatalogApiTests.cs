using System.Data.Common;
using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Gones.Api.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using NodaTime;

namespace Gones.IntegrationTests;

/// <summary>
/// The two whole-catalog reads of the three-tier archive: every League and every LeagueSeason in one
/// long-lived cacheable body each, as slim rows rather than documents (ADR 0042). The four counters a
/// Season row prints are denormalized onto the Season, so neither route touches
/// <c>archive_tournaments</c> and no Tournament document is deserialized to answer them.
/// </summary>
public sealed class PublicArchiveCatalogApiTests : IAsyncLifetime
{
    private const string LeaguePath = "/api/archive/leagues/all";
    private const string SeasonPath = "/api/archive/league-seasons/all";
    private static readonly Instant Seeded = Instant.FromUtc(2031, 5, 1, 12, 0);

    private readonly PostgreSqlTestContainer postgres = new();
    private readonly List<WebApplicationFactory<Program>> factories = [];

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using var database = CreateContext();
        await database.Database.MigrateAsync();
        // Seeded through raw SQL rather than through the aggregates: the catalog is coupled to the
        // frozen schema, not to a C# factory signature, and no Tournament exists at all — the Season
        // counters have to print from their own columns.
        await InsertLeagueAsync(database, "league-one", "League One", Seeded, Seeded, 1, null);
        await InsertLeagueAsync(database, "league-two", "League Two", Seeded, Seeded.Plus(Duration.FromHours(1)), 1, null);
        await InsertLeagueAsync(
            database, "league-gone", "League Gone", Seeded, Seeded.Plus(Duration.FromHours(3)), 2,
            Seeded.Plus(Duration.FromHours(3)));
        await InsertSeasonAsync(
            database, "season-alpha", "league-one", "Alpha", "completed", Seeded, 1, null,
            2, 3, new LocalDate(2031, 5, 1), new LocalDate(2031, 5, 2));
        await InsertSeasonAsync(
            database, "season-beta", "league-two", "Beta", "active", Seeded.Plus(Duration.FromHours(2)), 1, null,
            0, 0, null, null);
        await InsertSeasonAsync(
            database, "season-gone", "league-one", "Gone", "completed", Seeded.Plus(Duration.FromHours(3)), 2,
            Seeded.Plus(Duration.FromHours(3)), 0, 0, null, null);
    }

    public async Task DisposeAsync()
    {
        foreach (var factory in factories) await factory.DisposeAsync();
        await postgres.DisposeAsync();
    }

    [Fact]
    public async Task Serves_every_visible_League_as_a_slim_row()
    {
        using var client = CreateClient();
        using var response = await client.GetAsync(LeaguePath);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray().ToArray();

        Assert.Equal(["league-two", "league-one"], items.Select(item => item.GetProperty("id").GetString()!).ToArray());
        Assert.Equal(2, body.GetProperty("totalCount").GetInt32());
        Assert.False(body.GetProperty("truncated").GetBoolean());

        // Exactly these keys: a field creeping onto the row is a body every browser caches for a day.
        Assert.Equal(
            ["createdAt", "documentVersion", "id", "name", "updatedAt"],
            items[0].EnumerateObject().Select(property => property.Name).Order(StringComparer.Ordinal).ToArray());
        Assert.Equal("League Two", items[0].GetProperty("name").GetString());
    }

    [Fact]
    public async Task Omits_a_soft_deleted_League_from_the_rows_and_the_count()
    {
        using var client = CreateClient();
        var body = await (await client.GetAsync(LeaguePath)).Content.ReadFromJsonAsync<JsonElement>();

        Assert.DoesNotContain(
            "league-gone",
            body.GetProperty("items").EnumerateArray().Select(item => item.GetProperty("id").GetString()));
        // A soft delete leaves the row in place, so the count has to filter it too.
        Assert.Equal(2, body.GetProperty("totalCount").GetInt32());
    }

    [Fact]
    public async Task Serves_every_visible_Season_with_its_denormalized_counters()
    {
        using var client = CreateClient();
        using var response = await client.GetAsync(SeasonPath);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray().ToArray();

        Assert.Equal(["season-beta", "season-alpha"], items.Select(item => item.GetProperty("id").GetString()!).ToArray());
        Assert.Equal(2, body.GetProperty("totalCount").GetInt32());

        var alpha = items.Single(item => item.GetProperty("id").GetString() == "season-alpha");
        Assert.Equal("league-one", alpha.GetProperty("leagueId").GetString());
        Assert.Equal("completed", alpha.GetProperty("status").GetString());
        Assert.Equal(2, alpha.GetProperty("tournamentCount").GetInt32());
        Assert.Equal(3, alpha.GetProperty("playerCount").GetInt32());
        Assert.Equal("2031-05-01", alpha.GetProperty("firstTournamentDate").GetString());
        Assert.Equal("2031-05-02", alpha.GetProperty("lastTournamentDate").GetString());
        Assert.Equal(1, alpha.GetProperty("documentVersion").GetInt32());
    }

    [Fact]
    public async Task Serves_null_tournament_dates_for_a_Season_with_no_Tournament()
    {
        using var client = CreateClient();
        var body = await (await client.GetAsync(SeasonPath)).Content.ReadFromJsonAsync<JsonElement>();
        var beta = body.GetProperty("items").EnumerateArray().Single(item => item.GetProperty("id").GetString() == "season-beta");

        // The only two nullable fields on the wire, and they are null together.
        Assert.Equal(JsonValueKind.Null, beta.GetProperty("firstTournamentDate").ValueKind);
        Assert.Equal(JsonValueKind.Null, beta.GetProperty("lastTournamentDate").ValueKind);
        Assert.Equal(0, beta.GetProperty("tournamentCount").GetInt32());
        Assert.Equal(0, beta.GetProperty("playerCount").GetInt32());
    }

    [Fact]
    public async Task Omits_a_soft_deleted_Season_from_the_rows_and_the_count()
    {
        using var client = CreateClient();
        var body = await (await client.GetAsync(SeasonPath)).Content.ReadFromJsonAsync<JsonElement>();

        Assert.DoesNotContain(
            "season-gone",
            body.GetProperty("items").EnumerateArray().Select(item => item.GetProperty("id").GetString()));
        Assert.Equal(2, body.GetProperty("totalCount").GetInt32());
    }

    [Fact]
    public async Task Orders_both_catalogs_newest_updated_first()
    {
        using var client = CreateClient();
        var leagues = await (await client.GetAsync(LeaguePath)).Content.ReadFromJsonAsync<JsonElement>();
        var seasons = await (await client.GetAsync(SeasonPath)).Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(
            ["league-two", "league-one"],
            leagues.GetProperty("items").EnumerateArray().Select(item => item.GetProperty("id").GetString()!).ToArray());
        Assert.Equal(
            ["season-beta", "season-alpha"],
            seasons.GetProperty("items").EnumerateArray().Select(item => item.GetProperty("id").GetString()!).ToArray());

        foreach (var body in new[] { leagues, seasons })
        {
            var stamps = body.GetProperty("items").EnumerateArray()
                .Select(item => item.GetProperty("updatedAt").GetString()!)
                .ToArray();
            Assert.Equal(stamps.OrderByDescending(stamp => stamp, StringComparer.Ordinal).ToArray(), stamps);
        }
    }

    [Fact]
    public async Task Serves_a_Season_row_without_any_Tournament_document()
    {
        using var client = CreateClient();
        var body = await (await client.GetAsync(SeasonPath)).Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items");

        // The point of the slim catalog: the jsonb column never leaves the database on this route.
        foreach (var item in items.EnumerateArray())
        {
            foreach (var forbidden in new[] { "tournaments", "rounds", "playerArchetypes", "document" })
            {
                Assert.False(
                    item.TryGetProperty(forbidden, out _),
                    $"{item.GetProperty("id").GetString()} still carries {forbidden}");
            }
        }

        var bytes = items.GetRawText().Length;
        var count = items.GetArrayLength();
        Assert.True(bytes / count < 400, $"{bytes / count} bytes a row");
    }

    [Fact]
    public async Task Keeps_a_League_row_under_250_bytes()
    {
        using var client = CreateClient();
        var body = await (await client.GetAsync(LeaguePath)).Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items");

        var bytes = items.GetRawText().Length;
        var count = items.GetArrayLength();
        Assert.True(bytes / count < 250, $"{bytes / count} bytes a row");
    }

    [Fact]
    public async Task Truncates_the_League_catalog_at_the_configured_ceiling()
    {
        using var client = CreateClient(("Gones:Archive:MaximumLeagueCatalogSize", "1"));
        using var response = await client.GetAsync(LeaguePath);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(1, body.GetProperty("items").GetArrayLength());
        Assert.True(body.GetProperty("truncated").GetBoolean());
        // The count stays the whole visible archive, which is what makes the flag readable.
        Assert.Equal(2, body.GetProperty("totalCount").GetInt32());
    }

    [Fact]
    public async Task Truncates_the_Season_catalog_at_the_configured_ceiling()
    {
        using var client = CreateClient(("Gones:Archive:MaximumSeasonCatalogSize", "1"));
        using var response = await client.GetAsync(SeasonPath);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(1, body.GetProperty("items").GetArrayLength());
        Assert.True(body.GetProperty("truncated").GetBoolean());
        Assert.Equal(2, body.GetProperty("totalCount").GetInt32());
    }

    [Fact]
    public async Task Reports_no_truncation_when_the_row_count_equals_the_ceiling()
    {
        using var client = CreateClient(("Gones:Archive:MaximumSeasonCatalogSize", "2"));
        var body = await (await client.GetAsync(SeasonPath)).Content.ReadFromJsonAsync<JsonElement>();

        // Truncation is decided by the ceiling + 1 fetch, so an archive that ends exactly on the
        // ceiling is not truncated.
        Assert.Equal(2, body.GetProperty("items").GetArrayLength());
        Assert.False(body.GetProperty("truncated").GetBoolean());
        Assert.Equal(2, body.GetProperty("totalCount").GetInt32());
    }

    [Theory]
    [InlineData(LeaguePath)]
    [InlineData(SeasonPath)]
    public async Task Answers_304_on_a_matching_ETag(string path)
    {
        using var client = CreateClient();
        using var first = await client.GetAsync(path);
        var etag = first.Headers.ETag!.ToString();

        using var conditional = new HttpRequestMessage(HttpMethod.Get, path);
        conditional.Headers.TryAddWithoutValidation("If-None-Match", etag);
        using var replay = await client.SendAsync(conditional);

        Assert.Equal(HttpStatusCode.NotModified, replay.StatusCode);
        // A 304 still carries the whole caching contract.
        Assert.Equal(etag, replay.Headers.ETag!.ToString());
        Assert.Equal("public, max-age=3600", replay.Headers.CacheControl!.ToString());
    }

    [Theory]
    [InlineData(LeaguePath)]
    [InlineData(SeasonPath)]
    public async Task Sets_the_catalog_cache_control_and_a_strong_ETag(string path)
    {
        using var client = CreateClient();
        using var response = await client.GetAsync(path);

        Assert.Equal("public, max-age=3600", response.Headers.CacheControl!.ToString());
        Assert.NotNull(response.Headers.ETag);
        Assert.False(response.Headers.ETag!.IsWeak);
    }

    [Fact]
    public async Task Keeps_the_two_catalogs_in_separate_ETag_namespaces()
    {
        using var client = CreateClient();
        var leagues = (await client.GetAsync(LeaguePath)).Headers.ETag!.ToString();
        var seasons = (await client.GetAsync(SeasonPath)).Headers.ETag!.ToString();

        // Sharing a namespace would answer 304 to a client that holds the other body.
        Assert.NotEqual(leagues, seasons);
    }

    [Fact]
    public async Task Changes_the_Season_catalog_ETag_when_a_counter_moves()
    {
        using var client = CreateClient();
        var before = (await client.GetAsync(SeasonPath)).Headers.ETag!.ToString();

        await using (var database = CreateContext())
        {
            await database.Database.ExecuteSqlRawAsync(
                "UPDATE archive_league_seasons SET player_count = 9, version = version + 1 WHERE document_id = 'season-alpha'");
        }

        var after = (await client.GetAsync(SeasonPath)).Headers.ETag!.ToString();
        Assert.NotEqual(before, after);

        // A counter written by a Tournament command must not leave a stale body behind a 304 for an hour.
        using var conditional = new HttpRequestMessage(HttpMethod.Get, SeasonPath);
        conditional.Headers.TryAddWithoutValidation("If-None-Match", before);
        using var replay = await client.SendAsync(conditional);
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
    }

    [Fact]
    public async Task Changes_the_League_catalog_ETag_when_a_League_is_renamed()
    {
        using var client = CreateClient();
        var before = (await client.GetAsync(LeaguePath)).Headers.ETag!.ToString();

        await using (var database = CreateContext())
        {
            await database.Database.ExecuteSqlRawAsync(
                "UPDATE archive_leagues SET name = 'Renamed', updated_at = {0}, version = version + 1 WHERE document_id = 'league-one'",
                Seeded.Plus(Duration.FromHours(4)));
        }

        Assert.NotEqual(before, (await client.GetAsync(LeaguePath)).Headers.ETag!.ToString());
    }

    [Fact]
    public async Task Stays_inside_the_four_command_budget()
    {
        var commands = new CommandCountingInterceptor();
        using var client = CreateCountingClient(commands);

        foreach (var path in new[] { LeaguePath, SeasonPath })
        {
            commands.Reset();
            using var response = await client.GetAsync(path);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            // Count, max, sum, fetch — and nothing that grows with the number of rows.
            Assert.True(commands.Count <= 4, $"{path} issued {commands.Count} database commands; budget is 4.");
        }
    }

    [Theory]
    [InlineData(LeaguePath)]
    [InlineData(SeasonPath)]
    public async Task Is_anonymous_on_both_routes(string path)
    {
        using var client = CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        Assert.Null(request.Headers.Authorization);

        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Compresses_an_anonymous_catalog_read_with_brotli()
    {
        using var client = CreateCompressionClient();
        using var compressed = await client.SendAsync(Read(SeasonPath, "br"));
        Assert.Equal(HttpStatusCode.OK, compressed.StatusCode);
        Assert.Equal("br", compressed.Content.Headers.ContentEncoding.Single());

        // The compressed body has to be the identity body, not merely a body.
        using var identity = await client.SendAsync(Read(SeasonPath, null));
        Assert.Equal(await identity.Content.ReadAsStringAsync(), await DecodeAsync(compressed, "br"));
    }

    [Fact]
    public async Task Does_not_compress_a_credentialed_catalog_read()
    {
        using var client = CreateCompressionClient();

        using var bearer = Read(SeasonPath, "br");
        bearer.Headers.Authorization = new AuthenticationHeaderValue("Bearer", "not-a-real-access-token");
        using var bearerResponse = await client.SendAsync(bearer);

        using var cookie = Read(SeasonPath, "br");
        cookie.Headers.Add("Cookie", $"{RefreshCookie.Name}=not-a-real-refresh-token");
        using var cookieResponse = await client.SendAsync(cookie);

        // The routes are anonymous, so a credential changes nothing but the BREACH decision (ADR 0042).
        Assert.Equal(HttpStatusCode.OK, bearerResponse.StatusCode);
        Assert.Empty(bearerResponse.Content.Headers.ContentEncoding);
        Assert.Equal(HttpStatusCode.OK, cookieResponse.StatusCode);
        Assert.Empty(cookieResponse.Content.Headers.ContentEncoding);
    }

    private static Task InsertLeagueAsync(
        GonesDbContext database, string documentId, string name, Instant createdAt, Instant updatedAt, int version, Instant? deletedAt) =>
        database.Database.ExecuteSqlRawAsync("""
            INSERT INTO archive_leagues (document_id, name, created_at, updated_at, version, deleted_at)
            VALUES ({0}, {1}, {2}, {3}, {4}, {5})
            """, documentId, name, createdAt, updatedAt, version, deletedAt!);

    private static Task InsertSeasonAsync(
        GonesDbContext database, string documentId, string leagueId, string name, string status, Instant updatedAt,
        int version, Instant? deletedAt, int tournamentCount, int playerCount, LocalDate? firstTournamentDate, LocalDate? lastTournamentDate) =>
        database.Database.ExecuteSqlRawAsync("""
            INSERT INTO archive_league_seasons
                (document_id, league_id, name, status, updated_at, version, deleted_at,
                 tournament_count, player_count, first_tournament_date, last_tournament_date, counts_version)
            VALUES ({0}, {1}, {2}, {3}, {4}, {5}, {6}, {7}, {8}, {9}, {10}, {11})
            """, documentId, leagueId, name, status, updatedAt, version, deletedAt!,
            tournamentCount, playerCount, firstTournamentDate!, lastTournamentDate!, 1);

    private static HttpRequestMessage Read(string path, string? acceptEncoding)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (acceptEncoding is not null) request.Headers.AcceptEncoding.Add(new StringWithQualityHeaderValue(acceptEncoding));
        return request;
    }

    private static async Task<string> DecodeAsync(HttpResponseMessage response, string encoding)
    {
        var body = await response.Content.ReadAsStreamAsync();
        await using Stream decoded = encoding == "br"
            ? new BrotliStream(body, CompressionMode.Decompress)
            : new GZipStream(body, CompressionMode.Decompress);
        using var reader = new StreamReader(decoded, Encoding.UTF8);
        return await reader.ReadToEndAsync();
    }

    private HttpClient CreateClient(params (string Key, string Value)[] settings) =>
        CreateFactory(null, settings).CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

    /// <summary>
    /// Compression is only observable on a client that negotiates nothing and decompresses nothing,
    /// which is what leaves <c>Content-Encoding</c> on the response to assert.
    /// </summary>
    private HttpClient CreateCompressionClient() => CreateFactory(null).CreateDefaultClient();

    private HttpClient CreateCountingClient(CommandCountingInterceptor commands) =>
        CreateFactory(services =>
        {
            services.RemoveAll<DbContextOptions<GonesDbContext>>();
            services.RemoveAll<DbContextOptions>();
            services.AddDbContext<GonesDbContext>(options => options
                .ConfigureGones(postgres.GetConnectionString())
                .AddInterceptors(commands));
        }).CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

    private WebApplicationFactory<Program> CreateFactory(
        Action<IServiceCollection>? configureServices,
        params (string Key, string Value)[] settings)
    {
        var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "t-archive-catalog-signing-key-value");
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
            foreach (var (key, value) in settings) builder.UseSetting(key, value);
            if (configureServices is not null) builder.ConfigureServices(configureServices);
        });
        factories.Add(factory);
        return factory;
    }

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString()).Options);

    /// <summary>Counts executed database commands so an N+1 shows up as a failing budget, not a slow test.</summary>
    private sealed class CommandCountingInterceptor : DbCommandInterceptor
    {
        private int count;

        public int Count => Volatile.Read(ref count);

        public void Reset() => Volatile.Write(ref count, 0);

        public override InterceptionResult<DbDataReader> ReaderExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result)
        {
            Interlocked.Increment(ref count);
            return base.ReaderExecuting(command, eventData, result);
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref count);
            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }
    }
}
