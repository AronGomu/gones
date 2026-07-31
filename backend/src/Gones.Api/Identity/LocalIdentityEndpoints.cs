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
            .Produces<UserProfileResponse>(StatusCodes.Status201Created)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);
        auth.MapPost("/login", LoginAsync)
            .RequireRateLimiting(AuthRateLimiting.IpPolicy)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .AddEndpointFilter<AuthAccountRateLimitFilter>()
            .Produces<AccessTokenResponse>()
            .ProducesProblem(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);

        var users = app.MapGroup("/api/users").RequireAuthorization(AuthorizationPolicies.User);
        users.MapGet("/me", GetProfileAsync).Produces<UserProfileResponse>();
        users.MapPatch("/me", PatchProfileAsync)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces<UserProfileResponse>()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);
    }

    private static async Task<IResult> RegisterAsync(
        RegisterRequest request,
        UserManager<ApplicationUser> userManager,
        GonesDbContext database,
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
                await WriteAuditAsync(database, null, "auth.register.failed", "registration", "{\"outcome\":\"rejected\"}", clock, cancellationToken);
                metrics.RecordAuthRejection("register");
                if (result.Errors.Any(error => error.Code is "DuplicateUserName" or "DuplicateEmail")) throw new ResourceConflictException();
                throw IdentityValidation(result.Errors);
            }

            database.UserProfiles.Add(profile);
            database.AuditRecords.Add(NewAudit(user.Id, "auth.register.succeeded", "user", user.Id.ToString("D"),
                "{\"fields\":[\"username\",\"email\",\"firstName\",\"lastName\"]}", clock));
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            metrics.RecordAuthSuccess("register");
            return Results.Created("/api/users/me", ToResponse(user, profile));
        }
        catch (DbUpdateException)
        {
            await transaction.RollbackAsync(cancellationToken);
            database.ChangeTracker.Clear();
            await WriteAuditAsync(database, null, "auth.register.failed", "registration", "{\"outcome\":\"conflict\"}", clock, cancellationToken);
            metrics.RecordAuthRejection("register");
            throw new ResourceConflictException();
        }
    }

    private static async Task<IResult> LoginAsync(
        LoginRequest request,
        UserManager<ApplicationUser> userManager,
        GonesDbContext database,
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
        await WriteAuditAsync(database, user!.Id, "auth.login.succeeded", "user", "{\"outcome\":\"succeeded\"}", clock, cancellationToken);
        metrics.RecordAuthSuccess("login");
        var token = tokenIssuer.Issue(user);
        return Results.Ok(new AccessTokenResponse(token.Value, token.ExpiresAt, "Bearer"));
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
                request.Location,
                request.BirthYear,
                request.PreferredLanguage,
                request.IsFirstNamePublic,
                request.IsLastNamePublic,
                request.IsLocationPublic,
                request.IsBirthYearPublic,
                request.IsPreferredLanguagePublic,
                clock.GetCurrentInstant().InUtc().Year,
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

    private static IReadOnlyList<string> ChangedFields(UserProfile profile, PatchUserProfileRequest request)
    {
        var fields = new List<string>();
        Add(nameof(request.Username), profile.Username, request.Username);
        Add(nameof(request.FirstName), profile.FirstName, request.FirstName);
        Add(nameof(request.LastName), profile.LastName, request.LastName);
        Add(nameof(request.Location), profile.Location, request.Location);
        Add(nameof(request.BirthYear), profile.BirthYear, request.BirthYear);
        Add(nameof(request.PreferredLanguage), profile.PreferredLanguage, request.PreferredLanguage);
        Add(nameof(request.IsFirstNamePublic), profile.IsFirstNamePublic, request.IsFirstNamePublic);
        Add(nameof(request.IsLastNamePublic), profile.IsLastNamePublic, request.IsLastNamePublic);
        Add(nameof(request.IsLocationPublic), profile.IsLocationPublic, request.IsLocationPublic);
        Add(nameof(request.IsBirthYearPublic), profile.IsBirthYearPublic, request.IsBirthYearPublic);
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
        user.GlobalRole,
        profile.Username,
        profile.FirstName,
        profile.LastName,
        profile.Location,
        profile.BirthYear,
        profile.PreferredLanguage,
        profile.IsFirstNamePublic,
        profile.IsLastNamePublic,
        profile.IsLocationPublic,
        profile.IsBirthYearPublic,
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

    private static ApiValidationException IdentityValidation(IEnumerable<IdentityError> errors)
    {
        var messages = errors.Select(error => error.Description).Distinct(StringComparer.Ordinal).ToArray();
        return new ApiValidationException(new Dictionary<string, string[]> { ["Password"] = messages });
    }

    private static ApiValidationException Validation(string field, string message) =>
        new(new Dictionary<string, string[]> { [field] = [message] });
}

internal sealed record RegisterRequest(
    [property: Required, EmailAddress, StringLength(254)] string Email,
    [property: Required] string Username,
    [property: Required, StringLength(128)] string Password,
    [property: Required, StringLength(100)] string FirstName,
    [property: Required, StringLength(100)] string LastName) : IAuthRateLimitRequest
{
    public string RateLimitAccount => Email;
}

internal sealed record LoginRequest(
    [property: Required, EmailAddress, StringLength(254)] string Email,
    [property: Required, StringLength(128)] string Password) : IAuthRateLimitRequest
{
    public string RateLimitAccount => Email;
}

internal sealed record PatchUserProfileRequest(
    [property: Required] string Username,
    [property: Required, StringLength(100)] string FirstName,
    [property: Required, StringLength(100)] string LastName,
    [property: StringLength(200)] string? Location,
    int? BirthYear,
    [property: Required, RegularExpression("^(fr|en)$")] string PreferredLanguage,
    bool IsFirstNamePublic,
    bool IsLastNamePublic,
    bool IsLocationPublic,
    bool IsBirthYearPublic,
    bool IsPreferredLanguagePublic,
    [property: StringLength(128)] string? CurrentPassword);

internal sealed record UserProfileResponse(
    Guid Id,
    string Email,
    string GlobalRole,
    string Username,
    string FirstName,
    string LastName,
    string? Location,
    int? BirthYear,
    string PreferredLanguage,
    bool IsFirstNamePublic,
    bool IsLastNamePublic,
    bool IsLocationPublic,
    bool IsBirthYearPublic,
    bool IsPreferredLanguagePublic,
    Instant CreatedAt,
    Instant UpdatedAt);

internal sealed record AccessTokenResponse(string AccessToken, Instant ExpiresAt, string TokenType);
