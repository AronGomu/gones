using System.Data.Common;
using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Gones.Domain.Calendar;
using Gones.Domain.Catalog;
using Gones.Domain.Organizations;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using NodaTime;
using Testcontainers.PostgreSql;

namespace Gones.IntegrationTests;

/// <summary>
/// Performance budgets for the public read path (C40). These are regression fences, not benchmarks:
/// they fail when a change reintroduces an N+1, an unbounded list, or a per-row request waterfall.
/// </summary>
public sealed class PerformanceBudgetTests : IAsyncLifetime
{
    private const int SeededTournaments = 120;
    private readonly PostgreSqlContainer postgres = new PostgreSqlBuilder().WithImage("postgres:17-alpine").Build();
    private readonly CommandCountingInterceptor commands = new();
    private WebApplicationFactory<Program>? factory;
    private HttpClient? client;

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using (var database = CreateContext())
        {
            await database.Database.MigrateAsync();
            await SeedAsync(database);
        }
        factory = CreateFactory();
        client = factory.CreateClient();
    }

    public async Task DisposeAsync()
    {
        client?.Dispose();
        if (factory is not null) await factory.DisposeAsync();
        await postgres.DisposeAsync();
    }

    [Fact]
    public async Task Tournament_list_query_count_does_not_grow_with_page_size()
    {
        var small = await MeasureAsync("/api/events?pageSize=5");
        var large = await MeasureAsync("/api/events?pageSize=100");

        Assert.Equal(HttpStatusCode.OK, small.Status);
        Assert.Equal(HttpStatusCode.OK, large.Status);
        Assert.Equal(5, small.ItemCount);
        Assert.Equal(100, large.ItemCount);
        // A per-row lookup would make the 100-row page cost ~20x the 5-row page.
        Assert.Equal(small.Commands, large.Commands);
        Assert.True(large.Commands <= 4, $"list endpoint issued {large.Commands} database commands; budget is 4.");
    }

    [Fact]
    public async Task Tournament_list_caps_page_size_no_matter_what_the_client_asks_for()
    {
        var huge = await MeasureAsync($"/api/events?pageSize={SeededTournaments * 10}");
        var negative = await MeasureAsync("/api/events?pageSize=-1");

        Assert.Equal(100, huge.ItemCount);
        Assert.Equal(100, huge.PageSize);
        Assert.Equal(20, negative.ItemCount);
        Assert.Equal(20, negative.PageSize);
        Assert.True(huge.Commands <= 4, $"capped page issued {huge.Commands} database commands; budget is 4.");
    }

    [Fact]
    public async Task Tournament_detail_is_a_bounded_number_of_queries()
    {
        var detail = await MeasureAsync("/api/events/budget-cup-000");

        Assert.Equal(HttpStatusCode.OK, detail.Status);
        Assert.True(detail.Commands <= 3, $"detail endpoint issued {detail.Commands} database commands; budget is 3.");
    }

    [Fact]
    public async Task Public_reads_stay_inside_the_local_latency_budget()
    {
        // Warm the connection pool and query plans so the measurement is not dominated by first-hit cost.
        await MeasureAsync("/api/events?pageSize=100");

        var stopwatch = Stopwatch.StartNew();
        var measured = await MeasureAsync("/api/events?pageSize=100");
        stopwatch.Stop();

        Assert.Equal(HttpStatusCode.OK, measured.Status);
        Assert.True(
            stopwatch.Elapsed < TimeSpan.FromSeconds(2),
            $"a 100-row public list took {stopwatch.ElapsedMilliseconds}ms against a local container; budget is 2000ms.");
    }

    [Fact]
    public async Task Seeded_indexes_cover_the_public_list_ordering_and_filters()
    {
        await using var database = CreateContext();
        var indexes = await database.Database
            .SqlQuery<string>($"SELECT indexdef FROM pg_indexes WHERE tablename = 'events'")
            .ToListAsync();
        var combined = string.Join('\n', indexes).ToLowerInvariant();

        Assert.Contains("starts_at_utc", combined, StringComparison.Ordinal);
        Assert.Contains("slug", combined, StringComparison.Ordinal);
        Assert.Contains("status", combined, StringComparison.Ordinal);
    }

    private async Task<Measurement> MeasureAsync(string url)
    {
        commands.Reset();
        using var response = await Client.GetAsync(url);
        var count = commands.Count;
        if (response.StatusCode != HttpStatusCode.OK) return new Measurement(response.StatusCode, count, 0, 0);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.TryGetProperty("items", out var array) ? array.GetArrayLength() : 1;
        var pageSize = body.TryGetProperty("pageSize", out var size) ? size.GetInt32() : 0;
        return new Measurement(response.StatusCode, count, items, pageSize);
    }

    private sealed record Measurement(HttpStatusCode Status, int Commands, int ItemCount, int PageSize);

    private WebApplicationFactory<Program> CreateFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_PROVIDER", "Local");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "c40-performance-budget-signing-key-value");
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<GonesDbContext>>();
                services.RemoveAll<DbContextOptions>();
                services.AddDbContext<GonesDbContext>(options => options
                    .ConfigureGones(postgres.GetConnectionString())
                    .AddInterceptors(commands));
            });
        });

    private async Task SeedAsync(GonesDbContext database)
    {
        var user = new ApplicationUser
        {
            Id = Guid.NewGuid(),
            UserName = $"budget-{Guid.NewGuid():N}@example.test",
            NormalizedUserName = $"BUDGET-{Guid.NewGuid():N}@EXAMPLE.TEST",
            Email = $"budget-{Guid.NewGuid():N}@example.test",
            NormalizedEmail = $"BUDGET-{Guid.NewGuid():N}@EXAMPLE.TEST",
            EmailConfirmed = true,
            SecurityStamp = Guid.NewGuid().ToString("N"),
            ConcurrencyStamp = Guid.NewGuid().ToString("N")
        };
        var organization = Organization.Create("Budget Club", "Perf seed", null, null, Now);
        var legacy = await database.TournamentFormats.SingleOrDefaultAsync(format => format.Slug == TournamentFormat.LegacySlug)
            ?? TournamentFormat.CreateLegacy(Now);
        var pioneer = TournamentFormat.Create("Pioneer", "pioneer", 10, Now);
        database.Users.Add(user);
        database.Organizations.Add(organization);
        if (database.Entry(legacy).State == EntityState.Detached) database.TournamentFormats.Add(legacy);
        database.TournamentFormats.Add(pioneer);
        await database.SaveChangesAsync();

        for (var index = 0; index < SeededTournaments; index++)
        {
            var startsAt = new LocalDateTime(2035, 1, 1, 10, 0).PlusDays(index);
            database.Events.Add(Event.Create(
                organization.Id,
                user.Id,
                new ScheduledTournamentDraft(
                    Title: $"Budget Cup {index:000}",
                    Slug: $"budget-cup-{index:000}",
                    Summary: "Perf seed",
                    BodyHtml: "<p>Body</p>",
                    StreetAddress: "12 Rue de la Paix",
                    PostalCode: "75001",
                    City: "Lyon",
                    Country: "France",
                    TimeZoneId: "Europe/Paris",
                    StartsAtLocal: startsAt,
                    EndsAtLocal: startsAt.Date.At(new LocalTime(18, 0)),
                    Capacity: 64),
                index % 2 == 0 ? [legacy] : [legacy, pioneer],
                Now));
        }
        await database.SaveChangesAsync();
    }

    private GonesDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(postgres.GetConnectionString()).Options;
        return new GonesDbContext(options);
    }

    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");
    private static readonly Instant Now = Instant.FromUtc(2030, 1, 1, 12, 0);

    /// <summary>Counts executed database commands so an N+1 shows up as a failing budget, not a slow test.</summary>
    private sealed class CommandCountingInterceptor : DbCommandInterceptor
    {
        private int count;

        public int Count => Volatile.Read(ref count);

        public void Reset() => Volatile.Write(ref count, 0);

        public override InterceptionResult<DbDataReader> ReaderExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result)
        {
            Interlocked.Increment(ref count);
            return base.ReaderExecuting(command, eventData, result);
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref count);
            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }
    }
}
