using System.ComponentModel.DataAnnotations;
using System.Net.Mail;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Gones.Api.Errors;
using Gones.Api.Security;
using Gones.Api.Validation;
using Gones.Application.Notifications;
using Gones.Domain.Identity;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Configuration;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Notifications;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.Api.Identity;

internal static class ExternalOAuthEndpoints
{
    public static void MapExternalOAuthEndpoints(this WebApplication app)
    {
        var auth = app.MapGroup("/api/auth/oauth");
        auth.MapGet("/{provider}/start", StartAsync)
            .RequireRateLimiting(AuthRateLimiting.IpPolicy)
            .Produces(StatusCodes.Status302Found)
            .ProducesProblem(StatusCodes.Status404NotFound);
        auth.MapGet("/{provider}/callback", CallbackAsync)
            .RequireRateLimiting(AuthRateLimiting.IpPolicy)
            .Produces<OAuthFlowResponse>()
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);
        auth.MapPost("/complete", CompleteAsync)
            .RequireRateLimiting(AuthRateLimiting.IpPolicy)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces<OAuthFlowResponse>()
            .Produces<OAuthFlowResponse>(StatusCodes.Status202Accepted)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);
        auth.MapPost("/verify-email", VerifyEmailAsync)
            .RequireRateLimiting(AuthRateLimiting.IpPolicy)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces<OAuthFlowResponse>()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);

        var identities = app.MapGroup("/api/users/me/external-identities").RequireAuthorization(AuthorizationPolicies.User);
        identities.MapGet("/", ListAsync).Produces<IReadOnlyList<ExternalIdentityResponse>>();
        identities.MapPost("/{provider}/start", LinkStartAsync)
            .RequireRateLimiting(AuthRateLimiting.IpPolicy)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces<OAuthStartResponse>()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);
        identities.MapDelete("/{provider}", UnlinkAsync)
            .RequireRateLimiting(AuthRateLimiting.IpPolicy)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);
    }

    private static async Task<IResult> StartAsync(
        string provider,
        HttpContext context,
        ExternalOAuthService service,
        ExternalOAuthOptions options,
        CancellationToken cancellationToken)
    {
        provider = NormalizeProvider(provider);
        var started = await service.StartAsync(provider, OAuthAttemptPurpose.Register, null, FakeScenario(context, options), cancellationToken);
        OAuthCorrelationCookie.Issue(context.Response, started.Correlation);
        return Results.Redirect(started.AuthorizationUri.ToString());
    }

    private static async Task<IResult> LinkStartAsync(
        string provider,
        LinkExternalIdentityRequest request,
        ClaimsPrincipal principal,
        HttpContext context,
        ExternalOAuthService service,
        ExternalOAuthOptions options,
        CancellationToken cancellationToken)
    {
        provider = NormalizeProvider(provider);
        var userId = CurrentUserId(principal);
        await service.RequireReauthenticationAsync(userId, request.CurrentPassword, principal, cancellationToken);
        var started = await service.StartAsync(provider, OAuthAttemptPurpose.Link, userId, FakeScenario(context, options), cancellationToken);
        OAuthCorrelationCookie.Issue(context.Response, started.Correlation);
        return Results.Ok(new OAuthStartResponse(started.AuthorizationUri));
    }

    private static async Task<IResult> CallbackAsync(
        string provider,
        string? code,
        string? state,
        HttpContext context,
        ExternalOAuthService service,
        AccessTokenIssuer tokenIssuer,
        RefreshSessionService sessions,
        CancellationToken cancellationToken)
    {
        provider = NormalizeProvider(provider);
        var result = await service.CallbackAsync(provider, state, OAuthCorrelationCookie.Read(context.Request), code, cancellationToken);
        OAuthCorrelationCookie.Clear(context.Response);
        if (result.Linked) return Results.NoContent();
        if (result.User is not null) return await AuthenticatedAsync(result.User, result.DeviceLabel, context, sessions, tokenIssuer, cancellationToken);
        return Results.Ok(new OAuthFlowResponse(
            "completion_required",
            null,
            null,
            null,
            result.CompletionTicket,
            result.Email,
            result.EmailVerified,
            result.FirstName,
            result.LastName));
    }

    private static async Task<IResult> CompleteAsync(
        CompleteOAuthRequest request,
        HttpContext context,
        ExternalOAuthService service,
        AccessTokenIssuer tokenIssuer,
        RefreshSessionService sessions,
        CancellationToken cancellationToken)
    {
        var result = await service.CompleteAsync(request, cancellationToken);
        if (result.EmailVerificationRequired)
        {
            return Results.Accepted(value: new OAuthFlowResponse("email_verification_required", null, null, null, null, null, false, null, null));
        }
        return await AuthenticatedAsync(result.User!, request.DeviceLabel, context, sessions, tokenIssuer, cancellationToken);
    }

    private static async Task<IResult> VerifyEmailAsync(
        VerifyOAuthEmailRequest request,
        HttpContext context,
        ExternalOAuthService service,
        AccessTokenIssuer tokenIssuer,
        RefreshSessionService sessions,
        CancellationToken cancellationToken)
    {
        var user = await service.VerifyEmailAsync(request.Token, cancellationToken);
        return await AuthenticatedAsync(user, request.DeviceLabel, context, sessions, tokenIssuer, cancellationToken);
    }

    private static async Task<IResult> AuthenticatedAsync(
        ApplicationUser user,
        string? deviceLabel,
        HttpContext context,
        RefreshSessionService sessions,
        AccessTokenIssuer tokenIssuer,
        CancellationToken cancellationToken)
    {
        var session = await sessions.CreateAsync(user, NormalizeDeviceLabel(deviceLabel), cancellationToken);
        var token = tokenIssuer.Issue(user);
        RefreshCookie.Issue(context.Response, session.PlaintextToken, session.Session.AbsoluteExpiresAt, SystemClock.Instance.GetCurrentInstant());
        return Results.Ok(new OAuthFlowResponse("authenticated", token.Value, token.ExpiresAt, "Bearer", null, null, false, null, null));
    }

    private static async Task<IResult> ListAsync(
        ClaimsPrincipal principal,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var identities = await database.ExternalIdentities.AsNoTracking()
            .Where(item => item.UserId == CurrentUserId(principal))
            .OrderBy(item => item.Provider)
            .Select(item => new ExternalIdentityResponse(item.Provider, item.ProviderEmail, item.ProviderEmailVerified, item.CreatedAt, item.UpdatedAt))
            .ToListAsync(cancellationToken);
        return Results.Ok(identities);
    }

    private static async Task<IResult> UnlinkAsync(
        string provider,
        [FromBody] UnlinkExternalIdentityRequest request,
        ClaimsPrincipal principal,
        ExternalOAuthService service,
        CancellationToken cancellationToken)
    {
        await service.UnlinkAsync(CurrentUserId(principal), NormalizeProvider(provider), request.CurrentPassword, principal, cancellationToken);
        return Results.NoContent();
    }

    private static FakeOAuthScenario? FakeScenario(HttpContext context, ExternalOAuthOptions options) =>
        options.Mode == GonesAuthProvider.Fake
            ? new FakeOAuthScenario(
                context.Request.Headers["X-Gones-Fake-OAuth-Scenario"].FirstOrDefault() ?? "complete",
                context.Request.Headers["X-Gones-Fake-OAuth-Subject"].FirstOrDefault(),
                context.Request.Headers["X-Gones-Fake-OAuth-Email"].FirstOrDefault())
            : null;

    private static string NormalizeProvider(string provider)
    {
        try { return ExternalIdentityProvider.Normalize(provider); }
        catch (ArgumentException) { throw new OAuthProviderUnavailableException(); }
    }

    private static Guid CurrentUserId(ClaimsPrincipal principal)
    {
        var value = principal.FindFirstValue("sub") ?? principal.FindFirstValue(ClaimTypes.NameIdentifier);
        return Guid.TryParse(value, out var userId) ? userId : throw new AuthenticationFailedException();
    }

    private static string NormalizeDeviceLabel(string? value) => string.IsNullOrWhiteSpace(value) ? "OAuth sign-in" : value.Trim();
}

internal sealed class ExternalOAuthService(
    GonesDbContext database,
    UserManager<ApplicationUser> userManager,
    IExternalOAuthClient client,
    INotificationOutbox outbox,
    AccountLifecycleOptions lifecycleOptions,
    RefreshSessionService sessions,
    IClock clock)
{
    public async Task<OAuthStartResult> StartAsync(
        string provider,
        OAuthAttemptPurpose purpose,
        Guid? userId,
        FakeOAuthScenario? scenario,
        CancellationToken cancellationToken)
    {
        var state = RandomToken();
        var correlation = RandomToken();
        var now = clock.GetCurrentInstant();
        await database.OAuthAttempts
            .Where(item => item.ExpiresAt <= now
                && (item.Status != OAuthAttemptStatus.CallbackClaimed || item.CreatedAt < now - Duration.FromHours(1)))
            .ExecuteDeleteAsync(cancellationToken);
        var attempt = OAuthAttempt.Create(provider, purpose, userId, Hash(state), Hash(correlation), now);
        database.OAuthAttempts.Add(attempt);
        await database.SaveChangesAsync(cancellationToken);
        return new OAuthStartResult(client.CreateAuthorizationUri(provider, state, scenario), correlation);
    }

    public async Task RequireReauthenticationAsync(
        Guid userId,
        string? currentPassword,
        ClaimsPrincipal principal,
        CancellationToken cancellationToken)
    {
        var user = await userManager.FindByIdAsync(userId.ToString("D")) ?? throw new AuthenticationFailedException();
        if (await userManager.HasPasswordAsync(user))
        {
            if (string.IsNullOrWhiteSpace(currentPassword) || !await userManager.CheckPasswordAsync(user, currentPassword))
            {
                throw Validation(nameof(currentPassword), "Current password is required and must be valid.");
            }
        }
        else if (!HasRecentAuthentication(principal, clock.GetCurrentInstant()))
        {
            throw Validation("reauthentication", "Sign in again before changing external identities.");
        }
        cancellationToken.ThrowIfCancellationRequested();
    }

    public async Task<OAuthCallbackResult> CallbackAsync(
        string provider,
        string? state,
        string? correlation,
        string? code,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(state) || state.Length > 256 || string.IsNullOrWhiteSpace(correlation) || correlation.Length > 256)
        {
            throw new InvalidOAuthStateException();
        }
        Guid attemptId;
        await using (var claimTransaction = await database.Database.BeginTransactionAsync(cancellationToken))
        {
            var stateHash = Hash(state);
            var claimedAttempt = await database.OAuthAttempts
                .FromSqlInterpolated($"SELECT * FROM oauth_attempts WHERE state_hash = {stateHash} FOR UPDATE")
                .SingleOrDefaultAsync(cancellationToken);
            var claimTime = clock.GetCurrentInstant();
            if (claimedAttempt is null || claimedAttempt.Provider != provider || !claimedAttempt.CanAcceptCallback(Hash(correlation), claimTime))
            {
                throw new InvalidOAuthStateException();
            }
            claimedAttempt.ClaimCallback(Hash(correlation), claimTime);
            attemptId = claimedAttempt.Id;
            await database.SaveChangesAsync(cancellationToken);
            await claimTransaction.CommitAsync(cancellationToken);
        }

        var profile = await client.ExchangeAsync(provider, code ?? string.Empty, cancellationToken);
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var attempt = await database.OAuthAttempts
            .FromSqlInterpolated($"SELECT * FROM oauth_attempts WHERE id = {attemptId} FOR UPDATE")
            .SingleAsync(cancellationToken);
        var now = clock.GetCurrentInstant();
        attempt.CaptureProfile(profile.Subject, profile.Email, profile.EmailVerified);
        var existingIdentity = await database.ExternalIdentities.SingleOrDefaultAsync(
            item => item.Provider == provider && item.ProviderSubject == profile.Subject, cancellationToken);

        if (attempt.Purpose == OAuthAttemptPurpose.Link)
        {
            if (existingIdentity is not null) throw new ResourceConflictException();
            var userId = attempt.UserId!.Value;
            if (await database.ExternalIdentities.AnyAsync(item => item.UserId == userId && item.Provider == provider, cancellationToken)) throw new ResourceConflictException();
            database.ExternalIdentities.Add(ExternalIdentity.Create(userId, provider, profile.Subject, profile.Email, profile.EmailVerified, now));
            database.OAuthAttempts.Remove(attempt);
            await sessions.RevokeAllForIdentityChangeAsync(userId, cancellationToken);
            database.AuditRecords.Add(NewAudit(userId, "auth.external_identity.linked", userId, provider, now));
            try { await database.SaveChangesAsync(cancellationToken); }
            catch (DbUpdateException) { throw new ResourceConflictException(); }
            await transaction.CommitAsync(cancellationToken);
            return OAuthCallbackResult.LinkedIdentity;
        }

        if (existingIdentity is not null)
        {
            var user = await database.Users.SingleAsync(item => item.Id == existingIdentity.UserId, cancellationToken);
            existingIdentity.UpdateProviderEmail(profile.Email, profile.EmailVerified, now);
            database.OAuthAttempts.Remove(attempt);
            database.AuditRecords.Add(NewAudit(user.Id, "auth.external_identity.login", user.Id, provider, now));
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return OAuthCallbackResult.Authenticated(user);
        }

        if (profile.Email is not null && await EmailExistsAsync(profile.Email, cancellationToken))
        {
            database.OAuthAttempts.Remove(attempt);
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            throw new ExistingEmailRequiresLinkException();
        }
        if (profile.EmailVerified
            && profile.Email is not null
            && profile.Username is not null
            && profile.FirstName is not null
            && profile.LastName is not null)
        {
            var user = await CreateUserAsync(attempt, profile.Email, true, profile.Username, profile.FirstName, profile.LastName, now, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return OAuthCallbackResult.Authenticated(user);
        }

        var completion = RandomToken();
        attempt.AwaitCompletion(Hash(completion), now);
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return OAuthCallbackResult.Completion(completion, profile);
    }

    public async Task<OAuthCompletionResult> CompleteAsync(CompleteOAuthRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.CompletionTicket) || request.CompletionTicket.Length > 256) throw new InvalidOAuthTicketException();
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var hash = Hash(request.CompletionTicket);
        var attempt = await database.OAuthAttempts
            .FromSqlInterpolated($"SELECT * FROM oauth_attempts WHERE completion_hash = {hash} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);
        var now = clock.GetCurrentInstant();
        if (attempt is null || !attempt.CanComplete(hash, now) || attempt.Purpose != OAuthAttemptPurpose.Register) throw new InvalidOAuthTicketException();
        ValidateEmail(request.Email);
        if (await EmailExistsAsync(request.Email, cancellationToken)) throw new ExistingEmailRequiresLinkException();

        var providerEmailMatches = attempt.ProviderEmailVerified
            && string.Equals(NormalizeEmail(attempt.ProviderEmail!), NormalizeEmail(request.Email), StringComparison.Ordinal);
        if (providerEmailMatches)
        {
            var user = await CreateUserAsync(attempt, request.Email, true, request.Username, request.FirstName, request.LastName, now, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return OAuthCompletionResult.Authenticated(user);
        }

        var verificationToken = RandomToken();
        attempt.AwaitEmailVerification(Hash(verificationToken), request.Email, request.Username, request.FirstName, request.LastName, now);
        var actionUrl = new UriBuilder(new Uri(lifecycleOptions.PublicOrigin, "/oauth/verify-email"))
        {
            Query = $"token={Uri.EscapeDataString(verificationToken)}"
        }.Uri;
        outbox.Enqueue(new NotificationRequest(
            request.Email,
            "fr",
            $"oauth-email-verification:{attempt.Id:D}",
            new VerifyEmailTemplateModel(request.Username, actionUrl)));
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return OAuthCompletionResult.VerificationRequired;
    }

    public async Task<ApplicationUser> VerifyEmailAsync(string token, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 256) throw new InvalidOAuthTicketException();
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var hash = Hash(token);
        var attempt = await database.OAuthAttempts
            .FromSqlInterpolated($"SELECT * FROM oauth_attempts WHERE email_verification_hash = {hash} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);
        var now = clock.GetCurrentInstant();
        if (attempt is null || !attempt.CanVerifyEmail(hash, now)) throw new InvalidOAuthTicketException();
        if (await EmailExistsAsync(attempt.ProposedEmail!, cancellationToken)) throw new ExistingEmailRequiresLinkException();
        var user = await CreateUserAsync(
            attempt,
            attempt.ProposedEmail!,
            true,
            attempt.ProposedUsername!,
            attempt.ProposedFirstName!,
            attempt.ProposedLastName!,
            now,
            cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return user;
    }

    public async Task UnlinkAsync(
        Guid userId,
        string provider,
        string? currentPassword,
        ClaimsPrincipal principal,
        CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var user = await database.Users.FromSqlInterpolated($"SELECT * FROM asp_net_users WHERE id = {userId} FOR UPDATE").SingleOrDefaultAsync(cancellationToken)
            ?? throw new AuthenticationFailedException();
        var identities = await database.ExternalIdentities.Where(item => item.UserId == userId).ToListAsync(cancellationToken);
        var identity = identities.SingleOrDefault(item => item.Provider == provider) ?? throw new ResourceNotFoundException();
        var hasPassword = await userManager.HasPasswordAsync(user);
        if (!hasPassword && identities.Count == 1) throw new LastLoginMethodException();
        await RequireReauthenticationAsync(userId, currentPassword, principal, cancellationToken);

        database.ExternalIdentities.Remove(identity);
        await sessions.RevokeAllForIdentityChangeAsync(userId, cancellationToken);
        database.AuditRecords.Add(NewAudit(userId, "auth.external_identity.unlinked", userId, provider, clock.GetCurrentInstant()));
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    private async Task<ApplicationUser> CreateUserAsync(
        OAuthAttempt attempt,
        string email,
        bool emailVerified,
        string username,
        string firstName,
        string lastName,
        Instant now,
        CancellationToken cancellationToken)
    {
        UserProfile profile;
        try { profile = UserProfile.Create(Guid.NewGuid(), username, firstName, lastName, now); }
        catch (ArgumentException exception) { throw Validation(exception.ParamName ?? "request", exception.Message); }
        var user = new ApplicationUser
        {
            Id = profile.UserId,
            UserName = username,
            Email = email.Trim(),
            EmailConfirmed = emailVerified
        };
        var created = await userManager.CreateAsync(user);
        if (!created.Succeeded)
        {
            if (created.Errors.Any(item => item.Code == "DuplicateEmail")) throw new ExistingEmailRequiresLinkException();
            throw new ApiValidationException(new Dictionary<string, string[]> { ["Username"] = created.Errors.Select(item => item.Description).ToArray() });
        }
        database.UserProfiles.Add(profile);
        database.ExternalIdentities.Add(ExternalIdentity.Create(
            user.Id,
            attempt.Provider,
            attempt.ProviderSubject!,
            attempt.ProviderEmail,
            attempt.ProviderEmailVerified,
            now));
        database.OAuthAttempts.Remove(attempt);
        database.AuditRecords.Add(NewAudit(user.Id, "auth.external_identity.registered", user.Id, attempt.Provider, now));
        try { await database.SaveChangesAsync(cancellationToken); }
        catch (DbUpdateException) { throw new ResourceConflictException(); }
        return user;
    }

    private Task<bool> EmailExistsAsync(string email, CancellationToken cancellationToken)
    {
        var normalized = NormalizeEmail(email);
        return database.Users.AnyAsync(item => item.NormalizedEmail == normalized, cancellationToken);
    }

    private string NormalizeEmail(string email) => userManager.NormalizeEmail(email.Trim());

    private static void ValidateEmail(string email)
    {
        if (string.IsNullOrWhiteSpace(email) || email.Length > 254 || !MailAddress.TryCreate(email.Trim(), out var parsed) || parsed.Address != email.Trim())
        {
            throw Validation(nameof(email), "Email is invalid.");
        }
    }

    private static bool HasRecentAuthentication(ClaimsPrincipal principal, Instant now)
    {
        var issuedClaim = principal.FindFirstValue("iat");
        if (!long.TryParse(issuedClaim, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var issuedSeconds)) return false;
        var issuedAt = Instant.FromUnixTimeSeconds(issuedSeconds);
        var age = now - issuedAt;
        return age >= Duration.Zero && age <= Duration.FromMinutes(5);
    }

    private static string RandomToken() => WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
    private static string Hash(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    private static ApiValidationException Validation(string field, string message) => new(new Dictionary<string, string[]> { [field] = [message] });
    private static AuditRecord NewAudit(Guid actorId, string action, Guid entityId, string provider, Instant now) => new()
    {
        ActorId = actorId,
        Action = action,
        EntityType = "external_identity",
        EntityId = entityId.ToString("D"),
        RedactedDiff = JsonSerializer.Serialize(new { provider }),
        OccurredAt = now
    };
}

internal static class OAuthCorrelationCookie
{
    private const string Name = "gones_oauth_correlation";
    private const string Path = "/api/auth/oauth";

    public static string? Read(HttpRequest request) => request.Cookies[Name];
    public static void Issue(HttpResponse response, string value) => response.Cookies.Append(Name, value, Options(TimeSpan.FromMinutes(5)));
    public static void Clear(HttpResponse response) => response.Cookies.Delete(Name, Options(null));

    private static CookieOptions Options(TimeSpan? maxAge) => new()
    {
        Secure = true,
        HttpOnly = true,
        SameSite = SameSiteMode.Lax,
        Path = Path,
        IsEssential = true,
        MaxAge = maxAge
    };
}

internal sealed record CompleteOAuthRequest(
    [property: Required, StringLength(256)] string CompletionTicket,
    [property: Required, EmailAddress, StringLength(254)] string Email,
    [property: Required] string Username,
    [property: Required, StringLength(100)] string FirstName,
    [property: Required, StringLength(100)] string LastName,
    [property: StringLength(RefreshSession.MaximumDeviceLabelLength)] string? DeviceLabel);

internal sealed record VerifyOAuthEmailRequest(
    [property: Required, StringLength(256)] string Token,
    [property: StringLength(RefreshSession.MaximumDeviceLabelLength)] string? DeviceLabel);

internal sealed record LinkExternalIdentityRequest([property: StringLength(128)] string? CurrentPassword);
internal sealed record UnlinkExternalIdentityRequest([property: StringLength(128)] string? CurrentPassword);
internal sealed record OAuthStartResponse(Uri AuthorizationUrl);
internal sealed record ExternalIdentityResponse(string Provider, string? ProviderEmail, bool ProviderEmailVerified, Instant CreatedAt, Instant UpdatedAt);
internal sealed record OAuthFlowResponse(
    string Status,
    string? AccessToken,
    Instant? ExpiresAt,
    string? TokenType,
    string? CompletionTicket,
    string? Email,
    bool EmailVerified,
    string? FirstName,
    string? LastName);
internal sealed record OAuthStartResult(Uri AuthorizationUri, string Correlation);
internal sealed record OAuthCallbackResult(
    bool Linked,
    ApplicationUser? User,
    string? CompletionTicket,
    string? Email,
    bool EmailVerified,
    string? FirstName,
    string? LastName,
    string? DeviceLabel)
{
    public static OAuthCallbackResult LinkedIdentity { get; } = new(true, null, null, null, false, null, null, null);
    public static OAuthCallbackResult Authenticated(ApplicationUser user) => new(false, user, null, null, false, null, null, null);
    public static OAuthCallbackResult Completion(string ticket, ExternalProviderProfile profile) =>
        new(false, null, ticket, profile.Email, profile.EmailVerified, profile.FirstName, profile.LastName, null);
}
internal sealed record OAuthCompletionResult(bool EmailVerificationRequired, ApplicationUser? User)
{
    public static OAuthCompletionResult VerificationRequired { get; } = new(true, null);
    public static OAuthCompletionResult Authenticated(ApplicationUser user) => new(false, user);
}
