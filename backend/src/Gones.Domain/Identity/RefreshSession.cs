using Gones.Domain.Persistence;
using NodaTime;

namespace Gones.Domain.Identity;

public enum RefreshSessionRevocationReason
{
    Logout,
    LogoutAll,
    SessionRevoked,
    Replay,
    Expired,
    SecurityStampChanged,
    PasswordReset,
    ExternalIdentityChanged
}

public sealed class RefreshSession : VersionedEntity
{
    public static readonly Duration IdleLifetime = Duration.FromDays(7);
    public static readonly Duration AbsoluteLifetime = Duration.FromDays(30);
    public const int MaximumDeviceLabelLength = 100;

    private RefreshSession() { }

    public Guid UserId { get; private init; }
    public string SecurityStamp { get; private init; } = string.Empty;
    public string DeviceLabel { get; private init; } = string.Empty;
    public Instant CreatedAt { get; private init; }
    public Instant LastUsedAt { get; private set; }
    public Instant IdleExpiresAt { get; private set; }
    public Instant AbsoluteExpiresAt { get; private init; }
    public Instant? RevokedAt { get; private set; }
    public RefreshSessionRevocationReason? RevocationReason { get; private set; }

    public static RefreshSession Create(Guid userId, string securityStamp, string deviceLabel, Instant now)
    {
        if (userId == Guid.Empty) throw new ArgumentException("User ID cannot be empty.", nameof(userId));
        ArgumentException.ThrowIfNullOrWhiteSpace(securityStamp);
        ArgumentException.ThrowIfNullOrWhiteSpace(deviceLabel);
        var normalizedLabel = deviceLabel.Trim();
        if (normalizedLabel.Length > MaximumDeviceLabelLength)
        {
            throw new ArgumentException($"Device label cannot exceed {MaximumDeviceLabelLength} characters.", nameof(deviceLabel));
        }

        return new RefreshSession
        {
            UserId = userId,
            SecurityStamp = securityStamp,
            DeviceLabel = normalizedLabel,
            CreatedAt = now,
            LastUsedAt = now,
            IdleExpiresAt = now + IdleLifetime,
            AbsoluteExpiresAt = now + AbsoluteLifetime
        };
    }

    public bool CanRefresh(Instant now, string currentSecurityStamp) =>
        RevokedAt is null
        && now < IdleExpiresAt
        && now < AbsoluteExpiresAt
        && CryptographicEquals(SecurityStamp, currentSecurityStamp);

    public void RecordRotation(Instant now)
    {
        if (RevokedAt is not null) throw new InvalidOperationException("Revoked session cannot rotate.");
        LastUsedAt = now;
        var idleExpiry = now + IdleLifetime;
        IdleExpiresAt = idleExpiry < AbsoluteExpiresAt ? idleExpiry : AbsoluteExpiresAt;
    }

    public void Revoke(Instant now, RefreshSessionRevocationReason reason)
    {
        if (RevokedAt is not null) return;
        RevokedAt = now;
        RevocationReason = reason;
    }

    private static bool CryptographicEquals(string left, string right)
    {
        var leftBytes = System.Text.Encoding.UTF8.GetBytes(left);
        var rightBytes = System.Text.Encoding.UTF8.GetBytes(right);
        return System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(leftBytes, rightBytes);
    }
}

public sealed class RefreshToken : VersionedEntity
{
    private RefreshToken() { }

    public Guid SessionId { get; private init; }
    public string TokenHash { get; private init; } = string.Empty;
    public Instant CreatedAt { get; private init; }
    public Instant? UsedAt { get; private set; }
    public Instant? RevokedAt { get; private set; }
    public Guid? ReplacedById { get; private set; }

    public static RefreshToken Create(Guid sessionId, string tokenHash, Instant now)
    {
        if (sessionId == Guid.Empty) throw new ArgumentException("Session ID cannot be empty.", nameof(sessionId));
        ArgumentException.ThrowIfNullOrWhiteSpace(tokenHash);
        return new RefreshToken { SessionId = sessionId, TokenHash = tokenHash, CreatedAt = now };
    }

    public bool IsActive => UsedAt is null && RevokedAt is null;

    public void MarkRotated(Guid replacementId, Instant now)
    {
        if (!IsActive) throw new InvalidOperationException("Refresh token has already been consumed.");
        if (replacementId == Guid.Empty) throw new ArgumentException("Replacement ID cannot be empty.", nameof(replacementId));
        UsedAt = now;
        RevokedAt = now;
        ReplacedById = replacementId;
    }

    public void Revoke(Instant now)
    {
        if (RevokedAt is null) RevokedAt = now;
    }
}
