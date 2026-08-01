using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.Json;
using Gones.Api.Errors;
using Gones.Api.Security;
using Gones.Api.Validation;
using Gones.Domain.Identity;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.Api.Identity;

internal static class AccountLifecycleEndpoints
{
    private static readonly GenericAccountActionResponse GenericResponse =
        new("If the account is eligible, an email has been queued.");

    public static void MapAccountLifecycleEndpoints(this RouteGroupBuilder auth, RouteGroupBuilder users)
    {
        auth.MapPost("/verify-email", VerifyEmailAsync)
            .RequireRateLimiting(AuthRateLimiting.IpPolicy)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);
        auth.MapPost("/resend-verification", ResendVerificationAsync)
            .RequireRateLimiting(AuthRateLimiting.IpPolicy)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .AddEndpointFilter<AuthAccountRateLimitFilter>()
            .Produces<GenericAccountActionResponse>(StatusCodes.Status202Accepted)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);
        auth.MapPost("/forgot-password", ForgotPasswordAsync)
            .RequireRateLimiting(AuthRateLimiting.IpPolicy)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .AddEndpointFilter<AuthAccountRateLimitFilter>()
            .Produces<GenericAccountActionResponse>(StatusCodes.Status202Accepted)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);
        auth.MapPost("/reset-password", ResetPasswordAsync)
            .RequireRateLimiting(AuthRateLimiting.IpPolicy)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);
        auth.MapPost("/confirm-email-change", ConfirmEmailChangeAsync)
            .RequireRateLimiting(AuthRateLimiting.IpPolicy)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);

        users.MapPost("/me/email-change", RequestEmailChangeAsync)
            .RequireRateLimiting(AuthRateLimiting.IpPolicy)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .AddEndpointFilter<AuthAccountRateLimitFilter>()
            .Produces<GenericAccountActionResponse>(StatusCodes.Status202Accepted)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);
        users.MapGet("/me/email-history", GetEmailHistoryAsync)
            .Produces<IReadOnlyList<UserEmailHistoryResponse>>();
    }

    private static async Task<IResult> VerifyEmailAsync(
        TokenRequest request,
        UserManager<ApplicationUser> userManager,
        GonesDbContext database,
        AccountLifecycleService lifecycle,
        IClock clock,
        CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var token = await lifecycle.LockValidAsync(request.Token, AccountActionPurpose.VerifyEmail, cancellationToken)
            ?? throw new InvalidAccountActionTokenException();
        var user = await userManager.FindByIdAsync(token.UserId.ToString("D")) ?? throw new InvalidAccountActionTokenException();
        user.EmailConfirmed = true;
        var updated = await userManager.UpdateAsync(user);
        EnsureSucceeded(updated);
        token.Consume(clock.GetCurrentInstant());
        database.AuditRecords.Add(NewAudit(user.Id, "auth.email.verified", ["emailVerified"], clock));
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> ResendVerificationAsync(
        EmailAccountRequest request,
        UserManager<ApplicationUser> userManager,
        GonesDbContext database,
        AccountLifecycleService lifecycle,
        IClock clock,
        CancellationToken cancellationToken)
    {
        var user = await userManager.FindByEmailAsync(request.Email.Trim());
        if (user is not null && !user.EmailConfirmed)
        {
            await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
            await lifecycle.LockUserAsync(user.Id, cancellationToken);
            var changePending = await database.AccountActionTokens.AnyAsync(token => token.UserId == user.Id
                && token.Purpose == AccountActionPurpose.ChangeEmail
                && token.ConsumedAt == null
                && token.SupersededAt == null
                && token.ExpiresAt > clock.GetCurrentInstant(), cancellationToken);
            if (!changePending)
            {
                var profile = await database.UserProfiles.SingleAsync(item => item.UserId == user.Id, cancellationToken);
                await lifecycle.IssueAsync(user, AccountActionPurpose.VerifyEmail, profile.Username, profile.PreferredLanguage, null, cancellationToken);
                database.AuditRecords.Add(NewAudit(user.Id, "auth.email.verification_resent", ["verificationGeneration"], clock));
                await database.SaveChangesAsync(cancellationToken);
            }
            await transaction.CommitAsync(cancellationToken);
        }
        return Results.Accepted(value: GenericResponse);
    }

    private static async Task<IResult> ForgotPasswordAsync(
        EmailAccountRequest request,
        UserManager<ApplicationUser> userManager,
        GonesDbContext database,
        AccountLifecycleService lifecycle,
        IClock clock,
        CancellationToken cancellationToken)
    {
        var user = await userManager.FindByEmailAsync(request.Email.Trim());
        if (user is not null)
        {
            await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
            await lifecycle.LockUserAsync(user.Id, cancellationToken);
            var profile = await database.UserProfiles.SingleAsync(item => item.UserId == user.Id, cancellationToken);
            await lifecycle.IssueAsync(user, AccountActionPurpose.ResetPassword, profile.Username, profile.PreferredLanguage, null, cancellationToken);
            database.AuditRecords.Add(NewAudit(user.Id, "auth.password.reset_requested", ["resetGeneration"], clock));
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        return Results.Accepted(value: GenericResponse);
    }

    private static async Task<IResult> ResetPasswordAsync(
        ResetPasswordRequest request,
        UserManager<ApplicationUser> userManager,
        GonesDbContext database,
        AccountLifecycleService lifecycle,
        RefreshSessionService sessions,
        IClock clock,
        CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var token = await lifecycle.LockValidAsync(request.Token, AccountActionPurpose.ResetPassword, cancellationToken)
            ?? throw new InvalidAccountActionTokenException();
        var user = await userManager.FindByIdAsync(token.UserId.ToString("D")) ?? throw new InvalidAccountActionTokenException();
        var validation = await ValidatePasswordAsync(userManager, user, request.Password);
        if (!validation.Succeeded) throw IdentityValidation(validation.Errors);

        user.PasswordHash = userManager.PasswordHasher.HashPassword(user, request.Password);
        user.SecurityStamp = Guid.NewGuid().ToString("N");
        EnsureSucceeded(await userManager.UpdateAsync(user));
        token.Consume(clock.GetCurrentInstant());
        await sessions.RevokeAllForPasswordResetAsync(user.Id, cancellationToken);
        database.AuditRecords.Add(NewAudit(user.Id, "auth.password.reset", ["password", "securityStamp", "sessions"], clock));
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> RequestEmailChangeAsync(
        EmailChangeRequest request,
        ClaimsPrincipal principal,
        UserManager<ApplicationUser> userManager,
        GonesDbContext database,
        AccountLifecycleService lifecycle,
        IClock clock,
        CancellationToken cancellationToken)
    {
        var userId = CurrentUserId(principal);
        var user = await userManager.FindByIdAsync(userId.ToString("D")) ?? throw new AuthenticationFailedException();
        if (!await userManager.CheckPasswordAsync(user, request.CurrentPassword))
        {
            throw Validation(nameof(request.CurrentPassword), "Current password is invalid.");
        }
        var normalizedTarget = userManager.NormalizeEmail(request.NewEmail);
        if (await database.Users.AnyAsync(item => item.Id != userId && item.NormalizedEmail == normalizedTarget, cancellationToken))
        {
            throw new ResourceConflictException();
        }

        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        await lifecycle.LockUserAsync(user.Id, cancellationToken);
        user.EmailConfirmed = false;
        EnsureSucceeded(await userManager.UpdateAsync(user));
        var profile = await database.UserProfiles.SingleAsync(item => item.UserId == user.Id, cancellationToken);
        await lifecycle.IssueAsync(user, AccountActionPurpose.ChangeEmail, profile.Username, profile.PreferredLanguage, request.NewEmail, cancellationToken);
        database.AuditRecords.Add(NewAudit(user.Id, "auth.email.change_requested", ["emailVerified"], clock));
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Results.Accepted(value: GenericResponse);
    }

    private static async Task<IResult> ConfirmEmailChangeAsync(
        TokenRequest request,
        UserManager<ApplicationUser> userManager,
        GonesDbContext database,
        AccountLifecycleService lifecycle,
        IClock clock,
        CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var token = await lifecycle.LockValidAsync(request.Token, AccountActionPurpose.ChangeEmail, cancellationToken)
            ?? throw new InvalidAccountActionTokenException();
        var user = await userManager.FindByIdAsync(token.UserId.ToString("D")) ?? throw new InvalidAccountActionTokenException();
        if (await database.Users.AnyAsync(item => item.Id != user.Id && item.NormalizedEmail == token.NormalizedTargetEmail, cancellationToken))
        {
            throw new ResourceConflictException();
        }
        if (!string.IsNullOrWhiteSpace(user.Email)) database.UserEmailHistories.Add(UserEmailHistory.Create(user.Id, user.Email, clock.GetCurrentInstant()));
        user.Email = token.TargetEmail;
        user.NormalizedEmail = token.NormalizedTargetEmail;
        user.EmailConfirmed = true;
        EnsureSucceeded(await userManager.UpdateAsync(user));
        token.Consume(clock.GetCurrentInstant());
        database.AuditRecords.Add(NewAudit(user.Id, "auth.email.changed", ["email", "emailVerified"], clock));
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> GetEmailHistoryAsync(
        ClaimsPrincipal principal,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var userId = CurrentUserId(principal);
        var history = await database.UserEmailHistories.AsNoTracking()
            .Where(item => item.UserId == userId)
            .OrderByDescending(item => item.RecordedAt)
            .Select(item => new UserEmailHistoryResponse(item.Id, item.Email, item.RecordedAt, item.RetainUntil, item.RedactedAt))
            .ToListAsync(cancellationToken);
        return Results.Ok(history);
    }

    private static async Task<IdentityResult> ValidatePasswordAsync(UserManager<ApplicationUser> manager, ApplicationUser user, string password)
    {
        var errors = new List<IdentityError>();
        foreach (var validator in manager.PasswordValidators)
        {
            var result = await validator.ValidateAsync(manager, user, password);
            if (!result.Succeeded) errors.AddRange(result.Errors);
        }
        return errors.Count == 0 ? IdentityResult.Success : IdentityResult.Failed(errors.ToArray());
    }

    private static void EnsureSucceeded(IdentityResult result)
    {
        if (!result.Succeeded)
        {
            if (result.Errors.Any(error => error.Code is "DuplicateEmail" or "ConcurrencyFailure")) throw new ResourceConflictException();
            throw IdentityValidation(result.Errors);
        }
    }

    private static AuditRecord NewAudit(Guid userId, string action, IReadOnlyList<string> fields, IClock clock) => new()
    {
        ActorId = userId,
        Action = action,
        EntityType = "user",
        EntityId = userId.ToString("D"),
        RedactedDiff = JsonSerializer.Serialize(new { fields }),
        OccurredAt = clock.GetCurrentInstant()
    };

    private static Guid CurrentUserId(ClaimsPrincipal principal)
    {
        var value = principal.FindFirstValue("sub") ?? principal.FindFirstValue(ClaimTypes.NameIdentifier);
        return Guid.TryParse(value, out var userId) ? userId : throw new AuthenticationFailedException();
    }

    private static ApiValidationException IdentityValidation(IEnumerable<IdentityError> errors) =>
        new(new Dictionary<string, string[]> { ["Password"] = errors.Select(error => error.Description).Distinct(StringComparer.Ordinal).ToArray() });

    private static ApiValidationException Validation(string field, string message) =>
        new(new Dictionary<string, string[]> { [field] = [message] });
}

internal sealed record TokenRequest([property: Required, StringLength(256)] string Token);

internal sealed record EmailAccountRequest(
    [property: Required, EmailAddress, StringLength(254)] string Email) : IAuthRateLimitRequest
{
    public string RateLimitAccount => Email;
}

internal sealed record ResetPasswordRequest(
    [property: Required, StringLength(256)] string Token,
    [property: Required, StringLength(128)] string Password);

internal sealed record EmailChangeRequest(
    [property: Required, EmailAddress, StringLength(254)] string NewEmail,
    [property: Required, StringLength(128)] string CurrentPassword) : IAuthRateLimitRequest
{
    public string RateLimitAccount => NewEmail;
}

internal sealed record GenericAccountActionResponse(string Message);
internal sealed record UserEmailHistoryResponse(Guid Id, string? Email, Instant RecordedAt, Instant RetainUntil, Instant? RedactedAt);
