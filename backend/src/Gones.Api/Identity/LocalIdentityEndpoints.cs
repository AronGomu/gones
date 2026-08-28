using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.Json;
using Gones.Api.Errors;
using Gones.Api.Security;
using Gones.Api.Validation;
using Gones.Domain.Identity;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Observability;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.Api.Identity;

internal static class LocalIdentityEndpoints
{
    private static readonly Lazy<string> DummyPasswordHash = new(() =>
        new PasswordHasher<ApplicationUser>().HashPassword(new ApplicationUser(), "not-a-real-user-password"));

    public static void MapLocalIdentityEndpoints(this WebApplication app)
    {
        var auth = app.MapGroup("/api/auth");
        auth.MapPost("/register", RegisterAsync)
            .RequireRateLimiting(AuthRateLimiting.IpPolicy)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .AddEndpointFilter<AuthAccountRateLimitFilter>()
            .Produces<GenericAccountActionResponse>(StatusCodes.Status202Accepted)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);
        auth.MapPost("/login", LoginAsync)
            .RequireRateLimiting(AuthRateLimiting.IpPolicy)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .AddEndpointFilter<AuthAccountRateLimitFilter>()
            .Produces<AccessTokenResponse>()
            .ProducesProblem(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);
        auth.MapPost("/refresh", RefreshAsync)
            .RequireRateLimiting(AuthRateLimiting.RefreshPolicy)
            .Produces<AccessTokenResponse>()
            .ProducesProblem(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);
        auth.MapPost("/logout", LogoutAsync).Produces(StatusCodes.Status204NoContent);
        auth.MapPost("/logout-all", LogoutAllAsync)
            .RequireAuthorization(AuthorizationPolicies.User)
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status401Unauthorized);

        var users = app.MapGroup("/api/users").RequireAuthorization(AuthorizationPolicies.User);
        users.MapGet("/me", GetProfileAsync).Produces<UserProfileResponse>();
        users.MapPatch("/me", PatchProfileAsync)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces<UserProfileResponse>()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);
        users.MapDelete("/me", DeleteAccountAsync)
            .RequireRateLimiting(AuthRateLimiting.IpPolicy)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);
        auth.MapAccountLifecycleEndpoints(users);
    }

    private static async Task<IResult> RegisterAsync(
        RegisterRequest request,
        UserManager<ApplicationUser> userManager,
        GonesDbContext database,
        AccountLifecycleService lifecycle,
        IClock clock,
        OperationalMetrics metrics,
        CancellationToken cancellationToken)
    {
        var user = new ApplicationUser
        {
            Id = Guid.NewGuid(),
            UserName = request.Username,
            Email = request.Email.Trim()
        };
        UserProfile profile;
        try
        {
            profile = UserProfile.Create(user.Id, request.Username, request.FirstName, request.LastName, clock.GetCurrentInstant());
        }
        catch (ArgumentException exception)
        {
            await WriteAuditAsync(database, null, "auth.register.failed", "registration", "{\"outcome\":\"rejected\"}", clock, cancellationToken);
            metrics.RecordAuthRejection("register");
            throw Validation(exception.ParamName ?? "request", exception.Message);
        }

        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            var result = await userManager.CreateAsync(user, request.Password);
            if (!result.Succeeded)
            {
                await transaction.RollbackAsync(cancellationToken);
                database.ChangeTracker.Clear();
                var duplicateEmail = result.Errors.Any(error => error.Code is "DuplicateEmail");
                var duplicate = duplicateEmail || result.Errors.Any(error => error.Code is "DuplicateUserName");
                await WriteAuditAsync(database, null, "auth.register.failed", "registration",
                    duplicate ? "{\"outcome\":\"conflict\"}" : "{\"outcome\":\"rejected\"}", clock, cancellationToken);
                metrics.RecordAuthRejection("register");
                if (!duplicate) throw IdentityValidation(result.Errors);
                // A taken username is not an account-existence oracle - the public participants list
                // already shows usernames - so it is named instead of being answered generically, which
                // sent the caller to Verify Email to wait for a link nobody had queued. A taken email
                // still wins the tie: naming the username there would confirm the address has an account.
                if (!duplicateEmail) throw UsernameTaken();
                await AccountLifecycleEndpoints.TryResendVerificationAsync(request.Email.Trim(), request.ReturnUrl, userManager, database, lifecycle, clock, cancellationToken);
                return Results.Accepted(value: AccountLifecycleEndpoints.GenericResponse);
            }

            database.UserProfiles.Add(profile);
            await lifecycle.IssueAsync(user, AccountActionPurpose.VerifyEmail, profile.Username, profile.PreferredLanguage, null, request.ReturnUrl, cancellationToken);
            database.AuditRecords.Add(NewAudit(user.Id, "auth.register.succeeded", "user", user.Id.ToString("D"),
                "{\"fields\":[\"username\",\"email\",\"firstName\",\"lastName\",\"verificationGeneration\"]}", clock));
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            metrics.RecordAuthSuccess("register");
            return Results.Accepted(value: AccountLifecycleEndpoints.GenericResponse);
        }
        catch (DbUpdateException)
        {
            await transaction.RollbackAsync(cancellationToken);
            database.ChangeTracker.Clear();
            await WriteAuditAsync(database, null, "auth.register.failed", "registration", "{\"outcome\":\"conflict\"}", clock, cancellationToken);
            metrics.RecordAuthRejection("register");
            await AccountLifecycleEndpoints.TryResendVerificationAsync(request.Email.Trim(), request.ReturnUrl, userManager, database, lifecycle, clock, cancellationToken);
            return Results.Accepted(value: AccountLifecycleEndpoints.GenericResponse);
        }
    }

    private static async Task<IResult> LoginAsync(
        LoginRequest request,
        HttpContext httpContext,
        UserManager<ApplicationUser> userManager,
        GonesDbContext database,
        RefreshSessionService sessionService,
        RefreshCookie cookie,
        AccessTokenIssuer tokenIssuer,
        IClock clock,
        OperationalMetrics metrics,
        CancellationToken cancellationToken)
    {
        var user = await userManager.FindByEmailAsync(request.Email.Trim());
        if (user is null)
        {
            _ = userManager.PasswordHasher.VerifyHashedPassword(new ApplicationUser(), DummyPasswordHash.Value, request.Password);
            await RejectLoginAsync(database, null, "rejected", clock, metrics, cancellationToken);
        }

        if (await userManager.IsLockedOutAsync(user!))
        {
            metrics.RecordAuthLockout();
            await RejectLoginAsync(database, user!.Id, "locked", clock, metrics, cancellationToken);
        }

        if (!await userManager.CheckPasswordAsync(user!, request.Password))
        {
            var failed = await userManager.AccessFailedAsync(user!);
            if (!failed.Succeeded) throw new InvalidOperationException("Failed access count could not be updated.");
            if (await userManager.IsLockedOutAsync(user!)) metrics.RecordAuthLockout();
            await RejectLoginAsync(database, user!.Id, "rejected", clock, metrics, cancellationToken);
        }

        var reset = await userManager.ResetAccessFailedCountAsync(user!);
        if (!reset.Succeeded) throw new InvalidOperationException("Failed access count could not be reset.");
        var issuedSession = await sessionService.CreateAsync(user!, NormalizeDeviceLabel(request.DeviceLabel), cancellationToken);
        metrics.RecordAuthSuccess("login");
        var token = tokenIssuer.Issue(user!);
        cookie.Issue(httpContext.Response, issuedSession.PlaintextToken, issuedSession.Session.AbsoluteExpiresAt, clock.GetCurrentInstant());
        return Results.Ok(new AccessTokenResponse(token.Value, token.ExpiresAt, "Bearer"));
    }

    private static async Task<IResult> RefreshAsync(
        HttpContext httpContext,
        RefreshSessionService sessionService,
        RefreshCookie cookie,
        AccessTokenIssuer tokenIssuer,
        IClock clock,
        CancellationToken cancellationToken)
    {
        var attempt = await sessionService.RotateAsync(httpContext.Request.Cookies[RefreshCookie.Name], cancellationToken);
        if (!attempt.IsSuccess)
        {
            cookie.Clear(httpContext.Response);
            throw new AuthenticationFailedException();
        }

        var token = tokenIssuer.Issue(attempt.User!);
        cookie.Issue(httpContext.Response, attempt.PlaintextToken!, attempt.Session!.AbsoluteExpiresAt, clock.GetCurrentInstant());
        return Results.Ok(new AccessTokenResponse(token.Value, token.ExpiresAt, "Bearer"));
    }

    private static async Task<IResult> LogoutAsync(
        HttpContext httpContext,
        RefreshSessionService sessionService,
        RefreshCookie cookie,
        CancellationToken cancellationToken)
    {
        await sessionService.RevokeCurrentAsync(httpContext.Request.Cookies[RefreshCookie.Name], cancellationToken);
        cookie.Clear(httpContext.Response);
        return Results.NoContent();
    }

    private static async Task<IResult> LogoutAllAsync(
        HttpContext httpContext,
        ClaimsPrincipal principal,
        RefreshSessionService sessionService,
        RefreshCookie cookie,
        CancellationToken cancellationToken)
    {
        await sessionService.RevokeAllAsync(CurrentUserId(principal), cancellationToken);
        cookie.Clear(httpContext.Response);
        return Results.NoContent();
    }

    private static async Task RejectLoginAsync(
        GonesDbContext database,
        Guid? userId,
        string outcome,
        IClock clock,
        OperationalMetrics metrics,
        CancellationToken cancellationToken)
    {
        await WriteAuditAsync(database, userId, "auth.login.failed", userId?.ToString("D") ?? "unknown",
            JsonSerializer.Serialize(new { outcome }), clock, cancellationToken);
        metrics.RecordAuthRejection("login");
        throw new AuthenticationFailedException();
    }

    private static async Task<IResult> GetProfileAsync(
        ClaimsPrincipal principal,
        UserManager<ApplicationUser> userManager,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var userId = CurrentUserId(principal);
        var user = await userManager.FindByIdAsync(userId.ToString("D")) ?? throw new AuthenticationFailedException();
        var profile = await database.UserProfiles.AsNoTracking().SingleOrDefaultAsync(item => item.UserId == userId, cancellationToken)
            ?? throw new ResourceNotFoundException();
        return Results.Ok(ToResponse(user, profile));
    }

    private static async Task<IResult> PatchProfileAsync(
        PatchUserProfileRequest request,
        ClaimsPrincipal principal,
        UserManager<ApplicationUser> userManager,
        GonesDbContext database,
        IClock clock,
        OperationalMetrics metrics,
        CancellationToken cancellationToken)
    {
        var userId = CurrentUserId(principal);
        var user = await userManager.FindByIdAsync(userId.ToString("D")) ?? throw new AuthenticationFailedException();
        var profile = await database.UserProfiles.SingleOrDefaultAsync(item => item.UserId == userId, cancellationToken)
            ?? throw new ResourceNotFoundException();
        var usernameChanged = !string.Equals(profile.Username, request.Username, StringComparison.Ordinal);
        if (usernameChanged && (string.IsNullOrEmpty(request.CurrentPassword) || !await userManager.CheckPasswordAsync(user, request.CurrentPassword)))
        {
            metrics.RecordAuthRejection("profile_sensitive_change");
            throw Validation(nameof(request.CurrentPassword), "Current password is required and must be valid when changing Username.");
        }

        var changedFields = ChangedFields(profile, request);
        try
        {
            profile.Update(
                request.Username,
                request.FirstName,
                request.LastName,
                request.LocationCountry,
                request.LocationRegion,
                request.LocationCity,
                request.BirthDate,
                request.PreferredLanguage,
                request.IsFirstNamePublic,
                request.IsLastNamePublic,
                request.IsLocationPublic,
                request.IsBirthDatePublic,
                request.IsPreferredLanguagePublic,
                clock.GetCurrentInstant().InUtc().Date,
                clock.GetCurrentInstant());
        }
        catch (ArgumentException exception)
        {
            throw Validation(exception.ParamName ?? "request", exception.Message);
        }

        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            if (usernameChanged)
            {
                var result = await userManager.SetUserNameAsync(user, request.Username);
                if (!result.Succeeded)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    if (result.Errors.Any(error => error.Code is "DuplicateUserName" or "ConcurrencyFailure")) throw new ResourceConflictException();
                    throw IdentityValidation(result.Errors);
                }
            }
            database.AuditRecords.Add(NewAudit(userId, "profile.changed", "user", userId.ToString("D"),
                JsonSerializer.Serialize(new { fields = changedFields }), clock));
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            metrics.RecordAuthSuccess("profile_change");
            return Results.Ok(ToResponse(user, profile));
        }
        catch (DbUpdateException)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new ResourceConflictException();
        }
    }

    /// <summary>
    /// Hard account deletion, per <c>docs/adr/0025-hard-account-deletion.md</c>. A wrong password is
    /// reported as a 400 naming the field and never as a 401, so the endpoint cannot be used to tell
    /// "bad password" apart from "not signed in".
    /// </summary>
    private static async Task<IResult> DeleteAccountAsync(
        // Minimal APIs do not infer a body for DELETE, so the binding source is explicit here.
        [FromBody] DeleteAccountRequest request,
        ClaimsPrincipal principal,
        HttpContext httpContext,
        UserManager<ApplicationUser> userManager,
        GonesDbContext database,
        RefreshSessionService sessionService,
        RefreshCookie cookie,
        IClock clock,
        OperationalMetrics metrics,
        CancellationToken cancellationToken)
    {
        var userId = CurrentUserId(principal);
        var user = await userManager.FindByIdAsync(userId.ToString("D")) ?? throw new AuthenticationFailedException();
        if (string.IsNullOrEmpty(request.CurrentPassword) || !await userManager.CheckPasswordAsync(user, request.CurrentPassword))
        {
            metrics.RecordAuthRejection("account_delete");
            throw Validation(nameof(request.CurrentPassword), "Current password is required and must be valid to delete the account.");
        }

        // An installation without an administrator cannot be recovered from the product itself.
        if (user.GlobalRole == GlobalRoles.Admin && await database.Users.CountAsync(item => item.GlobalRole == GlobalRoles.Admin, cancellationToken) <= 1)
        {
            metrics.RecordAuthRejection("account_delete");
            throw new ResourceConflictException("lastAdmin");
        }

        // Pre-flight before the first mutation. RevokeAllAsync below commits its own transaction, so
        // a refusal discovered any later would already have signed the caller out of every device.
        var blocking = await FindBlockingRelationsAsync(database, userId, cancellationToken);
        if (blocking.Count > 0)
        {
            metrics.RecordAuthRejection("account_delete");
            throw new AccountOwnsRecordsException(blocking);
        }

        // Revoked outside the deletion transaction: RevokeAllAsync opens its own, and a revoked
        // session is the safe outcome even if the deletion below fails.
        await sessionService.RevokeAllAsync(userId, cancellationToken);

        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            // Repeated inside the transaction so a row created since the check above cannot slip
            // through between the pre-flight and the delete.
            blocking = await FindBlockingRelationsAsync(database, userId, cancellationToken);
            if (blocking.Count > 0)
            {
                await transaction.RollbackAsync(cancellationToken);
                metrics.RecordAuthRejection("account_delete");
                throw new AccountOwnsRecordsException(blocking);
            }

            // Written before the delete and with a null actor: the row has to outlive the account it
            // describes, and entity_id is the only place the account id belongs afterwards.
            database.AuditRecords.Add(NewAudit(null, "account.deleted", "user", userId.ToString("D"), "{\"outcome\":\"hardDeleted\"}", clock));
            await database.SaveChangesAsync(cancellationToken);
            await database.AuditRecords
                .Where(record => record.ActorId == userId)
                .ExecuteUpdateAsync(setters => setters.SetProperty(record => record.ActorId, (Guid?)null), cancellationToken);
            // ExecuteUpdate leaves the tracker holding audit rows that still claim this actor; deleting
            // the account would make EF null them a second time, which the append-only guard rejects.
            database.ChangeTracker.Clear();
            await DeleteUserGraphAsync(database, userId, cancellationToken);
            var target = await userManager.FindByIdAsync(userId.ToString("D")) ?? throw new AuthenticationFailedException();
            var result = await userManager.DeleteAsync(target);
            if (!result.Succeeded) throw IdentityValidation(result.Errors);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (Exception exception) when (IsForeignKeyViolation(exception))
        {
            // Last line of defence for a relation the list below has not caught up with: the caller
            // gets the same deterministic conflict rather than an unhandled 500.
            await transaction.RollbackAsync(cancellationToken);
            database.ChangeTracker.Clear();
            metrics.RecordAuthRejection("account_delete");
            throw new AccountOwnsRecordsException(await FindBlockingRelationsAsync(database, userId, cancellationToken));
        }

        cookie.Clear(httpContext.Response);
        metrics.RecordAuthSuccess("account_delete");
        return Results.NoContent();
    }

    /// <summary>
    /// Every column that still points at <c>asp_net_users</c> with <c>DeleteBehavior.Restrict</c>,
    /// paired with the rows that would survive <see cref="DeleteUserGraphAsync"/> and therefore break
    /// the delete. Adding a future restricting column is one line here.
    /// </summary>
    private static readonly (string Relation, Func<GonesDbContext, Guid, IQueryable<Guid>> Rows)[] BlockingRelations =
    [
        ("scheduled_tournaments.created_by_user_id",
            (database, userId) => database.Events.Where(item => item.CreatedByUserId == userId).Select(item => item.Id)),
        ("scheduled_tournaments.deleted_by_user_id",
            (database, userId) => database.Events.Where(item => item.DeletedByUserId == userId).Select(item => item.Id)),
        // The account's own attempts go with it, so only an attempt filed for somebody else blocks.
        ("tournament_registration_attempts.registered_by_user_id",
            (database, userId) => database.EventRegistrationAttempts.Where(item => item.UserId != userId && item.RegisteredByUserId == userId).Select(item => item.Id)),
        ("tournament_registration_attempts.status_changed_by_user_id",
            (database, userId) => database.EventRegistrationAttempts.Where(item => item.UserId != userId && item.StatusChangedByUserId == userId).Select(item => item.Id)),
        ("tournament_lifecycle_events.actor_user_id",
            (database, userId) => database.EventLifecycleEntries.Where(item => item.ActorUserId == userId).Select(item => item.Id)),
        // Blocks aimed at the account cascade away with it; only blocks it handed out survive.
        ("organization_blocked_users.blocked_by_user_id",
            (database, userId) => database.OrganizationBlockedUsers.Where(item => item.UserId != userId && item.BlockedByUserId == userId).Select(item => item.Id)),
        ("organization_blocked_users.unblocked_by_user_id",
            (database, userId) => database.OrganizationBlockedUsers.Where(item => item.UserId != userId && item.UnblockedByUserId == userId).Select(item => item.Id))
    ];

    /// <summary>
    /// Names every restricting relation the account still owns. Empty means the hard delete can run.
    /// </summary>
    private static async Task<IReadOnlyList<string>> FindBlockingRelationsAsync(
        GonesDbContext database,
        Guid userId,
        CancellationToken cancellationToken)
    {
        var blocking = new List<string>();
        foreach (var (relation, rows) in BlockingRelations)
        {
            if (await rows(database, userId).AnyAsync(cancellationToken)) blocking.Add(relation);
        }

        return blocking;
    }

    private static bool IsForeignKeyViolation(Exception exception) => exception switch
    {
        Npgsql.PostgresException { SqlState: Npgsql.PostgresErrorCodes.ForeignKeyViolation } => true,
        { InnerException: { } inner } => IsForeignKeyViolation(inner),
        _ => false
    };

    /// <summary>
    /// Removes what the account owns but what no cascade rule covers, in dependency order. Everything
    /// else — refresh sessions, external identities, account action tokens, organization memberships —
    /// is cascaded by the database when the account row goes.
    /// </summary>
    private static async Task DeleteUserGraphAsync(GonesDbContext database, Guid userId, CancellationToken cancellationToken)
    {
        await database.NotificationHistory.Where(item => item.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        await database.ScheduledNotifications.Where(item => item.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        await database.EventRegistrationAttempts.Where(item => item.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        await database.UserProfiles.Where(item => item.UserId == userId).ExecuteDeleteAsync(cancellationToken);
    }

    private static IReadOnlyList<string> ChangedFields(UserProfile profile, PatchUserProfileRequest request)
    {
        var fields = new List<string>();
        Add(nameof(request.Username), profile.Username, request.Username);
        Add(nameof(request.FirstName), profile.FirstName, request.FirstName);
        Add(nameof(request.LastName), profile.LastName, request.LastName);
        Add(nameof(request.LocationCountry), profile.LocationCountry, request.LocationCountry);
        Add(nameof(request.LocationRegion), profile.LocationRegion, request.LocationRegion);
        Add(nameof(request.LocationCity), profile.LocationCity, request.LocationCity);
        Add(nameof(request.BirthDate), profile.BirthDate, request.BirthDate);
        Add(nameof(request.PreferredLanguage), profile.PreferredLanguage, request.PreferredLanguage);
        Add(nameof(request.IsFirstNamePublic), profile.IsFirstNamePublic, request.IsFirstNamePublic);
        Add(nameof(request.IsLastNamePublic), profile.IsLastNamePublic, request.IsLastNamePublic);
        Add(nameof(request.IsLocationPublic), profile.IsLocationPublic, request.IsLocationPublic);
        Add(nameof(request.IsBirthDatePublic), profile.IsBirthDatePublic, request.IsBirthDatePublic);
        Add(nameof(request.IsPreferredLanguagePublic), profile.IsPreferredLanguagePublic, request.IsPreferredLanguagePublic);
        return fields;

        void Add<T>(string name, T before, T after)
        {
            if (!EqualityComparer<T>.Default.Equals(before, after)) fields.Add(char.ToLowerInvariant(name[0]) + name[1..]);
        }
    }

    private static Guid CurrentUserId(ClaimsPrincipal principal)
    {
        var value = principal.FindFirstValue("sub") ?? principal.FindFirstValue(ClaimTypes.NameIdentifier);
        return Guid.TryParse(value, out var userId) ? userId : throw new AuthenticationFailedException();
    }

    private static UserProfileResponse ToResponse(ApplicationUser user, UserProfile profile) => new(
        user.Id,
        user.Email ?? string.Empty,
        user.EmailConfirmed,
        user.GlobalRole,
        profile.Username,
        profile.FirstName,
        profile.LastName,
        profile.LocationCountry,
        profile.LocationRegion,
        profile.LocationCity,
        profile.BirthDate,
        profile.PreferredLanguage,
        profile.IsFirstNamePublic,
        profile.IsLastNamePublic,
        profile.IsLocationPublic,
        profile.IsBirthDatePublic,
        profile.IsPreferredLanguagePublic,
        profile.CreatedAt,
        profile.UpdatedAt);

    private static AuditRecord NewAudit(Guid? actorId, string action, string entityType, string entityId, string diff, IClock clock) => new()
    {
        ActorId = actorId,
        Action = action,
        EntityType = entityType,
        EntityId = entityId,
        RedactedDiff = diff,
        OccurredAt = clock.GetCurrentInstant()
    };

    private static async Task WriteAuditAsync(
        GonesDbContext database,
        Guid? actorId,
        string action,
        string entityId,
        string diff,
        IClock clock,
        CancellationToken cancellationToken)
    {
        database.AuditRecords.Add(NewAudit(actorId, action, "user", entityId, diff, clock));
        await database.SaveChangesAsync(cancellationToken);
    }

    private static string NormalizeDeviceLabel(string? value) => string.IsNullOrWhiteSpace(value) ? "Unknown device" : value.Trim();

    private static ApiValidationException IdentityValidation(IEnumerable<IdentityError> errors)
    {
        var messages = errors.Select(error => error.Description).Distinct(StringComparer.Ordinal).ToArray();
        return new ApiValidationException(new Dictionary<string, string[]> { ["Password"] = messages });
    }

    private static ApiValidationException Validation(string field, string message) =>
        new(new Dictionary<string, string[]> { [field] = [message] });

    /// <summary>
    /// The field map puts the refusal next to the username input; the narrower code lets the client
    /// phrase it in the reader's language instead of falling back to its generic failure line.
    /// </summary>
    private static ApiValidationException UsernameTaken() =>
        new(new Dictionary<string, string[]> { ["Username"] = ["Username is already taken."] }, "username_taken");
}

internal sealed record RegisterRequest(
    [property: Required, EmailAddress, StringLength(254)] string Email,
    [property: Required] string Username,
    [property: Required, StringLength(128)] string Password,
    [property: Required, StringLength(100)] string FirstName,
    [property: Required, StringLength(100)] string LastName,
    [property: StringLength(2048)] string? ReturnUrl) : IAuthRateLimitRequest
{
    public string RateLimitAccount => Email;
}

internal sealed record LoginRequest(
    [property: Required, EmailAddress, StringLength(254)] string Email,
    [property: Required, StringLength(128)] string Password,
    [property: StringLength(RefreshSession.MaximumDeviceLabelLength)] string? DeviceLabel) : IAuthRateLimitRequest
{
    public string RateLimitAccount => Email;
}

internal sealed record PatchUserProfileRequest(
    [property: Required] string Username,
    [property: Required, StringLength(100)] string FirstName,
    [property: Required, StringLength(100)] string LastName,
    [property: StringLength(100)] string? LocationCountry,
    [property: StringLength(100)] string? LocationRegion,
    [property: StringLength(100)] string? LocationCity,
    LocalDate? BirthDate,
    [property: Required, RegularExpression("^(fr|en)$")] string PreferredLanguage,
    bool IsFirstNamePublic,
    bool IsLastNamePublic,
    bool IsLocationPublic,
    bool IsBirthDatePublic,
    bool IsPreferredLanguagePublic,
    [property: StringLength(128)] string? CurrentPassword);

internal sealed record DeleteAccountRequest(
    [property: Required, StringLength(128)] string CurrentPassword);

internal sealed record UserProfileResponse(
    Guid Id,
    string Email,
    bool EmailVerified,
    string GlobalRole,
    string Username,
    string FirstName,
    string LastName,
    string? LocationCountry,
    string? LocationRegion,
    string? LocationCity,
    LocalDate? BirthDate,
    string PreferredLanguage,
    bool IsFirstNamePublic,
    bool IsLastNamePublic,
    bool IsLocationPublic,
    bool IsBirthDatePublic,
    bool IsPreferredLanguagePublic,
    Instant CreatedAt,
    Instant UpdatedAt);

internal sealed record AccessTokenResponse(string AccessToken, Instant ExpiresAt, string TokenType);
