using System.Security.Claims;
using System.Text.Json;
using Gones.Api.Errors;
using Gones.Api.Organizations;
using Gones.Api.Security;
using Gones.Application.Concurrency;
using Gones.Domain.Archive;
using Gones.Domain.Leagues;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using Npgsql;

namespace Gones.Api.Leagues;

/// <summary>
/// Settings-level Player Name maintenance over the shared League source.
/// Organizer/Admin only. Source matching is exact and case-sensitive.
/// </summary>
internal static class PlayerNameMaintenanceEndpoints
{
    /// <summary>
    /// The player-name catalog ceiling. The maintenance screen downloads the whole catalog once and
    /// filters it locally, so the cap bounds the body rather than paging it.
    /// </summary>
    public const int MaximumPlayerNameCatalogSize = 5000;
    public const string MaximumPlayerNameCatalogSizeKey = "Gones:Maintenance:MaximumPlayerNameCatalogSize";

    public static void MapPlayerNameMaintenanceEndpoints(this WebApplication app)
    {
        var maintenance = app.MapGroup("/api/maintenance").RequireAuthorization(AuthorizationPolicies.Organizer);

        maintenance.MapGet("/player-names", SearchAsync)
            .WithName("ListMaintenancePlayerNames")
            .Produces<PlayerNameListResponse>();
        maintenance.MapPost("/player-names/rename-preview", PreviewAsync)
            .WithName("PreviewMaintenancePlayerRename")
            .Produces<PlayerRenamePreviewResponse>()
            .ProducesProblem(StatusCodes.Status400BadRequest);
        maintenance.MapPost("/player-names/rename", RenameAsync)
            .WithName("CommitMaintenancePlayerRename")
            .Produces<PlayerRenameCommitResponse>()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound);
    }

    private static async Task<IResult> SearchAsync(
        string? search,
        PlayerNameMaintenanceService service,
        CancellationToken cancellationToken) =>
        Results.Ok(await service.SearchAsync(search, cancellationToken));

    private static async Task<IResult> PreviewAsync(
        PlayerRenameRequest request,
        PlayerNameMaintenanceService service,
        CancellationToken cancellationToken) =>
        Results.Ok(await service.PreviewAsync(request.FromName, request.ToName, cancellationToken));

    private static async Task<IResult> RenameAsync(
        PlayerRenameRequest request,
        ClaimsPrincipal principal,
        PlayerNameMaintenanceService service,
        CancellationToken cancellationToken) =>
        Results.Ok(await service.RenameAsync(OrganizationPrincipal.UserId(principal), request.FromName, request.ToName, cancellationToken));
}

internal sealed class PlayerNameMaintenanceService(
    GonesDbContext database,
    IClock clock,
    PlayerStatisticsRebuildService playerStatistics,
    IConfiguration configuration,
    ILogger<PlayerNameMaintenanceService> logger)
{
    /// <summary>
    /// One row per trimmed, non-empty player-name slot of every live Tournament — the SQL twin of
    /// LeaguePlayerNameMaintenance.EnumeratePlayerNameSlots, so the list never deserializes a document.
    /// </summary>
    private const string PlayerNameSlotsSql = """
        FROM archive_tournaments t
        CROSS JOIN LATERAL jsonb_array_elements(t.document -> 'rounds') AS r(round)
        CROSS JOIN LATERAL jsonb_array_elements(r.round -> 'entries') AS e(entry)
        CROSS JOIN LATERAL (
            SELECT btrim(candidate.value, E' \t\r\n') AS name
            FROM (VALUES
                (CASE WHEN e.entry ->> 'kind' = 'match' THEN e.entry ->> 'player1Name' END),
                (CASE WHEN e.entry ->> 'kind' = 'match' THEN e.entry ->> 'player2Name' END),
                (CASE WHEN e.entry ->> 'kind' = 'bye' THEN e.entry ->> 'playerName' END),
                (CASE WHEN e.entry ->> 'kind' = 'invalid' THEN e.entry ->> 'player' END),
                (CASE WHEN e.entry ->> 'kind' = 'invalid' THEN e.entry ->> 'opponent' END)
            ) AS candidate(value)
            WHERE candidate.value IS NOT NULL AND btrim(candidate.value, E' \t\r\n') <> ''
        ) AS s
        WHERE t.deleted_at IS NULL
        """;

    private static readonly string ListSql = $"""
        SELECT s.name AS "Name", count(*)::int AS "OccurrenceCount", count(DISTINCT t.document_id)::int AS "LeagueCount"
        {PlayerNameSlotsSql}
          AND (@search = '' OR s.name ILIKE '%' || @search || '%' ESCAPE '\')
        GROUP BY s.name
        ORDER BY lower(s.name) COLLATE "C", s.name COLLATE "C"
        LIMIT @limit
        """;

    private static readonly string ImpactsSql = $"""
        SELECT t.document_id AS "Id", t.name AS "Name", count(*)::int AS "OccurrenceCount"
        {PlayerNameSlotsSql}
          AND s.name = @from
        GROUP BY t.document_id, t.name
        ORDER BY t.document_id
        """;

    private static readonly string MergeSql = $"""
        SELECT EXISTS (
            SELECT 1
            {PlayerNameSlotsSql}
              AND s.name <> @from
              AND lower(s.name) = lower(@to)
        ) AS "Value"
        """;

    public async Task<PlayerNameListResponse> SearchAsync(string? search, CancellationToken cancellationToken)
    {
        // The term is a literal substring, the way the in-memory Contains was: its own wildcards escape.
        var term = (search ?? string.Empty).Trim();
        var escaped = term.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
        var ceiling = configuration.GetValue(
            PlayerNameMaintenanceEndpoints.MaximumPlayerNameCatalogSizeKey,
            PlayerNameMaintenanceEndpoints.MaximumPlayerNameCatalogSize);
        var rows = await database.Database
            .SqlQueryRaw<PlayerNameCountRow>(ListSql, new NpgsqlParameter("search", escaped), new NpgsqlParameter("limit", ceiling + 1))
            .ToListAsync(cancellationToken);

        var truncated = rows.Count > ceiling;
        if (truncated)
        {
            rows.RemoveRange(ceiling, rows.Count - ceiling);
            logger.LogWarning("Maintenance player-name catalog truncated: ceiling={Ceiling}", ceiling);
        }

        return new PlayerNameListResponse(
            rows.Select(row => new PlayerNameSummary(row.Name, row.OccurrenceCount, row.LeagueCount)).ToArray(),
            truncated);
    }

    public async Task<PlayerRenamePreviewResponse> PreviewAsync(string fromName, string toName, CancellationToken cancellationToken)
    {
        var (from, to) = RequireNames(fromName, toName);
        var impacts = await database.Database
            .SqlQueryRaw<PlayerRenameImpactRow>(ImpactsSql, new NpgsqlParameter("from", from))
            .ToListAsync(cancellationToken);
        var mergesWithExisting = await database.Database
            .SqlQueryRaw<bool>(MergeSql, new NpgsqlParameter("from", from), new NpgsqlParameter("to", to))
            .SingleAsync(cancellationToken);

        return new PlayerRenamePreviewResponse(
            from,
            to,
            impacts.Count,
            impacts.Sum(item => item.OccurrenceCount),
            mergesWithExisting,
            impacts.Select(row => new PlayerRenameLeagueImpact(row.Id, row.Name, row.OccurrenceCount)).ToArray());
    }

    public async Task<PlayerRenameCommitResponse> RenameAsync(Guid actorId, string fromName, string toName, CancellationToken cancellationToken)
    {
        var (from, to) = RequireNames(fromName, toName);
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var rows = await database.ArchiveTournaments
            .FromSqlRaw("SELECT * FROM archive_tournaments WHERE deleted_at IS NULL ORDER BY document_id FOR UPDATE")
            .ToListAsync(cancellationToken);

        var now = clock.GetCurrentInstant();
        var affected = new List<ArchiveTournament>();
        var affectedOccurrences = 0;
        foreach (var row in rows)
        {
            var document = Carrier(row);
            var occurrences = LeaguePlayerNameMaintenance.CountExactOccurrences(document, from);
            if (occurrences == 0) continue;
            var renamed = LeaguePlayerNameMaintenance.RenamePlayerExact(document, from, to).Tournaments[0];
            row.Apply(row.ReadDocument() with { Rounds = renamed.Rounds, PlayerArchetypes = renamed.PlayerArchetypes }, now);
            affectedOccurrences += occurrences;
            affected.Add(row);
            database.AuditRecords.Add(new AuditRecord
            {
                ActorId = actorId,
                Action = "maintenance.player_name.renamed",
                EntityType = "archive-tournament",
                EntityId = row.DocumentId,
                RedactedDiff = JsonSerializer.Serialize(new { fields = new[] { "playerNames" }, occurrences }),
                OccurredAt = now
            });
        }

        if (affected.Count == 0) throw new ResourceNotFoundException();

        try
        {
            // A rename changes the very key of the read model, so it is an archive write like any other
            // (ADR 0040) and rebuilds inside this transaction.
            await playerStatistics.RebuildAsync(database, cancellationToken);
            await database.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            throw new ConcurrencyConflictException();
        }

        await transaction.CommitAsync(cancellationToken);
        var results = affected
            .Select(row => new PlayerRenameLeagueResult(row.DocumentId, row.Version, StrongETag.Encode(row.Version)))
            .ToArray();
        return new PlayerRenameCommitResponse(from, to, results.Length, affectedOccurrences, results);
    }

    /// <summary>
    /// One Tournament wrapped in the single-Tournament League the name-maintenance rules still take.
    /// The carrier's id and name never leave this method — the response rows carry the Tournament's.
    /// </summary>
    private static LeagueDocument Carrier(ArchiveTournament row)
    {
        var document = row.ReadDocument();
        return new LeagueDocument(row.DocumentId, row.Name, "active", [ArchiveDocumentAdapter.ToLegacyTournament(document, document.SeasonId ?? string.Empty)]);
    }

    private static (string From, string To) RequireNames(string fromName, string toName)
    {
        var from = (fromName ?? string.Empty).Trim();
        var to = (toName ?? string.Empty).Trim();
        if (from.Length == 0) throw Validation("fromName", "Source Player Name is required.");
        if (to.Length == 0) throw Validation("toName", "Target Player Name is required.");
        return (from, to);
    }

    private static ApiValidationException Validation(string field, string message) =>
        new(new Dictionary<string, string[]> { [field] = [message] });

    private sealed class PlayerNameCountRow
    {
        public string Name { get; set; } = string.Empty;
        public int OccurrenceCount { get; set; }
        public int LeagueCount { get; set; }
    }

    private sealed class PlayerRenameImpactRow
    {
        public string Id { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public int OccurrenceCount { get; set; }
    }
}

internal sealed record PlayerRenameRequest(string FromName, string ToName);
internal sealed record PlayerNameListResponse(IReadOnlyList<PlayerNameSummary> Items, bool Truncated);
internal sealed record PlayerNameSummary(string Name, int OccurrenceCount, int LeagueCount);
internal sealed record PlayerRenameLeagueImpact(string Id, string Name, int OccurrenceCount);
internal sealed record PlayerRenamePreviewResponse(
    string FromName,
    string ToName,
    int AffectedLeagueCount,
    int AffectedOccurrenceCount,
    bool MergesWithExistingPlayer,
    IReadOnlyList<PlayerRenameLeagueImpact> Leagues);
internal sealed record PlayerRenameLeagueResult(string Id, long DocumentVersion, string ETag);
internal sealed record PlayerRenameCommitResponse(
    string FromName,
    string ToName,
    int AffectedLeagueCount,
    int AffectedOccurrenceCount,
    IReadOnlyList<PlayerRenameLeagueResult> Leagues);
