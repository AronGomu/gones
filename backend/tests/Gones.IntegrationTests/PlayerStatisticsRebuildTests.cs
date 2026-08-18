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
/// The ADR 0040 read model, from both ends: the rebuild itself, and every archive write that has to
/// carry it. The seed is deliberately mixed — an active League holding a completed Tournament and a
/// completed League holding an active one — so a rule that still looked at the League status would show
/// up as a wrong set of players rather than as a wrong count.
/// </summary>
public sealed class PlayerStatisticsRebuildTests : IAsyncLifetime
{
    private static readonly Guid Actor = Guid.Parse("10000000-0000-0000-0000-000000000022");
    private static readonly Instant Seeded = Instant.FromUtc(2030, 1, 1, 12, 0);

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
                UserName = "player-statistics-actor",
                NormalizedUserName = "PLAYER-STATISTICS-ACTOR",
                Email = "player-statistics-actor@example.test",
                NormalizedEmail = "PLAYER-STATISTICS-ACTOR@EXAMPLE.TEST",
                SecurityStamp = Guid.NewGuid().ToString("N"),
                ConcurrencyStamp = Guid.NewGuid().ToString("N")
            });
            database.LeagueArchiveAggregates.Add(LeagueArchiveAggregate.Create(ActiveLeague(), Seeded));
            database.LeagueArchiveAggregates.Add(LeagueArchiveAggregate.Create(CompletedLeague(), Seeded));
            await database.SaveChangesAsync();
        }

        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "c31-player-statistics-signing-key-value");
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
    public async Task Fills_the_table_from_an_empty_state()
    {
        await using (var database = CreateContext())
        {
            await database.Database.ExecuteSqlRawAsync("DELETE FROM player_statistics");
            Assert.Empty(await database.PlayerStatistics.AsNoTracking().ToListAsync());
        }

        await RebuildAsync();

        var rows = await RowsAsync();
        Assert.Equal(["Alice", "Bob", "Carol"], rows.Select(row => row.PlayerName));
        // Alice played the completed Tournament of the active League (2-1 over Bob) and the completed
        // Tournament of the completed League (0-2 to Carol). The active Tournament's Carol-Dana match is
        // out of scope, which is why Dana has no row at all.
        var alice = rows.Single(row => row.PlayerName == "Alice");
        Assert.Equal(2, alice.PlayedMatchCount);
        Assert.Equal(1, alice.MatchWins);
        Assert.Equal(1, alice.MatchLosses);
        Assert.Equal(0, alice.MatchDraws);
        Assert.Equal(0.5, alice.MatchWinrate);
        Assert.Equal(5, alice.PlayedGameCount);
        Assert.Equal(2, alice.GameWins);
        Assert.Equal(3, alice.GameLosses);
        Assert.Equal(0.4, alice.GameWinrate);
        Assert.Equal("Carol", alice.Nemesis?.Name);
        Assert.Equal("Bob", alice.Rival?.Name);
        Assert.Equal("Tempo", alice.MostPlayedArchetype?.Name);

        Assert.Equal(await ExpectedAsync(), rows.Select(row => row.ToGlobalPlayerStatistics()));
    }

    [Fact]
    public async Task Is_idempotent()
    {
        await RebuildAsync();
        var first = await RowsAsync();
        await RebuildAsync();
        var second = await RowsAsync();

        Assert.Equal(
            first.Select(row => row.ToGlobalPlayerStatistics()),
            second.Select(row => row.ToGlobalPlayerStatistics()));
        Assert.Equal(first.Count, second.Count);
        Assert.Equal(first.Select(row => row.PlayerName).Distinct().Count(), second.Count);
    }

    /// <summary>
    /// Two archive writes touching different Leagues both rewrite the whole table. Under READ COMMITTED
    /// the loser's <c>DELETE</c> is evaluated against a snapshot taken before the winner committed, so it
    /// removes nothing the winner inserted and then inserts the same Player Names on top of them — a
    /// duplicate key that turns a legal write into a 500. The advisory lock the rebuild takes first is
    /// what makes the loser wait and then rebuild over rows it can actually see.
    /// </summary>
    [Fact]
    public async Task A_second_rebuild_waits_for_the_first_instead_of_colliding_with_it()
    {
        await RebuildAsync();

        await using var first = CreateContext();
        await using var firstTransaction = await first.Database.BeginTransactionAsync();
        await new PlayerStatisticsRebuildService(NullLogger<PlayerStatisticsRebuildService>.Instance)
            .RebuildAsync(first, CancellationToken.None);
        await first.SaveChangesAsync();

        await using var second = CreateContext();
        await using var secondTransaction = await second.Database.BeginTransactionAsync();
        var contender = Task.Run(async () =>
        {
            await new PlayerStatisticsRebuildService(NullLogger<PlayerStatisticsRebuildService>.Instance)
                .RebuildAsync(second, CancellationToken.None);
            await second.SaveChangesAsync();
            await secondTransaction.CommitAsync();
        });

        // Held by the lock rather than by luck: nothing lets the contender past it before the commit.
        Assert.NotSame(contender, await Task.WhenAny(contender, Task.Delay(TimeSpan.FromSeconds(2))));
        await firstTransaction.CommitAsync();
        await contender;

        var rows = await RowsAsync();
        Assert.Equal(["Alice", "Bob", "Carol"], rows.Select(row => row.PlayerName));
        Assert.Equal(await ExpectedAsync(), rows.Select(row => row.ToGlobalPlayerStatistics()));
    }

    [Fact]
    public async Task Drops_a_player_who_no_longer_appears()
    {
        await RebuildAsync();
        Assert.Contains(await RowsAsync(), row => row.PlayerName == "Bob");

        await using (var database = CreateContext())
        {
            await database.Database.ExecuteSqlRawAsync(
                "UPDATE league_archive_aggregates SET deleted_at = now() WHERE document_id = 'statistics-active-league'");
        }
        await RebuildAsync();

        var rows = await RowsAsync();
        Assert.DoesNotContain(rows, row => row.PlayerName == "Bob");
        Assert.Equal(["Alice", "Carol"], rows.Select(row => row.PlayerName));
    }

    [Fact]
    public async Task Rebuilds_inside_the_commit_transaction()
    {
        var command = new
        {
            editTournament = (object?)null,
            status = (string?)null,
            addRounds = new[]
            {
                new
                {
                    roundId = Guid.NewGuid().ToString("D"),
                    entries = new[] { MatchJson("added-match", "Alice", "Eve", 2, 0) }
                }
            },
            deleteRoundIds = Array.Empty<string>(),
            replaceRounds = Array.Empty<object>(),
            updateArchetypes = Array.Empty<object>()
        };

        using var response = await SendJsonAsync(
            HttpMethod.Post,
            "/api/leagues-archive/statistics-active-league/tournaments-archive/statistics-a1/edit-batch",
            command,
            ifMatch: StrongETag.Encode(1));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        // One request, one transaction: the moment the commit returns, the table already answers with
        // the new numbers. No background pass fills them in later.
        var rows = await RowsAsync();
        Assert.Contains(rows, row => row.PlayerName == "Eve");
        Assert.Equal(3, rows.Single(row => row.PlayerName == "Alice").PlayedMatchCount);
        Assert.Equal(await ExpectedAsync(), rows.Select(row => row.ToGlobalPlayerStatistics()));
    }

    [Fact]
    public async Task Rolls_back_with_a_failed_write()
    {
        await RebuildAsync();
        var before = (await RowsAsync()).Select(row => row.ToGlobalPlayerStatistics()).ToArray();

        await using (var database = CreateContext())
        {
            await using var transaction = await database.Database.BeginTransactionAsync();
            var aggregate = await database.LeagueArchiveAggregates.SingleAsync(item => item.DocumentId == "statistics-completed-league");
            var document = aggregate.ReadDocument();
            aggregate.Apply(
                document with
                {
                    Tournaments = [document.Tournaments[0] with { Status = "completed" }, document.Tournaments[1]]
                },
                Seeded);
            await new PlayerStatisticsRebuildService(NullLogger<PlayerStatisticsRebuildService>.Instance)
                .RebuildAsync(database, CancellationToken.None);
            // An audit row pointing at an account that does not exist violates the actor foreign key, so
            // the save fails after the rebuild has already deleted every row.
            database.AuditRecords.Add(new AuditRecord
            {
                ActorId = Guid.NewGuid(),
                Action = "league.tournament.edit_batch.applied",
                EntityType = "league",
                EntityId = "statistics-completed-league",
                RedactedDiff = "{}",
                OccurredAt = Seeded
            });
            await Assert.ThrowsAsync<DbUpdateException>(() => database.SaveChangesAsync());
            await transaction.RollbackAsync();
        }

        Assert.Equal(before, (await RowsAsync()).Select(row => row.ToGlobalPlayerStatistics()));
        await using var reread = CreateContext();
        var stored = await reread.LeagueArchiveAggregates.AsNoTracking().SingleAsync(item => item.DocumentId == "statistics-completed-league");
        Assert.Equal("active", stored.ReadDocument().Tournaments[0].Status);
    }

    [Fact]
    public async Task Rebuilds_after_a_restore()
    {
        var restore = new
        {
            kind = "league",
            gonesDataVersion = LeagueNormalizer.GonesDataVersion,
            league = new
            {
                id = "restored-league",
                name = "Restored League",
                status = "active",
                tournaments = new[]
                {
                    new
                    {
                        id = "restored-tournament",
                        leagueId = "restored-league",
                        name = "Restored Day",
                        tournamentDate = "2030-03-03",
                        status = "completed",
                        rounds = new[]
                        {
                            new { id = "restored-round", entries = new[] { MatchJson("restored-match", "Zed", "Yuri", 2, 1) } }
                        },
                        playerArchetypes = Array.Empty<object>()
                    }
                }
            }
        };

        using var response = await SendJsonAsync(HttpMethod.Post, "/api/leagues-archive/restore", restore, key: "restore-statistics");
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        var rows = await RowsAsync();
        Assert.Equal(["Alice", "Bob", "Carol", "Yuri", "Zed"], rows.Select(row => row.PlayerName));
        Assert.Equal(1, rows.Single(row => row.PlayerName == "Zed").MatchWins);
    }

    [Fact]
    public async Task Rebuilds_after_a_delete()
    {
        Assert.Equal(["Alice", "Bob", "Carol"], (await RowsAsync()).Select(row => row.PlayerName));

        using var response = await SendJsonAsync(
            HttpMethod.Delete,
            "/api/leagues-archive/statistics-active-league",
            body: null,
            ifMatch: StrongETag.Encode(1));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var rows = await RowsAsync();
        Assert.Equal(["Alice", "Carol"], rows.Select(row => row.PlayerName));
        Assert.Equal(1, rows.Single(row => row.PlayerName == "Alice").PlayedMatchCount);
    }

    [Fact]
    public async Task Rebuilds_when_a_tournament_is_completed()
    {
        Assert.DoesNotContain(await RowsAsync(), row => row.PlayerName == "Frank");

        var command = new
        {
            editTournament = (object?)null,
            status = "completed",
            addRounds = Array.Empty<object>(),
            deleteRoundIds = Array.Empty<string>(),
            replaceRounds = Array.Empty<object>(),
            updateArchetypes = Array.Empty<object>()
        };
        using var response = await SendJsonAsync(
            HttpMethod.Post,
            "/api/leagues-archive/statistics-active-league/tournaments-archive/statistics-a2/edit-batch",
            command,
            ifMatch: StrongETag.Encode(1));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var rows = await RowsAsync();
        Assert.Equal(["Alice", "Bob", "Carol", "Frank", "Gina"], rows.Select(row => row.PlayerName));
        Assert.Equal(1, rows.Single(row => row.PlayerName == "Frank").MatchWins);
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
        // Ordered in memory, ordinally: that is the order the domain emits, and a database collation
        // would sort 'alice' and 'Alice' the other way round.
        return rows.OrderBy(row => row.PlayerName, StringComparer.Ordinal).ToList();
    }

    /// <summary>What the domain computes right now over every live archive — the table must equal it.</summary>
    private async Task<IReadOnlyList<GlobalPlayerStatistics>> ExpectedAsync()
    {
        await using var database = CreateContext();
        var aggregates = await database.LeagueArchiveAggregates.AsNoTracking().Where(item => item.DeletedAt == null).ToListAsync();
        var data = new GonesData(LeagueNormalizer.GonesDataVersion, aggregates.Select(item => item.ReadDocument()).ToList(), []);
        return LeagueRules.CalculateGlobalPlayerStatistics(data);
    }

    private async Task<HttpResponseMessage> SendJsonAsync(HttpMethod method, string path, object? body, string? key = null, string? ifMatch = null)
    {
        var request = new HttpRequestMessage(method, path);
        if (body is not null) request.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        request.Headers.TryAddWithoutValidation("X-Test-User", Actor.ToString("D"));
        request.Headers.TryAddWithoutValidation("X-Test-Roles", "Organizer");
        if (key is not null) request.Headers.TryAddWithoutValidation("Idempotency-Key", key);
        if (ifMatch is not null) request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        return await Client.SendAsync(request, CancellationToken.None);
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

    private static LeagueDocument ActiveLeague() => new(
        "statistics-active-league",
        "Statistics Active League",
        "active",
        [
            new TournamentDocument("statistics-a1", "statistics-active-league", "Completed Day", "2030-01-01", "completed",
                [new RoundDocument("statistics-a-round-1", [new MatchRoundEntry("statistics-a-match", "1", "Alice", "Bob", 2, 1, "Tempo", "Control")])],
                []),
            // Still running, so its players are out of every statistic until an Organizer completes it.
            new TournamentDocument("statistics-a2", "statistics-active-league", "Running Day", "2030-01-08", "active",
                [new RoundDocument("statistics-a2-round", [new MatchRoundEntry("statistics-a2-match", "1", "Frank", "Gina", 2, 0, string.Empty, string.Empty)])],
                [])
        ]);

    private static LeagueDocument CompletedLeague() => new(
        "statistics-completed-league",
        "Statistics Completed League",
        "completed",
        [
            new TournamentDocument("statistics-b1", "statistics-completed-league", "Ongoing Day", "2030-02-01", "active",
                [new RoundDocument("statistics-b1-round", [new MatchRoundEntry("statistics-b1-match", "1", "Carol", "Dana", 2, 0, string.Empty, string.Empty)])],
                []),
            new TournamentDocument("statistics-b2", "statistics-completed-league", "Finished Day", "2030-02-08", "completed",
                [new RoundDocument("statistics-b2-round", [new MatchRoundEntry("statistics-b2-match", "1", "Alice", "Carol", 0, 2, "Tempo", string.Empty)])],
                [])
        ]);

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString()).Options);

    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");
}
