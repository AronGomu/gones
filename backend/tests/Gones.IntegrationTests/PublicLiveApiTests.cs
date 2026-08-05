using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Gones.Domain.Leagues;
using Gones.Domain.Live;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using Testcontainers.PostgreSql;

namespace Gones.IntegrationTests;

public sealed class PublicLiveApiTests : IAsyncLifetime
{
    private static readonly Guid Actor = Guid.Parse("30000000-0000-0000-0000-000000000001");
    private readonly PostgreSqlContainer postgres = new PostgreSqlBuilder().WithImage("postgres:17-alpine").Build();
    private WebApplicationFactory<Program>? factory;
    private HttpClient? client;

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using (var database = CreateContext())
        {
            await database.Database.MigrateAsync();
            database.LiveAggregates.Add(LiveAggregate.Create(FixtureLive(), Instant.FromUtc(2026, 8, 5, 10, 0)));
            database.LiveAggregates.Add(LiveAggregate.Create(
                FixtureLive() with { Id = "deleted-live", Name = "Deleted Live", Stage = "registration", Rounds = [], Checkpoints = [] },
                Instant.FromUtc(2026, 8, 5, 9, 0)));
            await database.SaveChangesAsync();
            var deleted = await database.LiveAggregates.SingleAsync(item => item.DocumentId == "deleted-live");
            deleted.SoftDelete(Instant.FromUtc(2026, 8, 5, 11, 0));
            await database.SaveChangesAsync();
        }
        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "c33-public-live-signing-key-value-long");
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
    public async Task Public_list_detail_and_standings_are_anonymous_cacheable_and_hide_mutation_details()
    {
        using var list = await Client.GetAsync("/api/live-tournaments?page=1&pageSize=1&stage=round&search=Api");
        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        Assert.Contains("public", list.Headers.CacheControl!.ToString());
        Assert.NotNull(list.Headers.ETag);
        var listBody = await list.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, listBody.GetProperty("totalCount").GetInt32());
        var summary = listBody.GetProperty("items")[0];
        Assert.Equal("api-live", summary.GetProperty("id").GetString());
        Assert.Equal("round", summary.GetProperty("stage").GetString());
        Assert.Equal("2026-08-05", summary.GetProperty("tournamentDate").GetString());
        Assert.Equal(1, summary.GetProperty("documentVersion").GetInt64());
        Assert.False(summary.TryGetProperty("canonicalDocument", out _));
        Assert.False(summary.TryGetProperty("players", out _));

        using var detail = await Client.GetAsync("/api/live-tournaments/api-live");
        Assert.Equal(HttpStatusCode.OK, detail.StatusCode);
        Assert.NotNull(detail.Headers.ETag);
        var detailBody = await detail.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("api-live", detailBody.GetProperty("id").GetString());
        Assert.Equal(2, detailBody.GetProperty("players").GetArrayLength());
        Assert.Equal(1, detailBody.GetProperty("rounds").GetArrayLength());
        // Locked security review: pairing seed, locked order, and checkpoints are Organizer-only mutation details.
        Assert.False(detailBody.TryGetProperty("pairingSeed", out _));
        Assert.False(detailBody.TryGetProperty("firstRoundPlayerOrder", out _));
        Assert.False(detailBody.TryGetProperty("checkpoints", out _));

        using var conditional = new HttpRequestMessage(HttpMethod.Get, "/api/live-tournaments/api-live");
        conditional.Headers.TryAddWithoutValidation("If-None-Match", detail.Headers.ETag!.ToString());
        using var notModified = await Client.SendAsync(conditional);
        Assert.Equal(HttpStatusCode.NotModified, notModified.StatusCode);

        using var standings = await Client.GetAsync("/api/live-tournaments/api-live/standings");
        Assert.Equal(HttpStatusCode.OK, standings.StatusCode);
        var standingsBody = await standings.Content.ReadFromJsonAsync<JsonElement>();
        var firstRow = standingsBody.GetProperty("rows")[0];
        Assert.Equal("Alice", firstRow.GetProperty("playerName").GetString());
        Assert.Equal(3, firstRow.GetProperty("points").GetInt32());
        Assert.Equal(1, firstRow.GetProperty("rank").GetInt32());

        Assert.Equal(HttpStatusCode.NotFound, (await Client.GetAsync("/api/live-tournaments/deleted-live")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Client.GetAsync("/api/live-tournaments/missing-live")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Client.GetAsync("/api/live-tournaments?pageSize=101")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Client.GetAsync("/api/live-tournaments?stage=archived")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Client.GetAsync($"/api/live-tournaments/{new string('x', LiveAggregate.MaximumDocumentIdLength + 1)}")).StatusCode);
        using var literalWildcard = await Client.GetAsync("/api/live-tournaments?search=Api%25");
        Assert.Equal(0, (await literalWildcard.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("totalCount").GetInt32());
    }

    [Fact]
    public async Task Full_document_read_requires_organizer_or_admin_and_returns_strong_etag()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await SendAsync("/api/live-tournaments/api-live/document", role: null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync("/api/live-tournaments/api-live/document", role: "User")).StatusCode);

        using var organizer = await SendAsync("/api/live-tournaments/api-live/document", role: "Organizer");
        Assert.Equal(HttpStatusCode.OK, organizer.StatusCode);
        Assert.NotNull(organizer.Headers.ETag);
        var body = await organizer.Content.ReadFromJsonAsync<JsonElement>();
        var document = body.GetProperty("document");
        Assert.Equal("api-live", document.GetProperty("id").GetString());
        Assert.Equal(424242, document.GetProperty("pairingSeed").GetInt64());
        Assert.Equal(2, document.GetProperty("firstRoundPlayerOrder").GetArrayLength());
        Assert.Equal(1, document.GetProperty("checkpoints").GetArrayLength());
        Assert.Equal(1, body.GetProperty("documentVersion").GetInt64());

        using var admin = await SendAsync("/api/live-tournaments/api-live/document", role: "Admin");
        Assert.Equal(HttpStatusCode.OK, admin.StatusCode);

        using var conditional = await SendAsync("/api/live-tournaments/api-live/document", role: "Organizer", ifNoneMatch: organizer.Headers.ETag!.ToString());
        Assert.Equal(HttpStatusCode.NotModified, conditional.StatusCode);

        Assert.Equal(HttpStatusCode.NotFound, (await SendAsync("/api/live-tournaments/deleted-live/document", role: "Organizer")).StatusCode);
    }

    private async Task<HttpResponseMessage> SendAsync(string path, string? role, string? ifNoneMatch = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (role is not null)
        {
            request.Headers.TryAddWithoutValidation("X-Test-User", Actor.ToString("D"));
            request.Headers.TryAddWithoutValidation("X-Test-Roles", role);
        }
        if (ifNoneMatch is not null) request.Headers.TryAddWithoutValidation("If-None-Match", ifNoneMatch);
        return await Client.SendAsync(request);
    }

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString()).Options);

    private static LiveTournamentDocument FixtureLive() => new(
        "api-live",
        "Api Live Night",
        "league-1",
        "2026-08-05",
        "swiss",
        3,
        false,
        true,
        424242,
        ["p-1", "p-2"],
        "round",
        1,
        [
            new LiveTournamentPlayerDocument("p-1", "Alice", true, false, 0, 0, 0, "Tempo"),
            new LiveTournamentPlayerDocument("p-2", "Bob", false, false, 0, 0, 0, "Control")
        ],
        [new LiveTournamentRoundDocument("r-1", 1, [
            new LiveTournamentRoundEntryDocument(new MatchRoundEntry("m-1", "1", "Alice", "Bob", 2, 0, "", ""), true)
        ], true)],
        [new LiveTournamentCheckpointDocument("c-1", "Pairing 1", "2026-08-05T10:00:00.000Z", "round", 1, 3, true,
            [new LiveTournamentPlayerDocument("p-1", "Alice", true, false, 0, 0, 0, "Tempo")],
            [])],
        null,
        1,
        "2026-08-05T09:00:00.000Z",
        "2026-08-05T10:00:00.000Z");

    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");
}
