using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Gones.Application.Concurrency;
using Gones.Domain.Leagues;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using Testcontainers.PostgreSql;

namespace Gones.IntegrationTests;

public sealed class LeagueCommandApiTests : IAsyncLifetime
{
    private static readonly Guid Actor = Guid.Parse("10000000-0000-0000-0000-000000000001");
    private readonly PostgreSqlContainer postgres = new PostgreSqlBuilder().WithImage("postgres:17-alpine").Build();
    private WebApplicationFactory<Program>? factory;
    private HttpClient? client;

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using (var database = CreateContext())
        {
            await database.Database.MigrateAsync();
            database.LeagueAggregates.Add(LeagueAggregate.Create(FixtureLeague("command-league", "Command League"), Instant.FromUtc(2030, 1, 1, 12, 0)));
            database.LeagueAggregates.Add(LeagueAggregate.Create(new LeagueDocument("target-league", "Target League", "active", []), Instant.FromUtc(2030, 1, 1, 12, 0)));
            await database.SaveChangesAsync();
        }
        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "c31-league-command-signing-key-value-long");
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
    public async Task League_create_enforces_roles_idempotency_and_keeps_public_reads_anonymous()
    {
        using var anonymous = await SendJsonAsync(HttpMethod.Post, "/api/leagues", new { name = "Anonymous" }, role: null, key: "anonymous");
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        using var user = await SendJsonAsync(HttpMethod.Post, "/api/leagues", new { name = "User" }, "User", key: "user");
        Assert.Equal(HttpStatusCode.Forbidden, user.StatusCode);

        using var organizer = await SendJsonAsync(HttpMethod.Post, "/api/leagues", new { name = "Organizer League" }, "Organizer", key: "create-organizer");
        Assert.Equal(HttpStatusCode.Created, organizer.StatusCode);
        var created = await Body(organizer);
        Assert.NotNull(organizer.Headers.ETag);
        using var replay = await SendJsonAsync(HttpMethod.Post, "/api/leagues", new { name = "Organizer League" }, "Organizer", key: "create-organizer");
        Assert.Equal(HttpStatusCode.Created, replay.StatusCode);
        Assert.Equal(created.GetProperty("id").GetString(), (await Body(replay)).GetProperty("id").GetString());
        using var conflict = await SendJsonAsync(HttpMethod.Post, "/api/leagues", new { name = "Other" }, "Organizer", key: "create-organizer");
        await AssertProblem(conflict, HttpStatusCode.Conflict, "idempotency_conflict");

        using var admin = await SendJsonAsync(HttpMethod.Post, "/api/leagues", new { name = "Admin League" }, "Admin", key: "create-admin");
        Assert.Equal(HttpStatusCode.Created, admin.StatusCode);
        using var publicRead = await Client.GetAsync($"/api/leagues/{created.GetProperty("id").GetString()}");
        Assert.Equal(HttpStatusCode.OK, publicRead.StatusCode);
    }

    [Fact]
    public async Task League_rename_status_delete_and_concurrent_stale_commands_preserve_tombstone_visibility()
    {
        var etag = StrongETag.Encode(1);
        using var missing = await SendJsonAsync(HttpMethod.Patch, "/api/leagues/command-league/name", new { name = "Missing" }, "Organizer");
        await AssertProblem(missing, HttpStatusCode.PreconditionFailed, "stale_version");

        var first = SendJsonAsync(HttpMethod.Patch, "/api/leagues/command-league/name", new { name = "Winner A" }, "Organizer", ifMatch: etag);
        var second = SendJsonAsync(HttpMethod.Patch, "/api/leagues/command-league/name", new { name = "Winner B" }, "Organizer", ifMatch: etag);
        using var responseA = await first;
        using var responseB = await second;
        Assert.Equal(1, new[] { responseA, responseB }.Count(item => item.StatusCode == HttpStatusCode.OK));
        Assert.Equal(1, new[] { responseA, responseB }.Count(item => item.StatusCode == HttpStatusCode.PreconditionFailed));
        var winner = responseA.StatusCode == HttpStatusCode.OK ? responseA : responseB;

        using var completed = await SendJsonAsync(HttpMethod.Patch, "/api/leagues/command-league/status", new { status = "completed" }, "Organizer", ifMatch: winner.Headers.ETag!.Tag);
        Assert.Equal(HttpStatusCode.OK, completed.StatusCode);
        using var blockedEdit = await SendJsonAsync(HttpMethod.Post, "/api/leagues/command-league/tournaments", new { name = "Blocked", tournamentDate = "2030-01-02" }, "Organizer", ifMatch: completed.Headers.ETag!.Tag);
        Assert.Equal(HttpStatusCode.Conflict, blockedEdit.StatusCode);
        using var reopened = await SendJsonAsync(HttpMethod.Patch, "/api/leagues/command-league/status", new { status = "active" }, "Organizer", ifMatch: completed.Headers.ETag!.Tag);
        using var deleted = await SendJsonAsync(HttpMethod.Delete, "/api/leagues/command-league", new { }, "Organizer", ifMatch: reopened.Headers.ETag!.Tag);
        Assert.Equal(HttpStatusCode.OK, deleted.StatusCode);
        Assert.True((await Body(deleted)).GetProperty("deleted").GetBoolean());
        Assert.Equal(HttpStatusCode.NotFound, (await Client.GetAsync("/api/leagues/command-league")).StatusCode);

        using var placeholderDelete = await SendJsonAsync(HttpMethod.Delete, "/api/leagues/placeholder-league", new { }, "Admin", ifMatch: StrongETag.Encode(1));
        Assert.Equal(HttpStatusCode.Conflict, placeholderDelete.StatusCode);
    }

    [Fact]
    public async Task Result_Tournament_create_edit_delete_commands_preserve_server_ids_and_versions()
    {
        using var created = await SendJsonAsync(HttpMethod.Post, "/api/leagues/command-league/tournaments", new { name = " New Result ", tournamentDate = "2030-03-04" }, "Organizer", ifMatch: StrongETag.Encode(1));
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        var createdBody = await Body(created);
        var tournament = createdBody.GetProperty("tournaments").EnumerateArray().Single(item => item.GetProperty("name").GetString() == "New Result");
        var tournamentId = tournament.GetProperty("id").GetString()!;
        Assert.True(Guid.TryParse(tournamentId, out _));

        using var edited = await SendJsonAsync(HttpMethod.Patch, $"/api/leagues/command-league/tournaments/{tournamentId}", new { name = "Edited Result", tournamentDate = "2030-03-05" }, "Organizer", ifMatch: created.Headers.ETag!.Tag);
        Assert.Equal("Edited Result", (await Body(edited)).GetProperty("tournaments").EnumerateArray().Single(item => item.GetProperty("id").GetString() == tournamentId).GetProperty("name").GetString());
        using var deleted = await SendJsonAsync(HttpMethod.Delete, $"/api/leagues/command-league/tournaments/{tournamentId}", new { }, "Organizer", ifMatch: edited.Headers.ETag!.Tag);
        Assert.DoesNotContain((await Body(deleted)).GetProperty("tournaments").EnumerateArray(), item => item.GetProperty("id").GetString() == tournamentId);
    }

    [Fact]
    public async Task Result_Tournament_move_is_atomic_across_two_versioned_League_rows()
    {
        using var stale = await SendJsonAsync(HttpMethod.Post, "/api/leagues/command-league/tournaments/tournament-1/move", new { targetLeagueId = "target-league" }, "Organizer", ifMatch: StrongETag.Encode(1), targetIfMatch: StrongETag.Encode(99));
        await AssertProblem(stale, HttpStatusCode.PreconditionFailed, "stale_version");
        await using (var database = CreateContext())
        {
            Assert.Single((await database.LeagueAggregates.SingleAsync(item => item.DocumentId == "command-league")).ReadDocument().Tournaments);
            Assert.Empty((await database.LeagueAggregates.SingleAsync(item => item.DocumentId == "target-league")).ReadDocument().Tournaments);
        }

        using var moved = await SendJsonAsync(HttpMethod.Post, "/api/leagues/command-league/tournaments/tournament-1/move", new { targetLeagueId = "target-league" }, "Admin", ifMatch: StrongETag.Encode(1), targetIfMatch: StrongETag.Encode(1));
        Assert.Equal(HttpStatusCode.OK, moved.StatusCode);
        var body = await Body(moved);
        Assert.Empty(body.GetProperty("source").GetProperty("tournaments").EnumerateArray());
        Assert.Equal("target-league", body.GetProperty("target").GetProperty("tournaments")[0].GetProperty("leagueId").GetString());
        Assert.Equal(StrongETag.Encode(2), moved.Headers.GetValues("Target-ETag").Single());
    }

    [Fact]
    public async Task Round_add_import_replace_delete_commands_match_current_source_semantics()
    {
        using var added = await SendJsonAsync(HttpMethod.Post, "/api/leagues/command-league/tournaments/tournament-1/rounds", new { }, "Organizer", ifMatch: StrongETag.Encode(1));
        var addedBody = await Body(added);
        var roundId = addedBody.GetProperty("tournaments")[0].GetProperty("rounds")[1].GetProperty("id").GetString()!;
        Assert.True(Guid.TryParse(roundId, out _));

        const string csv = "Table,Player,Result,Opponent,Player_Decklist,Opponent_Decklist\n2, Carol ,Won 2-0,Dan, Aggro ,Control";
        using var imported = await SendJsonAsync(HttpMethod.Post, $"/api/leagues/command-league/tournaments/tournament-1/rounds/{roundId}/import", new { text = csv }, "Organizer", ifMatch: added.Headers.ETag!.Tag);
        var importedTournament = (await Body(imported)).GetProperty("tournaments")[0];
        Assert.Equal("Carol", importedTournament.GetProperty("rounds")[1].GetProperty("entries")[0].GetProperty("player1Name").GetString());
        Assert.Contains(importedTournament.GetProperty("playerArchetypes").EnumerateArray(), item => item.GetProperty("playerName").GetString() == "Carol");

        var replacement = new { entries = new object[] { new { kind = "bye", id = "replacement-entry", table = "1", playerName = "Eve", deckArchetype = "Earth" } } };
        using var replaced = await SendJsonAsync(HttpMethod.Post, $"/api/leagues/command-league/tournaments/tournament-1/rounds/{roundId}/replace", replacement, "Organizer", ifMatch: imported.Headers.ETag!.Tag);
        Assert.Equal("bye", (await Body(replaced)).GetProperty("tournaments")[0].GetProperty("rounds")[1].GetProperty("entries")[0].GetProperty("kind").GetString());

        using var deleted = await SendJsonAsync(HttpMethod.Delete, $"/api/leagues/command-league/tournaments/tournament-1/rounds/{roundId}", new { }, "Organizer", ifMatch: replaced.Headers.ETag!.Tag);
        Assert.Single((await Body(deleted)).GetProperty("tournaments")[0].GetProperty("rounds").EnumerateArray());
    }

    [Fact]
    public async Task Entry_add_edit_delete_archetype_update_and_Player_Name_rename_are_intent_scoped()
    {
        var entryRoute = "/api/leagues/command-league/tournaments/tournament-1/rounds/round-1/entries";
        using var added = await SendJsonAsync(HttpMethod.Post, entryRoute, new { kind = "bye", id = "ignored-client-id", table = "2", playerName = " Carol ", deckArchetype = " Earth " }, "Organizer", ifMatch: StrongETag.Encode(1));
        var entry = (await Body(added)).GetProperty("tournaments")[0].GetProperty("rounds")[0].GetProperty("entries")[1];
        var entryId = entry.GetProperty("id").GetString()!;
        Assert.NotEqual("ignored-client-id", entryId);
        Assert.Equal("Carol", entry.GetProperty("playerName").GetString());

        using var edited = await SendJsonAsync(HttpMethod.Patch, $"{entryRoute}/{entryId}", new { kind = "bye", id = "ignored", table = "3", playerName = "Carol", deckArchetype = "Air" }, "Organizer", ifMatch: added.Headers.ETag!.Tag);
        Assert.Equal("Air", (await Body(edited)).GetProperty("tournaments")[0].GetProperty("rounds")[0].GetProperty("entries")[1].GetProperty("deckArchetype").GetString());
        using var archetype = await SendJsonAsync(HttpMethod.Patch, "/api/leagues/command-league/tournaments/tournament-1/archetypes/Carol", new { archetype = "Sky" }, "Organizer", ifMatch: edited.Headers.ETag!.Tag);
        Assert.Contains((await Body(archetype)).GetProperty("tournaments")[0].GetProperty("playerArchetypes").EnumerateArray(), item => item.GetProperty("playerName").GetString() == "Carol" && item.GetProperty("archetype").GetString() == "Sky");
        using var renamed = await SendJsonAsync(HttpMethod.Post, "/api/leagues/command-league/players/rename", new { fromName = "Alice", toName = "Alicia" }, "Organizer", ifMatch: archetype.Headers.ETag!.Tag);
        Assert.Equal("Alicia", (await Body(renamed)).GetProperty("tournaments")[0].GetProperty("rounds")[0].GetProperty("entries")[0].GetProperty("player1Name").GetString());
        using var deleted = await SendJsonAsync(HttpMethod.Delete, $"{entryRoute}/{entryId}", new { }, "Organizer", ifMatch: renamed.Headers.ETag!.Tag);
        Assert.Single((await Body(deleted)).GetProperty("tournaments")[0].GetProperty("rounds")[0].GetProperty("entries").EnumerateArray());
    }

    [Fact]
    public async Task League_and_Full_Data_restore_remap_all_ids_names_enforce_roles_and_redact_audit()
    {
        var source = FixtureLeague("command-league", "Command League");
        var leagueExport = new { kind = "league", gonesDataVersion = 3, league = source };
        using var restored = await SendJsonAsync(HttpMethod.Post, "/api/leagues/restore", leagueExport, "Organizer", key: "restore-one");
        Assert.Equal(HttpStatusCode.Created, restored.StatusCode);
        var restoredBody = await Body(restored);
        Assert.NotEqual(source.Id, restoredBody.GetProperty("id").GetString());
        Assert.Equal("Command League (restored)", restoredBody.GetProperty("name").GetString());
        Assert.NotEqual(source.Tournaments[0].Id, restoredBody.GetProperty("tournaments")[0].GetProperty("id").GetString());
        Assert.NotEqual(source.Tournaments[0].Rounds[0].Id, restoredBody.GetProperty("tournaments")[0].GetProperty("rounds")[0].GetProperty("id").GetString());
        Assert.NotEqual(source.Tournaments[0].Rounds[0].Entries[0].Id, restoredBody.GetProperty("tournaments")[0].GetProperty("rounds")[0].GetProperty("entries")[0].GetProperty("id").GetString());
        using var replay = await SendJsonAsync(HttpMethod.Post, "/api/leagues/restore", leagueExport, "Organizer", key: "restore-one");
        Assert.Equal(restoredBody.GetProperty("id").GetString(), (await Body(replay)).GetProperty("id").GetString());

        var fullExport = new { kind = "fullData", gonesDataVersion = 3, leagues = new[] { source } };
        using var forbidden = await SendJsonAsync(HttpMethod.Post, "/api/leagues/restore-full", fullExport, "Organizer", key: "restore-full-organizer");
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
        using var full = await SendJsonAsync(HttpMethod.Post, "/api/leagues/restore-full", fullExport, "Admin", key: "restore-full-admin");
        Assert.Equal(HttpStatusCode.Created, full.StatusCode);

        await using var database = CreateContext();
        var ids = await database.LeagueAggregates.Select(item => item.DocumentId).ToListAsync();
        Assert.Equal(ids.Count, ids.Distinct(StringComparer.Ordinal).Count());
        var audits = await database.AuditRecords.Where(item => item.Action.StartsWith("league.")).ToListAsync();
        Assert.NotEmpty(audits);
        Assert.All(audits, audit =>
        {
            Assert.DoesNotContain("Alice", audit.RedactedDiff, StringComparison.Ordinal);
            Assert.DoesNotContain("Command League", audit.RedactedDiff, StringComparison.Ordinal);
            Assert.DoesNotContain("canonicalDocument", audit.RedactedDiff, StringComparison.OrdinalIgnoreCase);
        });
    }

    private async Task<HttpResponseMessage> SendJsonAsync(HttpMethod method, string path, object body, string? role, string? key = null, string? ifMatch = null, string? targetIfMatch = null)
    {
        var request = new HttpRequestMessage(method, path)
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json")
        };
        if (role is not null)
        {
            request.Headers.TryAddWithoutValidation("X-Test-User", Actor.ToString("D"));
            request.Headers.TryAddWithoutValidation("X-Test-Roles", role);
        }
        if (key is not null) request.Headers.TryAddWithoutValidation("Idempotency-Key", key);
        if (ifMatch is not null) request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        if (targetIfMatch is not null) request.Headers.TryAddWithoutValidation("Target-If-Match", targetIfMatch);
        return await Client.SendAsync(request);
    }

    private static async Task<JsonElement> Body(HttpResponseMessage response) => await response.Content.ReadFromJsonAsync<JsonElement>();

    private static async Task AssertProblem(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal(code, (await Body(response)).GetProperty("code").GetString());
    }

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(postgres.GetConnectionString()).Options);

    private static LeagueDocument FixtureLeague(string id, string name) => new(
        id,
        name,
        "active",
        [new TournamentDocument("tournament-1", id, "Result Tournament", "2030-01-01",
            [new RoundDocument("round-1", [new MatchRoundEntry("entry-1", "1", "Alice", "Bob", 2, 1, "Tempo", "Control")])],
            [new PlayerArchetypeDocument("Alice", "Tempo"), new PlayerArchetypeDocument("Bob", "Control")])]);

    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");
}
