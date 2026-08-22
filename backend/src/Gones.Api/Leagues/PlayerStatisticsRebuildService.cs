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
///
/// <para>Since the three-tier rebuild the table holds <b>one row per (scope, player)</b>: the global
/// scope, one scope per League, one scope per LeagueSeason. Each scope is recomputed from its own
/// Tournaments — rating, matches, tournaments played and winrate are all replayed inside the scope
/// and are never a global number filtered down. A standalone Tournament belongs to no League and no
/// Season, so it feeds the global scope only. The cost is roughly three passes over the archive
/// instead of one, because every attached Tournament is walked once for its Season, once for its
/// League and once globally.</para>
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
        await LockAsync(database, cancellationToken);

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

        var scopes = await ArchiveScopeSource.LoadAsync(
            database,
            live.Select(aggregate => aggregate.ReadDocument()).ToList(),
            cancellationToken);
        var rows = new List<PlayerStatisticsRow>();
        foreach (var scope in scopes)
        {
            foreach (var statistics in LeagueRules.CalculateGlobalPlayerStatistics(scope.Data))
            {
                rows.Add(PlayerStatisticsRow.From(statistics, scope.ScopeKind, scope.ScopeId));
            }
        }

        // The delete runs inside the caller's transaction; the inserts are staged for the same
        // SaveChangesAsync. Any row this context still tracks belongs to the state being replaced.
        await database.Database.ExecuteSqlRawAsync("DELETE FROM player_statistics", cancellationToken);
        foreach (var entry in database.ChangeTracker.Entries<PlayerStatisticsRow>().ToList()) entry.State = EntityState.Detached;
        database.PlayerStatistics.AddRange(rows);
        await StampAsync(database, cancellationToken);

        logger.LogInformation(
            "Player statistics rebuilt: {RowCount} rows across {ScopeCount} scopes in {ElapsedMilliseconds} ms.",
            rows.Count,
            scopes.Count,
            Stopwatch.GetElapsedTime(started).TotalMilliseconds);
    }

    /// <summary>
    /// Serialises every rebuild against every other one, for the whole of the caller's transaction.
    ///
    /// <para>Two transactions editing <b>different</b> Leagues both rewrite the whole table. Under READ
    /// COMMITTED the second one's <c>DELETE</c> is evaluated against a snapshot taken before the first
    /// committed, so it removes nothing the first inserted and then inserts the same Player Names on
    /// top of them — a duplicate key on <c>pk_player_statistics</c>, which turns a legal archive write
    /// into a 500 and rolls it back. Taking the lock first makes the loser wait and then rebuild over
    /// the winner's committed rows.</para>
    ///
    /// <para>Transaction-scoped, so it is released by the commit or rollback that ends the caller's
    /// transaction and never by this method. Every caller holds one (ADR 0040): the rebuild's own
    /// <c>DELETE</c> is raw SQL that must share a transaction with the save that stages the
    /// replacement, so a rebuild outside one is already broken for a louder reason.</para>
    /// </summary>
    private static Task LockAsync(GonesDbContext database, CancellationToken cancellationToken) =>
        database.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock(hashtext({LockScope}), hashtext({LockKey}))",
            cancellationToken);

    private const string LockScope = "gones:player-statistics";
    private const string LockKey = "rebuild";

    /// <summary>
    /// Records that the table now holds this build's formula, at this transaction's clock. The stamp is
    /// what the public rankings ETag is derived from, so it has to move on <b>every</b> rebuild and not
    /// only on the startup repair — otherwise an archive edit that leaves the player count alone would
    /// keep answering conditional requests with a 304 over stale numbers.
    ///
    /// <para>Raw SQL rather than a tracked entity: the caller may already be holding the meta row, and
    /// an upsert is the one shape that is correct whether or not it exists yet. It runs inside the
    /// caller's transaction, like the delete above.</para>
    /// </summary>
    private static Task StampAsync(GonesDbContext database, CancellationToken cancellationToken) =>
        database.Database.ExecuteSqlInterpolatedAsync(
            $"""
            INSERT INTO player_statistics_meta (id, formula_version, rebuilt_at)
            VALUES ({PlayerStatisticsMeta.SingletonId}, {PlayerStatisticsFormula.Version}, now())
            ON CONFLICT (id) DO UPDATE SET formula_version = EXCLUDED.formula_version, rebuilt_at = EXCLUDED.rebuilt_at
            """,
            cancellationToken);
}
