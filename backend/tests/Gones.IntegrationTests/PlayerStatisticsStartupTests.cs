using Gones.Domain.Leagues;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.IntegrationTests;

/// <summary>
/// The startup rebuild, which is the only repair path for a commit that changes the statistics maths:
/// no archive write happens afterwards, so nothing else would ever recompute the untouched players.
///
/// Every case seeds a <c>ghost</c> row that no League can produce. A rebuild has to delete it; a skipped
/// rebuild has to leave it. That is a sharper probe than counting rows, which a rebuild and a no-op
/// would answer the same way.
/// </summary>
public sealed class PlayerStatisticsStartupTests : IAsyncLifetime
{
    private static readonly Instant Seeded = Instant.FromUtc(2030, 1, 1, 12, 0);

    private readonly PostgreSqlTestContainer postgres = new();
    private WebApplicationFactory<Program>? factory;

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using var database = CreateContext();
        await database.Database.MigrateAsync();
        database.LeagueArchiveAggregates.Add(LeagueArchiveAggregate.Create(
            new LeagueDocument("startup-league", "Startup League", "active",
                [new TournamentDocument("startup-tournament", "startup-league", "Day 1", "2030-01-01", "completed",
                    [new RoundDocument("startup-round", [new MatchRoundEntry("startup-match", "1", "Alice", "Bob", 2, 1, string.Empty, string.Empty)])],
                    [])]),
            Seeded));
        database.PlayerStatistics.Add(PlayerStatisticsRow.From(
            new GlobalPlayerStatistics("Ghost", 9, 9, 0, 0, 1, 18, 18, 0, 1, null, null, null,
                Glicko2.DefaultRating, Glicko2.DefaultDeviation, Glicko2.DefaultVolatility,
                Glicko2.DefaultRating, 0, 0, null, Glicko2.DefaultRating)));
        await database.SaveChangesAsync();
    }

    public async Task DisposeAsync()
    {
        if (factory is not null) await factory.DisposeAsync();
        await postgres.DisposeAsync();
    }

    [Fact]
    public async Task Rebuilds_on_a_version_mismatch()
    {
        await SeedMetaAsync(PlayerStatisticsFormula.Version - 1);

        await StartAsync();

        Assert.Equal(["Alice", "Bob"], await PlayerNamesAsync());
        var meta = await MetaAsync();
        Assert.Equal(PlayerStatisticsFormula.Version, meta!.FormulaVersion);
        Assert.NotEqual(Seeded, meta.RebuiltAt);
    }

    [Fact]
    public async Task Skips_when_the_version_matches()
    {
        await SeedMetaAsync(PlayerStatisticsFormula.Version);

        await StartAsync();

        Assert.Equal(["Ghost"], await PlayerNamesAsync());
        Assert.Equal(Seeded, (await MetaAsync())!.RebuiltAt);
    }

    [Fact]
    public async Task Rebuilds_when_there_is_no_meta_row()
    {
        Assert.Null(await MetaAsync());

        await StartAsync();

        Assert.Equal(["Alice", "Bob"], await PlayerNamesAsync());
        Assert.Equal(PlayerStatisticsFormula.Version, (await MetaAsync())!.FormulaVersion);
    }

    [Fact]
    public async Task Honours_the_disable_switch()
    {
        await SeedMetaAsync(PlayerStatisticsFormula.Version - 1);

        await StartAsync(("Gones:PlayerStatistics:RebuildOnStartup", "false"));

        Assert.Equal(["Ghost"], await PlayerNamesAsync());
        Assert.Equal(PlayerStatisticsFormula.Version - 1, (await MetaAsync())!.FormulaVersion);
    }

    [Fact]
    public async Task Keeps_serving_when_the_rebuild_fails()
    {
        await SeedMetaAsync(PlayerStatisticsFormula.Version - 1);
        // A document the domain refuses to read. Only a write outside a domain transaction can produce
        // one — a bulk-SQL seeder, or hand-edited SQL — and it must not crash-loop the API.
        await using (var database = CreateContext())
        {
            await database.Database.ExecuteSqlRawAsync(
                """
                UPDATE league_archive_aggregates
                -- Doubled braces on purpose: ExecuteSqlRawAsync runs the SQL through string.Format,
                -- which unescapes them into the single-brace text[] path Postgres wants.
                SET canonical_document = jsonb_set(canonical_document, '{{tournaments,0,leagueId}}', '"somewhere-else"')
                WHERE document_id = 'startup-league';
                """);
        }

        await StartAsync();

        // Health still answers (StartAsync asserts it), the table is untouched, and the stored version
        // stays behind so the next start tries again.
        Assert.Equal(["Ghost"], await PlayerNamesAsync());
        Assert.Equal(PlayerStatisticsFormula.Version - 1, (await MetaAsync())!.FormulaVersion);
    }

    [Fact]
    public async Task Honours_the_disable_switch_under_its_environment_variable_spelling()
    {
        await SeedMetaAsync(PlayerStatisticsFormula.Version - 1);

        // GONES_PLAYER_STATISTICS__REBUILD_ON_STARTUP, as documented in .env.example, reaches
        // configuration under this key rather than the sectioned one.
        await StartAsync(("GONES_PLAYER_STATISTICS:REBUILD_ON_STARTUP", "false"));

        Assert.Equal(["Ghost"], await PlayerNamesAsync());
    }

    private async Task StartAsync(params (string Key, string Value)[] settings)
    {
        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "c31-player-statistics-startup-key-value");
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
            foreach (var (key, value) in settings) builder.UseSetting(key, value);
        });
        // Creating the client starts the host, which is what runs the hosted services.
        using var client = factory.CreateClient();
        using var response = await client.GetAsync("/health/live");
        response.EnsureSuccessStatusCode();
    }

    private async Task SeedMetaAsync(int formulaVersion)
    {
        await using var database = CreateContext();
        database.PlayerStatisticsMeta.Add(new PlayerStatisticsMeta
        {
            Id = PlayerStatisticsMeta.SingletonId,
            FormulaVersion = formulaVersion,
            RebuiltAt = Seeded
        });
        await database.SaveChangesAsync();
    }

    private async Task<IReadOnlyList<string>> PlayerNamesAsync()
    {
        await using var database = CreateContext();
        var names = await database.PlayerStatistics.AsNoTracking().Select(row => row.PlayerName).ToListAsync();
        return names.Order(StringComparer.Ordinal).ToArray();
    }

    private async Task<PlayerStatisticsMeta?> MetaAsync()
    {
        await using var database = CreateContext();
        return await database.PlayerStatisticsMeta.AsNoTracking().SingleOrDefaultAsync();
    }

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString()).Options);
}
