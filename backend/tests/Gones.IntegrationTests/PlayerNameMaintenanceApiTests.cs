using System.Net;
using System.Text;
using System.Text.Json;
using Gones.Domain.Leagues;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.IntegrationTests;

public sealed class PlayerNameMaintenanceApiTests : IAsyncLifetime
{
    private static readonly Guid Actor = Guid.Parse("10000000-0000-0000-0000-000000000036");
    private readonly PostgreSqlTestContainer postgres = new();
    private WebApplicationFactory<Program>? factory;
    private HttpClient? client;

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using (var database = CreateContext())
        {
            await database.Database.MigrateAsync();
            // audit_records.actor_id references asp_net_users since AllowAccountHardDelete, so the
            // synthetic actor these commands audit against needs a real account row.
            database.Users.Add(new ApplicationUser
            {
                Id = Actor,
                UserName = "name-maintenance-actor",
                NormalizedUserName = "NAME-MAINTENANCE-ACTOR",
                Email = "name-maintenance-actor@example.test",
                NormalizedEmail = "NAME-MAINTENANCE-ACTOR@EXAMPLE.TEST",
                SecurityStamp = Guid.NewGuid().ToString("N"),
                ConcurrencyStamp = Guid.NewGuid().ToString("N")
            });
            var now = Instant.FromUtc(2030, 1, 1, 12, 0);
            database.AddLegacyShapedLeague(LeagueWith("league-a", "League A", "active",
                Match("entry-1", "Alice", "Bob"),
                new ByeRoundEntry("entry-2", "2", "alice", string.Empty)), now);
            database.AddLegacyShapedLeague(LeagueWith("league-b", "League B", "completed",
                Match("entry-3", "Alice", "Cara")), now);
            database.AddLegacyShapedLeague(LeagueWith("league-deleted", "Deleted League", "active",
                Match("entry-4", "Alice", "Dana")), now);
            await database.SaveChangesAsync();
            // The maintenance scan reads Tournament rows, so it is the Tournament that must be invisible.
            // Deleting it after its insert leaves it at version 2, because ArchiveTournament.SoftDelete
            // bumps the version explicitly. That is its untouched baseline from here on.
            var deleted = await database.ArchiveTournaments.SingleAsync(item => item.DocumentId == "league-deleted-t1");
            deleted.SoftDelete(now);
            await database.SaveChangesAsync();
        }

        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "c36-maintenance-signing-key-value-long-enough");
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
    public async Task Player_name_search_is_organizer_only_and_lists_exact_case_names()
    {
        using var anonymous = await SendAsync(HttpMethod.Get, "/api/maintenance/player-names", body: null, role: null);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        using var user = await SendAsync(HttpMethod.Get, "/api/maintenance/player-names", body: null, role: "User");
        Assert.Equal(HttpStatusCode.Forbidden, user.StatusCode);

        using var organizer = await SendAsync(HttpMethod.Get, "/api/maintenance/player-names", body: null, role: "Organizer");
        Assert.Equal(HttpStatusCode.OK, organizer.StatusCode);
        var body = await Body(organizer);
        var items = body.GetProperty("items").EnumerateArray()
            .ToDictionary(item => item.GetProperty("name").GetString()!, item => item);

        Assert.True(items.ContainsKey("Alice"));
        Assert.True(items.ContainsKey("alice"));
        Assert.Equal(2, items["Alice"].GetProperty("occurrenceCount").GetInt32());
        Assert.Equal(2, items["Alice"].GetProperty("leagueCount").GetInt32());
        Assert.Equal(1, items["alice"].GetProperty("occurrenceCount").GetInt32());
        Assert.False(items.ContainsKey("Dana"), "deleted Leagues must not contribute names");

        using var filtered = await SendAsync(HttpMethod.Get, "/api/maintenance/player-names?search=ali", body: null, role: "Admin");
        var filteredNames = (await Body(filtered)).GetProperty("items").EnumerateArray()
            .Select(item => item.GetProperty("name").GetString()).ToArray();
        Assert.Contains("Alice", filteredNames);
        Assert.Contains("alice", filteredNames);
        Assert.DoesNotContain("Bob", filteredNames);
    }

    [Fact]
    public async Task Rename_preview_reports_exact_case_counts_without_mutation()
    {
        using var preview = await SendAsync(HttpMethod.Post, "/api/maintenance/player-names/rename-preview", new { fromName = "Alice", toName = "bob" }, "Organizer");
        Assert.Equal(HttpStatusCode.OK, preview.StatusCode);
        var body = await Body(preview);
        Assert.Equal(2, body.GetProperty("affectedLeagueCount").GetInt32());
        Assert.Equal(2, body.GetProperty("affectedOccurrenceCount").GetInt32());
        Assert.True(body.GetProperty("mergesWithExistingPlayer").GetBoolean());

        using var previewNoMerge = await SendAsync(HttpMethod.Post, "/api/maintenance/player-names/rename-preview", new { fromName = "alice", toName = "Zoe" }, "Organizer");
        var noMerge = await Body(previewNoMerge);
        Assert.Equal(1, noMerge.GetProperty("affectedLeagueCount").GetInt32());
        Assert.Equal(1, noMerge.GetProperty("affectedOccurrenceCount").GetInt32());
        Assert.False(noMerge.GetProperty("mergesWithExistingPlayer").GetBoolean());

        await using var database = CreateContext();
        Assert.True(await NothingMutatedAsync(database), "preview must not mutate Tournament documents");
    }

    [Fact]
    public async Task Rename_commits_atomically_across_leagues_and_rejects_invalid_input_without_changes()
    {
        using var invalid = await SendAsync(HttpMethod.Post, "/api/maintenance/player-names/rename", new { fromName = "Alice", toName = " " }, "Organizer");
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        await using (var database = CreateContext())
        {
            Assert.True(await NothingMutatedAsync(database), "failed rename must not mutate any Tournament");
        }

        using var missing = await SendAsync(HttpMethod.Post, "/api/maintenance/player-names/rename", new { fromName = "Nobody Here", toName = "Someone" }, "Organizer");
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);

        using var forbidden = await SendAsync(HttpMethod.Post, "/api/maintenance/player-names/rename", new { fromName = "Alice", toName = "Alicia" }, "User");
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);

        using var commit = await SendAsync(HttpMethod.Post, "/api/maintenance/player-names/rename", new { fromName = "Alice", toName = "Alicia" }, "Organizer");
        Assert.Equal(HttpStatusCode.OK, commit.StatusCode);
        var body = await Body(commit);
        Assert.Equal(2, body.GetProperty("affectedLeagueCount").GetInt32());
        Assert.Equal(2, body.GetProperty("affectedOccurrenceCount").GetInt32());

        await using (var database = CreateContext())
        {
            var leagueA = await database.ArchiveTournaments.SingleAsync(item => item.DocumentId == "league-a-t1");
            var leagueB = await database.ArchiveTournaments.SingleAsync(item => item.DocumentId == "league-b-t1");
            var deleted = await database.ArchiveTournaments.SingleAsync(item => item.DocumentId == "league-deleted-t1");
            Assert.Equal(2, leagueA.Version);
            Assert.Equal(2, leagueB.Version);
            // Still the seed's post-delete baseline: the rename skipped it, so nothing bumped it again.
            Assert.Equal(2, deleted.Version);

            var documentA = leagueA.ReadDocument();
            var match = Assert.IsType<MatchRoundEntry>(documentA.Rounds[0].Entries[0]);
            Assert.Equal("Alicia", match.Player1Name);
            var bye = Assert.IsType<ByeRoundEntry>(documentA.Rounds[0].Entries[1]);
            Assert.Equal("alice", bye.PlayerName);

            var audits = await database.AuditRecords
                .Where(item => item.Action == "maintenance.player_name.renamed")
                .ToListAsync();
            Assert.Equal(2, audits.Count);
            Assert.All(audits, audit => Assert.Equal(Actor, audit.ActorId));
        }
    }

    /// <summary>
    /// Every Tournament still at the version the seed left it at: 1 for the two live rows, 2 for the
    /// soft-deleted one. Asserting the per-row baseline rather than a flat <c>Version == 1</c> keeps the
    /// deleted Tournament inside the no-mutation guarantee instead of excluding it from the scan.
    /// </summary>
    private static Task<bool> NothingMutatedAsync(GonesDbContext database) =>
        database.ArchiveTournaments.AllAsync(item => item.Version == (item.DeletedAt == null ? 1 : 2));

    private static LeagueDocument LeagueWith(string id, string name, string status, params RoundEntry[] entries) => new(
        id,
        name,
        status,
        [new TournamentDocument($"{id}-t1", id, "Result Tournament", "2030-01-01", "completed",
            [new RoundDocument($"{id}-r1", entries)],
            [])]);

    private static MatchRoundEntry Match(string id, string player1, string player2) =>
        new(id, "1", player1, player2, 2, 1, string.Empty, string.Empty);

    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string path, object? body, string? role)
    {
        var request = new HttpRequestMessage(method, path);
        if (body is not null) request.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        if (role is not null)
        {
            request.Headers.TryAddWithoutValidation("X-Test-User", Actor.ToString("D"));
            request.Headers.TryAddWithoutValidation("X-Test-Roles", role);
        }
        return await Client.SendAsync(request);
    }

    private static async Task<JsonElement> Body(HttpResponseMessage response) =>
        JsonSerializer.Deserialize<JsonElement>(await response.Content.ReadAsStringAsync());

    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");

    private GonesDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<GonesDbContext>()
            .UseNpgsql(postgres.GetConnectionString(), npgsql => npgsql.UseNodaTime())
            .Options;
        return new GonesDbContext(options);
    }
}
