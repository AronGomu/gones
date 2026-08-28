using System.Data;
using System.Data.Common;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using Gones.Domain.Leagues;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Storage;
using NodaTime;

namespace Gones.Api.Leagues;

/// <summary>One <c>(scopeKind, scopeId)</c> partition of the archive, shaped for the statistics maths.</summary>
internal sealed record ArchiveStatisticsScope(string ScopeKind, string ScopeId, GonesData Data);

/// <summary>One Archive Tournament, read by column name.</summary>
internal sealed record ArchiveTournamentSource(
    string DocumentId,
    string? SeasonId,
    string Name,
    string TournamentDate,
    string Status,
    string Document);

/// <summary>
/// Splits the three-tier archive into the scopes <c>player_statistics</c> is keyed by: the global
/// scope, one scope per League, one scope per LeagueSeason.
///
/// <para><b>A standalone Tournament — <c>season_id IS NULL</c> — belongs to no League and no Season,
/// so it feeds the global scope only.</b> The same fallback covers a Tournament whose season row is
/// gone: it degrades to standalone rather than inventing a scope.</para>
///
/// <para>Every scope is a full, independent input to
/// <see cref="LeagueRules.CalculateGlobalPlayerStatistics"/>. Nothing here filters a global number
/// down: a League rating is a Glicko-2 replay over that League's Tournaments from the published
/// seed, and a League <c>tournamentsPlayed</c> counts that League's Tournaments only. That is the
/// whole point of storing per-scope rows rather than one global row and a WHERE clause.</para>
///
/// <para>The archive is read by <b>column name</b> and never by entity type. Persisted rows come
/// from a raw command over the frozen column names; rows the caller has staged but not yet saved
/// come from the change tracker, matched through <see cref="RelationalPropertyExtensions.GetColumnName(IReadOnlyProperty, in StoreObjectIdentifier)"/>.
/// Both halves are needed because an archive command runs this rebuild inside its write
/// transaction and may do so before <c>SaveChangesAsync</c>.</para>
/// </summary>
internal static class ArchiveScopeSource
{
    private const string SeasonTable = "archive_league_seasons";
    private const string TournamentTable = "archive_tournaments";

    /// <summary>
    /// The League id stamped into every shared <see cref="TournamentDocument"/>. The rebuild maths never
    /// reads a Tournament's League id, so one value serves every scope and the document stays shareable.
    /// </summary>
    private const string SharedContainerId = "archive";

    /// <summary>One Tournament, parsed once, alongside the Season that decides which scopes it joins.</summary>
    private sealed record ParsedArchiveTournament(string? SeasonId, TournamentDocument Document);

    /// <summary>
    /// Streams the scopes rather than materializing them, so the caller holds one scope's wrapper at a
    /// time. The yield order is part of the contract: global, then Leagues, then Seasons, each ordered
    /// by scope id.
    /// </summary>
    public static async IAsyncEnumerable<ArchiveStatisticsScope> LoadAsync(
        GonesDbContext database,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var seasons = await LoadSeasonsAsync(database, cancellationToken);
        var tournaments = (await LoadTournamentsAsync(database, cancellationToken))
            .OrderBy(tournament => tournament.DocumentId, StringComparer.Ordinal)
            .Select(tournament => new ParsedArchiveTournament(tournament.SeasonId, Parse(tournament)))
            .ToList();

        // The global scope carries every live Tournament, standalone ones included. The legacy
        // aggregates it also carried are retired (T19), so this is the whole archive.
        yield return Scope(
            PlayerStatisticsScope.Global,
            PlayerStatisticsScope.GlobalScopeId,
            tournaments.Select(tournament => tournament.Document).ToList());

        var attached = tournaments
            .Where(tournament => tournament.SeasonId is not null && seasons.ContainsKey(tournament.SeasonId))
            .ToList();

        foreach (var group in attached
            .GroupBy(tournament => seasons[tournament.SeasonId!], StringComparer.Ordinal)
            .OrderBy(group => group.Key, StringComparer.Ordinal))
        {
            yield return Scope(PlayerStatisticsScope.League, group.Key, group.Select(tournament => tournament.Document).ToList());
        }

        foreach (var group in attached
            .GroupBy(tournament => tournament.SeasonId!, StringComparer.Ordinal)
            .OrderBy(group => group.Key, StringComparer.Ordinal))
        {
            yield return Scope(PlayerStatisticsScope.Season, group.Key, group.Select(tournament => tournament.Document).ToList());
        }
    }

    /// <summary>
    /// One Tournament parsed exactly once. The document is immutable, so the same instance is shared
    /// by every scope that contains it; <see cref="SharedContainerId"/> stands in for the League id
    /// because the statistics maths never reads a Tournament's League id.
    /// </summary>
    private static TournamentDocument Parse(ArchiveTournamentSource tournament)
    {
        using var parsed = JsonDocument.Parse(tournament.Document);
        return new TournamentDocument(
            tournament.DocumentId,
            SharedContainerId,
            tournament.Name,
            tournament.TournamentDate,
            tournament.Status,
            ReadArray<RoundDocument>(parsed.RootElement, "rounds"),
            ReadArray<PlayerArchetypeDocument>(parsed.RootElement, "playerArchetypes"));
    }

    private static ArchiveStatisticsScope Scope(
        string scopeKind,
        string scopeId,
        IReadOnlyList<TournamentDocument> documents)
    {
        // The synthetic League exists because the domain walks data.Leagues[].Tournaments[]. It is a
        // container, never a scope: the statistics maths reads a Tournament's status and date and
        // never the League around it — except the League id, which keys the tournamentsPlayed dedup, so
        // it keeps the exact per-scope value it always had.
        var containerId = $"{scopeKind}:{scopeId}";
        var leagues = new List<LeagueDocument> { new(containerId, containerId, "completed", documents) };
        return new ArchiveStatisticsScope(
            scopeKind,
            scopeId,
            new GonesData(LeagueNormalizer.GonesDataVersion, leagues, []));
    }

    private static IReadOnlyList<T> ReadArray<T>(JsonElement root, string property) =>
        root.TryGetProperty(property, out var element) && element.ValueKind == JsonValueKind.Array
            ? element.Deserialize<List<T>>(LeagueJson.Options) ?? []
            : [];

    /// <summary>Season document id → League document id, for every live Season.</summary>
    private static async Task<Dictionary<string, string>> LoadSeasonsAsync(
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var seasons = await QueryAsync(
            database,
            "SELECT document_id, league_id FROM archive_league_seasons WHERE deleted_at IS NULL",
            reader => (DocumentId: reader.GetString(0), LeagueId: reader.GetString(1)),
            cancellationToken);
        var byId = seasons.ToDictionary(season => season.DocumentId, season => season.LeagueId, StringComparer.Ordinal);
        foreach (var entry in TrackedEntries(database, SeasonTable))
        {
            var documentId = Text(ColumnValue(entry, "document_id"));
            if (documentId is null) continue;
            if (entry.State == EntityState.Deleted || ColumnValue(entry, "deleted_at") is not null)
            {
                byId.Remove(documentId);
                continue;
            }
            var leagueId = Text(ColumnValue(entry, "league_id"));
            if (leagueId is not null) byId[documentId] = leagueId;
        }
        return byId;
    }

    private static async Task<List<ArchiveTournamentSource>> LoadTournamentsAsync(
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var stored = await QueryAsync(
            database,
            """
            SELECT document_id, season_id, name, tournament_date::text, status, document::text
            FROM archive_tournaments
            WHERE deleted_at IS NULL
            """,
            reader => new ArchiveTournamentSource(
                reader.GetString(0),
                reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                reader.GetString(5)),
            cancellationToken);
        var byId = stored.ToDictionary(tournament => tournament.DocumentId, StringComparer.Ordinal);
        foreach (var entry in TrackedEntries(database, TournamentTable))
        {
            var documentId = Text(ColumnValue(entry, "document_id"));
            if (documentId is null) continue;
            if (entry.State == EntityState.Deleted || ColumnValue(entry, "deleted_at") is not null)
            {
                byId.Remove(documentId);
                continue;
            }
            byId[documentId] = new ArchiveTournamentSource(
                documentId,
                Text(ColumnValue(entry, "season_id")),
                Text(ColumnValue(entry, "name")) ?? string.Empty,
                IsoDate(ColumnValue(entry, "tournament_date")),
                Text(ColumnValue(entry, "status")) ?? string.Empty,
                Text(ColumnValue(entry, "document")) ?? "{}");
        }
        return byId.Values.ToList();
    }

    private static IEnumerable<EntityEntry> TrackedEntries(GonesDbContext database, string table) =>
        database.ChangeTracker.Entries().Where(entry => entry.Metadata.GetTableName() == table);

    /// <summary>
    /// The current value behind a column, found by column name so this file names no archive entity
    /// type. The plan freezes the column names; it does not freeze the CLR ones.
    /// </summary>
    private static object? ColumnValue(EntityEntry entry, string column)
    {
        var table = entry.Metadata.GetTableName();
        if (table is null) return null;
        var identifier = StoreObjectIdentifier.Table(table, entry.Metadata.GetSchema());
        var property = entry.Metadata.GetProperties()
            .FirstOrDefault(candidate => candidate.GetColumnName(identifier) == column);
        return property is null ? null : entry.Property(property.Name).CurrentValue;
    }

    private static string? Text(object? value) => value switch
    {
        null => null,
        string text => text,
        _ => value.ToString()
    };

    /// <summary>
    /// A stored Tournament date as the ISO string the domain compares and groups rating periods by.
    /// The three shapes a <c>date</c> column can surface as are all handled, so this does not depend
    /// on which CLR type the archive aggregate chose.
    /// </summary>
    private static string IsoDate(object? value) => value switch
    {
        null => string.Empty,
        LocalDate local => local.ToString("uuuu-MM-dd", CultureInfo.InvariantCulture),
        DateOnly date => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        DateTime moment => moment.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        string text => text.Length >= 10 ? text[..10] : text,
        _ => string.Empty
    };

    /// <summary>
    /// Reads through the context's own connection and enlists in the caller's transaction, so the
    /// rows this sees are the rows the rebuild's <c>DELETE</c> and inserts will be committed beside.
    /// </summary>
    private static async Task<List<T>> QueryAsync<T>(
        GonesDbContext database,
        string sql,
        Func<DbDataReader, T> read,
        CancellationToken cancellationToken)
    {
        var connection = database.Database.GetDbConnection();
        if (connection.State != ConnectionState.Open) await connection.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Transaction = database.Database.CurrentTransaction?.GetDbTransaction();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var rows = new List<T>();
        while (await reader.ReadAsync(cancellationToken)) rows.Add(read(reader));
        return rows;
    }
}
