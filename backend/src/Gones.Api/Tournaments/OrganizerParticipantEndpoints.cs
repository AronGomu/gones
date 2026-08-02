using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Gones.Api.Errors;
using Gones.Api.Organizations;
using Gones.Api.Security;
using Gones.Api.Validation;
using Gones.Domain.Calendar;
using Gones.Domain.Identity;
using Gones.Domain.Organizations;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using Npgsql;

namespace Gones.Api.Tournaments;

internal static class OrganizerParticipantEndpoints
{
    private const int DefaultPageSize = 20;
    private const int MaximumPageSize = 100;

    public static void MapOrganizerParticipantEndpoints(this WebApplication app)
    {
        var users = app.MapGroup("/api").RequireAuthorization(AuthorizationPolicies.User);

        users.MapGet("/organizations/{organizationId:guid}/users/lookup", LookupUserAsync)
            .WithName("LookupOrganizationUser")
            .Produces<OrganizationUserLookupResponse>()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound);
        users.MapGet("/organizations/{organizationId:guid}/blocked-users", ListBlockedUsersAsync)
            .WithName("ListOrganizationBlockedUsers")
            .Produces<OrganizationBlockedUserListResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound);
        users.MapPost("/organizations/{organizationId:guid}/blocked-users", BlockUserAsync)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .WithName("BlockOrganizationUser")
            .Produces<OrganizationBlockedUserResponse>(StatusCodes.Status201Created)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
        users.MapDelete("/organizations/{organizationId:guid}/blocked-users/{userId:guid}", UnblockUserAsync)
            .WithName("UnblockOrganizationUser")
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status404NotFound);

        users.MapGet("/tournaments/{tournamentId:guid}/registrations", ListParticipantsAsync)
            .WithName("ListPrivateTournamentParticipants")
            .Produces<PrivateTournamentParticipantListResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound);
        users.MapPost("/tournaments/{tournamentId:guid}/registrations/by-organizer", RegisterByOrganizerAsync)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .RequireRateLimiting(AuthRateLimiting.RegistrationPolicy)
            .WithName("RegisterTournamentParticipantByOrganizer")
            .Produces<TournamentRegistrationMutationResponse>(StatusCodes.Status201Created)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);
        users.MapDelete("/tournaments/{tournamentId:guid}/registrations/{registrationId:guid}", RemoveByOrganizerAsync)
            .RequireRateLimiting(AuthRateLimiting.RegistrationPolicy)
            .WithName("RemoveTournamentParticipantByOrganizer")
            .Produces<TournamentRegistrationMutationResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);
        users.MapGet("/tournaments/{tournamentId:guid}/registrations/export", ExportParticipantsAsync)
            .RequireRateLimiting(AuthRateLimiting.ExportPolicy)
            .WithName("ExportTournamentParticipants")
            .Produces<Stream>(StatusCodes.Status200OK, contentType: "text/csv")
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);
    }

    private static async Task<IResult> LookupUserAsync(
        Guid organizationId,
        string? username,
        string? email,
        ClaimsPrincipal principal,
        OrganizerParticipantService participants,
        CancellationToken cancellationToken) =>
        Results.Ok(await participants.LookupUserAsync(
            organizationId,
            username,
            email,
            OrganizationPrincipal.UserId(principal),
            OrganizationPrincipal.IsAdmin(principal),
            cancellationToken));

    private static async Task<IResult> ListBlockedUsersAsync(
        Guid organizationId,
        int? page,
        int? pageSize,
        ClaimsPrincipal principal,
        OrganizerParticipantService participants,
        CancellationToken cancellationToken) =>
        Results.Ok(await participants.ListBlockedUsersAsync(
            organizationId,
            Page(page),
            PageSize(pageSize),
            OrganizationPrincipal.UserId(principal),
            OrganizationPrincipal.IsAdmin(principal),
            cancellationToken));

    private static async Task<IResult> BlockUserAsync(
        Guid organizationId,
        BlockOrganizationUserRequest request,
        ClaimsPrincipal principal,
        OrganizerParticipantService participants,
        CancellationToken cancellationToken)
    {
        var response = await participants.BlockUserAsync(
            organizationId,
            request.UserId,
            request.Reason,
            request.ExpiresAt,
            OrganizationPrincipal.UserId(principal),
            OrganizationPrincipal.IsAdmin(principal),
            cancellationToken);
        return Results.Created($"/api/organizations/{organizationId:D}/blocked-users/{request.UserId:D}", response);
    }

    private static async Task<IResult> UnblockUserAsync(
        Guid organizationId,
        Guid userId,
        ClaimsPrincipal principal,
        OrganizerParticipantService participants,
        CancellationToken cancellationToken)
    {
        await participants.UnblockUserAsync(
            organizationId,
            userId,
            OrganizationPrincipal.UserId(principal),
            OrganizationPrincipal.IsAdmin(principal),
            cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> ListParticipantsAsync(
        Guid tournamentId,
        int? page,
        int? pageSize,
        ClaimsPrincipal principal,
        OrganizerParticipantService participants,
        CancellationToken cancellationToken) =>
        Results.Ok(await participants.ListParticipantsAsync(
            tournamentId,
            Page(page),
            PageSize(pageSize),
            OrganizationPrincipal.UserId(principal),
            OrganizationPrincipal.IsAdmin(principal),
            cancellationToken));

    private static async Task<IResult> RegisterByOrganizerAsync(
        Guid tournamentId,
        RegisterByOrganizerRequest request,
        ClaimsPrincipal principal,
        TournamentRegistrationService registrations,
        CancellationToken cancellationToken)
    {
        var result = await registrations.RegisterByOrganizerAsync(
            tournamentId,
            request.UserId,
            OrganizationPrincipal.UserId(principal),
            OrganizationPrincipal.IsAdmin(principal),
            cancellationToken);
        return Results.Created($"/api/tournaments/{tournamentId:D}/registrations/{result.AttemptId:D}", result);
    }

    private static async Task<IResult> RemoveByOrganizerAsync(
        Guid tournamentId,
        Guid registrationId,
        ClaimsPrincipal principal,
        TournamentRegistrationService registrations,
        CancellationToken cancellationToken) =>
        Results.Ok(await registrations.RemoveByOrganizerAsync(
            tournamentId,
            registrationId,
            OrganizationPrincipal.UserId(principal),
            OrganizationPrincipal.IsAdmin(principal),
            cancellationToken));

    private static Task<IResult> ExportParticipantsAsync(
        Guid tournamentId,
        ClaimsPrincipal principal,
        OrganizerParticipantService participants,
        CancellationToken cancellationToken) =>
        participants.ExportParticipantsAsync(
            tournamentId,
            OrganizationPrincipal.UserId(principal),
            OrganizationPrincipal.IsAdmin(principal),
            cancellationToken);

    private static int Page(int? value) => value is null or < 1 ? 1 : value.Value;
    private static int PageSize(int? value) => value is null or < 1 ? DefaultPageSize : Math.Min(value.Value, MaximumPageSize);
}

internal sealed class OrganizerParticipantService(
    GonesDbContext database,
    OrganizationAccessService access,
    IClock clock)
{
    internal const int MaximumExportRows = 10_000;
    private static readonly string[] CsvColumns = ["Username", "FirstName", "LastName", "Email", "RegisteredAt"];

    public async Task<OrganizationUserLookupResponse> LookupUserAsync(
        Guid organizationId,
        string? username,
        string? email,
        Guid actorUserId,
        bool isAdmin,
        CancellationToken cancellationToken)
    {
        _ = await access.RequireMemberAsync(organizationId, actorUserId, isAdmin, cancellationToken);
        var hasUsername = !string.IsNullOrWhiteSpace(username);
        var hasEmail = !string.IsNullOrWhiteSpace(email);
        if (hasUsername == hasEmail)
        {
            throw Validation("lookup", "Provide exactly one exact Username or email.");
        }

        string? normalizedUsername = null;
        if (hasUsername)
        {
            try
            {
                normalizedUsername = Username.Normalize(username!);
            }
            catch (ArgumentException)
            {
                throw Validation("username", "Username is invalid.");
            }
        }
        var normalizedEmail = hasEmail ? email!.Trim().ToUpperInvariant() : null;
        return await (
            from user in database.Users.AsNoTracking()
            join profile in database.UserProfiles.AsNoTracking() on user.Id equals profile.UserId
            where user.EmailConfirmed
                && profile.ClosedAt == null
                && (normalizedUsername != null
                    ? profile.NormalizedUsername == normalizedUsername
                    : user.NormalizedEmail == normalizedEmail)
            select new OrganizationUserLookupResponse(user.Id, profile.Username, profile.FirstName, profile.LastName, user.Email!)
        ).SingleOrDefaultAsync(cancellationToken) ?? throw new ResourceNotFoundException();
    }

    public async Task<OrganizationBlockedUserListResponse> ListBlockedUsersAsync(
        Guid organizationId,
        int page,
        int pageSize,
        Guid actorUserId,
        bool isAdmin,
        CancellationToken cancellationToken)
    {
        _ = await access.RequireMemberAsync(organizationId, actorUserId, isAdmin, cancellationToken);
        var now = clock.GetCurrentInstant();
        var query =
            from block in database.OrganizationBlockedUsers.AsNoTracking()
            join profile in database.UserProfiles.AsNoTracking() on block.UserId equals profile.UserId
            where block.OrganizationId == organizationId
                && block.IsActive
                && (block.ExpiresAt == null || block.ExpiresAt > now)
                && profile.ClosedAt == null
            select new { Block = block, Profile = profile };
        var total = await query.CountAsync(cancellationToken);
        var items = await query
            .OrderBy(item => item.Profile.NormalizedUsername)
            .ThenBy(item => item.Block.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(item => new OrganizationBlockedUserResponse(
                item.Block.Id,
                organizationId,
                item.Block.UserId,
                item.Profile.Username,
                item.Block.Reason,
                item.Block.BlockedByUserId,
                item.Block.BlockedAt,
                item.Block.ExpiresAt))
            .ToListAsync(cancellationToken);
        return new OrganizationBlockedUserListResponse(items, page, pageSize, total);
    }

    public async Task<OrganizationBlockedUserResponse> BlockUserAsync(
        Guid organizationId,
        Guid userId,
        string reason,
        Instant? expiresAt,
        Guid actorUserId,
        bool isAdmin,
        CancellationToken cancellationToken)
    {
        _ = await access.RequireMemberAsync(organizationId, actorUserId, isAdmin, cancellationToken);
        var now = clock.GetCurrentInstant();
        if (expiresAt <= now) throw Validation("expiresAt", "Expiry must be in the future.");
        var target = await (
            from user in database.Users
            join profile in database.UserProfiles on user.Id equals profile.UserId
            where user.Id == userId && user.EmailConfirmed && profile.ClosedAt == null
            select new { User = user, Profile = profile }
        ).SingleOrDefaultAsync(cancellationToken) ?? throw new ResourceNotFoundException();

        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var current = await database.OrganizationBlockedUsers
            .FromSqlInterpolated($"SELECT * FROM organization_blocked_users WHERE organization_id = {organizationId} AND user_id = {userId} AND is_active FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);
        if (current?.AppliesAt(now) == true) throw new OrganizationBlockAlreadyActiveException();
        if (current is not null)
        {
            current.Unblock(actorUserId, now);
            await database.SaveChangesAsync(cancellationToken);
        }

        OrganizationBlockedUser block;
        try
        {
            block = OrganizationBlockedUser.Block(organizationId, userId, reason, actorUserId, now, expiresAt);
        }
        catch (ArgumentException)
        {
            throw Validation("reason", $"Reason is required and cannot exceed {OrganizationBlockedUser.MaximumReasonLength} characters.");
        }
        database.OrganizationBlockedUsers.Add(block);
        database.AuditRecords.Add(Audit(
            actorUserId,
            "organization.user.blocked",
            block.Id,
            JsonSerializer.Serialize(new { fields = new[] { "reason", "expiresAt" }, organizationId, userId }),
            now));
        try
        {
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new OrganizationBlockAlreadyActiveException();
        }
        return new OrganizationBlockedUserResponse(block.Id, organizationId, userId, target.Profile.Username, block.Reason, block.BlockedByUserId, block.BlockedAt, block.ExpiresAt);
    }

    public async Task UnblockUserAsync(
        Guid organizationId,
        Guid userId,
        Guid actorUserId,
        bool isAdmin,
        CancellationToken cancellationToken)
    {
        _ = await access.RequireMemberAsync(organizationId, actorUserId, isAdmin, cancellationToken);
        var block = await database.OrganizationBlockedUsers
            .SingleOrDefaultAsync(item => item.OrganizationId == organizationId && item.UserId == userId && item.IsActive, cancellationToken)
            ?? throw new ResourceNotFoundException();
        var now = clock.GetCurrentInstant();
        block.Unblock(actorUserId, now);
        database.AuditRecords.Add(Audit(
            actorUserId,
            "organization.user.unblocked",
            block.Id,
            JsonSerializer.Serialize(new { fields = new[] { "isActive" }, organizationId, userId }),
            now));
        await database.SaveChangesAsync(cancellationToken);
    }

    public async Task<PrivateTournamentParticipantListResponse> ListParticipantsAsync(
        Guid tournamentId,
        int page,
        int pageSize,
        Guid actorUserId,
        bool isAdmin,
        CancellationToken cancellationToken)
    {
        _ = await RequireTournamentAsync(tournamentId, actorUserId, isAdmin, cancellationToken);
        var query = ActiveParticipants(tournamentId);
        var total = await query.CountAsync(cancellationToken);
        var items = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(item => new PrivateTournamentParticipantResponse(
                item.Attempt.Id,
                item.User.Id,
                item.Profile.Username,
                item.Profile.FirstName,
                item.Profile.LastName,
                item.User.Email!,
                item.Attempt.RegisteredAt,
                item.Attempt.RegisteredByUserId))
            .ToListAsync(cancellationToken);
        return new PrivateTournamentParticipantListResponse(items, page, pageSize, total);
    }

    public async Task<IResult> ExportParticipantsAsync(
        Guid tournamentId,
        Guid actorUserId,
        bool isAdmin,
        CancellationToken cancellationToken)
    {
        var tournament = await RequireTournamentAsync(tournamentId, actorUserId, isAdmin, cancellationToken);
        var query = ActiveParticipants(tournamentId);
        var rowCount = await query.CountAsync(cancellationToken);
        if (rowCount > MaximumExportRows) throw new ExportRowLimitExceededException();

        database.AuditRecords.Add(Audit(
            actorUserId,
            "tournament.participants.exported",
            tournamentId,
            JsonSerializer.Serialize(new { tournamentId, rowCount, columns = CsvColumns }),
            clock.GetCurrentInstant()));
        await database.SaveChangesAsync(cancellationToken);

        var rows = query
            .Take(MaximumExportRows)
            .Select(item => new CsvParticipantRow(
                item.Profile.Username,
                item.Profile.FirstName,
                item.Profile.LastName,
                item.User.Email!,
                item.Attempt.RegisteredAt));
        var fileName = $"{SafeFileName(tournament.Slug)}-participants.csv";
        return Results.Stream(async stream =>
        {
            await using var writer = new StreamWriter(stream, new UTF8Encoding(false), leaveOpen: true);
            await writer.WriteAsync(string.Join(',', CsvColumns) + "\r\n");
            await foreach (var row in rows.AsAsyncEnumerable().WithCancellation(cancellationToken))
            {
                var cells = new[]
                {
                    CsvCell(row.Username),
                    CsvCell(row.FirstName),
                    CsvCell(row.LastName),
                    CsvCell(row.Email),
                    CsvCell(row.RegisteredAt.ToString("uuuu-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture))
                };
                await writer.WriteAsync(string.Join(',', cells) + "\r\n");
            }
            await writer.FlushAsync(cancellationToken);
        }, "text/csv; charset=utf-8", fileName);
    }

    private async Task<ScheduledTournament> RequireTournamentAsync(
        Guid tournamentId,
        Guid actorUserId,
        bool isAdmin,
        CancellationToken cancellationToken)
    {
        var tournament = await database.ScheduledTournaments.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == tournamentId && item.DeletedAt == null, cancellationToken)
            ?? throw new ResourceNotFoundException();
        _ = await access.RequireMemberAsync(tournament.OrganizationId, actorUserId, isAdmin, cancellationToken);
        return tournament;
    }

    private IQueryable<ParticipantJoin> ActiveParticipants(Guid tournamentId) =>
        from attempt in database.TournamentRegistrationAttempts.AsNoTracking()
        join user in database.Users.AsNoTracking() on attempt.UserId equals user.Id
        join profile in database.UserProfiles.AsNoTracking() on user.Id equals profile.UserId
        where attempt.TournamentId == tournamentId
            && attempt.Status == TournamentRegistrationStatus.Confirmed
            && profile.ClosedAt == null
        orderby profile.NormalizedUsername, attempt.Id
        select new ParticipantJoin(attempt, user, profile);

    private static string CsvCell(string value)
    {
        var neutralized = IsFormula(value) ? $"'{value}" : value;
        return $"\"{neutralized.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";
    }

    private static bool IsFormula(string value)
    {
        if (string.IsNullOrEmpty(value)) return false;
        if (value[0] is '\t' or '\r' or '\n') return true;
        var index = 0;
        while (index < value.Length && char.IsWhiteSpace(value[index])) index++;
        return index < value.Length && value[index] is '=' or '+' or '-' or '@';
    }

    private static string SafeFileName(string value) =>
        new(value.Select(character => char.IsLetterOrDigit(character) || character is '-' or '_' ? character : '-').ToArray());

    private static ApiValidationException Validation(string field, string message) =>
        new(new Dictionary<string, string[]> { [field] = [message] });

    private static AuditRecord Audit(Guid actorId, string action, Guid entityId, string diff, Instant now) => new()
    {
        ActorId = actorId,
        Action = action,
        EntityType = action.StartsWith("organization.", StringComparison.Ordinal) ? "organization_blocked_user" : "tournament_registration",
        EntityId = entityId.ToString("D"),
        RedactedDiff = diff,
        OccurredAt = now
    };

    private sealed record ParticipantJoin(TournamentRegistrationAttempt Attempt, Gones.Infrastructure.Identity.ApplicationUser User, UserProfile Profile);
    private sealed record CsvParticipantRow(string Username, string FirstName, string LastName, string Email, Instant RegisteredAt);
}

internal sealed record RegisterByOrganizerRequest([property: Required] Guid UserId);

internal sealed record BlockOrganizationUserRequest(
    [property: Required] Guid UserId,
    [property: Required, StringLength(OrganizationBlockedUser.MaximumReasonLength)] string Reason,
    Instant? ExpiresAt);

internal sealed record OrganizationUserLookupResponse(Guid UserId, string Username, string FirstName, string LastName, string Email);

internal sealed record OrganizationBlockedUserResponse(
    Guid BlockId,
    Guid OrganizationId,
    Guid UserId,
    string Username,
    string Reason,
    Guid? BlockedByUserId,
    Instant BlockedAt,
    Instant? ExpiresAt);

internal sealed record OrganizationBlockedUserListResponse(
    IReadOnlyList<OrganizationBlockedUserResponse> Items,
    int Page,
    int PageSize,
    int TotalCount);

internal sealed record PrivateTournamentParticipantResponse(
    Guid AttemptId,
    Guid UserId,
    string Username,
    string FirstName,
    string LastName,
    string Email,
    Instant RegisteredAt,
    Guid RegisteredByUserId);

internal sealed record PrivateTournamentParticipantListResponse(
    IReadOnlyList<PrivateTournamentParticipantResponse> Items,
    int Page,
    int PageSize,
    int TotalCount);
