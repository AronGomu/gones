using System.Security.Cryptography;
using System.Text;
using Gones.Domain.Persistence;
using NodaTime;

namespace Gones.Domain.Identity;

public static class ExternalIdentityProvider
{
    public const string Google = "google";
    public const string Facebook = "facebook";

    public static string Normalize(string provider) => provider.Trim().ToLowerInvariant() switch
    {
        Google => Google,
        Facebook => Facebook,
        _ => throw new ArgumentException("Provider must be Google or Facebook.", nameof(provider))
    };
}

public sealed class ExternalIdentity : VersionedEntity
{
    private ExternalIdentity() { }

    public Guid UserId { get; private init; }
    public string Provider { get; private init; } = string.Empty;
    public string ProviderSubject { get; private init; } = string.Empty;
    public string? ProviderEmail { get; private set; }
    public bool ProviderEmailVerified { get; private set; }
    public Instant ProviderEmailUpdatedAt { get; private set; }
    public Instant CreatedAt { get; private init; }
    public Instant UpdatedAt { get; private set; }

    public static ExternalIdentity Create(
        Guid userId,
        string provider,
        string providerSubject,
        string? providerEmail,
        bool providerEmailVerified,
        Instant now)
    {
        if (userId == Guid.Empty) throw new ArgumentException("User ID cannot be empty.", nameof(userId));
        var normalizedProvider = ExternalIdentityProvider.Normalize(provider);
        var normalizedSubject = Require(providerSubject, 255, nameof(providerSubject));
        var normalizedEmail = NormalizeEmail(providerEmail);
        return new ExternalIdentity
        {
            UserId = userId,
            Provider = normalizedProvider,
            ProviderSubject = normalizedSubject,
            ProviderEmail = normalizedEmail,
            ProviderEmailVerified = normalizedEmail is not null && providerEmailVerified,
            ProviderEmailUpdatedAt = now,
            CreatedAt = now,
            UpdatedAt = now
        };
    }

    public void UpdateProviderEmail(string? email, bool verified, Instant now)
    {
        ProviderEmail = NormalizeEmail(email);
        ProviderEmailVerified = ProviderEmail is not null && verified;
        ProviderEmailUpdatedAt = now;
        UpdatedAt = now;
    }

    private static string Require(string value, int maximumLength, string paramName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value, paramName);
        var normalized = value.Trim();
        return normalized.Length <= maximumLength ? normalized : throw new ArgumentOutOfRangeException(paramName);
    }

    private static string? NormalizeEmail(string? email)
    {
        if (string.IsNullOrWhiteSpace(email)) return null;
        var normalized = email.Trim();
        return normalized.Length <= 254 ? normalized : throw new ArgumentOutOfRangeException(nameof(email));
    }
}

public enum OAuthAttemptPurpose
{
    Register,
    Link
}

public enum OAuthAttemptStatus
{
    AwaitingCallback,
    CallbackClaimed,
    AwaitingCompletion,
    AwaitingEmailVerification,
    Consumed
}

public sealed class OAuthAttempt : VersionedEntity
{
    public static readonly Duration StateLifetime = Duration.FromMinutes(5);
    public static readonly Duration CompletionLifetime = Duration.FromMinutes(10);
    public static readonly Duration EmailVerificationLifetime = Duration.FromHours(24);

    private OAuthAttempt() { }

    public string Provider { get; private init; } = string.Empty;
    public OAuthAttemptPurpose Purpose { get; private init; }
    public Guid? UserId { get; private init; }
    public string StateHash { get; private init; } = string.Empty;
    public string CorrelationHash { get; private init; } = string.Empty;
    public string? CompletionHash { get; private set; }
    public string? EmailVerificationHash { get; private set; }
    public string? ProviderSubject { get; private set; }
    public string? ProviderEmail { get; private set; }
    public bool ProviderEmailVerified { get; private set; }
    public string? ProposedEmail { get; private set; }
    public string? ProposedUsername { get; private set; }
    public string? ProposedFirstName { get; private set; }
    public string? ProposedLastName { get; private set; }
    public OAuthAttemptStatus Status { get; private set; }
    public Instant CreatedAt { get; private init; }
    public Instant ExpiresAt { get; private set; }
    public Instant? ConsumedAt { get; private set; }

    public static OAuthAttempt Create(
        string provider,
        OAuthAttemptPurpose purpose,
        Guid? userId,
        string stateHash,
        string correlationHash,
        Instant now)
    {
        if ((purpose == OAuthAttemptPurpose.Link) != userId.HasValue) throw new ArgumentException("Link attempt must be bound to a User.", nameof(userId));
        ValidateHash(stateHash, nameof(stateHash));
        ValidateHash(correlationHash, nameof(correlationHash));
        return new OAuthAttempt
        {
            Provider = ExternalIdentityProvider.Normalize(provider),
            Purpose = purpose,
            UserId = userId,
            StateHash = stateHash,
            CorrelationHash = correlationHash,
            Status = OAuthAttemptStatus.AwaitingCallback,
            CreatedAt = now,
            ExpiresAt = now + StateLifetime
        };
    }

    public bool CanAcceptCallback(string correlationHash, Instant now) =>
        Status == OAuthAttemptStatus.AwaitingCallback
        && now < ExpiresAt
        && FixedEquals(CorrelationHash, correlationHash);

    public void ClaimCallback(string correlationHash, Instant now)
    {
        if (!CanAcceptCallback(correlationHash, now)) throw new InvalidOperationException("OAuth callback is invalid or expired.");
        Status = OAuthAttemptStatus.CallbackClaimed;
        ExpiresAt = now + StateLifetime;
    }

    public void CaptureProfile(string subject, string? email, bool emailVerified)
    {
        if (Status != OAuthAttemptStatus.CallbackClaimed) throw new InvalidOperationException("OAuth callback was not claimed.");
        ProviderSubject = Require(subject, 255, nameof(subject));
        ProviderEmail = NormalizeEmail(email);
        ProviderEmailVerified = ProviderEmail is not null && emailVerified;
    }

    public void AwaitCompletion(string completionHash, Instant now)
    {
        RequireProfile();
        ValidateHash(completionHash, nameof(completionHash));
        CompletionHash = completionHash;
        Status = OAuthAttemptStatus.AwaitingCompletion;
        ExpiresAt = now + CompletionLifetime;
    }

    public bool CanComplete(string completionHash, Instant now) =>
        Status == OAuthAttemptStatus.AwaitingCompletion
        && CompletionHash is not null
        && now < ExpiresAt
        && FixedEquals(CompletionHash, completionHash);

    public void AwaitEmailVerification(
        string emailVerificationHash,
        string email,
        string username,
        string firstName,
        string lastName,
        Instant now)
    {
        if (Status != OAuthAttemptStatus.AwaitingCompletion) throw new InvalidOperationException("OAuth completion is not active.");
        ValidateHash(emailVerificationHash, nameof(emailVerificationHash));
        ProposedEmail = NormalizeEmail(email) ?? throw new ArgumentException("Email is required.", nameof(email));
        ProposedUsername = Require(username, 120, nameof(username));
        ProposedFirstName = Require(firstName, 100, nameof(firstName));
        ProposedLastName = Require(lastName, 100, nameof(lastName));
        CompletionHash = null;
        EmailVerificationHash = emailVerificationHash;
        Status = OAuthAttemptStatus.AwaitingEmailVerification;
        ExpiresAt = now + EmailVerificationLifetime;
    }

    public bool CanVerifyEmail(string emailVerificationHash, Instant now) =>
        Status == OAuthAttemptStatus.AwaitingEmailVerification
        && EmailVerificationHash is not null
        && now < ExpiresAt
        && FixedEquals(EmailVerificationHash, emailVerificationHash);

    public void Consume(Instant now)
    {
        if (Status == OAuthAttemptStatus.Consumed) throw new InvalidOperationException("OAuth attempt was already consumed.");
        Status = OAuthAttemptStatus.Consumed;
        CompletionHash = null;
        EmailVerificationHash = null;
        ConsumedAt = now;
        ExpiresAt = now;
    }

    private void RequireProfile()
    {
        if (string.IsNullOrWhiteSpace(ProviderSubject)) throw new InvalidOperationException("Provider profile is missing.");
    }

    private static void ValidateHash(string hash, string paramName)
    {
        if (hash.Length != 64 || !hash.All(Uri.IsHexDigit)) throw new ArgumentException("Value must be a SHA-256 hex hash.", paramName);
    }

    private static bool FixedEquals(string left, string right) => CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(left), Encoding.UTF8.GetBytes(right));

    private static string Require(string value, int maximumLength, string paramName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value, paramName);
        var normalized = value.Trim();
        return normalized.Length <= maximumLength ? normalized : throw new ArgumentOutOfRangeException(paramName);
    }

    private static string? NormalizeEmail(string? email)
    {
        if (string.IsNullOrWhiteSpace(email)) return null;
        var normalized = email.Trim();
        return normalized.Length <= 254 ? normalized : throw new ArgumentOutOfRangeException(nameof(email));
    }
}
