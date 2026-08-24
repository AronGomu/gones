using System.Security.Claims;
using System.Text.Json;
using Gones.Api.Errors;
using Gones.Api.Leagues;
using Gones.Api.Organizations;
using Gones.Api.Security;
using Gones.Application.Concurrency;
using Gones.Domain.Archive;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.Api.Archive;

/// <summary>
/// The write half of the two upper archive tiers. Operation IDs are noun-first
/// (<c>Archive{Tier}{Verb}</c>) because the verb-first names are still owned by the legacy
/// <see cref="Gones.Api.Leagues.LeagueCommandEndpoints"/> surface, and two endpoints sharing a
/// <c>WithName</c> throw at startup.
/// </summary>
internal static class ArchiveCommandEndpoints
{
    public static void MapArchiveCommandEndpoints(this WebApplication app)
    {
        var organizer = app.MapGroup("/api/archive").RequireAuthorization(AuthorizationPolicies.Organizer);

        organizer.MapPost("/leagues", CreateLeagueAsync).WithName("ArchiveLeagueCreate").Produces<ArchiveCommandResponse>(StatusCodes.Status201Created);
        organizer.MapPatch("/leagues/{leagueId}/name", RenameLeagueAsync).WithName("ArchiveLeagueRename").Produces<ArchiveCommandResponse>();
        organizer.MapDelete("/leagues/{leagueId}", DeleteLeagueAsync).WithName("ArchiveLeagueDelete").Produces<ArchiveDeleteResponse>();
        organizer.MapPost("/league-seasons", CreateSeasonAsync).WithName("ArchiveLeagueSeasonCreate").Produces<ArchiveCommandResponse>(StatusCodes.Status201Created);
        organizer.MapPatch("/league-seasons/{seasonId}/name", RenameSeasonAsync).WithName("ArchiveLeagueSeasonRename").Produces<ArchiveCommandResponse>();
        organizer.MapPatch("/league-seasons/{seasonId}/status", ChangeSeasonStatusAsync).WithName("ArchiveLeagueSeasonChangeStatus").Produces<ArchiveCommandResponse>();
        organizer.MapPatch("/league-seasons/{seasonId}/league", MoveSeasonAsync).WithName("ArchiveLeagueSeasonMoveToLeague").Produces<ArchiveCommandResponse>();
        organizer.MapDelete("/league-seasons/{seasonId}", DeleteSeasonAsync).WithName("ArchiveLeagueSeasonDelete").Produces<ArchiveDeleteResponse>();
    }

    private static async Task<IResult> CreateLeagueAsync(CreateArchiveLeagueRequest request, ClaimsPrincipal principal, HttpResponse httpResponse, ArchiveCommandService service, CancellationToken cancellationToken)
    {
        var response = await service.CreateLeagueAsync(OrganizationPrincipal.UserId(principal), request, cancellationToken);
        httpResponse.Headers.ETag = response.ETag;
        return Results.Created($"/api/archive/leagues/{response.Id}", response);
    }

    private static Task<IResult> RenameLeagueAsync(string leagueId, RenameArchiveLeagueRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, ArchiveCommandService service, CancellationToken cancellationToken) =>
        OkAsync(response, service.RenameLeagueAsync(leagueId, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), request, cancellationToken));

    private static async Task<IResult> DeleteLeagueAsync(string leagueId, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, ArchiveCommandService service, CancellationToken cancellationToken)
    {
        var result = await service.DeleteLeagueAsync(leagueId, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), cancellationToken);
        response.Headers.ETag = result.ETag;
        return Results.Ok(result);
    }

    private static async Task<IResult> CreateSeasonAsync(CreateArchiveLeagueSeasonRequest request, ClaimsPrincipal principal, HttpResponse httpResponse, ArchiveCommandService service, CancellationToken cancellationToken)
    {
        var response = await service.CreateSeasonAsync(OrganizationPrincipal.UserId(principal), request, cancellationToken);
        httpResponse.Headers.ETag = response.ETag;
        return Results.Created($"/api/archive/league-seasons/{response.Id}", response);
    }

    private static Task<IResult> RenameSeasonAsync(string seasonId, RenameArchiveLeagueSeasonRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, ArchiveCommandService service, CancellationToken cancellationToken) =>
        OkAsync(response, service.RenameSeasonAsync(seasonId, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), request, cancellationToken));

    private static Task<IResult> ChangeSeasonStatusAsync(string seasonId, ChangeArchiveLeagueSeasonStatusRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, ArchiveCommandService service, CancellationToken cancellationToken) =>
        OkAsync(response, service.ChangeSeasonStatusAsync(seasonId, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), request, cancellationToken));

    private static Task<IResult> MoveSeasonAsync(string seasonId, MoveArchiveLeagueSeasonRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, ArchiveCommandService service, CancellationToken cancellationToken) =>
        OkAsync(response, service.MoveSeasonAsync(seasonId, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), request, cancellationToken));

    private static async Task<IResult> DeleteSeasonAsync(string seasonId, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, ArchiveCommandService service, CancellationToken cancellationToken)
    {
        var result = await service.DeleteSeasonAsync(seasonId, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), cancellationToken);
        response.Headers.ETag = result.ETag;
        return Results.Ok(result);
    }

    private static async Task<IResult> OkAsync(HttpResponse response, Task<ArchiveCommandResponse> pending)
    {
        var result = await pending;
        response.Headers.ETag = result.ETag;
        return Results.Ok(result);
    }

    private static long RequiredVersion(string? value)
    {
        if (!StrongETag.TryDecode(value, out var version)) throw new ConcurrencyConflictException();
        return version;
    }
}

internal sealed class ArchiveCommandService(GonesDbContext database, IClock clock, PlayerStatisticsRebuildService playerStatistics)
{
    public const int MaximumNameLength = 200;
    public const int MaximumIdLength = 200;

    private const string LeagueEntityType = "archiveLeague";
    private const string SeasonEntityType = "archiveLeagueSeason";
    private static readonly JsonSerializerOptions AuditJsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<ArchiveCommandResponse> CreateLeagueAsync(Guid actorId, CreateArchiveLeagueRequest request, CancellationToken cancellationToken)
    {
        var name = RequiredName(request.Name);
        var league = ArchiveLeague.Create(NewId(), name, clock.GetCurrentInstant());
        database.ArchiveLeagues.Add(league);
        AddAudit(actorId, "archive.league.created", LeagueEntityType, league.DocumentId, ["name"]);
        await SaveAsync(cancellationToken);
        return Response(league.DocumentId, league.Version, league.UpdatedAt);
    }

    public async Task<ArchiveCommandResponse> RenameLeagueAsync(string leagueId, Guid actorId, long expectedVersion, RenameArchiveLeagueRequest request, CancellationToken cancellationToken)
    {
        var name = RequiredName(request.Name);
        var league = await database.ArchiveLeagues
            .SingleOrDefaultAsync(item => item.DocumentId == leagueId && item.DeletedAt == null, cancellationToken)
            ?? throw new ResourceNotFoundException();
        RequireVersion(league.Version, expectedVersion);
        league.Rename(name, clock.GetCurrentInstant());
        AddAudit(actorId, "archive.league.renamed", LeagueEntityType, league.DocumentId, ["name"]);
        await SaveAsync(cancellationToken);
        return Response(league.DocumentId, league.Version, league.UpdatedAt);
    }

    /// <summary>
    /// Refuses while the League still has a live Season. The count runs under the League's row lock and
    /// every Season write that targets a League takes the same lock first, so no Season can slip in
    /// between the count and the soft delete.
    /// </summary>
    public async Task<ArchiveDeleteResponse> DeleteLeagueAsync(string leagueId, Guid actorId, long expectedVersion, CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var league = await LockLeagueAsync(leagueId, cancellationToken);
        RequireVersion(league.Version, expectedVersion);
        var stillReferenced = await database.ArchiveLeagueSeasons
            .AnyAsync(item => item.LeagueId == leagueId && item.DeletedAt == null, cancellationToken);
        if (stillReferenced) throw new ArchiveLeagueNotEmptyException();
        league.SoftDelete(clock.GetCurrentInstant());
        AddAudit(actorId, "archive.league.deleted", LeagueEntityType, league.DocumentId, ["deletedAt"]);
        await SaveAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new ArchiveDeleteResponse(league.DocumentId, true, league.Version, StrongETag.Encode(league.Version));
    }

    public async Task<ArchiveCommandResponse> CreateSeasonAsync(Guid actorId, CreateArchiveLeagueSeasonRequest request, CancellationToken cancellationToken)
    {
        var leagueId = RequiredId(request.LeagueId, "leagueId");
        var name = RequiredName(request.Name);
        var status = RequiredStatus(request.Status ?? "active");
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        _ = await LockLeagueAsync(leagueId, cancellationToken);
        // Create stamps TournamentCount = 0, PlayerCount = 0, both dates null and
        // CountsVersion = ArchiveCatalogCounts.Version itself, so nothing here touches the counters.
        var season = ArchiveLeagueSeason.Create(NewId(), leagueId, name, status, clock.GetCurrentInstant());
        database.ArchiveLeagueSeasons.Add(season);
        AddAudit(actorId, "archive.season.created", SeasonEntityType, season.DocumentId, ["name", "leagueId", "status"]);
        await SaveAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Response(season.DocumentId, season.Version, season.UpdatedAt);
    }

    public async Task<ArchiveCommandResponse> RenameSeasonAsync(string seasonId, Guid actorId, long expectedVersion, RenameArchiveLeagueSeasonRequest request, CancellationToken cancellationToken)
    {
        var name = RequiredName(request.Name);
        var season = await RequireSeasonAsync(seasonId, cancellationToken);
        RequireVersion(season.Version, expectedVersion);
        season.Rename(name, clock.GetCurrentInstant());
        AddAudit(actorId, "archive.season.renamed", SeasonEntityType, season.DocumentId, ["name"]);
        await SaveAsync(cancellationToken);
        return Response(season.DocumentId, season.Version, season.UpdatedAt);
    }

    public async Task<ArchiveCommandResponse> ChangeSeasonStatusAsync(string seasonId, Guid actorId, long expectedVersion, ChangeArchiveLeagueSeasonStatusRequest request, CancellationToken cancellationToken)
    {
        var status = RequiredStatus(request.Status);
        var season = await RequireSeasonAsync(seasonId, cancellationToken);
        RequireVersion(season.Version, expectedVersion);
        season.ChangeStatus(status, clock.GetCurrentInstant());
        AddAudit(actorId, "archive.season.status.changed", SeasonEntityType, season.DocumentId, ["status"]);
        await SaveAsync(cancellationToken);
        return Response(season.DocumentId, season.Version, season.UpdatedAt);
    }

    /// <summary>Locks the target League before the Season, keeping the League-before-Season lock order.</summary>
    public async Task<ArchiveCommandResponse> MoveSeasonAsync(string seasonId, Guid actorId, long expectedVersion, MoveArchiveLeagueSeasonRequest request, CancellationToken cancellationToken)
    {
        var leagueId = RequiredId(request.LeagueId, "leagueId");
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        _ = await LockLeagueAsync(leagueId, cancellationToken);
        var season = await RequireSeasonAsync(seasonId, cancellationToken);
        RequireVersion(season.Version, expectedVersion);
        season.MoveToLeague(leagueId, clock.GetCurrentInstant());
        AddAudit(actorId, "archive.season.league.changed", SeasonEntityType, season.DocumentId, ["leagueId"]);
        await SaveAsync(cancellationToken);
        // The League scope of player_statistics is "every Tournament of every Season this League owns",
        // so re-parenting a Season moves its whole result history from one League scope to another.
        await RebuildPlayerStatisticsAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Response(season.DocumentId, season.Version, season.UpdatedAt);
    }

    public async Task<ArchiveDeleteResponse> DeleteSeasonAsync(string seasonId, Guid actorId, long expectedVersion, CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var season = await LockSeasonAsync(seasonId, cancellationToken);
        RequireVersion(season.Version, expectedVersion);
        var now = clock.GetCurrentInstant();
        // Detach, never cascade: a Tournament outlives the Season it was played in and becomes
        // standalone. ArchiveTournament.MoveToSeason(null, now) would do exactly this per row, but a
        // Season may hold thousands of Tournaments and loading every aggregate to flip one column is the
        // wrong trade. One UPDATE writes the same four things the mutator writes - season_id, the
        // document's seasonId, updated_at and version + 1 - and touches no derived counter, because
        // detaching changes neither the Tournament's player_count nor its counts_version. Dropping the
        // document key rather than nulling it matches what the mutator would store: LeagueJson ignores
        // nulls when writing. Both halves are mandatory, because ck_archive_tournament_document_metadata
        // rejects any row whose season_id and document seasonId disagree. Raw SQL for a bulk archive
        // write is the established idiom; PlayerStatisticsRebuildService does the same.
        var detached = await database.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE archive_tournaments SET season_id = NULL, document = document - 'seasonId', updated_at = {now}, version = version + 1 WHERE season_id = {seasonId} AND deleted_at IS NULL",
            cancellationToken);
        season.SoftDelete(now);
        AddAudit(actorId, "archive.season.deleted", SeasonEntityType, season.DocumentId, ["deletedAt"]);
        if (detached > 0) AddAudit(actorId, "archive.season.tournaments.detached", SeasonEntityType, season.DocumentId, ["seasonId"]);
        await SaveAsync(cancellationToken);
        // The detached Tournaments are standalone now, which drops this Season's scope entirely and takes
        // its results back out of the owning League's scope.
        await RebuildPlayerStatisticsAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new ArchiveDeleteResponse(season.DocumentId, true, season.Version, StrongETag.Encode(season.Version));
    }

    private async Task<ArchiveLeague> LockLeagueAsync(string leagueId, CancellationToken cancellationToken) =>
        await database.ArchiveLeagues
            .FromSqlInterpolated($"SELECT * FROM archive_leagues WHERE document_id = {leagueId} AND deleted_at IS NULL FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken)
        ?? throw new ResourceNotFoundException();

    private async Task<ArchiveLeagueSeason> RequireSeasonAsync(string seasonId, CancellationToken cancellationToken) =>
        await database.ArchiveLeagueSeasons
            .SingleOrDefaultAsync(item => item.DocumentId == seasonId && item.DeletedAt == null, cancellationToken)
        ?? throw new ResourceNotFoundException();

    private async Task<ArchiveLeagueSeason> LockSeasonAsync(string seasonId, CancellationToken cancellationToken) =>
        await database.ArchiveLeagueSeasons
            .FromSqlInterpolated($"SELECT * FROM archive_league_seasons WHERE document_id = {seasonId} AND deleted_at IS NULL FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken)
        ?? throw new ResourceNotFoundException();

    private static string RequiredName(string? value)
    {
        var name = value?.Trim();
        if (string.IsNullOrWhiteSpace(name) || name.Length > MaximumNameLength)
            throw Validation("name", $"Name is required and cannot exceed {MaximumNameLength} characters.");
        return name;
    }

    private static string RequiredStatus(string? value)
    {
        if (value is not ("active" or "completed"))
            throw Validation("status", "Status must be active or completed.");
        return value;
    }

    private static string RequiredId(string? value, string field)
    {
        var id = value?.Trim();
        if (string.IsNullOrWhiteSpace(id) || id.Length > MaximumIdLength)
            throw Validation(field, $"{field} is required and cannot exceed {MaximumIdLength} characters.");
        return id;
    }

    // `actual` is the aggregate's `int Version`, widened by the caller; `expected` is the decoded
    // If-Match, which StrongETag always yields as a long.
    private static void RequireVersion(long actual, long expected)
    {
        if (actual != expected) throw new ConcurrencyConflictException();
    }

    private async Task SaveAsync(CancellationToken cancellationToken)
    {
        try
        {
            await database.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            throw new ConcurrencyConflictException();
        }
    }

    /// <summary>
    /// Rewrites <c>player_statistics</c> from the archive this command just changed, inside the caller's
    /// transaction and before the <c>SaveChangesAsync</c> that stages the new rows, so the read model and
    /// the write commit or roll back together — the same guarantee
    /// <see cref="Gones.Api.Leagues.LeagueCommandService"/> gives the legacy surface (ADR 0040).
    ///
    /// <para>Only two of this service's eight write paths call it, because a rebuild is a full recompute
    /// of every scope and the other six cannot move a single number in it. A League or Season scope is
    /// keyed by <b>document id</b> and computed from the results of the Tournaments underneath it, so
    /// renaming either changes nothing; creating either produces a tier with no Tournament, and a scope
    /// with no Match yields no row; a Season's own <c>status</c> is never read by the statistics, which
    /// look at each Tournament's; and a League delete is refused while any live Season still points at
    /// it, so a deletable League already owns no result. Only re-parenting a Season and deleting one —
    /// which detaches its Tournaments — change which scope a result is counted in.</para>
    /// </summary>
    private async Task RebuildPlayerStatisticsAsync(CancellationToken cancellationToken)
    {
        await playerStatistics.RebuildAsync(database, cancellationToken);
        await SaveAsync(cancellationToken);
    }

    private void AddAudit(Guid actorId, string action, string entityType, string entityId, IReadOnlyList<string> fields) =>
        database.AuditRecords.Add(new AuditRecord
        {
            ActorId = actorId,
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            RedactedDiff = JsonSerializer.Serialize(new { fields }, AuditJsonOptions),
            OccurredAt = clock.GetCurrentInstant()
        });

    private static ArchiveCommandResponse Response(string id, int version, Instant updatedAt) =>
        new(id, version, updatedAt, StrongETag.Encode(version));

    private static ApiValidationException Validation(string field, string message) =>
        new(new Dictionary<string, string[]> { [field] = [message] });

    private static string NewId() => Guid.NewGuid().ToString("D");
}

internal sealed record CreateArchiveLeagueRequest(string? Name);
internal sealed record RenameArchiveLeagueRequest(string? Name);
internal sealed record CreateArchiveLeagueSeasonRequest(string? LeagueId, string? Name, string? Status);
internal sealed record RenameArchiveLeagueSeasonRequest(string? Name);
internal sealed record ChangeArchiveLeagueSeasonStatusRequest(string? Status);
internal sealed record MoveArchiveLeagueSeasonRequest(string? LeagueId);

/// <summary>
/// Tier-agnostic write acknowledgement. Deliberately carries no `name`, `leagueId`, `status` or
/// `seasonId`: the brief hands this same record to the Tournament commands in T4, and a Tournament, a
/// LeagueSeason and a League have no field in common beyond identity and version. Callers refresh the
/// row itself through the catalog reads (T5-T7) after invalidating their cache.
/// </summary>
internal sealed record ArchiveCommandResponse(string Id, int DocumentVersion, Instant UpdatedAt, string ETag);

internal sealed record ArchiveDeleteResponse(string Id, bool Deleted, int DocumentVersion, string ETag);

/// <summary>409. A League that still has at least one live LeagueSeason cannot be deleted.</summary>
internal sealed class ArchiveLeagueNotEmptyException()
    : ApiException("archive_league_not_empty", "League still has League Seasons and cannot be deleted.", StatusCodes.Status409Conflict);
