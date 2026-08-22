using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using Gones.Api.Leagues;
using Gones.Application.Concurrency;
using Gones.Domain.Leagues;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using NodaTime;

namespace Gones.IntegrationTests;

/// <summary>
/// The ADR 0043 rating columns end to end: the startup rebuild that the formula-version bump triggers
/// fills them, every archive write recomputes them inside its own transaction, and a write that fails
/// after the rebuild leaves the old numbers standing.
///
/// <para>The seed is two dates, so a rating that never replayed the second period is visible as a wrong
/// <c>last_played_date</c> rather than only as a wrong number.</para>
/// </summary>
public sealed class PlayerStatisticsRatingRebuildTests : IAsyncLifetime
{
    private static readonly Guid Actor = Guid.Parse("10000000-0000-0000-0000-000000000043");
    private static readonly Instant Seeded = Instant.FromUtc(2030, 1, 1, 12, 0);

    // The rebuild reads the wall clock for idle growth and decay, and nothing in the API lets a test
    // pin it. So the seed dates are relative to today: two recent dates, a week apart, which keeps the
    // idle months at zero however long this suite lives.
    private static readonly string Day1 = Date(-14);
    private static readonly string Day2 = Date(-7);

    private readonly PostgreSqlTestContainer postgres = new();
    private WebApplicationFactory<Program>? factory;

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using var database = CreateContext();
        await database.Database.MigrateAsync();
        database.Users.Add(new ApplicationUser
        {
            Id = Actor,
            UserName = "rating-actor",
            NormalizedUserName = "RATING-ACTOR",
            Email = "rating-actor@example.test",
            NormalizedEmail = "RATING-ACTOR@EXAMPLE.TEST",
            SecurityStamp = Guid.NewGuid().ToString("N"),
            ConcurrencyStamp = Guid.NewGuid().ToString("N")
        });
        database.LeagueArchiveAggregates.Add(LeagueArchiveAggregate.Create(RatingLeague(), Seeded));
        // A row no League can produce, seeded at the previous formula version: a rebuild has to replace
        // it, a skipped rebuild has to leave it.
        database.PlayerStatistics.Add(PlayerStatisticsRow.From(new GlobalPlayerStatistics(
            "Ghost", 9, 9, 0, 0, 1, 18, 18, 0, 1, null, null, null,
            Glicko2.DefaultRating, Glicko2.DefaultDeviation, Glicko2.DefaultVolatility,
            Glicko2.DefaultRating, 0, 0, null, Glicko2.DefaultRating),
            PlayerStatisticsScope.Global,
            PlayerStatisticsScope.GlobalScopeId));
        database.PlayerStatisticsMeta.Add(new PlayerStatisticsMeta
        {
            Id = PlayerStatisticsMeta.SingletonId,
            FormulaVersion = PlayerStatisticsFormula.Version - 1,
            RebuiltAt = Seeded
        });
        await database.SaveChangesAsync();
    }

    public async Task DisposeAsync()
    {
        if (factory is not null) await factory.DisposeAsync();
        await postgres.DisposeAsync();
    }

    [Fact]
    public async Task Startup_rebuild_fills_the_rating_columns()
    {
        using var client = StartApp();
        using var health = await client.GetAsync("/health/live");
        health.EnsureSuccessStatusCode();

        var rows = await RowsAsync();
        Assert.Equal(["Alice", "Bob", "Carol"], rows.Select(row => row.PlayerName));
        foreach (var row in rows)
        {
            Assert.NotEqual(Glicko2.DefaultRating, row.Rating);
            Assert.True(row.RatingDeviation < Glicko2.DefaultDeviation, $"{row.PlayerName} kept the seed deviation.");
            Assert.True(row.TournamentsPlayed > 0, $"{row.PlayerName} played nothing.");
            Assert.NotNull(row.LastPlayedDate);
            Assert.Equal(row.Rating - row.PreviousRating, row.LastRatingDelta, 10);
        }

        // Alice played both dates; Bob only the first.
        Assert.Equal(Day2, rows.Single(row => row.PlayerName == "Alice").LastPlayedDate);
        Assert.Equal(2, rows.Single(row => row.PlayerName == "Alice").TournamentsPlayed);
        Assert.Equal(Day1, rows.Single(row => row.PlayerName == "Bob").LastPlayedDate);

        var meta = await MetaAsync();
        Assert.Equal(PlayerStatisticsFormula.Version, meta!.FormulaVersion);
    }

    [Fact]
    public async Task An_archive_write_recomputes_the_ratings()
    {
        using var client = StartApp();
        using var health = await client.GetAsync("/health/live");
        health.EnsureSuccessStatusCode();
        var before = (await RowsAsync()).ToDictionary(row => row.PlayerName, StringComparer.Ordinal);

        var command = new
        {
            editTournament = (object?)null,
            status = (string?)null,
            addRounds = new[]
            {
                new
                {
                    roundId = Guid.NewGuid().ToString("D"),
                    entries = new[] { MatchJson("rating-added-match", "Bob", "Alice", 2, 0) }
                }
            },
            deleteRoundIds = Array.Empty<string>(),
            replaceRounds = Array.Empty<object>(),
            updateArchetypes = Array.Empty<object>()
        };

        using var response = await SendJsonAsync(
            client,
            HttpMethod.Post,
            "/api/leagues-archive/rating-league/tournaments-archive/rating-t1/edit-batch",
            command,
            ifMatch: StrongETag.Encode(1));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        // One request, one transaction: the table already answers with the replayed rating.
        var after = (await RowsAsync()).ToDictionary(row => row.PlayerName, StringComparer.Ordinal);
        Assert.NotEqual(before["Bob"].Rating, after["Bob"].Rating);
        Assert.NotEqual(before["Alice"].Rating, after["Alice"].Rating);
        Assert.True(after["Bob"].Rating > before["Bob"].Rating, "Bob won a Match and did not gain rating.");
        Assert.Equal(await ExpectedAsync(), (await RowsAsync()).Select(row => row.ToGlobalPlayerStatistics()));
    }

    [Fact]
    public async Task A_rolled_back_write_leaves_the_ratings_alone()
    {
        await RebuildAsync();
        var before = (await RowsAsync()).Select(row => row.ToGlobalPlayerStatistics()).ToArray();

        await using (var database = CreateContext())
        {
            await using var transaction = await database.Database.BeginTransactionAsync();
            var aggregate = await database.LeagueArchiveAggregates.SingleAsync(item => item.DocumentId == "rating-league");
            var document = aggregate.ReadDocument();
            var round = document.Tournaments[0].Rounds[0];
            aggregate.Apply(
                document with
                {
                    Tournaments =
                    [
                        document.Tournaments[0] with
                        {
                            Rounds =
                            [
                                round with
                                {
                                    Entries = [new MatchRoundEntry("rating-m1", "1", "Alice", "Bob", 0, 2, string.Empty, string.Empty)]
                                }
                            ]
                        },
                        document.Tournaments[1]
                    ]
                },
                Seeded);
            await new PlayerStatisticsRebuildService(NullLogger<PlayerStatisticsRebuildService>.Instance)
                .RebuildAsync(database, CancellationToken.None);
            // An audit row pointing at an account that does not exist violates the actor foreign key, so
            // the save fails after the rebuild has already replaced every rating.
            database.AuditRecords.Add(new AuditRecord
            {
                ActorId = Guid.NewGuid(),
                Action = "league.tournament.edit_batch.applied",
                EntityType = "league",
                EntityId = "rating-league",
                RedactedDiff = "{}",
                OccurredAt = Seeded
            });
            await Assert.ThrowsAsync<DbUpdateException>(() => database.SaveChangesAsync());
            await transaction.RollbackAsync();
        }

        Assert.Equal(before, (await RowsAsync()).Select(row => row.ToGlobalPlayerStatistics()));
    }

    private HttpClient StartApp()
    {
        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "c43-player-rating-rebuild-signing-key");
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
        });
        // Creating the client starts the host, which is what runs the startup rebuild.
        return factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
    }

    private async Task RebuildAsync()
    {
        await using var database = CreateContext();
        await using var transaction = await database.Database.BeginTransactionAsync();
        await new PlayerStatisticsRebuildService(NullLogger<PlayerStatisticsRebuildService>.Instance)
            .RebuildAsync(database, CancellationToken.None);
        await database.SaveChangesAsync();
        await transaction.CommitAsync();
    }

    private async Task<IReadOnlyList<PlayerStatisticsRow>> RowsAsync()
    {
        await using var database = CreateContext();
        var rows = await database.PlayerStatistics.AsNoTracking().ToListAsync();
        return rows.OrderBy(row => row.PlayerName, StringComparer.Ordinal).ToList();
    }

    private async Task<PlayerStatisticsMeta?> MetaAsync()
    {
        await using var database = CreateContext();
        return await database.PlayerStatisticsMeta.AsNoTracking().SingleOrDefaultAsync();
    }

    /// <summary>What the domain computes right now over every live archive — the table must equal it.</summary>
    private async Task<IReadOnlyList<GlobalPlayerStatistics>> ExpectedAsync()
    {
        await using var database = CreateContext();
        var aggregates = await database.LeagueArchiveAggregates.AsNoTracking().Where(item => item.DeletedAt == null).ToListAsync();
        var data = new GonesData(LeagueNormalizer.GonesDataVersion, aggregates.Select(item => item.ReadDocument()).ToList(), []);
        return LeagueRules.CalculateGlobalPlayerStatistics(data);
    }

    private async Task<HttpResponseMessage> SendJsonAsync(
        HttpClient client,
        HttpMethod method,
        string path,
        object? body,
        string? ifMatch = null)
    {
        var request = new HttpRequestMessage(method, path);
        if (body is not null) request.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        request.Headers.TryAddWithoutValidation("X-Test-User", Actor.ToString("D"));
        request.Headers.TryAddWithoutValidation("X-Test-Roles", "Organizer");
        if (ifMatch is not null) request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        return await client.SendAsync(request, CancellationToken.None);
    }

    private static object MatchJson(string id, string player1, string player2, int player1Score, int player2Score) => new
    {
        kind = "match",
        id,
        table = "1",
        player1Name = player1,
        player2Name = player2,
        player1Score,
        player2Score,
        player1DeckArchetype = string.Empty,
        player2DeckArchetype = string.Empty
    };

    private static LeagueDocument RatingLeague() => new(
        "rating-league",
        "Rating League",
        "active",
        [
            new TournamentDocument("rating-t1", "rating-league", "Day 1", Day1, "completed",
                [new RoundDocument("rating-t1-round", [new MatchRoundEntry("rating-m1", "1", "Alice", "Bob", 2, 0, string.Empty, string.Empty)])],
                []),
            new TournamentDocument("rating-t2", "rating-league", "Day 2", Day2, "completed",
                [new RoundDocument("rating-t2-round", [new MatchRoundEntry("rating-m2", "1", "Alice", "Carol", 0, 2, string.Empty, string.Empty)])],
                [])
        ]);

    private static string Date(int dayOffset) =>
        DateOnly.FromDateTime(DateTime.UtcNow).AddDays(dayOffset).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString()).Options);
}
