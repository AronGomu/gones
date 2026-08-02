using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;
using Gones.Api.Errors;
using Gones.Api.Organizations;
using Gones.Api.Security;
using Gones.Api.Validation;
using Gones.Application.Concurrency;
using Gones.Domain.Calendar;
using Gones.Domain.Catalog;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using NodaTime.Text;

namespace Gones.Api.Tournaments;

internal static class TournamentLifecycleEndpoints
{
    private const int DefaultPageSize = 20;
    private const int MaximumPageSize = 100;

    public static void MapTournamentLifecycleEndpoints(this WebApplication app)
    {
        var organizer = app.MapGroup("/api").RequireAuthorization(AuthorizationPolicies.Organizer);
        organizer.MapGet("/organizer/tournaments", ListOrganizerTournamentsAsync)
            .WithName("ListOrganizerTournaments")
            .Produces<TournamentManagementListResponse>();
        organizer.MapPatch("/tournaments/{tournamentId:guid}/details", UpdateTournamentDetailsEndpointAsync)
            .WithName("UpdateTournamentDetails")
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces<TournamentManagementResponse>()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status412PreconditionFailed);
        organizer.MapPost("/tournaments/{tournamentId:guid}/cancel", CancelTournamentAsync)
            .WithName("CancelTournament")
            .Produces<TournamentMutationResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status412PreconditionFailed);
        organizer.MapDelete("/tournaments/{tournamentId:guid}", DeleteTournamentAsync)
            .WithName("DeleteTournament")
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces<TournamentMutationResponse>()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status412PreconditionFailed);

        var admin = app.MapGroup("/api/admin/tournaments").RequireAuthorization(AuthorizationPolicies.Admin);
        admin.MapGet("/deleted", ListDeletedTournamentsAsync)
            .WithName("ListDeletedTournaments")
            .Produces<TournamentManagementListResponse>();
        admin.MapPost("/{tournamentId:guid}/restore", RestoreTournamentAsync)
            .WithName("RestoreTournament")
            .Produces<TournamentMutationResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status412PreconditionFailed);
    }

    private static async Task<IResult> ListOrganizerTournamentsAsync(
        ClaimsPrincipal principal,
        int? page,
        int? pageSize,
        TournamentLifecycleService lifecycle,
        CancellationToken cancellationToken) =>
        Results.Ok(await lifecycle.ListOrganizerAsync(
            OrganizationPrincipal.UserId(principal),
            OrganizationPrincipal.IsAdmin(principal),
            Page(page),
            PageSize(pageSize),
            cancellationToken));

    private static async Task<IResult> ListDeletedTournamentsAsync(
        int? page,
        int? pageSize,
        TournamentLifecycleService lifecycle,
        CancellationToken cancellationToken) =>
        Results.Ok(await lifecycle.ListDeletedAsync(Page(page), PageSize(pageSize), cancellationToken));

    private static async Task<IResult> UpdateTournamentDetailsEndpointAsync(
        Guid tournamentId,
        UpdateTournamentDetailsRequest request,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        HttpResponse response,
        ClaimsPrincipal principal,
        TournamentLifecycleService lifecycle,
        CancellationToken cancellationToken)
    {
        RejectMassAssignment(request.AdditionalFields);
        var result = await lifecycle.UpdateDetailsAsync(
            tournamentId,
            OrganizationPrincipal.UserId(principal),
            OrganizationPrincipal.IsAdmin(principal),
            RequiredVersion(ifMatch),
            request,
            cancellationToken);
        response.Headers.ETag = result.ETag;
        return Results.Ok(result);
    }

    private static async Task<IResult> CancelTournamentAsync(
        Guid tournamentId,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        [FromHeader(Name = "Idempotency-Key")] string idempotencyKey,
        HttpResponse response,
        ClaimsPrincipal principal,
        TournamentLifecycleService lifecycle,
        CancellationToken cancellationToken)
    {
        var result = await lifecycle.CancelAsync(
            tournamentId,
            OrganizationPrincipal.UserId(principal),
            OrganizationPrincipal.IsAdmin(principal),
            RequiredVersion(ifMatch),
            RequiredIdempotencyKey(idempotencyKey),
            cancellationToken);
        response.Headers.ETag = result.ETag;
        return Results.Ok(result);
    }

    private static async Task<IResult> DeleteTournamentAsync(
        Guid tournamentId,
        [FromBody] DeleteTournamentRequest? request,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        [FromHeader(Name = "Idempotency-Key")] string idempotencyKey,
        HttpResponse response,
        ClaimsPrincipal principal,
        TournamentLifecycleService lifecycle,
        CancellationToken cancellationToken)
    {
        RejectMassAssignment(request?.AdditionalFields);
        var result = await lifecycle.DeleteAsync(
            tournamentId,
            OrganizationPrincipal.UserId(principal),
            OrganizationPrincipal.IsAdmin(principal),
            RequiredVersion(ifMatch),
            RequiredIdempotencyKey(idempotencyKey),
            request?.Reason,
            cancellationToken);
        response.Headers.ETag = result.ETag;
        return Results.Ok(result);
    }

    private static async Task<IResult> RestoreTournamentAsync(
        Guid tournamentId,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        HttpResponse response,
        ClaimsPrincipal principal,
        TournamentLifecycleService lifecycle,
        CancellationToken cancellationToken)
    {
        var result = await lifecycle.RestoreAsync(
            tournamentId,
            OrganizationPrincipal.UserId(principal),
            RequiredVersion(ifMatch),
            cancellationToken);
        response.Headers.ETag = result.ETag;
        return Results.Ok(result);
    }

    private static int Page(int? page) => page is null or < 1 ? 1 : page.Value;
    private static int PageSize(int? pageSize) => pageSize is null or < 1 ? DefaultPageSize : Math.Min(pageSize.Value, MaximumPageSize);

    private static long RequiredVersion(string? ifMatch)
    {
        if (!StrongETag.TryDecode(ifMatch, out var version)) throw new ConcurrencyConflictException();
        return version;
    }

    private static string RequiredIdempotencyKey(string? value)
    {
        var key = value?.Trim();
        if (string.IsNullOrWhiteSpace(key) || key.Length > 200)
        {
            throw new ApiValidationException(new Dictionary<string, string[]>
            {
                ["Idempotency-Key"] = ["Idempotency-Key header is required and cannot exceed 200 characters."]
            });
        }
        return key;
    }

    private static void RejectMassAssignment(IDictionary<string, JsonElement>? additionalFields)
    {
        if (additionalFields is null || additionalFields.Count == 0) return;
        throw new ApiValidationException(additionalFields.Keys.ToDictionary(
            key => key,
            _ => new[] { "Field is not allowed for Tournament detail updates." },
            StringComparer.OrdinalIgnoreCase));
    }
}

internal sealed class TournamentLifecycleService(
    GonesDbContext database,
    OrganizationAccessService access,
    IClock clock)
{
    private static readonly JsonSerializerOptions StoredJsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<TournamentManagementListResponse> ListOrganizerAsync(
        Guid userId,
        bool isAdmin,
        int page,
        int pageSize,
        CancellationToken cancellationToken)
    {
        var query = database.ScheduledTournaments.AsNoTracking()
            .Where(item => item.DeletedAt == null);
        if (!isAdmin)
        {
            query = query.Where(item => database.OrganizationMembers.Any(member =>
                member.OrganizationId == item.OrganizationId && member.UserId == userId));
        }
        return await ListAsync(query, page, pageSize, cancellationToken);
    }

    public Task<TournamentManagementListResponse> ListDeletedAsync(
        int page,
        int pageSize,
        CancellationToken cancellationToken) =>
        ListAsync(database.ScheduledTournaments.AsNoTracking().Where(item => item.DeletedAt != null), page, pageSize, cancellationToken);

    public async Task<TournamentManagementResponse> UpdateDetailsAsync(
        Guid tournamentId,
        Guid actorUserId,
        bool isAdmin,
        long expectedVersion,
        UpdateTournamentDetailsRequest request,
        CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var tournament = await RequireActiveAsync(tournamentId, actorUserId, isAdmin, cancellationToken);
        RequireVersion(tournament, expectedVersion);
        var formats = await RequireFormatsAsync(request.FormatIds, cancellationToken);
        var before = TournamentAuditSnapshot.From(tournament);
        var draft = ToDraft(request, tournament.Slug);
        TournamentChangeSeverity severity;
        try
        {
            severity = tournament.ClassifyChange(draft, formats);
            tournament.UpdateDetails(draft, formats, clock.GetCurrentInstant());
        }
        catch (ArgumentException exception)
        {
            throw Validation("details", exception.Message);
        }
        catch (InvalidOperationException)
        {
            throw new ResourceConflictException();
        }

        var now = clock.GetCurrentInstant();
        var after = TournamentAuditSnapshot.From(tournament);
        var changedFields = before.ChangedFields(after);
        database.AuditRecords.Add(NewAudit(actorUserId, "tournament.details.updated", tournament.Id, before.AuditDiff(after, changedFields), now));
        if (severity == TournamentChangeSeverity.Major)
        {
            var reminderAction = before.ScheduleChanged(after)
                ? TournamentReminderPlanAction.RecalculateFuture
                : TournamentReminderPlanAction.None;
            database.TournamentLifecycleEvents.Add(TournamentLifecycleEvent.Create(
                tournament.Id,
                actorUserId,
                TournamentLifecycleEventType.MajorDetailsUpdated,
                reminderAction,
                now));
        }
        ForceVersionMutation(tournament);
        await SaveAsync(transaction, cancellationToken);
        return await ResponseAsync(tournament, cancellationToken);
    }

    public Task<TournamentMutationResponse> CancelAsync(
        Guid tournamentId,
        Guid actorUserId,
        bool isAdmin,
        long expectedVersion,
        string idempotencyKey,
        CancellationToken cancellationToken) =>
        ExecuteIdempotentAsync(
            tournamentId,
            actorUserId,
            isAdmin,
            expectedVersion,
            idempotencyKey,
            "cancel",
            "tournament.cancelled",
            TournamentLifecycleEventType.Cancelled,
            TournamentReminderPlanAction.CancelFuture,
            (tournament, now) => tournament.Cancel(now),
            cancellationToken);

    public Task<TournamentMutationResponse> DeleteAsync(
        Guid tournamentId,
        Guid actorUserId,
        bool isAdmin,
        long expectedVersion,
        string idempotencyKey,
        string? reason,
        CancellationToken cancellationToken) =>
        ExecuteIdempotentAsync(
            tournamentId,
            actorUserId,
            isAdmin,
            expectedVersion,
            idempotencyKey,
            "delete",
            "tournament.deleted",
            TournamentLifecycleEventType.Deleted,
            TournamentReminderPlanAction.CancelFuture,
            (tournament, now) => tournament.SoftDelete(actorUserId, reason, now),
            cancellationToken);

    public async Task<TournamentMutationResponse> RestoreAsync(
        Guid tournamentId,
        Guid actorUserId,
        long expectedVersion,
        CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var tournament = await database.ScheduledTournaments.SingleOrDefaultAsync(
            item => item.Id == tournamentId && item.DeletedAt != null,
            cancellationToken) ?? throw new ResourceNotFoundException();
        RequireVersion(tournament, expectedVersion);
        var now = clock.GetCurrentInstant();
        try
        {
            tournament.Restore(now);
        }
        catch (InvalidOperationException)
        {
            throw new ResourceConflictException();
        }
        database.TournamentLifecycleEvents.Add(TournamentLifecycleEvent.Create(
            tournament.Id,
            actorUserId,
            TournamentLifecycleEventType.Restored,
            TournamentReminderPlanAction.RecalculateFuture,
            now));
        database.AuditRecords.Add(NewAudit(actorUserId, "tournament.restored", tournament.Id, "{\"fields\":[\"deletedAt\",\"deletedByUserId\",\"deletedReason\"]}", now));
        ForceVersionMutation(tournament);
        await SaveAsync(transaction, cancellationToken);
        return MutationResponse(tournament);
    }

    private async Task<TournamentMutationResponse> ExecuteIdempotentAsync(
        Guid tournamentId,
        Guid actorUserId,
        bool isAdmin,
        long expectedVersion,
        string idempotencyKey,
        string command,
        string auditAction,
        TournamentLifecycleEventType eventType,
        TournamentReminderPlanAction reminderAction,
        Action<ScheduledTournament, Instant> mutate,
        CancellationToken cancellationToken)
    {
        var scope = $"tournament-lifecycle:{actorUserId:D}";
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        await database.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock(hashtext({scope}), hashtext({idempotencyKey}))",
            cancellationToken);
        var existing = await database.IdempotencyRecords.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Scope == scope && item.Key == idempotencyKey, cancellationToken);
        if (existing is not null)
        {
            var stored = JsonSerializer.Deserialize<StoredLifecycleMutation>(existing.ResponseBody, StoredJsonOptions)
                ?? throw new InvalidOperationException("Stored Tournament lifecycle result is invalid.");
            if (stored.TournamentId != tournamentId || !string.Equals(stored.Command, command, StringComparison.Ordinal))
            {
                throw new IdempotencyConflictException();
            }
            var retryTournament = await database.ScheduledTournaments.AsNoTracking()
                .SingleOrDefaultAsync(item => item.Id == tournamentId, cancellationToken)
                ?? throw new ResourceNotFoundException();
            _ = await access.RequireMemberAsync(retryTournament.OrganizationId, actorUserId, isAdmin, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return stored.Response;
        }

        var tournament = await RequireActiveAsync(tournamentId, actorUserId, isAdmin, cancellationToken);
        RequireVersion(tournament, expectedVersion);
        var now = clock.GetCurrentInstant();
        try
        {
            mutate(tournament, now);
        }
        catch (ArgumentException exception)
        {
            throw Validation("reason", exception.Message);
        }
        catch (InvalidOperationException)
        {
            throw new ResourceConflictException();
        }
        database.TournamentLifecycleEvents.Add(TournamentLifecycleEvent.Create(tournament.Id, actorUserId, eventType, reminderAction, now));
        database.AuditRecords.Add(NewAudit(actorUserId, auditAction, tournament.Id,
            command == "delete"
                ? "{\"fields\":[\"deletedAt\",\"deletedByUserId\",\"deletedReason\"]}"
                : "{\"fields\":[\"status\"]}", now));
        ForceVersionMutation(tournament);
        var response = MutationResponse(tournament, expectedVersion + 1);
        database.IdempotencyRecords.Add(new IdempotencyRecord
        {
            Scope = scope,
            Key = idempotencyKey,
            ResponseStatusCode = StatusCodes.Status200OK,
            ResponseBody = JsonSerializer.Serialize(new StoredLifecycleMutation(command, tournament.Id, response), StoredJsonOptions),
            CreatedAt = now,
            ExpiresAt = now + Duration.FromHours(24)
        });
        await SaveAsync(transaction, cancellationToken);
        return MutationResponse(tournament);
    }

    private async Task<ScheduledTournament> RequireActiveAsync(
        Guid tournamentId,
        Guid actorUserId,
        bool isAdmin,
        CancellationToken cancellationToken)
    {
        var tournament = await database.ScheduledTournaments
            .Include(item => item.Formats)
            .SingleOrDefaultAsync(item => item.Id == tournamentId && item.DeletedAt == null, cancellationToken)
            ?? throw new ResourceNotFoundException();
        _ = await access.RequireMemberAsync(tournament.OrganizationId, actorUserId, isAdmin, cancellationToken);
        return tournament;
    }

    private async Task<IReadOnlyList<TournamentFormat>> RequireFormatsAsync(
        IReadOnlyList<Guid>? requestedIds,
        CancellationToken cancellationToken)
    {
        var ids = requestedIds?.Distinct().Order().ToArray() ?? [];
        if (ids.Length == 0 || ids.Length != requestedIds!.Count)
        {
            throw Validation("formatIds", "At least one unique format is required.");
        }
        var formats = await database.TournamentFormats.Where(item => ids.Contains(item.Id) && item.DeletedAt == null).ToListAsync(cancellationToken);
        if (formats.Count != ids.Length) throw Validation("formatIds", "One or more formats are invalid.");
        return formats;
    }

    private async Task<TournamentManagementListResponse> ListAsync(
        IQueryable<ScheduledTournament> query,
        int page,
        int pageSize,
        CancellationToken cancellationToken)
    {
        var total = await query.CountAsync(cancellationToken);
        var tournaments = await query.Include(item => item.Formats)
            .OrderBy(item => item.StartsAtUtc)
            .ThenBy(item => item.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);
        var organizationIds = tournaments.Select(item => item.OrganizationId).Distinct().ToArray();
        var organizationNames = await database.Organizations.AsNoTracking()
            .Where(item => organizationIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, item => item.Name, cancellationToken);
        var items = tournaments.Select(item => ToResponse(item, organizationNames[item.OrganizationId])).ToArray();
        return new TournamentManagementListResponse(items, page, pageSize, total);
    }

    private async Task<TournamentManagementResponse> ResponseAsync(ScheduledTournament tournament, CancellationToken cancellationToken)
    {
        var organizationName = await database.Organizations.AsNoTracking()
            .Where(item => item.Id == tournament.OrganizationId)
            .Select(item => item.Name)
            .SingleAsync(cancellationToken);
        return ToResponse(tournament, organizationName);
    }

    private async Task SaveAsync(Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction transaction, CancellationToken cancellationToken)
    {
        try
        {
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new ConcurrencyConflictException();
        }
        catch (DbUpdateException exception) when (exception.InnerException is Npgsql.PostgresException { SqlState: Npgsql.PostgresErrorCodes.UniqueViolation })
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new ConcurrencyConflictException();
        }
    }

    private static void RequireVersion(ScheduledTournament tournament, long expectedVersion)
    {
        if (tournament.Version != expectedVersion) throw new ConcurrencyConflictException();
    }

    private void ForceVersionMutation(ScheduledTournament tournament) =>
        database.Entry(tournament).Property(item => item.UpdatedAt).IsModified = true;

    private static TournamentMutationResponse MutationResponse(ScheduledTournament tournament, long? version = null)
    {
        var currentVersion = version ?? tournament.Version;
        return new TournamentMutationResponse(tournament.Id, tournament.Status.ToString(), tournament.IsDeleted, currentVersion, StrongETag.Encode(currentVersion));
    }

    private static TournamentManagementResponse ToResponse(ScheduledTournament item, string organizationName) => new(
        item.Id,
        item.OrganizationId,
        organizationName,
        item.Title,
        item.Slug,
        item.Summary,
        item.BodyHtml,
        item.StreetAddress,
        item.PostalCode,
        item.City,
        item.Country,
        item.TimeZoneId,
        LocalDatePattern.Iso.Format(item.VenueStartDate),
        LocalTimePattern.CreateWithInvariantCulture("HH:mm:ss").Format(item.VenueStartTime),
        LocalDatePattern.Iso.Format(item.VenueEndDate),
        LocalTimePattern.CreateWithInvariantCulture("HH:mm:ss").Format(item.VenueEndTime),
        item.StartsAtUtc,
        item.EndsAtUtc,
        item.Capacity,
        item.Status.ToString(),
        item.DeletedAt,
        item.DeletedReason,
        item.Formats.Select(format => format.TournamentFormatId).Order().ToArray(),
        item.Version,
        StrongETag.Encode(item.Version));

    private static ScheduledTournamentDraft ToDraft(UpdateTournamentDetailsRequest request, string slug) => new(
        request.Title,
        slug,
        request.Summary,
        request.BodyHtml,
        request.StreetAddress,
        request.PostalCode,
        request.City,
        request.Country,
        request.TimeZoneId,
        ParseLocal(request.StartsAtLocal, "startsAtLocal"),
        string.IsNullOrWhiteSpace(request.EndsAtLocal) ? null : ParseLocal(request.EndsAtLocal, "endsAtLocal"),
        request.Capacity);

    private static LocalDateTime ParseLocal(string value, string field)
    {
        if (string.IsNullOrWhiteSpace(value)) throw Validation(field, "Local date and time is required.");
        var parsed = LocalDateTimePattern.ExtendedIso.Parse(value.Trim());
        if (!parsed.Success) throw Validation(field, "Value must be an ISO-8601 local date and time.");
        return parsed.Value;
    }

    private static AuditRecord NewAudit(Guid actorUserId, string action, Guid tournamentId, string diff, Instant now) => new()
    {
        ActorId = actorUserId,
        Action = action,
        EntityType = "scheduled_tournament",
        EntityId = tournamentId.ToString("D"),
        RedactedDiff = diff,
        OccurredAt = now
    };

    private static ApiValidationException Validation(string field, string message) =>
        new(new Dictionary<string, string[]> { [field] = [message] });

    private sealed record StoredLifecycleMutation(string Command, Guid TournamentId, TournamentMutationResponse Response);
}

internal sealed class TournamentOrganizationDeleteDependency(GonesDbContext database) : IOrganizationDeleteDependency
{
    public async Task<IReadOnlyList<string>> GetBlockersAsync(Guid organizationId, CancellationToken cancellationToken)
    {
        var blocked = await database.ScheduledTournaments.AsNoTracking().AnyAsync(item =>
            item.OrganizationId == organizationId
            && item.DeletedAt == null
            && (item.Status == ScheduledTournamentStatus.Published || item.Status == ScheduledTournamentStatus.InProgress),
            cancellationToken);
        return blocked ? ["nonterminal_tournament"] : [];
    }
}

internal sealed record UpdateTournamentDetailsRequest(
    [property: Required, MaxLength(ScheduledTournament.MaximumTitleLength)] string Title,
    [property: MaxLength(ScheduledTournament.MaximumSummaryLength)] string? Summary,
    [property: MaxLength(ScheduledTournament.MaximumBodyHtmlLength)] string? BodyHtml,
    [property: Required, MaxLength(ScheduledTournament.MaximumAddressLength)] string StreetAddress,
    [property: MaxLength(ScheduledTournament.MaximumPostalCodeLength)] string? PostalCode,
    [property: Required, MaxLength(ScheduledTournament.MaximumCityLength)] string City,
    [property: Required, MaxLength(ScheduledTournament.MaximumCountryLength)] string Country,
    [property: Required, MaxLength(ScheduledTournament.MaximumTimeZoneLength)] string TimeZoneId,
    [property: Required] string StartsAtLocal,
    string? EndsAtLocal,
    int? Capacity,
    [property: Required, MinLength(1)] IReadOnlyList<Guid> FormatIds)
{
    [JsonExtensionData]
    public IDictionary<string, JsonElement>? AdditionalFields { get; init; }
}

internal sealed record DeleteTournamentRequest(
    [property: MaxLength(ScheduledTournament.MaximumDeletedReasonLength)] string? Reason)
{
    [JsonExtensionData]
    public IDictionary<string, JsonElement>? AdditionalFields { get; init; }
}

internal sealed record TournamentManagementListResponse(
    IReadOnlyList<TournamentManagementResponse> Items,
    int Page,
    int PageSize,
    int TotalCount);

internal sealed record TournamentManagementResponse(
    Guid Id,
    Guid OrganizationId,
    string OrganizationName,
    string Title,
    string Slug,
    string? Summary,
    string? BodyHtml,
    string StreetAddress,
    string? PostalCode,
    string City,
    string Country,
    string TimeZoneId,
    string VenueStartDate,
    string VenueStartTime,
    string VenueEndDate,
    string VenueEndTime,
    Instant StartsAtUtc,
    Instant EndsAtUtc,
    int? Capacity,
    string Status,
    Instant? DeletedAt,
    string? DeletedReason,
    IReadOnlyList<Guid> FormatIds,
    long Version,
    string ETag);

internal sealed record TournamentMutationResponse(
    Guid Id,
    string Status,
    bool IsDeleted,
    long Version,
    string ETag);

internal sealed record TournamentAuditSnapshot(
    string Title,
    string? Summary,
    string? BodyHtml,
    string StreetAddress,
    string? PostalCode,
    string City,
    string Country,
    string TimeZoneId,
    string StartsAt,
    string EndsAt,
    int? Capacity,
    IReadOnlyList<Guid> FormatIds)
{
    public static TournamentAuditSnapshot From(ScheduledTournament tournament) => new(
        tournament.Title,
        tournament.Summary,
        tournament.BodyHtml,
        tournament.StreetAddress,
        tournament.PostalCode,
        tournament.City,
        tournament.Country,
        tournament.TimeZoneId,
        tournament.StartsAtUtc.ToString(),
        tournament.EndsAtUtc.ToString(),
        tournament.Capacity,
        tournament.Formats.Select(item => item.TournamentFormatId).Order().ToArray());

    public bool ScheduleChanged(TournamentAuditSnapshot other) =>
        StartsAt != other.StartsAt || EndsAt != other.EndsAt || TimeZoneId != other.TimeZoneId;

    public IReadOnlyList<string> ChangedFields(TournamentAuditSnapshot other)
    {
        var fields = new List<string>();
        if (Title != other.Title) fields.Add("title");
        if (Summary != other.Summary) fields.Add("summary");
        if (BodyHtml != other.BodyHtml) fields.Add("bodyChanged");
        if (StreetAddress != other.StreetAddress) fields.Add("streetAddress");
        if (PostalCode != other.PostalCode) fields.Add("postalCode");
        if (City != other.City) fields.Add("city");
        if (Country != other.Country) fields.Add("country");
        if (TimeZoneId != other.TimeZoneId) fields.Add("timeZoneId");
        if (StartsAt != other.StartsAt) fields.Add("startsAt");
        if (EndsAt != other.EndsAt) fields.Add("endsAt");
        if (Capacity != other.Capacity) fields.Add("capacity");
        if (!FormatIds.SequenceEqual(other.FormatIds)) fields.Add("formatIds");
        return fields;
    }

    public string AuditDiff(TournamentAuditSnapshot other, IReadOnlyList<string> fields)
    {
        var before = ValuesFor(fields);
        var after = other.ValuesFor(fields);
        return JsonSerializer.Serialize(new
        {
            fields,
            before,
            after,
            bodyChanged = BodyHtml != other.BodyHtml
        });
    }

    private Dictionary<string, object?> ValuesFor(IReadOnlyList<string> fields)
    {
        var values = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var field in fields)
        {
            if (field == "bodyChanged") continue;
            values[field] = field switch
            {
                "title" => Title,
                "summary" => Summary,
                "streetAddress" => StreetAddress,
                "postalCode" => PostalCode,
                "city" => City,
                "country" => Country,
                "timeZoneId" => TimeZoneId,
                "startsAt" => StartsAt,
                "endsAt" => EndsAt,
                "capacity" => Capacity,
                "formatIds" => FormatIds,
                _ => throw new InvalidOperationException("Unsupported Tournament audit field.")
            };
        }
        return values;
    }
}
