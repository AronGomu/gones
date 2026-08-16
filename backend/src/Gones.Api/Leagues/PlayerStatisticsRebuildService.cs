using System.Diagnostics;
using Gones.Domain.Leagues;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Gones.Api.Leagues;

/// <summary>
/// Rewrites the whole <c>player_statistics</c> table from the League archive (ADR 0040).
///
/// <para>Reads are indexed and bounded because the cost moves here, to a write that happens a few times
/// a week. The rebuild is deliberately total rather than incremental: one edited Match can change a
/// Nemesis, a Rival and a most-played archetype for two players at once, and recomputing everything is
/// both simpler and impossible to leave half-applied.</para>
/// </summary>
internal sealed class PlayerStatisticsRebuildService(ILogger<PlayerStatisticsRebuildService> logger)
{
    /// <summary>
    /// Recomputes every row and stages the replacement. Deliberately does <b>not</b> call
    /// <c>SaveChangesAsync</c>: the caller owns the transaction, so a write that fails afterwards rolls
    /// the statistics back with the archive change that caused them.
    /// </summary>
    public async Task RebuildAsync(GonesDbContext database, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(database);
        var started = Stopwatch.GetTimestamp();

        // Tracked, not AsNoTracking: the caller is mid-write, so the archive change that triggered this
        // rebuild lives in the change tracker and not yet in the table. A tracked query returns the
        // in-memory instance for a row that is already loaded, and pending inserts are added below.
        var stored = await database.LeagueArchiveAggregates.ToListAsync(cancellationToken);
        var pending = database.ChangeTracker.Entries<LeagueArchiveAggregate>()
            .Where(entry => entry.State == EntityState.Added)
            .Select(entry => entry.Entity);
        var deleted = database.ChangeTracker.Entries<LeagueArchiveAggregate>()
            .Where(entry => entry.State == EntityState.Deleted)
            .Select(entry => entry.Entity)
            .ToHashSet();
        var live = stored.Concat(pending)
            .Where(aggregate => aggregate.DeletedAt is null && !deleted.Contains(aggregate))
            .ToList();

        var data = new GonesData(LeagueNormalizer.GonesDataVersion, live.Select(aggregate => aggregate.ReadDocument()).ToList(), []);
        var rows = LeagueRules.CalculateGlobalPlayerStatistics(data);

        // The delete runs inside the caller's transaction; the inserts are staged for the same
        // SaveChangesAsync. Any row this context still tracks belongs to the state being replaced.
        await database.Database.ExecuteSqlRawAsync("DELETE FROM player_statistics", cancellationToken);
        foreach (var entry in database.ChangeTracker.Entries<PlayerStatisticsRow>().ToList()) entry.State = EntityState.Detached;
        database.PlayerStatistics.AddRange(rows.Select(PlayerStatisticsRow.From));

        logger.LogInformation(
            "Player statistics rebuilt: {RowCount} rows from {LeagueCount} Leagues in {ElapsedMilliseconds} ms.",
            rows.Count,
            live.Count,
            Stopwatch.GetElapsedTime(started).TotalMilliseconds);
    }
}
