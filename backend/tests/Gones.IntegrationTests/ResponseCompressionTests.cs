using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Gones.Api.Identity;
using Gones.Domain.Leagues;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.IntegrationTests;

/// <summary>
/// Compression is registered app-wide but answered only to anonymous reads (ADR 0042). Compressing a
/// response that carries a session secret next to attacker-influenced input is the BREACH side
/// channel — the compressed length leaks the secret byte by byte — so a request carrying an
/// <c>Authorization</c> header or the refresh cookie is answered uncompressed. Every payload this was
/// built for, the League catalog first among them, is an anonymous public read.
/// </summary>
public sealed class ResponseCompressionTests : IAsyncLifetime
{
    private const string Path = "/api/leagues-archive/all";
    private const string DocumentsPath = "/api/leagues-archive/all/documents";
    private static readonly Instant Seeded = Instant.FromUtc(2031, 5, 1, 12, 0);

    private readonly PostgreSqlTestContainer postgres = new();
    private readonly List<WebApplicationFactory<Program>> factories = [];

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using var database = CreateContext();
        await database.Database.MigrateAsync();
        database.LeagueArchiveAggregates.Add(LeagueArchiveAggregate.Create(CompressibleLeague("compression-one"), Seeded));
        database.LeagueArchiveAggregates.Add(LeagueArchiveAggregate.Create(CompressibleLeague("compression-two"), Seeded.Plus(Duration.FromHours(1))));
        await database.SaveChangesAsync();
    }

    public async Task DisposeAsync()
    {
        foreach (var factory in factories) await factory.DisposeAsync();
        await postgres.DisposeAsync();
    }

    [Fact]
    public async Task Compresses_a_public_catalog_read_with_brotli()
    {
        using var client = CreateClient();
        using var compressed = await client.SendAsync(Read("br"));
        Assert.Equal(HttpStatusCode.OK, compressed.StatusCode);
        Assert.Equal("br", compressed.Content.Headers.ContentEncoding.Single());

        // The compressed body has to be the identity body, not merely a body: a decode mismatch would
        // still have shipped the header.
        using var identity = await client.SendAsync(Read(null));
        Assert.Equal(await identity.Content.ReadAsStringAsync(), await DecodeAsync(compressed, "br"));
    }

    [Fact]
    public async Task Falls_back_to_gzip()
    {
        using var client = CreateClient();
        using var compressed = await client.SendAsync(Read("gzip"));
        Assert.Equal(HttpStatusCode.OK, compressed.StatusCode);
        Assert.Equal("gzip", compressed.Content.Headers.ContentEncoding.Single());

        using var identity = await client.SendAsync(Read(null));
        Assert.Equal(await identity.Content.ReadAsStringAsync(), await DecodeAsync(compressed, "gzip"));
    }

    [Fact]
    public async Task Leaves_a_response_uncompressed_without_Accept_Encoding()
    {
        using var client = CreateClient();
        using var response = await client.SendAsync(Read(null));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty(response.Content.Headers.ContentEncoding);
    }

    [Fact]
    public async Task Does_not_compress_a_credentialed_request()
    {
        using var client = CreateClient();
        using var request = Read("br");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", "not-a-real-access-token");

        using var response = await client.SendAsync(request);

        // The route is anonymous, so the header changes nothing but the compression decision.
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty(response.Content.Headers.ContentEncoding);
    }

    [Fact]
    public async Task Does_not_compress_a_cookie_session_request()
    {
        using var client = CreateClient();
        using var request = Read("br");
        request.Headers.Add("Cookie", $"{RefreshCookie.Name}=not-a-real-refresh-token");

        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty(response.Content.Headers.ContentEncoding);
    }

    /// <summary>
    /// The credential test cannot protect the auth group: <c>GET /api/auth/oauth/{provider}/callback</c>
    /// is a first login, so it carries neither an <c>Authorization</c> header nor the refresh cookie, and
    /// it answers <c>OAuthFlowResponse</c> — an access token or a completion ticket. The group is
    /// therefore excluded by path, which is what keeps "a body holding a session secret is never
    /// compressed" (<c>docs/RUNTIME_CONTRACT.md</c>) true by construction. <c>application/problem+json</c>
    /// is on the compressible list, so this response would carry an encoding without the exclusion.
    /// </summary>
    [Fact]
    public async Task Does_not_compress_an_anonymous_auth_response()
    {
        using var client = CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/auth/oauth/google/callback");
        request.Headers.AcceptEncoding.Add(new StringWithQualityHeaderValue("br"));

        using var response = await client.SendAsync(request);

        Assert.Empty(response.Content.Headers.ContentEncoding);
    }

    [Fact]
    public async Task Sends_no_encoding_on_a_304()
    {
        using var client = CreateClient();
        using var first = await client.SendAsync(Read("br"));
        var etag = first.Headers.ETag!.ToString();

        using var conditional = Read("br");
        conditional.Headers.TryAddWithoutValidation("If-None-Match", etag);
        using var replay = await client.SendAsync(conditional);

        // A 304 carries no body, so there is nothing to encode and no header to send.
        Assert.Equal(HttpStatusCode.NotModified, replay.StatusCode);
        Assert.Empty(replay.Content.Headers.ContentEncoding);
    }

    /// <summary>
    /// A real browser sends <c>Accept-Encoding: gzip, deflate, br</c> and must receive brotli.
    /// Brotli must be smaller than what gzip Fastest would have produced — brotli Fastest fails this
    /// because at quality 1 its streaming overhead makes it larger than gzip on realistic payloads.
    /// </summary>
    [Fact]
    public async Task Real_browser_header_selects_brotli_and_it_beats_gzip_Fastest()
    {
        await using var database = CreateContext();
        for (int i = 0; i < 200; i++)
            database.LeagueArchiveAggregates.Add(
                LeagueArchiveAggregate.Create(
                    CompressibleLeague($"ratio-{i}"),
                    Seeded.Plus(Duration.FromHours(i + 100))));
        await database.SaveChangesAsync();

        using var client = CreateClient();

        using var gzipRequest = new HttpRequestMessage(HttpMethod.Get, DocumentsPath);
        gzipRequest.Headers.AcceptEncoding.Add(new StringWithQualityHeaderValue("gzip"));
        using var gzipResponse = await client.SendAsync(gzipRequest);
        Assert.Equal("gzip", gzipResponse.Content.Headers.ContentEncoding.Single());
        var gzipBodyLength = (await gzipResponse.Content.ReadAsByteArrayAsync()).Length;

        using var realBrowserRequest = new HttpRequestMessage(HttpMethod.Get, DocumentsPath);
        realBrowserRequest.Headers.TryAddWithoutValidation("Accept-Encoding", "gzip, deflate, br");
        using var realBrowserResponse = await client.SendAsync(realBrowserRequest);
        Assert.Equal(HttpStatusCode.OK, realBrowserResponse.StatusCode);
        Assert.Equal("br", realBrowserResponse.Content.Headers.ContentEncoding.Single());

        var brBodyLength = (await realBrowserResponse.Content.ReadAsByteArrayAsync()).Length;
        Assert.True(
            brBodyLength < gzipBodyLength,
            $"Brotli body ({brBodyLength} B) must be smaller than gzip Fastest ({gzipBodyLength} B) for the real-browser path.");
    }

    private static HttpRequestMessage Read(string? acceptEncoding)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, Path);
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

    private HttpClient CreateClient()
    {
        var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "t-response-compression-signing-key-value");
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
        });
        factories.Add(factory);
        // The default client negotiates nothing and decompresses nothing, which is what makes the
        // Content-Encoding header assertable rather than silently unwrapped by the handler.
        return factory.CreateDefaultClient();
    }

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString()).Options);

    /// <summary>A League with enough repeated text that a compressed body is meaningfully smaller.</summary>
    private static LeagueDocument CompressibleLeague(string id) => new(
        id,
        $"Compression League {id}",
        "completed",
        [
            new TournamentDocument($"{id}-tournament", id, "Compression Day", "2031-05-01", "completed",
                [
                    new RoundDocument($"{id}-round",
                    [
                        new MatchRoundEntry($"{id}-match", "1", "Ada", "Bo", 2, 0, "Tempo", "Control")
                    ])
                ],
                [new PlayerArchetypeDocument("Ada", "Tempo")])
        ]);
}
