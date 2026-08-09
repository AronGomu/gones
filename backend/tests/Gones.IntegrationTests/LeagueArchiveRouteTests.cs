using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Gones.Domain.Leagues;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using Testcontainers.PostgreSql;

namespace Gones.IntegrationTests;

/// <summary>
/// T23 route contract: the archived League feature answers on <c>/api/leagues-archive</c> and
/// <c>/tournaments-archive</c>, the pre-rename paths are gone (ADR 0022 keeps no aliases), and the
/// two frozen surfaces — the export bundle format and <c>/api/maintenance/player-names*</c> — are
/// untouched.
/// </summary>
public sealed class LeagueArchiveRouteTests : IAsyncLifetime
{
    private static readonly Guid Actor = Guid.Parse("10000000-0000-0000-0000-000000000023");
    private readonly PostgreSqlContainer postgres = new PostgreSqlBuilder().WithImage("postgres:17-alpine").Build();
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
                UserName = "archive-route-actor",
                NormalizedUserName = "ARCHIVE-ROUTE-ACTOR",
                Email = "archive-route-actor@example.test",
                NormalizedEmail = "ARCHIVE-ROUTE-ACTOR@EXAMPLE.TEST",
                SecurityStamp = Guid.NewGuid().ToString("N"),
                ConcurrencyStamp = Guid.NewGuid().ToString("N")
            });
            database.LeagueArchiveAggregates.Add(LeagueArchiveAggregate.Create(FixtureLeague(), Instant.FromUtc(2030, 2, 1, 12, 0)));
            await database.SaveChangesAsync();
        }
        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "t23-league-archive-route-signing-key-value");
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
    public async Task Archive_list_responds_on_the_new_path()
    {
        using var list = await Client.GetAsync("/api/leagues-archive");
        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        var body = await list.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains(body.GetProperty("items").EnumerateArray(), item => item.GetProperty("id").GetString() == "archive-league");

        using var detail = await Client.GetAsync("/api/leagues-archive/archive-league");
        Assert.Equal(HttpStatusCode.OK, detail.StatusCode);
    }

    [Fact]
    public async Task Old_league_path_is_gone()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await Client.GetAsync("/api/leagues")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Client.GetAsync("/api/leagues/archive-league")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Client.GetAsync("/api/leagues/archive-league/result")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Client.GetAsync("/api/leagues/archive-league/export")).StatusCode);
    }

    [Fact]
    public async Task Archive_tournament_path_uses_the_new_segment()
    {
        using var tournament = await Client.GetAsync("/api/leagues-archive/archive-league/tournaments-archive/archive-tournament");
        Assert.Equal(HttpStatusCode.OK, tournament.StatusCode);
        Assert.Equal("Archive Tournament", (await tournament.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("name").GetString());

        using var result = await Client.GetAsync("/api/leagues-archive/archive-league/tournaments-archive/archive-tournament/result");
        Assert.Equal(HttpStatusCode.OK, result.StatusCode);
    }

    [Fact]
    public async Task Old_tournament_segment_is_gone()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await Client.GetAsync("/api/leagues-archive/archive-league/tournaments/archive-tournament")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Client.GetAsync("/api/leagues-archive/archive-league/tournaments/archive-tournament/result")).StatusCode);
    }

    [Fact]
    public async Task Commands_respond_on_the_new_group()
    {
        using var created = await SendJsonAsync(HttpMethod.Post, "/api/leagues-archive", new { name = "Commanded Archive" }, "Organizer", key: "archive-create");
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var body = await created.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Commanded Archive", body.GetProperty("name").GetString());
        Assert.Equal($"/api/leagues-archive/{body.GetProperty("id").GetString()}", created.Headers.Location!.ToString());

        using var onOldGroup = await SendJsonAsync(HttpMethod.Post, "/api/leagues", new { name = "Old Group" }, "Organizer", key: "archive-create-old");
        Assert.Equal(HttpStatusCode.NotFound, onOldGroup.StatusCode);
    }

    [Fact]
    public async Task Maintenance_paths_are_untouched()
    {
        using var names = await SendJsonAsync(HttpMethod.Get, "/api/maintenance/player-names", body: null, role: "Organizer");
        Assert.Equal(HttpStatusCode.OK, names.StatusCode);
        Assert.Contains(
            (await names.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("items").EnumerateArray(),
            item => item.GetProperty("name").GetString() == "Alice");
    }

    [Fact]
    public async Task Export_bundle_format_is_unchanged()
    {
        using var export = await Client.GetAsync("/api/leagues-archive/archive-league/export");
        Assert.Equal(HttpStatusCode.OK, export.StatusCode);
        var body = await export.Content.ReadFromJsonAsync<JsonElement>();
        // ADR 0022 freezes the wire format: kind stays "league" and the payload stays under "league".
        Assert.Equal("league", body.GetProperty("kind").GetString());
        Assert.Equal(LeagueNormalizer.GonesDataVersion, body.GetProperty("gonesDataVersion").GetInt32());
        Assert.Equal("archive-league", body.GetProperty("league").GetProperty("id").GetString());
        Assert.False(body.TryGetProperty("leagueArchive", out _));
        Assert.False(body.TryGetProperty("tournamentsArchive", out _));
        Assert.Contains("tournaments", body.GetProperty("league").EnumerateObject().Select(property => property.Name));
    }

    [Fact]
    public async Task Restore_still_accepts_an_old_bundle()
    {
        using var parity = JsonDocument.Parse(File.ReadAllText(Path.Combine(FindFixtureDirectory(), "parity.json")));
        var bundle = new
        {
            kind = "league",
            gonesDataVersion = parity.RootElement.GetProperty("sourceDataVersion").GetInt32(),
            league = parity.RootElement.GetProperty("normalization")[0].GetProperty("expected")
        };
        using var restored = await SendJsonAsync(HttpMethod.Post, "/api/leagues-archive/restore", bundle, "Organizer", key: "archive-restore-v1");
        Assert.Equal(HttpStatusCode.Created, restored.StatusCode);
        var body = await restored.Content.ReadFromJsonAsync<JsonElement>();
        Assert.NotEqual("league-1", body.GetProperty("id").GetString());
        Assert.NotEmpty(body.GetProperty("tournaments").EnumerateArray());
    }

    private static string FindFixtureDirectory()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            var candidate = Path.Combine(directory.FullName, "fixtures", "league-domain", "v1");
            if (Directory.Exists(candidate)) return candidate;
        }
        throw new DirectoryNotFoundException("fixtures/league-domain/v1");
    }

    private async Task<HttpResponseMessage> SendJsonAsync(HttpMethod method, string path, object? body, string? role, string? key = null)
    {
        using var request = new HttpRequestMessage(method, path);
        if (body is not null) request.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        if (role is not null)
        {
            request.Headers.TryAddWithoutValidation("X-Test-User", Actor.ToString("D"));
            request.Headers.TryAddWithoutValidation("X-Test-Roles", role);
        }
        if (key is not null) request.Headers.TryAddWithoutValidation("Idempotency-Key", key);
        return await Client.SendAsync(request);
    }

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString()).Options);

    private static LeagueDocument FixtureLeague() => new(
        "archive-league",
        "Archive League",
        "active",
        [new TournamentDocument("archive-tournament", "archive-league", "Archive Tournament", "2030-02-01",
            [new RoundDocument("archive-round", [new MatchRoundEntry("archive-entry", "1", "Alice", "Bob", 2, 1, "Tempo", "Control")])],
            [new PlayerArchetypeDocument("Alice", "Tempo"), new PlayerArchetypeDocument("Bob", "Control")])]);

    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");
}
