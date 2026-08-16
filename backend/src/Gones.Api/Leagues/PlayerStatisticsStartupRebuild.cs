using Gones.Domain.Leagues;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.Api.Leagues;

/// <summary>
/// Fills <c>player_statistics</c> before the API serves traffic whenever the stored formula version is
/// not the one this build computes with — including the first start after the table was created, when
/// there is no meta row at all (ADR 0040).
///
/// <para>This is the repair path for the one failure the write-side rebuild cannot cover: a commit that
/// changes the statistics maths leaves every untouched player computed by the old formula. Bumping
/// <see cref="PlayerStatisticsFormula.Version"/> in that commit is what makes this run.</para>
///
/// <para>The switch is <c>Gones:PlayerStatistics:RebuildOnStartup</c>, default <c>true</c>. Turning it
/// off is for hosts that would rather pay the cost in the one-shot <c>migrator</c> container that
/// already runs before the API; the code path is identical.</para>
/// </summary>
internal sealed class PlayerStatisticsStartupRebuild(
    IServiceScopeFactory scopeFactory,
    IConfiguration configuration,
    ILogger<PlayerStatisticsStartupRebuild> logger) : IHostedService
{
    public const string EnabledKey = "Gones:PlayerStatistics:RebuildOnStartup";

    /// <summary>
    /// The same switch under the flat environment-variable spelling documented in <c>.env.example</c>
    /// (<c>GONES_PLAYER_STATISTICS__REBUILD_ON_STARTUP</c>), which the default provider turns into this
    /// key rather than the sectioned one above.
    /// </summary>
    public const string EnvironmentEnabledKey = "GONES_PLAYER_STATISTICS:REBUILD_ON_STARTUP";

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        if (!Enabled())
        {
            logger.LogInformation("Player statistics startup rebuild is disabled by {Key}.", EnabledKey);
            return;
        }

        using var scope = scopeFactory.CreateScope();
        var database = scope.ServiceProvider.GetRequiredService<GonesDbContext>();
        var rebuild = scope.ServiceProvider.GetRequiredService<PlayerStatisticsRebuildService>();
        var clock = scope.ServiceProvider.GetRequiredService<IClock>();

        // Configurations that boot without a reachable database are legitimate — the API still serves
        // its health endpoints and reports the database unhealthy. Refusing to start would turn that
        // into a crash loop.
        if (!await database.Database.CanConnectAsync(cancellationToken))
        {
            logger.LogWarning("Player statistics startup rebuild skipped: the database is unreachable.");
            return;
        }

        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var meta = await database.PlayerStatisticsMeta.SingleOrDefaultAsync(cancellationToken);
        if (meta is not null && meta.FormulaVersion == PlayerStatisticsFormula.Version)
        {
            logger.LogInformation("Player statistics are current at formula version {Version}; no rebuild.", PlayerStatisticsFormula.Version);
            return;
        }

        logger.LogInformation(
            "Rebuilding player statistics: stored formula version {StoredVersion} is not {Version}.",
            meta?.FormulaVersion,
            PlayerStatisticsFormula.Version);
        try
        {
            await rebuild.RebuildAsync(database, cancellationToken);
            if (meta is null)
            {
                database.PlayerStatisticsMeta.Add(new PlayerStatisticsMeta
                {
                    Id = PlayerStatisticsMeta.SingletonId,
                    FormulaVersion = PlayerStatisticsFormula.Version,
                    RebuiltAt = clock.GetCurrentInstant()
                });
            }
            else
            {
                meta.FormulaVersion = PlayerStatisticsFormula.Version;
                meta.RebuiltAt = clock.GetCurrentInstant();
            }

            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // A repair job must not be able to take the API down. One archive document the domain
            // refuses to read — which only a write outside a domain transaction can produce, such as a
            // bulk-SQL stress seeder — would otherwise crash-loop the container and take health, auth
            // and every unrelated endpoint with it. The transaction rolls back, the stored version stays
            // where it was, and the next start (or the next archive write) tries again.
            logger.LogError(exception, "Player statistics startup rebuild failed; the stored formula version is left unchanged.");
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private bool Enabled() =>
        configuration.GetValue<bool?>(EnabledKey)
        ?? configuration.GetValue<bool?>(EnvironmentEnabledKey)
        ?? true;
}
