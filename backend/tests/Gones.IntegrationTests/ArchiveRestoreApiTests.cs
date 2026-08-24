using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Gones.Domain.Archive;
using Gones.Domain.Leagues;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.IntegrationTests;

/// <summary>
/// The archive bundle restore pair. Restore mints brand-new IDs for every tier and is deliberately
/// exempt from the 365-day lock: bulk-importing years of historical results is the archive's core
/// workflow, and it rewrites no protected row.
/// </summary>
public sealed class ArchiveRestoreApiTests : IAsyncLifetime
{
    private static readonly Guid Actor = Guid.Parse("10000000-0000-0000-0000-000000000006");
    private static readonly LocalDate Today = SystemClock.Instance.GetCurrentInstant().InUtc().Date;
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
                UserName = "archive-restore-actor",
                NormalizedUserName = "ARCHIVE-RESTORE-ACTOR",
                Email = "archive-restore-actor@example.test",
                NormalizedEmail = "ARCHIVE-RESTORE-ACTOR@EXAMPLE.TEST",
                SecurityStamp = Guid.NewGuid().ToString("N"),
                ConcurrencyStamp = Guid.NewGuid().ToString("N")
            });
            await database.SaveChangesAsync();
        }
        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "t4-archive-restore-signing-key");
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
    public async Task Archive_restore_remaps_every_id_and_rewires_the_tier_links()
    {
        using var response = await SendAsync("/api/archive/restore", Bundle("archive"), "Organizer", "remap");

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await Body(response);
        var league = body.GetProperty("leagues")[0];
        var season = body.GetProperty("leagueSeasons")[0];
        var tournaments = body.GetProperty("tournaments").EnumerateArray().ToArray();
        Assert.Equal("source-league", league.GetProperty("sourceId").GetString());
        Assert.NotEqual("source-league", league.GetProperty("id").GetString());
        Assert.NotEqual("source-season", season.GetProperty("id").GetString());
        Assert.All(tournaments, item => Assert.NotEqual(item.GetProperty("sourceId").GetString(), item.GetProperty("id").GetString()));
        Assert.Equal(1, league.GetProperty("documentVersion").GetInt32());

        await using var database = CreateContext();
        var storedLeague = await database.ArchiveLeagues.AsNoTracking().SingleAsync();
        var storedSeason = await database.ArchiveLeagueSeasons.AsNoTracking().SingleAsync();
        Assert.Equal(storedLeague.DocumentId, storedSeason.LeagueId);
        Assert.Equal(league.GetProperty("id").GetString(), storedLeague.DocumentId);

        var attached = await database.ArchiveTournaments.AsNoTracking().SingleAsync(item => item.Name == "Manche attachée");
        var standalone = await database.ArchiveTournaments.AsNoTracking().SingleAsync(item => item.Name == "Manche isolée");
        Assert.Equal(storedSeason.DocumentId, attached.SeasonId);
        Assert.Null(standalone.SeasonId);
        Assert.Null(standalone.ReadDocument().SeasonId);

        var round = attached.ReadDocument().Rounds.Single();
        Assert.NotEqual("source-round", round.Id);
        Assert.NotEqual("source-entry", round.Entries.Single().Id);
        Assert.True(Guid.TryParseExact(round.Id, "D", out _), round.Id);
        Assert.True(Guid.TryParseExact(round.Entries.Single().Id, "D", out _), round.Entries.Single().Id);
    }

    [Fact]
    public async Task Archive_restore_stamps_the_restored_Season_counters()
    {
        using var response = await SendAsync("/api/archive/restore", Bundle("archive"), "Organizer", "counters");
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        await using var database = CreateContext();
        var season = await database.ArchiveLeagueSeasons.AsNoTracking().SingleAsync();
        Assert.Equal(1, season.TournamentCount);
        Assert.Equal(2, season.PlayerCount);
        Assert.NotNull(season.FirstTournamentDate);
        Assert.NotNull(season.LastTournamentDate);
        Assert.Equal(ArchiveCatalogCounts.Version, season.CountsVersion);
        Assert.Equal(1, season.Version);
    }

    [Fact]
    public async Task Archive_restore_rebuilds_the_scoped_player_statistics()
    {
        using var response = await SendAsync("/api/archive/restore", Bundle("archive"), "Organizer", "statistics");
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await Body(response);
        var leagueId = body.GetProperty("leagues")[0].GetProperty("id").GetString()!;
        var seasonId = body.GetProperty("leagueSeasons")[0].GetProperty("id").GetString()!;

        await using var database = CreateContext();
        var rows = await database.PlayerStatistics.AsNoTracking().ToListAsync();
        Assert.Equal(
            [("global", ""), ("league", leagueId), ("season", seasonId)],
            rows.Select(row => (row.ScopeKind, row.ScopeId))
                .Distinct()
                .OrderBy(scope => scope.ScopeKind, StringComparer.Ordinal)
                .ToArray());
        // Only the attached Tournament carries a Match; the standalone one is a bye, and a player with
        // no rated Match never gets a row.
        foreach (var (scopeKind, scopeId) in rows.Select(row => (row.ScopeKind, row.ScopeId)).Distinct())
        {
            Assert.Equal(
                ["Alice", "Bob"],
                rows.Where(row => row.ScopeKind == scopeKind && row.ScopeId == scopeId)
                    .Select(row => row.PlayerName)
                    .Order(StringComparer.Ordinal)
                    .ToArray());
        }
    }

    [Fact]
    public async Task Archive_restore_refuses_a_bundle_that_is_not_version_5()
    {
        using var response = await SendAsync("/api/archive/restore", Bundle("archive") with { Version = 4 }, "Organizer", "v4");

        await AssertProblem(response, HttpStatusCode.BadRequest, "validation_failed");
        await AssertEmptyArchiveAsync();
    }

    [Fact]
    public async Task Archive_restore_refuses_a_wrong_kind()
    {
        using var response = await SendAsync("/api/archive/restore", Bundle("fullArchive"), "Organizer", "wrong-kind");

        await AssertProblem(response, HttpStatusCode.BadRequest, "validation_failed");
        await AssertEmptyArchiveAsync();
    }

    [Fact]
    public async Task Archive_restore_refuses_a_dangling_season_link()
    {
        var bundle = Bundle("archive");
        using var response = await SendAsync(
            "/api/archive/restore",
            bundle with { Tournaments = [bundle.Tournaments[0] with { SeasonId = "no-such-season" }] },
            "Organizer",
            "dangling");

        await AssertProblem(response, HttpStatusCode.BadRequest, "validation_failed");
        await AssertEmptyArchiveAsync();
    }

    [Fact]
    public async Task Archive_restore_refuses_a_Tournament_with_no_Rounds_array()
    {
        var bundle = Bundle("archive");
        using var response = await SendAsync(
            "/api/archive/restore",
            bundle with { Tournaments = [bundle.Tournaments[0] with { Rounds = null! }] },
            "Organizer",
            "no-rounds");

        await AssertProblem(response, HttpStatusCode.BadRequest, "validation_failed");
        await AssertEmptyArchiveAsync();
    }

    [Fact]
    public async Task Archive_restore_uniquifies_a_colliding_League_and_Season_name()
    {
        using var first = await SendAsync("/api/archive/restore", Bundle("archive"), "Organizer", "unique-1");
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        using var second = await SendAsync("/api/archive/restore", Bundle("archive"), "Organizer", "unique-2");
        Assert.Equal(HttpStatusCode.Created, second.StatusCode);

        var body = await Body(second);
        Assert.Equal("Ligue source (restored)", body.GetProperty("leagues")[0].GetProperty("name").GetString());
        Assert.Equal("Saison source (restored)", body.GetProperty("leagueSeasons")[0].GetProperty("name").GetString());

        await using var database = CreateContext();
        Assert.Equal(2, await database.ArchiveLeagues.CountAsync());
        Assert.Equal(2, await database.ArchiveLeagueSeasons.CountAsync());
    }

    [Fact]
    public async Task Archive_restore_is_exempt_from_the_365_day_lock()
    {
        var bundle = Bundle("archive");
        using var response = await SendAsync(
            "/api/archive/restore",
            bundle with { Tournaments = [.. bundle.Tournaments.Select(item => item with { TournamentDate = Iso(Today.PlusDays(-1000)) })] },
            "Organizer",
            "historical");

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        await using var database = CreateContext();
        Assert.Equal(2, await database.ArchiveTournaments.CountAsync());
    }

    [Fact]
    public async Task Archive_restore_full_requires_Admin()
    {
        using var organizer = await SendAsync("/api/archive/restore-full", Bundle("fullArchive"), "Organizer", "full-1");
        await AssertProblem(organizer, HttpStatusCode.Forbidden, "forbidden");
        await AssertEmptyArchiveAsync();

        using var admin = await SendAsync("/api/archive/restore-full", Bundle("fullArchive"), "Admin", "full-2");
        Assert.Equal(HttpStatusCode.Created, admin.StatusCode);
        await using var database = CreateContext();
        Assert.Equal(1, await database.ArchiveLeagues.CountAsync());
    }

    [Fact]
    public async Task Archive_restore_replays_by_Idempotency_Key()
    {
        using var first = await SendAsync("/api/archive/restore", Bundle("archive"), "Organizer", "replay");
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        using var replay = await SendAsync("/api/archive/restore", Bundle("archive"), "Organizer", "replay");
        Assert.Equal(HttpStatusCode.Created, replay.StatusCode);
        Assert.Equal(
            (await Body(first)).GetProperty("leagues")[0].GetProperty("id").GetString(),
            (await Body(replay)).GetProperty("leagues")[0].GetProperty("id").GetString());

        var different = Bundle("archive");
        using var conflicting = await SendAsync(
            "/api/archive/restore",
            different with { Leagues = [different.Leagues[0] with { Name = "Autre ligue" }] },
            "Organizer",
            "replay");
        await AssertProblem(conflicting, HttpStatusCode.Conflict, "idempotency_conflict");

        await using var database = CreateContext();
        Assert.Equal(1, await database.ArchiveLeagues.CountAsync());
    }

    [Fact]
    public async Task Archive_restore_refuses_an_oversized_bundle()
    {
        var bundle = Bundle("fullArchive");
        using var response = await SendAsync(
            "/api/archive/restore-full",
            bundle with
            {
                Leagues = [.. Enumerable.Range(0, 101).Select(index => new ArchiveLeagueDocument($"source-league-{index}", $"Ligue {index}", Iso(Today)))],
                LeagueSeasons = [],
                Tournaments = []
            },
            "Admin",
            "oversized");

        await AssertProblem(response, HttpStatusCode.BadRequest, "validation_failed");
        await AssertEmptyArchiveAsync();
    }

    private static ArchiveRestoreBundle Bundle(string kind) => new(
        kind,
        5,
        [new ArchiveLeagueDocument("source-league", "Ligue source", Iso(Today))],
        [new ArchiveLeagueSeasonDocument("source-season", "Saison source", "source-league", "completed")],
        [
            new ArchiveTournamentDocument(
                "source-tournament-attached",
                "Manche attachée",
                "source-season",
                Iso(Today.PlusDays(-30)),
                "completed",
                [new RoundDocument("source-round", [new MatchRoundEntry("source-entry", "1", "Alice", "Bob", 2, 1, "Tempo", "Control")])],
                []),
            new ArchiveTournamentDocument(
                "source-tournament-standalone",
                "Manche isolée",
                null,
                Iso(Today.PlusDays(-20)),
                "completed",
                [new RoundDocument("source-round-2", [new ByeRoundEntry("source-entry-2", "1", "Carol", "Aggro")])],
                [])
        ]);

    /// <summary>Mirrors the wire shape of the endpoint's request record without depending on an internal type.</summary>
    private sealed record ArchiveRestoreBundle(
        string Kind,
        int Version,
        IReadOnlyList<ArchiveLeagueDocument> Leagues,
        IReadOnlyList<ArchiveLeagueSeasonDocument> LeagueSeasons,
        IReadOnlyList<ArchiveTournamentDocument> Tournaments);

    private static string Iso(LocalDate date) => ArchiveTournamentCommands.FormatDate(date);

    private async Task AssertEmptyArchiveAsync()
    {
        await using var database = CreateContext();
        Assert.Equal(0, await database.ArchiveLeagues.CountAsync());
        Assert.Equal(0, await database.ArchiveLeagueSeasons.CountAsync());
        Assert.Equal(0, await database.ArchiveTournaments.CountAsync());
    }

    private async Task<HttpResponseMessage> SendAsync(string path, ArchiveRestoreBundle bundle, string role, string key)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = new StringContent(LeagueJson.Serialize(bundle), Encoding.UTF8, "application/json")
        };
        request.Headers.TryAddWithoutValidation("X-Test-User", Actor.ToString("D"));
        request.Headers.TryAddWithoutValidation("X-Test-Roles", role);
        request.Headers.TryAddWithoutValidation("Idempotency-Key", key);
        return await Client.SendAsync(request);
    }

    private static async Task<JsonElement> Body(HttpResponseMessage response) => await response.Content.ReadFromJsonAsync<JsonElement>();

    private static async Task AssertProblem(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal(code, (await Body(response)).GetProperty("code").GetString());
    }

    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(postgres.GetConnectionString()).Options);
}
