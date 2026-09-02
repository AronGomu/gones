using System.ComponentModel.DataAnnotations;
using System.Data;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;
using Gones.Api.Errors;
using Gones.Api.Organizations;
using Gones.Api.Security;
using Gones.Api.Validation;
using Gones.Application.Concurrency;
using Gones.Application.Events;
using Gones.Domain.Calendar;
using Gones.Domain.Catalog;
using Gones.Domain.Persistence;
using Gones.Infrastructure.EventProviders;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using NodaTime.Text;

namespace Gones.Api.Events;

internal static class EventLifecycleEndpoints
{
    private const int DefaultPageSize = 20;
    private const int MaximumPageSize = 100;

    public static void MapEventLifecycleEndpoints(this WebApplication app)
    {
        var organizer = app.MapGroup("/api").RequireAuthorization(AuthorizationPolicies.Organizer);
        organizer.MapGet("/organizer/events", ListOrganizerEventsAsync)
            .WithName("ListOrganizerEvents")
            .Produces<EventManagementListResponse>();
        organizer.MapPatch("/organizer/events/{eventId:guid}/details", UpdateEventDetailsEndpointAsync)
            .WithName("UpdateEventDetails")
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces<EventManagementResponse>()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status412PreconditionFailed);
        organizer.MapPost("/events/{eventId:guid}/cancel", CancelEventAsync)
            .WithName("CancelEvent")
            .Produces<EventMutationResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status412PreconditionFailed);
        organizer.MapDelete("/events/{eventId:guid}", DeleteEventAsync)
            .WithName("DeleteEvent")
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces<EventMutationResponse>()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status412PreconditionFailed);

        var admin = app.MapGroup("/api/admin/events").RequireAuthorization(AuthorizationPolicies.Admin);
        admin.MapGet("/deleted", ListDeletedEventsAsync)
            .WithName("ListDeletedEvents")
            .Produces<EventManagementListResponse>();
        admin.MapPost("/{eventId:guid}/restore", RestoreEventAsync)
            .WithName("RestoreEvent")
            .Produces<EventMutationResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status412PreconditionFailed);
    }

    private static async Task<IResult> ListOrganizerEventsAsync(
        ClaimsPrincipal principal,
        int? page,
        int? pageSize,
        EventLifecycleService lifecycle,
        CancellationToken cancellationToken) =>
        Results.Ok(await lifecycle.ListOrganizerAsync(
            OrganizationPrincipal.UserId(principal),
            OrganizationPrincipal.IsAdmin(principal),
            Page(page),
            PageSize(pageSize),
            cancellationToken));

    private static async Task<IResult> ListDeletedEventsAsync(
        ClaimsPrincipal principal,
        int? page,
        int? pageSize,
        EventLifecycleService lifecycle,
        CancellationToken cancellationToken) =>
        Results.Ok(await lifecycle.ListDeletedAsync(
            OrganizationPrincipal.UserId(principal),
            Page(page),
            PageSize(pageSize),
            cancellationToken));

    private static async Task<IResult> UpdateEventDetailsEndpointAsync(
        Guid eventId,
        UpdateEventDetailsRequest request,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        HttpResponse response,
        ClaimsPrincipal principal,
        EventLifecycleService lifecycle,
        CancellationToken cancellationToken)
    {
        RejectMassAssignment(request.AdditionalFields);
        var result = await lifecycle.UpdateDetailsAsync(
            eventId,
            OrganizationPrincipal.UserId(principal),
            OrganizationPrincipal.IsAdmin(principal),
            RequiredVersion(ifMatch),
            request,
            cancellationToken);
        response.Headers.ETag = result.ETag;
        return Results.Ok(result);
    }

    private static async Task<IResult> CancelEventAsync(
        Guid eventId,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        [FromHeader(Name = "Idempotency-Key")] string idempotencyKey,
        HttpResponse response,
        ClaimsPrincipal principal,
        EventLifecycleService lifecycle,
        CancellationToken cancellationToken)
    {
        var result = await lifecycle.CancelAsync(
            eventId,
            OrganizationPrincipal.UserId(principal),
            OrganizationPrincipal.IsAdmin(principal),
            RequiredVersion(ifMatch),
            RequiredIdempotencyKey(idempotencyKey),
            cancellationToken);
        response.Headers.ETag = result.ETag;
        return Results.Ok(result);
    }

    private static async Task<IResult> DeleteEventAsync(
        Guid eventId,
        [FromBody] DeleteEventRequest? request,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        [FromHeader(Name = "Idempotency-Key")] string idempotencyKey,
        HttpResponse response,
        ClaimsPrincipal principal,
        EventLifecycleService lifecycle,
        CancellationToken cancellationToken)
    {
        RejectMassAssignment(request?.AdditionalFields);
        var result = await lifecycle.DeleteAsync(
            eventId,
            OrganizationPrincipal.UserId(principal),
            OrganizationPrincipal.IsAdmin(principal),
            RequiredVersion(ifMatch),
            RequiredIdempotencyKey(idempotencyKey),
            request?.Reason,
            cancellationToken);
        response.Headers.ETag = result.ETag;
        return Results.Ok(result);
    }

    private static async Task<IResult> RestoreEventAsync(
        Guid eventId,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        HttpResponse response,
        ClaimsPrincipal principal,
        EventLifecycleService lifecycle,
        CancellationToken cancellationToken)
    {
        var result = await lifecycle.RestoreAsync(
            eventId,
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

internal sealed class EventLifecycleService(
    GonesDbContext database,
    OrganizationAccessService access,
    EventRegistrationNotificationService registrationNotifications,
    IEventLocationTokenService locationTokens,
    EventImageCleanupService imageCleanup,
    ILogger<EventLifecycleService> logger,
    IClock clock)
{
    private static readonly JsonSerializerOptions StoredJsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<EventManagementListResponse> ListOrganizerAsync(
        Guid userId,
        bool isAdmin,
        int page,
        int pageSize,
        CancellationToken cancellationToken)
    {
        var query = database.Events.AsNoTracking()
            .Where(item => item.DeletedAt == null);
        if (!isAdmin)
        {
            query = query.Where(item => database.OrganizationMembers.Any(member =>
                member.OrganizationId == item.OrganizationId && member.UserId == userId));
        }
        return await ListAsync(query, userId, page, pageSize, cancellationToken);
    }

    public Task<EventManagementListResponse> ListDeletedAsync(
        Guid userId,
        int page,
        int pageSize,
        CancellationToken cancellationToken) =>
        ListAsync(database.Events.AsNoTracking().Where(item => item.DeletedAt != null), userId, page, pageSize, cancellationToken);

    public async Task<EventManagementResponse> UpdateDetailsAsync(
        Guid eventId,
        Guid actorUserId,
        bool isAdmin,
        long expectedVersion,
        UpdateEventDetailsRequest request,
        CancellationToken cancellationToken)
    {
        ValidateDetailsRequest(request);
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var tournament = await RequireActiveAsync(eventId, actorUserId, isAdmin, cancellationToken);
        RequireVersion(tournament, expectedVersion);
        var formats = await RequireFormatsAsync(request.FormatIds, cancellationToken);
        var now = clock.GetCurrentInstant();
        var location = locationTokens.Validate(actorUserId, request.Location, now);
        if (!EventPublicationService.LocationMatches(request.Location, location)) throw new LocationTokenInvalidException();
        var media = await UpdateImagesAsync(tournament.Id, actorUserId, request.Images, now, cancellationToken);
        var before = EventAuditSnapshot.From(tournament);
        var draft = ToDraft(request, tournament, location);
        TournamentChangeSeverity severity;
        try
        {
            severity = tournament.ClassifyChange(draft, formats, media.Changed);
            tournament.UpdateDetails(draft, formats, now);
        }
        catch (ArgumentException exception)
        {
            throw Validation("details", exception.Message);
        }
        catch (InvalidOperationException)
        {
            throw new ResourceConflictException();
        }

        var after = EventAuditSnapshot.From(tournament);
        var changedFields = before.ChangedFields(after).ToList();
        if (media.Changed) changedFields.Add("imagesChanged");
        database.AuditRecords.Add(NewAudit(actorUserId, "tournament.details.updated", tournament.Id, before.AuditDiff(after, changedFields), now));
        if (severity == TournamentChangeSeverity.Major)
        {
            var reminderAction = before.ScheduleChanged(after)
                ? TournamentReminderPlanAction.RecalculateFuture
                : TournamentReminderPlanAction.None;
            var lifecycleEvent = EventLifecycleEntry.Create(
                tournament.Id,
                actorUserId,
                TournamentLifecycleEventType.MajorDetailsUpdated,
                reminderAction,
                now);
            database.EventLifecycleEntries.Add(lifecycleEvent);
            await registrationNotifications.EnqueueMajorUpdateAsync(tournament, lifecycleEvent.Id, cancellationToken);
        }
        ForceVersionMutation(tournament);
        await SaveChangesAsync(transaction, cancellationToken);
        var response = await ResponseAsync(tournament, actorUserId, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        await ProcessRemovedImagesAsync(media.RemovedImageIds);
        return response;
    }

    public Task<EventMutationResponse> CancelAsync(
        Guid eventId,
        Guid actorUserId,
        bool isAdmin,
        long expectedVersion,
        string idempotencyKey,
        CancellationToken cancellationToken) =>
        ExecuteIdempotentAsync(
            eventId,
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

    public Task<EventMutationResponse> DeleteAsync(
        Guid eventId,
        Guid actorUserId,
        bool isAdmin,
        long expectedVersion,
        string idempotencyKey,
        string? reason,
        CancellationToken cancellationToken) =>
        ExecuteIdempotentAsync(
            eventId,
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

    public async Task<EventMutationResponse> RestoreAsync(
        Guid eventId,
        Guid actorUserId,
        long expectedVersion,
        CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var tournament = await database.Events.SingleOrDefaultAsync(
            item => item.Id == eventId && item.DeletedAt != null,
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
        database.EventLifecycleEntries.Add(EventLifecycleEntry.Create(
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

    private async Task<EventMutationResponse> ExecuteIdempotentAsync(
        Guid eventId,
        Guid actorUserId,
        bool isAdmin,
        long expectedVersion,
        string idempotencyKey,
        string command,
        string auditAction,
        TournamentLifecycleEventType eventType,
        TournamentReminderPlanAction reminderAction,
        Action<Event, Instant> mutate,
        CancellationToken cancellationToken)
    {
        var scope = $"tournament-lifecycle:{actorUserId:D}";
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        await database.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock(hashtext({scope}), hashtext({idempotencyKey}))",
            cancellationToken);
        var existing = await database.IdempotencyRecords.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Scope == scope && item.Key == idempotencyKey, cancellationToken);
        if (existing is not null && existing.ExpiresAt <= clock.GetCurrentInstant())
        {
            await database.IdempotencyRecords.Where(item => item.Id == existing.Id).ExecuteDeleteAsync(cancellationToken);
            existing = null;
        }
        if (existing is not null)
        {
            var stored = JsonSerializer.Deserialize<StoredLifecycleMutation>(existing.ResponseBody, StoredJsonOptions)
                ?? throw new InvalidOperationException("Stored Tournament lifecycle result is invalid.");
            if (stored.EventId != eventId || !string.Equals(stored.Command, command, StringComparison.Ordinal))
            {
                throw new IdempotencyConflictException();
            }
            var retryEvent = await database.Events.AsNoTracking()
                .SingleOrDefaultAsync(item => item.Id == eventId, cancellationToken)
                ?? throw new ResourceNotFoundException();
            _ = await access.RequireMemberAsync(retryEvent.OrganizationId, actorUserId, isAdmin, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return stored.Response;
        }

        var tournament = await RequireActiveAsync(eventId, actorUserId, isAdmin, cancellationToken);
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
        var lifecycleEvent = EventLifecycleEntry.Create(tournament.Id, actorUserId, eventType, reminderAction, now);
        database.EventLifecycleEntries.Add(lifecycleEvent);
        if (eventType is TournamentLifecycleEventType.Cancelled or TournamentLifecycleEventType.Deleted)
        {
            await registrationNotifications.CancelActiveRegistrationsAsync(
                tournament,
                lifecycleEvent.Id,
                actorUserId,
                now,
                cancellationToken);
        }
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

    private async Task<Event> RequireActiveAsync(
        Guid eventId,
        Guid actorUserId,
        bool isAdmin,
        CancellationToken cancellationToken)
    {
        var locked = await database.Events.FromSqlInterpolated($$"""
            SELECT * FROM events WHERE id = {{eventId}} AND deleted_at IS NULL FOR UPDATE
            """).ToListAsync(cancellationToken);
        var tournament = locked.SingleOrDefault() ?? throw new ResourceNotFoundException();
        _ = await access.RequireMemberAsync(tournament.OrganizationId, actorUserId, isAdmin, cancellationToken);
        await database.Entry(tournament).Collection(item => item.Formats).LoadAsync(cancellationToken);
        return tournament;
    }

    private async Task<IReadOnlyList<TournamentFormat>> RequireFormatsAsync(
        IReadOnlyList<Guid>? requestedIds,
        CancellationToken cancellationToken)
    {
        var ids = requestedIds?.Distinct().ToArray() ?? [];
        if (requestedIds is null || requestedIds.Count != 1 || ids.Length != 1)
        {
            throw Validation("formatIds", "Exactly one format is required.");
        }
        var formats = await database.TournamentFormats
            .FromSqlInterpolated($"SELECT * FROM tournament_formats WHERE id = {ids[0]} AND deleted_at IS NULL FOR KEY SHARE")
            .ToListAsync(cancellationToken);
        if (formats.Count != 1) throw Validation("formatIds", "The selected format is no longer active.");
        return formats;
    }

    private static void ValidateDetailsRequest(UpdateEventDetailsRequest request)
    {
        EventPublicationService.ValidatePayloadShape(new EventPayloadRequest(
            Guid.Empty,
            request.Title,
            request.Location,
            request.EventType,
            request.StartsAtLocal,
            request.Capacity,
            request.FormatIds,
            request.Images,
            request.Summary,
            request.BodyMarkdown));
        if (request.Images.Select(image => image.ImageId).Distinct().Count() != request.Images.Count)
        {
            throw new ResourceConflictException("image_state_conflict");
        }
    }

    private async Task<MediaUpdateResult> UpdateImagesAsync(
        Guid eventId,
        Guid actorUserId,
        IReadOnlyList<EventImageInput> inputs,
        Instant now,
        CancellationToken cancellationToken)
    {
        var requestedIds = inputs.Select(input => input.ImageId).ToArray();
        var requestedStates = await database.EventImages.AsNoTracking()
            .Where(image => requestedIds.Contains(image.Id))
            .Select(image => new { image.Id, image.State, image.EventId })
            .ToListAsync(cancellationToken);
        if (requestedStates.Any(image => image.State != EventImageState.Temporary
            && (image.State != EventImageState.EventOwned || image.EventId != eventId)))
        {
            throw new ResourceConflictException("image_state_conflict");
        }
        var locked = await database.EventImages.FromSqlInterpolated($$"""
            SELECT * FROM event_images
            WHERE event_id = {{eventId}} OR id = ANY({{requestedIds}})
            ORDER BY id
            FOR UPDATE
            """).ToListAsync(cancellationToken);
        var byId = locked.ToDictionary(image => image.Id);
        var current = locked
            .Where(image => image.State == EventImageState.EventOwned && image.EventId == eventId)
            .OrderBy(image => image.SortOrder)
            .ToArray();
        var currentShape = current.Select(image => new ImageShape(image.Id, image.AltText)).ToArray();
        var requestedShape = inputs.Select(input => new ImageShape(input.ImageId, NormalizeAltText(input.AltText))).ToArray();
        var changed = !currentShape.SequenceEqual(requestedShape);

        foreach (var input in inputs)
        {
            if (!byId.TryGetValue(input.ImageId, out var image)) throw new EventImageNotFoundException();
            if (image.State == EventImageState.EventOwned && image.EventId == eventId) continue;
            if (image.State == EventImageState.Temporary
                && image.UploadedByUserId == actorUserId
                && image.ExpiresAt > now)
            {
                continue;
            }
            throw new ResourceConflictException("image_state_conflict");
        }

        if (changed && current.Length > 0)
        {
            await database.Database.ExecuteSqlInterpolatedAsync($$"""
                UPDATE event_images SET sort_order = -sort_order - 1 WHERE event_id = {{eventId}}
                """, cancellationToken);
        }

        for (var index = 0; index < inputs.Count; index++)
        {
            var input = inputs[index];
            var image = byId[input.ImageId];
            try
            {
                if (image.State == EventImageState.EventOwned)
                {
                    image.UpdateEventDetails(eventId, index, input.AltText);
                    if (changed) database.Entry(image).Property(item => item.SortOrder).IsModified = true;
                }
                else image.AttachToEvent(eventId, actorUserId, index, input.AltText, now);
            }
            catch (InvalidOperationException)
            {
                throw new ResourceConflictException("image_state_conflict");
            }
            catch (ArgumentException exception)
            {
                throw Validation($"images[{index}].altText", exception.Message);
            }
        }

        var requested = requestedIds.ToHashSet();
        var removed = current.Where(image => !requested.Contains(image.Id)).ToArray();
        foreach (var image in removed) imageCleanup.Enqueue(image);
        return new MediaUpdateResult(changed, removed.Select(image => image.Id).ToArray());
    }

    private async Task ProcessRemovedImagesAsync(IReadOnlyList<Guid> imageIds)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        foreach (var imageId in imageIds)
        {
            try
            {
                await imageCleanup.ProcessImageObjectDeletionsAsync(imageId, timeout.Token);
            }
            catch (Exception exception)
            {
                logger.LogWarning(
                    EventImageCleanupLogEvents.PostCommitCleanupFailed,
                    "Event image post-commit object cleanup deferred; Event={Event}; ImageId={ImageId}; ExceptionType={ExceptionType}",
                    "event_image.object_delete.post_commit_deferred",
                    imageId,
                    exception.GetType().Name);
            }
        }
    }

    private async Task<EventManagementListResponse> ListAsync(
        IQueryable<Event> query,
        Guid actorUserId,
        int page,
        int pageSize,
        CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, cancellationToken);
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
        var formatIds = tournaments.SelectMany(item => item.Formats).Select(item => item.TournamentFormatId).Distinct().ToArray();
        var formatNames = await database.TournamentFormats.AsNoTracking()
            .Where(item => formatIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, item => item.Name, cancellationToken);
        var eventIds = tournaments.Select(item => item.Id).ToArray();
        var images = (await database.EventImages.AsNoTracking()
            .Where(item => eventIds.Contains(item.EventId!.Value) && item.State == EventImageState.EventOwned)
            .OrderBy(item => item.EventId)
            .ThenBy(item => item.SortOrder)
            .ToListAsync(cancellationToken))
            .ToLookup(item => item.EventId!.Value);
        var items = tournaments.Select(item => ToResponse(
            item,
            organizationNames[item.OrganizationId],
            formatNames[item.Formats.Single().TournamentFormatId],
            images[item.Id],
            actorUserId)).ToArray();
        await transaction.CommitAsync(cancellationToken);
        return new EventManagementListResponse(items, page, pageSize, total);
    }

    private async Task<EventManagementResponse> ResponseAsync(
        Event tournament,
        Guid actorUserId,
        CancellationToken cancellationToken)
    {
        var organizationName = await database.Organizations.AsNoTracking()
            .Where(item => item.Id == tournament.OrganizationId)
            .Select(item => item.Name)
            .SingleAsync(cancellationToken);
        var formatId = tournament.Formats.Single().TournamentFormatId;
        var formatName = await database.TournamentFormats.AsNoTracking()
            .Where(item => item.Id == formatId)
            .Select(item => item.Name)
            .SingleAsync(cancellationToken);
        var images = await database.EventImages.AsNoTracking()
            .Where(item => item.EventId == tournament.Id && item.State == EventImageState.EventOwned)
            .OrderBy(item => item.SortOrder)
            .ToListAsync(cancellationToken);
        return ToResponse(tournament, organizationName, formatName, images, actorUserId);
    }

    private async Task SaveAsync(Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction transaction, CancellationToken cancellationToken)
    {
        await SaveChangesAsync(transaction, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    private async Task SaveChangesAsync(Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction transaction, CancellationToken cancellationToken)
    {
        try
        {
            await database.SaveChangesAsync(cancellationToken);
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

    private static void RequireVersion(Event tournament, long expectedVersion)
    {
        if (tournament.Version != expectedVersion) throw new ConcurrencyConflictException();
    }

    private void ForceVersionMutation(Event tournament) =>
        database.Entry(tournament).Property(item => item.UpdatedAt).IsModified = true;

    private static EventMutationResponse MutationResponse(Event tournament, long? version = null)
    {
        var currentVersion = version ?? tournament.Version;
        return new EventMutationResponse(tournament.Id, tournament.Status.ToString(), tournament.IsDeleted, currentVersion, StrongETag.Encode(currentVersion));
    }

    private EventManagementResponse ToResponse(
        Event item,
        string organizationName,
        string formatName,
        IEnumerable<EventImage> images,
        Guid actorUserId)
    {
        var issuedAt = clock.GetCurrentInstant();
        var token = locationTokens.Issue(actorUserId, new ResolvedEventLocation(
            item.ProviderPlaceId,
            item.StreetAddress,
            item.PostalCode,
            item.City,
            item.Country,
            item.Region,
            item.Latitude,
            item.Longitude,
            item.TimeZoneId), issuedAt);
        return new EventManagementResponse(
            item.Id,
            item.OrganizationId,
            organizationName,
            item.Title,
            EventDisplayTitle.From(item.Title, formatName),
            item.Slug,
            item.Summary,
            item.BodyMarkdown,
            item.LiveTournamentUrl,
            item.ArchiveTournamentUrl,
            new EventLocationInput(item.StreetAddress, item.PostalCode, item.City, item.Country, item.Region, token),
            InstantPattern.ExtendedIso.Format(issuedAt + EventLocationTokenService.Lifetime),
            item.StreetAddress,
            item.PostalCode,
            item.City,
            item.Country,
            item.Region,
            EventPublicationService.EventTypeWire(item.EventType),
            item.TimeZoneId,
            $"{LocalDatePattern.Iso.Format(item.VenueStartDate)}T{LocalTimePattern.CreateWithInvariantCulture("HH:mm").Format(item.VenueStartTime)}",
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
            images.OrderBy(image => image.SortOrder).Select(ToImageResponse).ToArray(),
            item.Version,
            StrongETag.Encode(item.Version));
    }

    private static EventImageResponse ToImageResponse(EventImage image) => new(
        image.Id,
        image.AltText,
        EventImage.VariantWidthsFor(image.Width)
            .Select(width => new EventImageVariantResponse(
                width,
                (int)Math.Round((double)image.Height * width / image.Width),
                $"/api/event-images/{image.Id:D}/variants/{width}"))
            .ToArray());

    private static ScheduledTournamentDraft ToDraft(
        UpdateEventDetailsRequest request,
        Event tournament,
        ValidatedEventLocation location) => new(
        request.Title,
        tournament.Slug,
        request.Summary,
        request.BodyMarkdown,
        location.StreetAddress,
        location.PostalCode,
        location.City,
        location.Country,
        location.TimeZoneId,
        ParseLocal(request.StartsAtLocal, "startsAtLocal"),
        null,
        request.Capacity,
        null,
        null,
        location.Region,
        EventPublicationService.ToDomainEventType(request.EventType),
        location.PlaceId,
        location.Latitude,
        location.Longitude);

    private static LocalDateTime ParseLocal(string value, string field)
    {
        if (string.IsNullOrWhiteSpace(value)) throw Validation(field, "Local date and time is required.");
        var parsed = LocalDateTimePattern.CreateWithInvariantCulture("uuuu-MM-dd'T'HH:mm").Parse(value.Trim());
        if (!parsed.Success) throw Validation(field, "Value must be an ISO-8601 local date and time in YYYY-MM-DDTHH:mm form.");
        return parsed.Value;
    }

    private static string? NormalizeAltText(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static AuditRecord NewAudit(Guid actorUserId, string action, Guid eventId, string diff, Instant now) => new()
    {
        ActorId = actorUserId,
        Action = action,
        EntityType = "scheduled_tournament",
        EntityId = eventId.ToString("D"),
        RedactedDiff = diff,
        OccurredAt = now
    };

    private static ApiValidationException Validation(string field, string message) =>
        new(new Dictionary<string, string[]> { [field] = [message] });

    private sealed record ImageShape(Guid Id, string? AltText);
    private sealed record MediaUpdateResult(bool Changed, IReadOnlyList<Guid> RemovedImageIds);
    private sealed record StoredLifecycleMutation(string Command, Guid EventId, EventMutationResponse Response);
}

internal sealed class EventOrganizationDeleteDependency(GonesDbContext database) : IOrganizationDeleteDependency
{
    public async Task<IReadOnlyList<string>> GetBlockersAsync(Guid organizationId, CancellationToken cancellationToken)
    {
        var blocked = await database.Events.AsNoTracking().AnyAsync(item =>
            item.OrganizationId == organizationId
            && item.DeletedAt == null
            && (item.Status == ScheduledTournamentStatus.Published || item.Status == ScheduledTournamentStatus.InProgress),
            cancellationToken);
        return blocked ? ["nonterminal_tournament"] : [];
    }
}

internal sealed record UpdateEventDetailsRequest(
    [property: Required, MaxLength(Event.MaximumTitleLength)] string Title,
    [property: MaxLength(Event.MaximumSummaryLength)] string? Summary,
    [property: MaxLength(Event.MaximumBodyMarkdownLength)] string? BodyMarkdown,
    [property: Required] EventLocationInput Location,
    [property: Required] PublicCalendarEventType? EventType,
    [property: Required] string StartsAtLocal,
    [property: Range(1, int.MaxValue)] int Capacity,
    [property: Required, MinLength(1), MaxLength(1)] IReadOnlyList<Guid> FormatIds,
    [property: Required, MaxLength(5)] IReadOnlyList<EventImageInput> Images)
{
    [JsonExtensionData]
    public IDictionary<string, JsonElement>? AdditionalFields { get; init; }
}

internal sealed record DeleteEventRequest(
    [property: MaxLength(Event.MaximumDeletedReasonLength)] string? Reason)
{
    [JsonExtensionData]
    public IDictionary<string, JsonElement>? AdditionalFields { get; init; }
}

internal sealed record EventManagementListResponse(
    IReadOnlyList<EventManagementResponse> Items,
    int Page,
    int PageSize,
    int TotalCount);

internal sealed record EventManagementResponse(
    Guid Id,
    Guid OrganizationId,
    string OrganizationName,
    string Title,
    string DisplayTitle,
    string Slug,
    string? Summary,
    string? BodyMarkdown,
    string? LiveTournamentUrl,
    string? ArchiveTournamentUrl,
    EventLocationInput Location,
    [property: DataType(DataType.DateTime)] string LocationTokenExpiresAt,
    string StreetAddress,
    string? PostalCode,
    string City,
    string Country,
    string? Region,
    PublicCalendarEventType? EventType,
    string TimeZoneId,
    string StartsAtLocal,
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
    IReadOnlyList<EventImageResponse> Images,
    long Version,
    string ETag);

internal sealed record EventMutationResponse(
    Guid Id,
    string Status,
    bool IsDeleted,
    long Version,
    string ETag);

internal sealed record EventAuditSnapshot(
    string Title,
    string? Summary,
    string? BodyMarkdown,
    string? LiveTournamentUrl,
    string? ArchiveTournamentUrl,
    string StreetAddress,
    string? PostalCode,
    string City,
    string Country,
    string? Region,
    PublicCalendarEventType? EventType,
    string TimeZoneId,
    string StartsAt,
    string EndsAt,
    int? Capacity,
    IReadOnlyList<Guid> FormatIds)
{
    public static EventAuditSnapshot From(Event tournament) => new(
        tournament.Title,
        tournament.Summary,
        tournament.BodyMarkdown,
        tournament.LiveTournamentUrl,
        tournament.ArchiveTournamentUrl,
        tournament.StreetAddress,
        tournament.PostalCode,
        tournament.City,
        tournament.Country,
        tournament.Region,
        EventPublicationService.EventTypeWire(tournament.EventType),
        tournament.TimeZoneId,
        tournament.StartsAtUtc.ToString(),
        tournament.EndsAtUtc.ToString(),
        tournament.Capacity,
        tournament.Formats.Select(item => item.TournamentFormatId).Order().ToArray());

    public bool ScheduleChanged(EventAuditSnapshot other) =>
        StartsAt != other.StartsAt || EndsAt != other.EndsAt || TimeZoneId != other.TimeZoneId;

    public IReadOnlyList<string> ChangedFields(EventAuditSnapshot other)
    {
        var fields = new List<string>();
        if (Title != other.Title) fields.Add("title");
        if (Summary != other.Summary) fields.Add("summary");
        if (BodyMarkdown != other.BodyMarkdown) fields.Add("bodyChanged");
        if (LiveTournamentUrl != other.LiveTournamentUrl) fields.Add("liveTournamentUrl");
        if (ArchiveTournamentUrl != other.ArchiveTournamentUrl) fields.Add("archiveTournamentUrl");
        if (StreetAddress != other.StreetAddress) fields.Add("streetAddress");
        if (PostalCode != other.PostalCode) fields.Add("postalCode");
        if (City != other.City) fields.Add("city");
        if (Country != other.Country) fields.Add("country");
        if (Region != other.Region) fields.Add("region");
        if (EventType != other.EventType) fields.Add("eventType");
        if (TimeZoneId != other.TimeZoneId) fields.Add("timeZoneId");
        if (StartsAt != other.StartsAt) fields.Add("startsAt");
        if (EndsAt != other.EndsAt) fields.Add("endsAt");
        if (Capacity != other.Capacity) fields.Add("capacity");
        if (!FormatIds.SequenceEqual(other.FormatIds)) fields.Add("formatIds");
        return fields;
    }

    public string AuditDiff(EventAuditSnapshot other, IReadOnlyList<string> fields)
    {
        var before = ValuesFor(fields);
        var after = other.ValuesFor(fields);
        return JsonSerializer.Serialize(new
        {
            fields,
            before,
            after,
            bodyChanged = BodyMarkdown != other.BodyMarkdown,
            imagesChanged = fields.Contains("imagesChanged", StringComparer.Ordinal)
        });
    }

    private Dictionary<string, object?> ValuesFor(IReadOnlyList<string> fields)
    {
        var values = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var field in fields)
        {
            if (field is "bodyChanged" or "imagesChanged") continue;
            values[field] = field switch
            {
                "title" => Title,
                "summary" => Summary,
                "liveTournamentUrl" => LiveTournamentUrl,
                "archiveTournamentUrl" => ArchiveTournamentUrl,
                "streetAddress" => StreetAddress,
                "postalCode" => PostalCode,
                "city" => City,
                "country" => Country,
                "region" => Region,
                "eventType" => EventType,
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
