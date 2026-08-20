using Gones.Domain.Leagues;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Gones.Api.Leagues;

/// <summary>
/// Repairs the denormalized catalog counts of every League archive row stamped with a formula version
/// that is not <see cref="LeagueCatalogCounts.Version"/> — including the rows the migration created at
/// version <c>0</c>, which is what makes the columns trustworthy the first time anything reads them
/// (ADR 0042).
///
/// <para>The counts cannot be derived in SQL: the player count is the Swiss standings row count, so the
/// repair is C# over the stored documents rather than an <c>UPDATE</c> in the migration.</para>
///
/// <para>The switch is <c>Gones:Leagues:BackfillCatalogCountsOnStartup</c>, default <c>true</c>.</para>
/// </summary>
internal sealed class LeagueArchiveCatalogCountsBackfill(
    IServiceScopeFactory scopeFactory,
    IConfiguration configuration,
    ILogger<LeagueArchiveCatalogCountsBackfill> logger) : IHostedService
{
    public const string EnabledKey = "Gones:Leagues:BackfillCatalogCountsOnStartup";

    /// <summary>
    /// The same switch under the flat environment-variable spelling documented in <c>.env.example</c>
    /// (<c>GONES_LEAGUES__BACKFILL_CATALOG_COUNTS_ON_STARTUP</c>), which the default provider turns into
    /// this key rather than the sectioned one above.
    /// </summary>
    public const string EnvironmentEnabledKey = "GONES_LEAGUES:BACKFILL_CATALOG_COUNTS_ON_STARTUP";

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        if (!Enabled())
        {
            logger.LogInformation("League archive catalog counts backfill is disabled by {Key}.", EnabledKey);
            return;
        }

        using var scope = scopeFactory.CreateScope();
        var database = scope.ServiceProvider.GetRequiredService<GonesDbContext>();

        // Configurations that boot without a reachable database are legitimate — the API still serves
        // its health endpoints and reports the database unhealthy. Refusing to start would turn that
        // into a crash loop.
        if (!await database.Database.CanConnectAsync(cancellationToken))
        {
            logger.LogWarning("League archive catalog counts backfill skipped: the database is unreachable.");
            return;
        }

        try
        {
            await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
            // Soft-deleted rows are excluded: nothing reads their counts, and a deleted aggregate refuses
            // to be changed.
            var stale = await database.LeagueArchiveAggregates
                .Where(aggregate => aggregate.DeletedAt == null && aggregate.CountsVersion != LeagueCatalogCounts.Version)
                .ToListAsync(cancellationToken);
            if (stale.Count == 0)
            {
                logger.LogInformation("League archive catalog counts are current at version {Version}; no backfill.", LeagueCatalogCounts.Version);
                return;
            }

            foreach (var aggregate in stale) aggregate.RefreshCatalogCounts();
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            logger.LogInformation(
                "Backfilled the catalog counts of {Count} League archive rows to version {Version}.",
                stale.Count,
                LeagueCatalogCounts.Version);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // A repair job must not be able to take the API down. One archive document the domain
            // refuses to read — which only a write outside a domain transaction can produce, such as a
            // bulk-SQL stress seeder — would otherwise crash-loop the container and take health, auth
            // and every unrelated endpoint with it. The transaction rolls back, the stored versions stay
            // where they were, and the next start tries again.
            logger.LogError(exception, "League archive catalog counts backfill failed; the stored counts versions are left unchanged.");
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private bool Enabled() =>
        configuration.GetValue<bool?>(EnabledKey)
        ?? configuration.GetValue<bool?>(EnvironmentEnabledKey)
        ?? true;
}
