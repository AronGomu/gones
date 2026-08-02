using System.Data;
using System.Security.Claims;
using System.Text.Json;
using Gones.Api.Errors;
using Gones.Api.Organizations;
using Gones.Api.Security;
using Gones.Application.Notifications;
using Gones.Domain.Calendar;
using Gones.Domain.Identity;
using Gones.Domain.Organizations;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using NodaTime.Serialization.SystemTextJson;
using Npgsql;

namespace Gones.Api.Tournaments;

internal static class TournamentRegistrationEndpoints
{
    private const int DefaultPageSize = 20;
    private const int MaximumPageSize = 100;

    public static void MapTournamentRegistrationEndpoints(this WebApplication app)
    {
        var users = app.MapGroup("/api").RequireAuthorization(AuthorizationPolicies.User);
        users.MapPost("/tournaments/{tournamentId:guid}/registrations", RegisterAsync)
            .RequireRateLimiting(AuthRateLimiting.RegistrationPolicy)
            .WithName("RegisterForTournament")
            .Produces<TournamentRegistrationMutationResponse>(StatusCodes.Status201Created)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);
        users.MapDelete("/tournaments/{tournamentId:guid}/registrations", UnregisterAsync)
            .RequireRateLimiting(AuthRateLimiting.RegistrationPolicy)
            .WithName("UnregisterFromTournament")
            .Produces<TournamentRegistrationMutationResponse>()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);
        users.MapGet("/tournaments/{tournamentId:guid}/registration-capability", GetCapabilityAsync)
            .WithName("GetTournamentRegistrationCapability")
            .Produces<TournamentRegistrationCapabilityResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound);
        users.MapGet("/users/me/registrations", ListMineAsync)
            .WithName("ListMyTournamentRegistrations")
            .Produces<TournamentRegistrationListResponse>();
    }

    private static async Task<IResult> RegisterAsync(
        Guid tournamentId,
        [FromHeader(Name = "Idempotency-Key")] string? idempotencyKey,
        ClaimsPrincipal principal,
        TournamentRegistrationService registrations,
        CancellationToken cancellationToken)
    {
        var result = await registrations.RegisterAsync(
            tournamentId,
            OrganizationPrincipal.UserId(principal),
            RequireIdempotencyKey(idempotencyKey),
            cancellationToken);
        return Results.Created($"/api/users/me/registrations", result);
    }

    private static async Task<IResult> UnregisterAsync(
        Guid tournamentId,
        [FromHeader(Name = "Idempotency-Key")] string? idempotencyKey,
        ClaimsPrincipal principal,
        TournamentRegistrationService registrations,
        CancellationToken cancellationToken) =>
        Results.Ok(await registrations.UnregisterAsync(
            tournamentId,
            OrganizationPrincipal.UserId(principal),
            RequireIdempotencyKey(idempotencyKey),
            cancellationToken));

    private static async Task<IResult> GetCapabilityAsync(
        Guid tournamentId,
        ClaimsPrincipal principal,
        TournamentRegistrationService registrations,
        CancellationToken cancellationToken) =>
        Results.Ok(await registrations.GetCapabilityAsync(
            tournamentId,
            OrganizationPrincipal.UserId(principal),
            cancellationToken));

    private static async Task<IResult> ListMineAsync(
        int? page,
        int? pageSize,
        ClaimsPrincipal principal,
        TournamentRegistrationService registrations,
        CancellationToken cancellationToken) =>
        Results.Ok(await registrations.ListMineAsync(
            OrganizationPrincipal.UserId(principal),
            page is null or < 1 ? 1 : page.Value,
            pageSize is null or < 1 ? DefaultPageSize : Math.Min(pageSize.Value, MaximumPageSize),
            cancellationToken));

    private static string RequireIdempotencyKey(string? value)
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
}

internal sealed class TournamentRegistrationService(
    GonesDbContext database,
    TournamentRegistrationNotificationService notifications,
    OrganizationAccessService organizationAccess,
    IClock clock)
{
    private const int MaximumSerializableAttempts = 10;
    private static readonly JsonSerializerOptions StoredJsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web)
        .ConfigureForNodaTime(DateTimeZoneProviders.Tzdb);

    public Task<TournamentRegistrationMutationResponse> RegisterAsync(
        Guid tournamentId,
        Guid userId,
        string idempotencyKey,
        CancellationToken cancellationToken) =>
        ExecuteSerializableAsync(() => RegisterOnceAsync(tournamentId, userId, userId, idempotencyKey, false, false, cancellationToken), cancellationToken);

    public Task<TournamentRegistrationMutationResponse> RegisterByOrganizerAsync(
        Guid tournamentId,
        Guid userId,
        Guid actorUserId,
        bool isAdmin,
        CancellationToken cancellationToken) =>
        ExecuteSerializableAsync(() => RegisterOnceAsync(tournamentId, userId, actorUserId, null, true, isAdmin, cancellationToken), cancellationToken);

    public Task<TournamentRegistrationMutationResponse> RemoveByOrganizerAsync(
        Guid tournamentId,
        Guid registrationId,
        Guid actorUserId,
        bool isAdmin,
        CancellationToken cancellationToken) =>
        ExecuteSerializableAsync(() => RemoveByOrganizerOnceAsync(tournamentId, registrationId, actorUserId, isAdmin, cancellationToken), cancellationToken);

    public Task<TournamentRegistrationMutationResponse> UnregisterAsync(
        Guid tournamentId,
        Guid userId,
        string idempotencyKey,
        CancellationToken cancellationToken) =>
        ExecuteSerializableAsync(() => UnregisterOnceAsync(tournamentId, userId, idempotencyKey, cancellationToken), cancellationToken);

    public async Task<TournamentRegistrationCapabilityResponse> GetCapabilityAsync(
        Guid tournamentId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        var tournament = await database.ScheduledTournaments.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == tournamentId && item.DeletedAt == null, cancellationToken)
            ?? throw new ResourceNotFoundException();
        if (!await database.Organizations.AsNoTracking().AnyAsync(
                item => item.Id == tournament.OrganizationId && item.DeletedAt == null,
                cancellationToken))
        {
            throw new ResourceNotFoundException();
        }

        var activeParticipantCount = await database.TournamentRegistrationAttempts.AsNoTracking().CountAsync(
            item => item.TournamentId == tournamentId && item.Status == TournamentRegistrationStatus.Confirmed,
            cancellationToken);
        var hasActiveRegistration = await database.TournamentRegistrationAttempts.AsNoTracking().AnyAsync(
            item => item.TournamentId == tournamentId
                && item.UserId == userId
                && item.Status == TournamentRegistrationStatus.Confirmed,
            cancellationToken);
        var now = clock.GetCurrentInstant();
        if (hasActiveRegistration)
        {
            var canUnregister = now < tournament.StartsAtUtc;
            return Capability(false, canUnregister, canUnregister ? "registered" : "unregistration_closed");
        }
        if (tournament.Status == ScheduledTournamentStatus.InProgress || now >= tournament.StartsAtUtc)
        {
            return Capability(false, false, "registration_closed");
        }
        if (tournament.Status != ScheduledTournamentStatus.Published)
        {
            return Capability(false, false, "tournament_not_open");
        }

        var user = await database.Users.AsNoTracking().SingleOrDefaultAsync(item => item.Id == userId, cancellationToken)
            ?? throw new ResourceNotFoundException();
        if (!user.EmailConfirmed) return Capability(false, false, "email_verification_required");
        if (!await database.UserProfiles.AsNoTracking().AnyAsync(item => item.UserId == userId && item.ClosedAt == null, cancellationToken))
        {
            throw new ResourceNotFoundException();
        }
        if (await database.OrganizationBlockedUsers.AsNoTracking().AnyAsync(block =>
                block.OrganizationId == tournament.OrganizationId
                && block.UserId == userId
                && block.IsActive
                && (block.ExpiresAt == null || block.ExpiresAt > now), cancellationToken))
        {
            return Capability(false, false, "registration_blocked");
        }
        if (tournament.Capacity is int capacity && activeParticipantCount >= capacity)
        {
            return Capability(false, false, "tournament_full");
        }
        return Capability(true, false, "available");

        TournamentRegistrationCapabilityResponse Capability(bool canRegister, bool canUnregister, string reason) =>
            new(canRegister, canUnregister, reason, activeParticipantCount, tournament.Capacity);
    }

    public async Task<TournamentRegistrationListResponse> ListMineAsync(
        Guid userId,
        int page,
        int pageSize,
        CancellationToken cancellationToken)
    {
        var query =
            from attempt in database.TournamentRegistrationAttempts.AsNoTracking()
            join tournament in database.ScheduledTournaments.AsNoTracking() on attempt.TournamentId equals tournament.Id
            join organization in database.Organizations.AsNoTracking() on tournament.OrganizationId equals organization.Id
            where attempt.UserId == userId
            select new { Attempt = attempt, Tournament = tournament, OrganizationName = organization.Name };
        var total = await query.CountAsync(cancellationToken);
        var items = await query
            .OrderByDescending(item => item.Attempt.Status == TournamentRegistrationStatus.Confirmed)
            .ThenByDescending(item => item.Attempt.RegisteredAt)
            .ThenByDescending(item => item.Attempt.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(item => new TournamentRegistrationHistoryResponse(
                item.Attempt.Id,
                item.Tournament.Id,
                item.Tournament.Slug,
                item.Tournament.Title,
                item.OrganizationName,
                item.Tournament.StartsAtUtc,
                item.Tournament.TimeZoneId,
                item.Attempt.Status.ToString(),
                item.Attempt.Status == TournamentRegistrationStatus.Confirmed,
                item.Attempt.RegisteredByUserId,
                item.Attempt.RegisteredAt,
                item.Attempt.StatusChangedByUserId,
                item.Attempt.StatusChangedAt))
            .ToListAsync(cancellationToken);
        return new TournamentRegistrationListResponse(items, page, pageSize, total);
    }

    private async Task<TournamentRegistrationMutationResponse> RegisterOnceAsync(
        Guid tournamentId,
        Guid userId,
        Guid actorUserId,
        string? idempotencyKey,
        bool requireOrganizerAccess,
        bool isAdmin,
        CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
        var tournament = await LockTournamentAsync(tournamentId, cancellationToken)
            ?? throw new ResourceNotFoundException();
        if (requireOrganizerAccess)
        {
            _ = await organizationAccess.RequireMemberAsync(tournament.OrganizationId, actorUserId, isAdmin, cancellationToken);
        }

        var scope = $"tournament-registration:{userId:D}";
        if (idempotencyKey is not null)
        {
            var replay = await ReplayAsync(scope, idempotencyKey, tournamentId, "register", cancellationToken);
            if (replay is not null)
            {
                await transaction.CommitAsync(cancellationToken);
                return replay;
            }
        }

        if (tournament.DeletedAt is not null) throw new ResourceNotFoundException();
        var now = clock.GetCurrentInstant();
        if (tournament.Status == ScheduledTournamentStatus.InProgress || now >= tournament.StartsAtUtc)
        {
            throw new RegistrationClosedException();
        }
        if (tournament.Status != ScheduledTournamentStatus.Published) throw new TournamentNotOpenException();
        if (!await database.Organizations.AnyAsync(item => item.Id == tournament.OrganizationId && item.DeletedAt == null, cancellationToken))
        {
            throw new ResourceNotFoundException();
        }

        var user = await database.Users.SingleOrDefaultAsync(item => item.Id == userId, cancellationToken)
            ?? throw new ResourceNotFoundException();
        if (!user.EmailConfirmed) throw new EmailVerificationRequiredException();
        var profile = await database.UserProfiles.SingleOrDefaultAsync(item => item.UserId == userId && item.ClosedAt == null, cancellationToken)
            ?? throw new ResourceNotFoundException();
        if (await database.OrganizationBlockedUsers.AsNoTracking().AnyAsync(block =>
                block.OrganizationId == tournament.OrganizationId
                && block.UserId == userId
                && block.IsActive
                && (block.ExpiresAt == null || block.ExpiresAt > now), cancellationToken))
        {
            throw new RegistrationBlockedException();
        }
        if (await database.TournamentRegistrationAttempts.AnyAsync(attempt =>
                attempt.TournamentId == tournament.Id
                && attempt.UserId == userId
                && attempt.Status == TournamentRegistrationStatus.Confirmed, cancellationToken))
        {
            throw new RegistrationAlreadyActiveException();
        }
        if (tournament.Capacity is int capacity
            && await database.TournamentRegistrationAttempts.CountAsync(attempt =>
                attempt.TournamentId == tournament.Id
                && attempt.Status == TournamentRegistrationStatus.Confirmed, cancellationToken) >= capacity)
        {
            throw new TournamentFullException();
        }

        var attempt = TournamentRegistrationAttempt.Register(tournament.Id, userId, actorUserId, now);
        database.TournamentRegistrationAttempts.Add(attempt);
        await notifications.EnqueueSelfRegistrationAsync(attempt, tournament, user, profile, registered: true, cancellationToken);
        database.AuditRecords.Add(NewAudit(
            actorUserId,
            requireOrganizerAccess ? "tournament.registration.confirmed_by_organizer" : "tournament.registration.confirmed",
            attempt.Id,
            JsonSerializer.Serialize(new { fields = new[] { "status" }, tournamentId = tournament.Id, userId }),
            now));
        MarkParticipantProjectionChanged(tournament);
        var response = ToMutation(attempt);
        if (idempotencyKey is not null)
        {
            StoreIdempotency(scope, idempotencyKey, "register", tournament.Id, response, now, StatusCodes.Status201Created);
        }
        await SaveAndCommitAsync(transaction, cancellationToken);
        return response;
    }

    private async Task<TournamentRegistrationMutationResponse> RemoveByOrganizerOnceAsync(
        Guid tournamentId,
        Guid registrationId,
        Guid actorUserId,
        bool isAdmin,
        CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
        var tournament = await LockTournamentAsync(tournamentId, cancellationToken)
            ?? throw new ResourceNotFoundException();
        if (tournament.DeletedAt is not null) throw new ResourceNotFoundException();
        _ = await organizationAccess.RequireMemberAsync(tournament.OrganizationId, actorUserId, isAdmin, cancellationToken);
        var now = clock.GetCurrentInstant();
        if (now >= tournament.StartsAtUtc) throw new UnregistrationClosedException();
        var attempt = await database.TournamentRegistrationAttempts
            .FromSqlInterpolated($"SELECT * FROM tournament_registration_attempts WHERE id = {registrationId} AND tournament_id = {tournamentId} AND status = 'Confirmed' FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new ActiveRegistrationNotFoundException();
        var user = await database.Users.SingleAsync(item => item.Id == attempt.UserId, cancellationToken);
        var profile = await database.UserProfiles.SingleAsync(item => item.UserId == attempt.UserId && item.ClosedAt == null, cancellationToken);
        attempt.RemoveByOrganizer(actorUserId, now);
        notifications.EnqueueOrganizerRemoval(attempt, tournament, user, profile);
        database.AuditRecords.Add(NewAudit(
            actorUserId,
            "tournament.registration.removed_by_organizer",
            attempt.Id,
            JsonSerializer.Serialize(new { fields = new[] { "status" }, tournamentId, userId = attempt.UserId }),
            now));
        MarkParticipantProjectionChanged(tournament);
        var response = ToMutation(attempt);
        await SaveAndCommitAsync(transaction, cancellationToken);
        return response;
    }

    private async Task<TournamentRegistrationMutationResponse> UnregisterOnceAsync(
        Guid tournamentId,
        Guid userId,
        string idempotencyKey,
        CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
        var tournament = await LockTournamentAsync(tournamentId, cancellationToken)
            ?? throw new ResourceNotFoundException();

        var scope = $"tournament-registration:{userId:D}";
        var replay = await ReplayAsync(scope, idempotencyKey, tournamentId, "unregister", cancellationToken);
        if (replay is not null)
        {
            await transaction.CommitAsync(cancellationToken);
            return replay;
        }

        if (tournament.DeletedAt is not null) throw new ResourceNotFoundException();
        var now = clock.GetCurrentInstant();
        if (now >= tournament.StartsAtUtc) throw new UnregistrationClosedException();
        var attempt = await database.TournamentRegistrationAttempts
            .FromSqlInterpolated($"""
                SELECT * FROM tournament_registration_attempts
                WHERE tournament_id = {tournamentId} AND user_id = {userId} AND status = 'Confirmed'
                FOR UPDATE
                """)
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new ActiveRegistrationNotFoundException();
        var user = await database.Users.SingleAsync(item => item.Id == userId, cancellationToken);
        var profile = await database.UserProfiles.SingleAsync(item => item.UserId == userId, cancellationToken);
        attempt.CancelByUser(userId, now);
        await notifications.EnqueueSelfRegistrationAsync(attempt, tournament, user, profile, registered: false, cancellationToken);
        database.AuditRecords.Add(NewAudit(
            userId,
            "tournament.registration.cancelled_by_user",
            attempt.Id,
            JsonSerializer.Serialize(new { fields = new[] { "status" }, tournamentId = tournament.Id, userId }),
            now));
        MarkParticipantProjectionChanged(tournament);
        var response = ToMutation(attempt);
        StoreIdempotency(scope, idempotencyKey, "unregister", tournament.Id, response, now, StatusCodes.Status200OK);
        await SaveAndCommitAsync(transaction, cancellationToken);
        return response;
    }

    private async Task<TournamentRegistrationMutationResponse?> ReplayAsync(
        string scope,
        string key,
        Guid tournamentId,
        string command,
        CancellationToken cancellationToken)
    {
        var existing = await database.IdempotencyRecords.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Scope == scope && item.Key == key, cancellationToken);
        if (existing is null) return null;
        var stored = JsonSerializer.Deserialize<StoredRegistrationMutation>(existing.ResponseBody, StoredJsonOptions)
            ?? throw new InvalidOperationException("Stored registration result is invalid.");
        if (stored.TournamentId != tournamentId || !string.Equals(stored.Command, command, StringComparison.Ordinal))
        {
            throw new IdempotencyConflictException();
        }
        return stored.Response;
    }

    private void StoreIdempotency(
        string scope,
        string key,
        string command,
        Guid tournamentId,
        TournamentRegistrationMutationResponse response,
        Instant now,
        int statusCode)
    {
        database.IdempotencyRecords.Add(new IdempotencyRecord
        {
            Scope = scope,
            Key = key,
            ResponseStatusCode = statusCode,
            ResponseBody = JsonSerializer.Serialize(new StoredRegistrationMutation(command, tournamentId, response), StoredJsonOptions),
            CreatedAt = now,
            ExpiresAt = now + Duration.FromHours(24)
        });
    }

    private async Task<TournamentRegistrationMutationResponse> ExecuteSerializableAsync(
        Func<Task<TournamentRegistrationMutationResponse>> action,
        CancellationToken cancellationToken)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                return await action();
            }
            catch (Exception exception) when (IsSerializationFailure(exception) && attempt < MaximumSerializableAttempts)
            {
                database.ChangeTracker.Clear();
                await Task.Delay(TimeSpan.FromMilliseconds(attempt * attempt * 10), cancellationToken);
            }
        }
    }

    private async Task<ScheduledTournament?> LockTournamentAsync(Guid tournamentId, CancellationToken cancellationToken) =>
        await database.ScheduledTournaments
            .FromSqlInterpolated($"SELECT * FROM scheduled_tournaments WHERE id = {tournamentId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);

    private async Task SaveAndCommitAsync(
        Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction transaction,
        CancellationToken cancellationToken)
    {
        try
        {
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new RegistrationAlreadyActiveException();
        }
    }

    private void MarkParticipantProjectionChanged(ScheduledTournament tournament) =>
        database.Entry(tournament).Property(item => item.UpdatedAt).IsModified = true;

    private static bool IsSerializationFailure(Exception exception)
    {
        for (Exception? current = exception; current is not null; current = current.InnerException)
        {
            if (current is PostgresException { SqlState: PostgresErrorCodes.SerializationFailure }) return true;
        }
        return false;
    }

    private static TournamentRegistrationMutationResponse ToMutation(TournamentRegistrationAttempt attempt) =>
        new(attempt.Id, attempt.TournamentId, attempt.UserId, attempt.Status.ToString(), attempt.RegisteredAt, attempt.StatusChangedAt);

    private static AuditRecord NewAudit(Guid actorId, string action, Guid attemptId, string diff, Instant now) => new()
    {
        ActorId = actorId,
        Action = action,
        EntityType = "tournament_registration",
        EntityId = attemptId.ToString("D"),
        RedactedDiff = diff,
        OccurredAt = now
    };

    private sealed record StoredRegistrationMutation(
        string Command,
        Guid TournamentId,
        TournamentRegistrationMutationResponse Response);
}

internal sealed record TournamentRegistrationCapabilityResponse(
    bool CanRegister,
    bool CanUnregister,
    string Reason,
    int ActiveParticipantCount,
    int? Capacity);

internal sealed class TournamentRegistrationNotificationService(
    GonesDbContext database,
    INotificationOutbox outbox,
    TournamentRegistrationOptions options)
{
    public async Task EnqueueSelfRegistrationAsync(
        TournamentRegistrationAttempt attempt,
        ScheduledTournament tournament,
        ApplicationUser user,
        UserProfile profile,
        bool registered,
        CancellationToken cancellationToken)
    {
        var tournamentUrl = TournamentUrl(tournament.Slug);
        outbox.Enqueue(new NotificationRequest(
            RequiredEmail(user),
            profile.PreferredLanguage,
            $"registration:{attempt.Id:D}:{(registered ? "confirmed" : "cancelled-by-user")}:participant",
            registered
                ? new RegistrationTemplateModel(profile.Username, tournament.Title, tournamentUrl)
                : new UnregistrationTemplateModel(profile.Username, tournament.Title, tournamentUrl),
            user.Id,
            tournament.Id));

        var settings = await database.OrganizationNotificationSettings.AsNoTracking()
            .SingleOrDefaultAsync(item => item.OrganizationId == tournament.OrganizationId, cancellationToken);
        var notify = registered ? settings?.NotifyOnRegistration == true : settings?.NotifyOnUnregistration == true;
        if (!notify) return;

        var organizers = await (
            from member in database.OrganizationMembers.AsNoTracking()
            join organizer in database.Users.AsNoTracking() on member.UserId equals organizer.Id
            join organizerProfile in database.UserProfiles.AsNoTracking() on organizer.Id equals organizerProfile.UserId
            where member.OrganizationId == tournament.OrganizationId && organizerProfile.ClosedAt == null
            select new { User = organizer, Profile = organizerProfile }
        ).ToListAsync(cancellationToken);
        foreach (var organizer in organizers)
        {
            outbox.Enqueue(new NotificationRequest(
                RequiredEmail(organizer.User),
                organizer.Profile.PreferredLanguage,
                $"registration:{attempt.Id:D}:{(registered ? "confirmed" : "cancelled-by-user")}:organizer:{organizer.User.Id:D}",
                new OrganizerNoticeTemplateModel(
                    organizer.Profile.Username,
                    profile.Username,
                    tournament.Title,
                    registered ? "registered" : "unregistered",
                    tournamentUrl),
                organizer.User.Id,
                tournament.Id));
        }
    }

    public void EnqueueOrganizerRemoval(
        TournamentRegistrationAttempt attempt,
        ScheduledTournament tournament,
        ApplicationUser user,
        UserProfile profile)
    {
        outbox.Enqueue(new NotificationRequest(
            RequiredEmail(user),
            profile.PreferredLanguage,
            $"registration:{attempt.Id:D}:removed-by-organizer:participant",
            new UnregistrationTemplateModel(profile.Username, tournament.Title, TournamentUrl(tournament.Slug)),
            user.Id,
            tournament.Id));
    }

    public async Task EnqueueMajorUpdateAsync(
        ScheduledTournament tournament,
        Guid lifecycleEventId,
        CancellationToken cancellationToken)
    {
        var participants = await ActiveParticipantsAsync(tournament.Id, cancellationToken);
        foreach (var participant in participants)
        {
            outbox.Enqueue(new NotificationRequest(
                RequiredEmail(participant.User),
                participant.Profile.PreferredLanguage,
                $"tournament-lifecycle:{lifecycleEventId:D}:major-update:{participant.User.Id:D}",
                new MajorUpdateTemplateModel(participant.Profile.Username, tournament.Title, "date_or_address", TournamentUrl(tournament.Slug)),
                participant.User.Id,
                tournament.Id));
        }
    }

    public async Task CancelActiveRegistrationsAsync(
        ScheduledTournament tournament,
        Guid lifecycleEventId,
        Guid actorUserId,
        Instant now,
        CancellationToken cancellationToken)
    {
        var participants = await ActiveParticipantsAsync(tournament.Id, cancellationToken);
        foreach (var participant in participants)
        {
            participant.Attempt.CancelByTournament(actorUserId, now);
            outbox.Enqueue(new NotificationRequest(
                RequiredEmail(participant.User),
                participant.Profile.PreferredLanguage,
                $"tournament-lifecycle:{lifecycleEventId:D}:cancellation:{participant.User.Id:D}",
                new CancellationTemplateModel(participant.Profile.Username, tournament.Title, TournamentUrl(tournament.Slug)),
                participant.User.Id,
                tournament.Id));
        }
    }

    private async Task<List<ActiveParticipant>> ActiveParticipantsAsync(Guid tournamentId, CancellationToken cancellationToken) =>
        await (
            from attempt in database.TournamentRegistrationAttempts
            join user in database.Users on attempt.UserId equals user.Id
            join profile in database.UserProfiles on user.Id equals profile.UserId
            where attempt.TournamentId == tournamentId
                && attempt.Status == TournamentRegistrationStatus.Confirmed
                && profile.ClosedAt == null
            orderby attempt.Id
            select new ActiveParticipant(attempt, user, profile)
        ).ToListAsync(cancellationToken);

    private Uri TournamentUrl(string slug)
    {
        if (!Uri.TryCreate(options.PublicAppOrigin, UriKind.Absolute, out var origin)
            || origin.Scheme != Uri.UriSchemeHttps
            || string.IsNullOrWhiteSpace(origin.Host)
            || origin.AbsolutePath != "/"
            || !string.IsNullOrWhiteSpace(origin.Query)
            || !string.IsNullOrWhiteSpace(origin.Fragment))
        {
            throw new InvalidOperationException("GONES_PUBLIC_APP_ORIGIN must be an HTTPS origin.");
        }
        return new Uri(origin, $"/calendar/tournaments/{Uri.EscapeDataString(slug)}");
    }

    private static string RequiredEmail(ApplicationUser user) =>
        !string.IsNullOrWhiteSpace(user.Email) ? user.Email : throw new InvalidOperationException("Registration notification user lacks email.");

    private sealed record ActiveParticipant(
        TournamentRegistrationAttempt Attempt,
        ApplicationUser User,
        UserProfile Profile);
}

internal sealed record TournamentRegistrationOptions(string? PublicAppOrigin)
{
    public static TournamentRegistrationOptions Load(IConfiguration configuration) =>
        new(configuration["GONES_PUBLIC_APP_ORIGIN"]);
}

internal sealed class RegistrationOrganizationDeleteDependency(GonesDbContext database) : IOrganizationDeleteDependency
{
    public async Task<IReadOnlyList<string>> GetBlockersAsync(Guid organizationId, CancellationToken cancellationToken)
    {
        var blocked = await database.TournamentRegistrationAttempts.AsNoTracking().AnyAsync(attempt =>
            attempt.Status == TournamentRegistrationStatus.Confirmed
            && database.ScheduledTournaments.Any(tournament =>
                tournament.Id == attempt.TournamentId && tournament.OrganizationId == organizationId),
            cancellationToken);
        return blocked ? ["active_registration"] : [];
    }
}

internal sealed record TournamentRegistrationMutationResponse(
    Guid AttemptId,
    Guid TournamentId,
    Guid UserId,
    string Status,
    Instant RegisteredAt,
    Instant? StatusChangedAt);

internal sealed record TournamentRegistrationListResponse(
    IReadOnlyList<TournamentRegistrationHistoryResponse> Items,
    int Page,
    int PageSize,
    int TotalCount);

internal sealed record TournamentRegistrationHistoryResponse(
    Guid AttemptId,
    Guid TournamentId,
    string TournamentSlug,
    string TournamentTitle,
    string OrganizationName,
    Instant StartsAtUtc,
    string TimeZoneId,
    string Status,
    bool IsCurrent,
    Guid RegisteredByUserId,
    Instant RegisteredAt,
    Guid? StatusChangedByUserId,
    Instant? StatusChangedAt);
