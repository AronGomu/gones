using System.Security.Cryptography;
using System.Text;
using Gones.Domain.Persistence;
using NodaTime;

namespace Gones.Domain.Identity;

public enum AccountActionPurpose
{
    VerifyEmail,
    ResetPassword,
    ChangeEmail
}

public sealed class AccountActionToken : VersionedEntity
{
    public static readonly Duration VerificationLifetime = Duration.FromHours(24);
    public static readonly Duration PasswordResetLifetime = Duration.FromHours(1);

    private AccountActionToken() { }

    public Guid UserId { get; private init; }
    public AccountActionPurpose Purpose { get; private init; }
    public string TokenHash { get; private init; } = string.Empty;
    public string SecurityStamp { get; private init; } = string.Empty;
    public string? TargetEmail { get; private init; }
    public string? NormalizedTargetEmail { get; private init; }
    public Instant CreatedAt { get; private init; }
    public Instant ExpiresAt { get; private init; }
    public Instant? ConsumedAt { get; private set; }
    public Instant? SupersededAt { get; private set; }

    public static AccountActionToken Create(
        Guid userId,
        AccountActionPurpose purpose,
        string tokenHash,
        string securityStamp,
        string? targetEmail,
        string? normalizedTargetEmail,
        Instant now)
    {
        if (userId == Guid.Empty) throw new ArgumentException("User ID cannot be empty.", nameof(userId));
        if (tokenHash.Length != 64) throw new ArgumentException("Token hash must be SHA-256 hex.", nameof(tokenHash));
        ArgumentException.ThrowIfNullOrWhiteSpace(securityStamp);
        if (purpose == AccountActionPurpose.ChangeEmail
            && (string.IsNullOrWhiteSpace(targetEmail) || string.IsNullOrWhiteSpace(normalizedTargetEmail)))
        {
            throw new ArgumentException("Email-change token requires target email.", nameof(targetEmail));
        }
        if (purpose != AccountActionPurpose.ChangeEmail && (targetEmail is not null || normalizedTargetEmail is not null))
        {
            throw new ArgumentException("Only email-change tokens may carry target email.", nameof(targetEmail));
        }

        return new AccountActionToken
        {
            UserId = userId,
            Purpose = purpose,
            TokenHash = tokenHash,
            SecurityStamp = securityStamp,
            TargetEmail = targetEmail,
            NormalizedTargetEmail = normalizedTargetEmail,
            CreatedAt = now,
            ExpiresAt = now + (purpose == AccountActionPurpose.ResetPassword ? PasswordResetLifetime : VerificationLifetime)
        };
    }

    public bool CanConsume(Instant now, string currentSecurityStamp) =>
        ConsumedAt is null
        && SupersededAt is null
        && now < ExpiresAt
        && CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(SecurityStamp),
            Encoding.UTF8.GetBytes(currentSecurityStamp));

    public void Consume(Instant now)
    {
        if (ConsumedAt is not null || SupersededAt is not null) throw new InvalidOperationException("Token is no longer active.");
        ConsumedAt = now;
    }

    public void Supersede(Instant now)
    {
        if (ConsumedAt is null && SupersededAt is null) SupersededAt = now;
    }
}

public sealed class UserEmailHistory : VersionedEntity
{
    private UserEmailHistory() { }

    public Guid UserId { get; private init; }
    public string? Email { get; private set; }
    public Instant RecordedAt { get; private init; }
    public Instant RetainUntil { get; private init; }
    public Instant? RedactedAt { get; private set; }

    public static UserEmailHistory Create(Guid userId, string email, Instant now)
    {
        if (userId == Guid.Empty) throw new ArgumentException("User ID cannot be empty.", nameof(userId));
        ArgumentException.ThrowIfNullOrWhiteSpace(email);
        return new UserEmailHistory
        {
            UserId = userId,
            Email = email.Trim(),
            RecordedAt = now,
            RetainUntil = now.InUtc().LocalDateTime.PlusYears(2).InUtc().ToInstant()
        };
    }

    public bool Redact(Instant now)
    {
        if (Email is null || now < RetainUntil) return false;
        Email = null;
        RedactedAt = now;
        return true;
    }
}
