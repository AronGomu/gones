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

namespace Gones.Api.Leagues;

/// <summary>
/// Settings-level Player Name maintenance over the shared League source.
/// Organizer/Admin only. Source matching is exact and case-sensitive.
/// </summary>
internal static class PlayerNameMaintenanceEndpoints
{
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

internal sealed class PlayerNameMaintenanceService(GonesDbContext database, IClock clock, PlayerStatisticsRebuildService playerStatistics)
{
    public async Task<PlayerNameListResponse> SearchAsync(string? search, CancellationToken cancellationToken)
    {
        var names = new Dictionary<string, (int Occurrences, HashSet<string> Leagues)>(StringComparer.Ordinal);
        foreach (var row in await ActiveTournamentsAsync(cancellationToken))
        {
            foreach (var slot in LeaguePlayerNameMaintenance.EnumeratePlayerNameSlots(Carrier(row)))
            {
                var entry = names.TryGetValue(slot, out var existing) ? existing : (0, new HashSet<string>(StringComparer.Ordinal));
                entry.Item1 += 1;
                entry.Item2.Add(row.DocumentId);
                names[slot] = entry;
            }
        }

        var term = (search ?? string.Empty).Trim();
        var items = names
            .Where(item => term.Length == 0 || item.Key.Contains(term, StringComparison.OrdinalIgnoreCase))
            .Select(item => new PlayerNameSummary(item.Key, item.Value.Occurrences, item.Value.Leagues.Count))
            .OrderBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(item => item.Name, StringComparer.Ordinal)
            .ToArray();
        return new PlayerNameListResponse(items);
    }

    public async Task<PlayerRenamePreviewResponse> PreviewAsync(string fromName, string toName, CancellationToken cancellationToken)
    {
        var (from, to) = RequireNames(fromName, toName);
        var impacts = new List<PlayerRenameLeagueImpact>();
        var mergesWithExisting = false;
        foreach (var row in await ActiveTournamentsAsync(cancellationToken))
        {
            var document = Carrier(row);
            var occurrences = LeaguePlayerNameMaintenance.CountExactOccurrences(document, from);
            if (!mergesWithExisting)
            {
                mergesWithExisting = LeaguePlayerNameMaintenance.EnumeratePlayerNameSlots(document)
                    .Any(slot => !string.Equals(slot, from, StringComparison.Ordinal) && SameName(slot, to));
            }
            if (occurrences == 0) continue;
            impacts.Add(new PlayerRenameLeagueImpact(row.DocumentId, row.Name, occurrences));
        }

        return new PlayerRenamePreviewResponse(
            from,
            to,
            impacts.Count,
            impacts.Sum(item => item.OccurrenceCount),
            mergesWithExisting,
            impacts);
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

    private async Task<IReadOnlyList<ArchiveTournament>> ActiveTournamentsAsync(CancellationToken cancellationToken) =>
        await database.ArchiveTournaments.AsNoTracking()
            .Where(item => item.DeletedAt == null)
            .OrderBy(item => item.DocumentId)
            .ToListAsync(cancellationToken);

    /// <summary>
    /// One Tournament wrapped in the single-Tournament League the name-maintenance rules still take.
    /// The carrier's id and name never leave this method — the response rows carry the Tournament's.
    /// </summary>
    private static LeagueDocument Carrier(ArchiveTournament row)
    {
        var document = row.ReadDocument();
        return new LeagueDocument(row.DocumentId, row.Name, "active", [ArchiveDocumentAdapter.ToLegacyTournament(document, document.SeasonId ?? string.Empty)]);
    }

    private static bool SameName(string left, string right) =>
        string.Equals(left.Trim(), right.Trim(), StringComparison.OrdinalIgnoreCase);

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
}

internal sealed record PlayerRenameRequest(string FromName, string ToName);
internal sealed record PlayerNameListResponse(IReadOnlyList<PlayerNameSummary> Items);
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
