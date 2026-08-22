using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Gones.Application.Concurrency;
using Gones.Domain.Archive;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.IntegrationTests;

public sealed class ArchiveCommandApiTests : IAsyncLifetime
{
    private static readonly Guid Actor = Guid.Parse("10000000-0000-0000-0000-000000000003");
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
                UserName = "archive-command-actor",
                NormalizedUserName = "ARCHIVE-COMMAND-ACTOR",
                Email = "archive-command-actor@example.test",
                NormalizedEmail = "ARCHIVE-COMMAND-ACTOR@EXAMPLE.TEST",
                SecurityStamp = Guid.NewGuid().ToString("N"),
                ConcurrencyStamp = Guid.NewGuid().ToString("N")
            });
            var seeded = Instant.FromUtc(2026, 1, 1, 12, 0);
            database.ArchiveLeagues.Add(ArchiveLeague.Create("league-alpha", "Alpha", seeded));
            database.ArchiveLeagues.Add(ArchiveLeague.Create("league-beta", "Beta", seeded));
            database.ArchiveLeagueSeasons.Add(ArchiveLeagueSeason.Create("season-alpha", "league-alpha", "Alpha 2026", "active", seeded));
            database.ArchiveLeagueSeasons.Add(ArchiveLeagueSeason.Create("season-beta", "league-beta", "Beta 2026", "active", seeded));
            await database.SaveChangesAsync();
            // Raw SQL on purpose: the Tournament write surface belongs to T4, so this suite never
            // touches the ArchiveTournament aggregate. The stored documents repeat id, name, status and
            // seasonId because ck_archive_tournament_document_metadata rejects a row whose envelope
            // columns and document disagree, and they travel as parameters because a JSON brace inside
            // a raw SQL string is read as a format placeholder.
            const string attachedDocument = """
                {"id":"tournament-attached","name":"Attached","seasonId":"season-alpha","tournamentDate":"2026-05-01","status":"completed","rounds":[],"playerArchetypes":[]}
                """;
            const string standaloneDocument = """
                {"id":"tournament-standalone","name":"Standalone","tournamentDate":"2026-06-01","status":"completed","rounds":[],"playerArchetypes":[]}
                """;
            const string deletedDocument = """
                {"id":"tournament-deleted","name":"Deleted","seasonId":"season-alpha","tournamentDate":"2026-04-01","status":"completed","rounds":[],"playerArchetypes":[]}
                """;
            await database.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO archive_tournaments
                  (document_id, season_id, name, tournament_date, status, document, updated_at, version, deleted_at, player_count, counts_version)
                VALUES
                  ('tournament-attached', 'season-alpha', 'Attached', DATE '2026-05-01', 'completed',
                   {attachedDocument}::jsonb, TIMESTAMPTZ '2026-05-01T12:00:00Z', 1, NULL, 0, 0),
                  ('tournament-standalone', NULL, 'Standalone', DATE '2026-06-01', 'completed',
                   {standaloneDocument}::jsonb, TIMESTAMPTZ '2026-06-01T12:00:00Z', 1, NULL, 0, 0),
                  ('tournament-deleted', 'season-alpha', 'Deleted', DATE '2026-04-01', 'completed',
                   {deletedDocument}::jsonb, TIMESTAMPTZ '2026-04-01T12:00:00Z', 1, TIMESTAMPTZ '2026-04-15T12:00:00Z', 0, 0)
                """);
        }
        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "t3-archive-command-signing-key-value");
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
    public async Task Archive_League_create_is_organizer_gated_and_returns_a_versioned_ETag()
    {
        using var anonymous = await SendJsonAsync(HttpMethod.Post, "/api/archive/leagues", new { name = "Anonymous" }, role: null);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        using var user = await SendJsonAsync(HttpMethod.Post, "/api/archive/leagues", new { name = "User" }, "User");
        await AssertProblem(user, HttpStatusCode.Forbidden, "forbidden");

        using var created = await SendJsonAsync(HttpMethod.Post, "/api/archive/leagues", new { name = "  Nouvelle Ligue  " }, "Organizer");
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var body = await Body(created);
        var id = body.GetProperty("id").GetString()!;
        Assert.Equal($"/api/archive/leagues/{id}", created.Headers.Location!.ToString());
        Assert.Equal(StrongETag.Encode(1), created.Headers.ETag!.Tag);
        Assert.Equal(1, body.GetProperty("documentVersion").GetInt32());
        Assert.Equal(created.Headers.ETag!.Tag, body.GetProperty("eTag").GetString());

        await using var database = CreateContext();
        var league = await database.ArchiveLeagues.AsNoTracking().SingleAsync(item => item.DocumentId == id);
        Assert.Equal("Nouvelle Ligue", league.Name);
        Assert.Equal(league.CreatedAt, league.UpdatedAt);
    }

    [Fact]
    public async Task Archive_League_rename_bumps_one_version_and_refuses_a_stale_If_Match()
    {
        using var missingIfMatch = await SendJsonAsync(HttpMethod.Patch, "/api/archive/leagues/league-alpha/name", new { name = "Alpha Renamed" }, "Organizer");
        await AssertProblem(missingIfMatch, HttpStatusCode.PreconditionFailed, "stale_version");
        using var staleIfMatch = await SendJsonAsync(HttpMethod.Patch, "/api/archive/leagues/league-alpha/name", new { name = "Alpha Renamed" }, "Organizer", ifMatch: StrongETag.Encode(99));
        await AssertProblem(staleIfMatch, HttpStatusCode.PreconditionFailed, "stale_version");

        using var renamed = await SendJsonAsync(HttpMethod.Patch, "/api/archive/leagues/league-alpha/name", new { name = "Alpha Renamed" }, "Organizer", ifMatch: StrongETag.Encode(1));
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);
        var body = await Body(renamed);
        Assert.Equal(2, body.GetProperty("documentVersion").GetInt32());
        Assert.Equal(StrongETag.Encode(2), renamed.Headers.ETag!.Tag);
        Assert.Equal(StrongETag.Encode(2), body.GetProperty("eTag").GetString());
        await using (var database = CreateContext())
        {
            Assert.Equal("Alpha Renamed", (await database.ArchiveLeagues.AsNoTracking().SingleAsync(item => item.DocumentId == "league-alpha")).Name);
        }

        using var missingLeague = await SendJsonAsync(HttpMethod.Patch, "/api/archive/leagues/missing-league/name", new { name = "Ghost" }, "Organizer", ifMatch: StrongETag.Encode(1));
        await AssertProblem(missingLeague, HttpStatusCode.NotFound, "not_found");
    }

    [Fact]
    public async Task Archive_League_delete_is_refused_while_a_League_Season_still_references_it()
    {
        using var refused = await SendJsonAsync(HttpMethod.Delete, "/api/archive/leagues/league-alpha", new { }, "Organizer", ifMatch: StrongETag.Encode(1));
        await AssertProblem(refused, HttpStatusCode.Conflict, "archive_league_not_empty");
        await using (var database = CreateContext())
        {
            var blocked = await database.ArchiveLeagues.AsNoTracking().SingleAsync(item => item.DocumentId == "league-alpha");
            Assert.Null(blocked.DeletedAt);
            Assert.Equal(1, blocked.Version);
        }

        using var seasonDeleted = await SendJsonAsync(HttpMethod.Delete, "/api/archive/league-seasons/season-alpha", new { }, "Organizer", ifMatch: StrongETag.Encode(1));
        Assert.Equal(HttpStatusCode.OK, seasonDeleted.StatusCode);

        using var deleted = await SendJsonAsync(HttpMethod.Delete, "/api/archive/leagues/league-alpha", new { }, "Organizer", ifMatch: StrongETag.Encode(1));
        Assert.Equal(HttpStatusCode.OK, deleted.StatusCode);
        var body = await Body(deleted);
        Assert.True(body.GetProperty("deleted").GetBoolean());
        Assert.Equal(2, body.GetProperty("documentVersion").GetInt32());
        Assert.Equal(StrongETag.Encode(2), deleted.Headers.ETag!.Tag);
        await using (var database = CreateContext())
        {
            Assert.NotNull((await database.ArchiveLeagues.AsNoTracking().SingleAsync(item => item.DocumentId == "league-alpha")).DeletedAt);
        }

        using var again = await SendJsonAsync(HttpMethod.Delete, "/api/archive/leagues/league-alpha", new { }, "Organizer", ifMatch: StrongETag.Encode(2));
        await AssertProblem(again, HttpStatusCode.NotFound, "not_found");
    }

    [Fact]
    public async Task Archive_League_Season_create_requires_a_live_parent_League_and_defaults_to_active()
    {
        using var orphan = await SendJsonAsync(HttpMethod.Post, "/api/archive/league-seasons", new { leagueId = "missing-league", name = "X" }, "Organizer");
        await AssertProblem(orphan, HttpStatusCode.NotFound, "not_found");

        using var created = await SendJsonAsync(HttpMethod.Post, "/api/archive/league-seasons", new { leagueId = "league-alpha", name = "  Saison 2027  " }, "Organizer");
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var createdId = (await Body(created)).GetProperty("id").GetString()!;
        Assert.Equal($"/api/archive/league-seasons/{createdId}", created.Headers.Location!.ToString());

        using var completed = await SendJsonAsync(HttpMethod.Post, "/api/archive/league-seasons", new { leagueId = "league-alpha", name = "Saison 2028", status = "completed" }, "Organizer");
        Assert.Equal(HttpStatusCode.Created, completed.StatusCode);
        var completedId = (await Body(completed)).GetProperty("id").GetString()!;

        using var badStatus = await SendJsonAsync(HttpMethod.Post, "/api/archive/league-seasons", new { leagueId = "league-alpha", name = "Bad", status = "archived" }, "Organizer");
        await AssertProblem(badStatus, HttpStatusCode.BadRequest, "validation_failed");

        await using var database = CreateContext();
        var defaulted = await database.ArchiveLeagueSeasons.AsNoTracking().SingleAsync(item => item.DocumentId == createdId);
        Assert.Equal("Saison 2027", defaulted.Name);
        Assert.Equal("active", defaulted.Status);
        Assert.Equal(1, defaulted.Version);
        Assert.Equal("league-alpha", defaulted.LeagueId);
        Assert.Equal("completed", (await database.ArchiveLeagueSeasons.AsNoTracking().SingleAsync(item => item.DocumentId == completedId)).Status);
    }

    [Fact]
    public async Task Archive_League_Season_rename_status_and_re_parent_each_bump_exactly_one_version()
    {
        using var renamed = await SendJsonAsync(HttpMethod.Patch, "/api/archive/league-seasons/season-alpha/name", new { name = "Alpha 2026 Renamed" }, "Organizer", ifMatch: StrongETag.Encode(1));
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);
        Assert.Equal(2, (await Body(renamed)).GetProperty("documentVersion").GetInt32());

        using var statusChanged = await SendJsonAsync(HttpMethod.Patch, "/api/archive/league-seasons/season-alpha/status", new { status = "completed" }, "Organizer", ifMatch: StrongETag.Encode(2));
        Assert.Equal(HttpStatusCode.OK, statusChanged.StatusCode);
        Assert.Equal(3, (await Body(statusChanged)).GetProperty("documentVersion").GetInt32());

        using var moved = await SendJsonAsync(HttpMethod.Patch, "/api/archive/league-seasons/season-alpha/league", new { leagueId = "league-beta" }, "Organizer", ifMatch: StrongETag.Encode(3));
        Assert.Equal(HttpStatusCode.OK, moved.StatusCode);
        Assert.Equal(4, (await Body(moved)).GetProperty("documentVersion").GetInt32());

        using var movedNowhere = await SendJsonAsync(HttpMethod.Patch, "/api/archive/league-seasons/season-alpha/league", new { leagueId = "missing-league" }, "Organizer", ifMatch: StrongETag.Encode(4));
        await AssertProblem(movedNowhere, HttpStatusCode.NotFound, "not_found");

        await using var database = CreateContext();
        var season = await database.ArchiveLeagueSeasons.AsNoTracking().SingleAsync(item => item.DocumentId == "season-alpha");
        Assert.Equal("league-beta", season.LeagueId);
        Assert.Equal("completed", season.Status);
        Assert.Equal(4, season.Version);
        // Concurrency is per row: neither the League the Season left nor the one it joined moves.
        Assert.Equal(1, (await database.ArchiveLeagues.AsNoTracking().SingleAsync(item => item.DocumentId == "league-alpha")).Version);
        Assert.Equal(1, (await database.ArchiveLeagues.AsNoTracking().SingleAsync(item => item.DocumentId == "league-beta")).Version);
    }

    [Fact]
    public async Task Archive_League_Season_delete_detaches_its_Tournaments_and_never_deletes_them()
    {
        using var deleted = await SendJsonAsync(HttpMethod.Delete, "/api/archive/league-seasons/season-alpha", new { }, "Organizer", ifMatch: StrongETag.Encode(1));
        Assert.Equal(HttpStatusCode.OK, deleted.StatusCode);
        var body = await Body(deleted);
        Assert.True(body.GetProperty("deleted").GetBoolean());
        Assert.Equal(2, body.GetProperty("documentVersion").GetInt32());

        await using var database = CreateContext();
        Assert.Equal(3, await database.Database.SqlQueryRaw<int>("SELECT count(*)::int AS \"Value\" FROM archive_tournaments").SingleAsync());

        var attached = await TournamentRowAsync("tournament-attached");
        Assert.Null(attached.SeasonId);
        // The envelope column and the stored document detach together, or
        // ck_archive_tournament_document_metadata would have aborted the write.
        Assert.Null(attached.DocumentSeasonId);
        Assert.Equal(2, attached.Version);
        Assert.True(attached.UpdatedAt > Instant.FromUtc(2026, 5, 1, 12, 0));
        var standalone = await TournamentRowAsync("tournament-standalone");
        Assert.Null(standalone.SeasonId);
        Assert.Equal(1, standalone.Version);
        // An already soft-deleted Tournament keeps its historical Season: the detach is scoped to
        // deleted_at IS NULL, so a tombstone never loses the provenance it recorded.
        var alreadyDeleted = await TournamentRowAsync("tournament-deleted");
        Assert.Equal("season-alpha", alreadyDeleted.SeasonId);
        Assert.Equal("season-alpha", alreadyDeleted.DocumentSeasonId);
        Assert.Equal(1, alreadyDeleted.Version);

        Assert.NotNull((await database.ArchiveLeagueSeasons.AsNoTracking().SingleAsync(item => item.DocumentId == "season-alpha")).DeletedAt);
        Assert.Equal(1, (await database.ArchiveLeagues.AsNoTracking().SingleAsync(item => item.DocumentId == "league-alpha")).Version);
    }

    [Fact]
    public async Task Archive_commands_reject_blank_and_over_long_names()
    {
        using var blank = await SendJsonAsync(HttpMethod.Post, "/api/archive/leagues", new { name = "   " }, "Organizer");
        await AssertProblem(blank, HttpStatusCode.BadRequest, "validation_failed");
        using var overLong = await SendJsonAsync(HttpMethod.Post, "/api/archive/leagues", new { name = new string('x', 201) }, "Organizer");
        await AssertProblem(overLong, HttpStatusCode.BadRequest, "validation_failed");
        using var emptyRename = await SendJsonAsync(HttpMethod.Patch, "/api/archive/leagues/league-alpha/name", new { name = "" }, "Organizer", ifMatch: StrongETag.Encode(1));
        await AssertProblem(emptyRename, HttpStatusCode.BadRequest, "validation_failed");
        using var blankLeagueId = await SendJsonAsync(HttpMethod.Post, "/api/archive/league-seasons", new { leagueId = " ", name = "x" }, "Organizer");
        await AssertProblem(blankLeagueId, HttpStatusCode.BadRequest, "validation_failed");

        await using var database = CreateContext();
        Assert.Equal(1, (await database.ArchiveLeagues.AsNoTracking().SingleAsync(item => item.DocumentId == "league-alpha")).Version);
        Assert.Equal(2, await database.ArchiveLeagues.CountAsync());
    }

    [Fact]
    public async Task Archive_command_concurrency_lets_exactly_one_of_two_racing_renames_win()
    {
        var first = SendJsonAsync(HttpMethod.Patch, "/api/archive/leagues/league-beta/name", new { name = "Winner A" }, "Organizer", ifMatch: StrongETag.Encode(1));
        var second = SendJsonAsync(HttpMethod.Patch, "/api/archive/leagues/league-beta/name", new { name = "Winner B" }, "Organizer", ifMatch: StrongETag.Encode(1));
        using var responseA = await first;
        using var responseB = await second;

        Assert.Equal(1, new[] { responseA, responseB }.Count(item => item.StatusCode == HttpStatusCode.OK));
        Assert.Equal(1, new[] { responseA, responseB }.Count(item => item.StatusCode == HttpStatusCode.PreconditionFailed));
        var loser = responseA.StatusCode == HttpStatusCode.PreconditionFailed ? responseA : responseB;
        Assert.Equal("stale_version", (await Body(loser)).GetProperty("code").GetString());

        await using var database = CreateContext();
        Assert.Equal(2, (await database.ArchiveLeagues.AsNoTracking().SingleAsync(item => item.DocumentId == "league-beta")).Version);
    }

    [Fact]
    public async Task Archive_commands_refuse_a_plain_User_on_every_route()
    {
        var ifMatch = StrongETag.Encode(1);
        (HttpMethod Method, string Path, object Body, string? IfMatch)[] routes =
        [
            (HttpMethod.Post, "/api/archive/leagues", new { name = "Nope" }, null),
            (HttpMethod.Patch, "/api/archive/leagues/league-alpha/name", new { name = "Nope" }, ifMatch),
            (HttpMethod.Delete, "/api/archive/leagues/league-alpha", new { }, ifMatch),
            (HttpMethod.Post, "/api/archive/league-seasons", new { leagueId = "league-alpha", name = "Nope" }, null),
            (HttpMethod.Patch, "/api/archive/league-seasons/season-alpha/name", new { name = "Nope" }, ifMatch),
            (HttpMethod.Patch, "/api/archive/league-seasons/season-alpha/status", new { status = "completed" }, ifMatch),
            (HttpMethod.Patch, "/api/archive/league-seasons/season-alpha/league", new { leagueId = "league-beta" }, ifMatch),
            (HttpMethod.Delete, "/api/archive/league-seasons/season-alpha", new { }, ifMatch)
        ];

        foreach (var (method, path, body, routeIfMatch) in routes)
        {
            using var response = await SendJsonAsync(method, path, body, "User", ifMatch: routeIfMatch);
            await AssertProblem(response, HttpStatusCode.Forbidden, "forbidden");
        }

        await using var database = CreateContext();
        Assert.Equal(1, (await database.ArchiveLeagues.AsNoTracking().SingleAsync(item => item.DocumentId == "league-alpha")).Version);
        Assert.Equal(1, (await database.ArchiveLeagueSeasons.AsNoTracking().SingleAsync(item => item.DocumentId == "season-alpha")).Version);
    }

    [Fact]
    public async Task Archive_commands_audit_the_actor_without_leaking_names()
    {
        using var created = await SendJsonAsync(HttpMethod.Post, "/api/archive/leagues", new { name = "Secret Ligue" }, "Organizer");
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var renamed = await SendJsonAsync(HttpMethod.Patch, "/api/archive/leagues/league-alpha/name", new { name = "Also Secret" }, "Organizer", ifMatch: StrongETag.Encode(1));
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);

        await using var database = CreateContext();
        var audits = await database.AuditRecords.AsNoTracking().Where(item => item.EntityType == "archiveLeague").ToListAsync();
        Assert.Contains(audits, audit => audit.Action == "archive.league.created");
        Assert.Contains(audits, audit => audit.Action == "archive.league.renamed");
        Assert.All(audits, audit =>
        {
            Assert.Equal(Actor, audit.ActorId);
            Assert.DoesNotContain("Secret Ligue", audit.RedactedDiff, StringComparison.Ordinal);
            Assert.DoesNotContain("Also Secret", audit.RedactedDiff, StringComparison.Ordinal);
        });
    }

    private async Task<HttpResponseMessage> SendJsonAsync(HttpMethod method, string path, object body, string? role, string? ifMatch = null)
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
        if (ifMatch is not null) request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        return await Client.SendAsync(request);
    }

    private static async Task<JsonElement> Body(HttpResponseMessage response) => await response.Content.ReadFromJsonAsync<JsonElement>();

    private static async Task AssertProblem(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal(code, (await Body(response)).GetProperty("code").GetString());
    }

    /// <summary>
    /// Reads a Tournament row without touching the <c>ArchiveTournament</c> aggregate, whose write
    /// surface belongs to T4. <c>version</c> is <c>integer</c>, so it is read with <c>GetInt32</c>.
    /// </summary>
    private async Task<(int Version, string? SeasonId, string? DocumentSeasonId, Instant UpdatedAt)> TournamentRowAsync(string documentId)
    {
        await using var database = CreateContext();
        var connection = database.Database.GetDbConnection();
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT version, season_id, document ->> 'seasonId', updated_at FROM archive_tournaments WHERE document_id = @documentId";
        var parameter = command.CreateParameter();
        parameter.ParameterName = "documentId";
        parameter.Value = documentId;
        command.Parameters.Add(parameter);
        await using var reader = await command.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        return (
            reader.GetInt32(0),
            reader.IsDBNull(1) ? null : reader.GetString(1),
            reader.IsDBNull(2) ? null : reader.GetString(2),
            reader.GetFieldValue<Instant>(3));
    }

    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(postgres.GetConnectionString()).Options);
}
