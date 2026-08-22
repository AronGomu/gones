using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Gones.Application.Concurrency;
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
/// The derived 365-day lock. It is computed from <c>tournamentDate</c> against today and never stored,
/// so the seeds are written straight through <see cref="GonesDbContext"/> at exact day offsets from
/// today: 365 days old is still writable, 366 is frozen for everyone but an Admin.
/// </summary>
public sealed class ArchiveTournamentLockApiTests : IAsyncLifetime
{
    private static readonly Guid Actor = Guid.Parse("10000000-0000-0000-0000-000000000005");
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
                UserName = "archive-lock-actor",
                NormalizedUserName = "ARCHIVE-LOCK-ACTOR",
                Email = "archive-lock-actor@example.test",
                NormalizedEmail = "ARCHIVE-LOCK-ACTOR@EXAMPLE.TEST",
                SecurityStamp = Guid.NewGuid().ToString("N"),
                ConcurrencyStamp = Guid.NewGuid().ToString("N")
            });
            var seeded = Instant.FromUtc(2026, 1, 1, 12, 0);
            database.ArchiveLeagues.Add(ArchiveLeague.Create("league-1", "Ligue 1", seeded));
            database.ArchiveLeagueSeasons.Add(ArchiveLeagueSeason.Create("season-1", "league-1", "Saison 1", "active", seeded));
            database.ArchiveLeagueSeasons.Add(ArchiveLeagueSeason.Create("season-2", "league-1", "Saison 2", "active", seeded));
            // Literal offsets, not ArchiveLockRule.LockWindowDays: these tests pin the boundary itself,
            // so they must fail if the window ever moves.
            database.ArchiveTournaments.Add(Seed("fresh", Today));
            database.ArchiveTournaments.Add(Seed("edge-365", Today.PlusDays(-365)));
            database.ArchiveTournaments.Add(Seed("locked-366", Today.PlusDays(-366)));
            await database.SaveChangesAsync();
        }
        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "t4-archive-tournament-lock-signing-key");
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
    public async Task Tournament_dated_365_days_ago_is_writable_by_an_Organizer()
    {
        using var response = await SendAsync(HttpMethod.Patch, "/api/archive/tournaments/edge-365", Rename("Toujours ouvert", Today.PlusDays(-365)), "Organizer", ifMatch: StrongETag.Encode(1));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(2, (await Body(response)).GetProperty("documentVersion").GetInt32());
        await using var database = CreateContext();
        Assert.Equal(2, (await TournamentAsync(database, "edge-365")).Version);
    }

    [Fact]
    public async Task Tournament_dated_366_days_ago_refuses_an_Organizer_write()
    {
        using var response = await SendAsync(HttpMethod.Patch, "/api/archive/tournaments/locked-366", Rename("Gelé", Today.PlusDays(-366)), "Organizer", ifMatch: StrongETag.Encode(1));

        await AssertProblem(response, HttpStatusCode.Conflict, "archive_tournament_locked");
        await using var database = CreateContext();
        var stored = await TournamentAsync(database, "locked-366");
        Assert.Equal(1, stored.Version);
        Assert.Equal("Tournoi locked-366", stored.Name);
    }

    [Fact]
    public async Task Tournament_dated_366_days_ago_accepts_an_Admin_write()
    {
        using var response = await SendAsync(HttpMethod.Patch, "/api/archive/tournaments/locked-366", Rename("Dégelé", Today.PlusDays(-366)), "Admin", ifMatch: StrongETag.Encode(1));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await using var database = CreateContext();
        var stored = await TournamentAsync(database, "locked-366");
        Assert.Equal(2, stored.Version);
        Assert.Equal("Dégelé", stored.Name);
    }

    [Fact]
    public async Task Locked_Tournament_refuses_every_content_route_for_an_Organizer()
    {
        var ifMatch = StrongETag.Encode(1);
        var entry = new { kind = "bye", id = "e", table = "1", playerName = "Carol", deckArchetype = "Aggro" };
        (HttpMethod Method, string Path, object Body)[] routes =
        [
            (HttpMethod.Post, "/api/archive/tournaments/locked-366/rounds", new { }),
            (HttpMethod.Delete, "/api/archive/tournaments/locked-366/rounds/locked-366-r1", new { }),
            (HttpMethod.Post, "/api/archive/tournaments/locked-366/rounds/locked-366-r1/import", new { text = "Table,Player,Result,Opponent,Player_Decklist,Opponent_Decklist" }),
            (HttpMethod.Post, "/api/archive/tournaments/locked-366/rounds/locked-366-r1/replace", new { entries = new[] { entry } }),
            (HttpMethod.Post, "/api/archive/tournaments/locked-366/rounds/locked-366-r1/entries", entry),
            (HttpMethod.Patch, "/api/archive/tournaments/locked-366/rounds/locked-366-r1/entries/locked-366-e1", entry),
            (HttpMethod.Delete, "/api/archive/tournaments/locked-366/rounds/locked-366-r1/entries/locked-366-e1", new { }),
            (HttpMethod.Patch, "/api/archive/tournaments/locked-366/archetypes/Alice", new { archetype = "Tempo" }),
            (HttpMethod.Post, "/api/archive/tournaments/locked-366/edit-batch", new
            {
                editTournament = new { name = "Batch", tournamentDate = Iso(Today) },
                addRounds = Array.Empty<object>(),
                deleteRoundIds = Array.Empty<string>(),
                replaceRounds = Array.Empty<object>(),
                updateArchetypes = Array.Empty<object>()
            }),
            (HttpMethod.Post, "/api/archive/tournaments/locked-366/players/rename", new { fromName = "Alice", toName = "Alicia" }),
            (HttpMethod.Patch, "/api/archive/tournaments/locked-366/season", new { seasonId = "season-2" }),
            (HttpMethod.Delete, "/api/archive/tournaments/locked-366", new { })
        ];

        string before;
        await using (var database = CreateContext()) before = (await TournamentAsync(database, "locked-366")).Document;

        foreach (var (method, path, body) in routes)
        {
            using var response = await SendAsync(method, path, body, "Organizer", ifMatch: ifMatch);
            await AssertProblem(response, HttpStatusCode.Conflict, "archive_tournament_locked");
        }

        await using var after = CreateContext();
        var stored = await TournamentAsync(after, "locked-366");
        Assert.Equal(1, stored.Version);
        Assert.Equal(before, stored.Document);
        Assert.Null(stored.DeletedAt);
    }

    [Fact]
    public async Task Creating_a_Tournament_dated_366_days_ago_is_refused_for_an_Organizer()
    {
        using var response = await SendAsync(
            HttpMethod.Post,
            "/api/archive/tournaments",
            new { name = "Trop vieux", tournamentDate = Iso(Today.PlusDays(-366)) },
            "Organizer",
            key: "locked-create");

        await AssertProblem(response, HttpStatusCode.Conflict, "archive_tournament_locked");
        await using var database = CreateContext();
        Assert.Equal(3, await database.ArchiveTournaments.CountAsync());
    }

    [Fact]
    public async Task Creating_a_Tournament_dated_365_days_ago_is_accepted_for_an_Organizer()
    {
        using var response = await SendAsync(
            HttpMethod.Post,
            "/api/archive/tournaments",
            new { name = "Juste à temps", tournamentDate = Iso(Today.PlusDays(-365)) },
            "Organizer",
            key: "edge-create");

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task Creating_a_Tournament_dated_366_days_ago_is_accepted_for_an_Admin()
    {
        using var response = await SendAsync(
            HttpMethod.Post,
            "/api/archive/tournaments",
            new { name = "Historique", tournamentDate = Iso(Today.PlusDays(-366)) },
            "Admin",
            key: "admin-create");

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task Organizer_cannot_move_a_fresh_Tournament_into_the_locked_window()
    {
        using var response = await SendAsync(
            HttpMethod.Patch,
            "/api/archive/tournaments/fresh",
            new { name = "Antidaté", tournamentDate = Iso(Today.PlusDays(-366)) },
            "Organizer",
            ifMatch: StrongETag.Encode(1));

        await AssertProblem(response, HttpStatusCode.Conflict, "archive_tournament_locked");
        await using var database = CreateContext();
        var stored = await TournamentAsync(database, "fresh");
        Assert.Equal(Today, stored.TournamentDate);
        Assert.Equal(1, stored.Version);
    }

    [Fact]
    public async Task Admin_can_move_a_fresh_Tournament_into_the_locked_window()
    {
        using var response = await SendAsync(
            HttpMethod.Patch,
            "/api/archive/tournaments/fresh",
            new { name = "Antidaté", tournamentDate = Iso(Today.PlusDays(-366)) },
            "Admin",
            ifMatch: StrongETag.Encode(1));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await using var database = CreateContext();
        var stored = await TournamentAsync(database, "fresh");
        Assert.Equal(Today.PlusDays(-366), stored.TournamentDate);
        Assert.Equal(2, stored.Version);
    }

    private static object Rename(string name, LocalDate date) => new { name, tournamentDate = Iso(date) };

    private static ArchiveTournament Seed(string id, LocalDate date) => ArchiveTournament.Create(
        new ArchiveTournamentDocument(
            id,
            $"Tournoi {id}",
            "season-1",
            Iso(date),
            "active",
            [new RoundDocument($"{id}-r1", [new MatchRoundEntry($"{id}-e1", "1", "Alice", "Bob", 2, 1, "Tempo", "Control")])],
            []),
        Instant.FromUtc(2026, 1, 1, 12, 0));

    private static string Iso(LocalDate date) => ArchiveTournamentCommands.FormatDate(date);

    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string path, object body, string role, string? ifMatch = null, string? key = null)
    {
        var request = new HttpRequestMessage(method, path)
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json")
        };
        request.Headers.TryAddWithoutValidation("X-Test-User", Actor.ToString("D"));
        request.Headers.TryAddWithoutValidation("X-Test-Roles", role);
        if (ifMatch is not null) request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        if (key is not null) request.Headers.TryAddWithoutValidation("Idempotency-Key", key);
        return await Client.SendAsync(request);
    }

    private static async Task<JsonElement> Body(HttpResponseMessage response) => await response.Content.ReadFromJsonAsync<JsonElement>();

    private static async Task AssertProblem(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal(code, (await Body(response)).GetProperty("code").GetString());
    }

    private static async Task<ArchiveTournament> TournamentAsync(GonesDbContext database, string documentId) =>
        await database.ArchiveTournaments.AsNoTracking().SingleAsync(item => item.DocumentId == documentId);

    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(postgres.GetConnectionString()).Options);
}
