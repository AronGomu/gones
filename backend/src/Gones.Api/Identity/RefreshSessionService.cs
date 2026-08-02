using System.Security.Cryptography;
using System.Text;
using Gones.Domain.Identity;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Observability;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.Api.Identity;

internal sealed class RefreshSessionService(
    GonesDbContext database,
    IClock clock,
    OperationalMetrics metrics,
    ILogger<RefreshSessionService> logger)
{
    private static readonly EventId ReplayEvent = new(2101, "RefreshTokenReplay");

    public async Task<IssuedRefreshSession> CreateAsync(ApplicationUser user, string deviceLabel, CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        var session = RefreshSession.Create(user.Id, RequiredSecurityStamp(user), deviceLabel, now);
        var issuedToken = CreateToken(session.Id, now);

        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        database.RefreshSessions.Add(session);
        database.RefreshTokens.Add(issuedToken.Record);
        database.AuditRecords.Add(NewAudit(user.Id, "auth.login.succeeded", "user", user.Id, "{\"outcome\":\"succeeded\"}", now));
        database.AuditRecords.Add(NewAudit(user.Id, "auth.session.created", "refresh_session", session.Id, "{\"outcome\":\"created\"}", now));
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new IssuedRefreshSession(session, issuedToken.Plaintext);
    }

    public async Task<RefreshAttempt> RotateAsync(string? plaintextToken, CancellationToken cancellationToken)
    {
        var tokenHash = HashToken(plaintextToken);
        if (tokenHash is null)
        {
            metrics.RecordAuthAbuse("invalid_refresh");
            return RefreshAttempt.Rejected;
        }

        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var token = await LockTokenAsync(tokenHash, cancellationToken);
        if (token is null)
        {
            metrics.RecordAuthAbuse("unknown_refresh");
            await transaction.CommitAsync(cancellationToken);
            return RefreshAttempt.Rejected;
        }

        var session = await LockSessionAsync(token.SessionId, cancellationToken);
        var user = await database.Users.SingleAsync(item => item.Id == session.UserId, cancellationToken);
        var now = clock.GetCurrentInstant();

        if (!token.IsActive)
        {
            session.Revoke(now, RefreshSessionRevocationReason.Replay);
            database.AuditRecords.Add(NewAudit(user.Id, "auth.session.replay", "refresh_session", session.Id, "{\"outcome\":\"family_revoked\"}", now));
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            metrics.RecordAuthAbuse("refresh_replay");
            logger.LogWarning(ReplayEvent, "Refresh token replay revoked session family {SessionId}", session.Id);
            return RefreshAttempt.Rejected;
        }

        var currentSecurityStamp = RequiredSecurityStamp(user);
        if (!session.CanRefresh(now, currentSecurityStamp))
        {
            var reason = session.RevocationReason
                ?? (!CryptographicEquals(session.SecurityStamp, currentSecurityStamp)
                    ? RefreshSessionRevocationReason.SecurityStampChanged
                    : RefreshSessionRevocationReason.Expired);
            session.Revoke(now, reason);
            token.Revoke(now);
            database.AuditRecords.Add(NewAudit(user.Id, "auth.session.revoked", "refresh_session", session.Id,
                $"{{\"reason\":\"{reason}\"}}", now));
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            metrics.RecordAuthRejection("refresh");
            return RefreshAttempt.Rejected;
        }

        var replacement = CreateToken(session.Id, now);
        token.MarkRotated(replacement.Record.Id, now);
        session.RecordRotation(now);
        database.RefreshTokens.Add(replacement.Record);
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        metrics.RecordAuthSuccess("refresh");
        return RefreshAttempt.Succeeded(user, session, replacement.Plaintext);
    }

    public async Task RevokeCurrentAsync(string? plaintextToken, CancellationToken cancellationToken)
    {
        var tokenHash = HashToken(plaintextToken);
        if (tokenHash is null) return;

        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var token = await LockTokenAsync(tokenHash, cancellationToken);
        if (token is not null)
        {
            var session = await LockSessionAsync(token.SessionId, cancellationToken);
            var now = clock.GetCurrentInstant();
            session.Revoke(now, RefreshSessionRevocationReason.Logout);
            token.Revoke(now);
            database.AuditRecords.Add(NewAudit(session.UserId, "auth.session.revoked", "refresh_session", session.Id,
                "{\"reason\":\"logout\"}", now));
            await database.SaveChangesAsync(cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task RevokeAllAsync(Guid userId, CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var sessions = await database.RefreshSessions
            .FromSqlInterpolated($"SELECT * FROM refresh_sessions WHERE user_id = {userId} AND revoked_at IS NULL FOR UPDATE")
            .ToListAsync(cancellationToken);
        var now = clock.GetCurrentInstant();
        foreach (var session in sessions) session.Revoke(now, RefreshSessionRevocationReason.LogoutAll);
        database.AuditRecords.Add(NewAudit(userId, "auth.sessions.revoked_all", "user", userId,
            $"{{\"count\":{sessions.Count}}}", now));
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task RevokeAllForPasswordResetAsync(Guid userId, CancellationToken cancellationToken)
    {
        if (database.Database.CurrentTransaction is null) throw new InvalidOperationException("Password reset revocation requires an existing transaction.");
        var sessions = await LockActiveSessionsAsync(userId, cancellationToken);
        var now = clock.GetCurrentInstant();
        foreach (var session in sessions) session.Revoke(now, RefreshSessionRevocationReason.PasswordReset);
    }

    public async Task RevokeAllForIdentityChangeAsync(Guid userId, CancellationToken cancellationToken)
    {
        if (database.Database.CurrentTransaction is null) throw new InvalidOperationException("External identity revocation requires an existing transaction.");
        var active = await LockActiveSessionsAsync(userId, cancellationToken);
        var now = clock.GetCurrentInstant();
        foreach (var session in active) session.Revoke(now, RefreshSessionRevocationReason.ExternalIdentityChanged);
    }

    public async Task RevokeAllForRoleChangeAsync(Guid userId, CancellationToken cancellationToken)
    {
        if (database.Database.CurrentTransaction is null) throw new InvalidOperationException("Role change revocation requires an existing transaction.");
        var active = await LockActiveSessionsAsync(userId, cancellationToken);
        var now = clock.GetCurrentInstant();
        foreach (var session in active) session.Revoke(now, RefreshSessionRevocationReason.RoleChanged);
        database.AuditRecords.Add(NewAudit(userId, "auth.sessions.revoked_role_change", "user", userId,
            $"{{\"count\":{active.Count}}}", now));
    }

    public async Task RevokeAllForAccountClosureAsync(Guid userId, CancellationToken cancellationToken)
    {
        if (database.Database.CurrentTransaction is null) throw new InvalidOperationException("Account closure revocation requires an existing transaction.");
        var active = await LockActiveSessionsAsync(userId, cancellationToken);
        var now = clock.GetCurrentInstant();
        foreach (var session in active) session.Revoke(now, RefreshSessionRevocationReason.AccountClosed);
        database.AuditRecords.Add(NewAudit(userId, "auth.sessions.revoked_account_closed", "user", userId,
            $"{{\"count\":{active.Count}}}", now));
    }

    public async Task<IReadOnlyList<RefreshSession>> ListAsync(Guid userId, string securityStamp, CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        return await database.RefreshSessions.AsNoTracking()
            .Where(item => item.UserId == userId
                && item.RevokedAt == null
                && item.SecurityStamp == securityStamp
                && item.IdleExpiresAt > now
                && item.AbsoluteExpiresAt > now)
            .OrderByDescending(item => item.LastUsedAt)
            .ToListAsync(cancellationToken);
    }

    public async Task<bool> RevokeAsync(Guid userId, Guid sessionId, CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var session = await database.RefreshSessions
            .FromSqlInterpolated($"SELECT * FROM refresh_sessions WHERE id = {sessionId} AND user_id = {userId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);
        if (session is null)
        {
            await transaction.CommitAsync(cancellationToken);
            return false;
        }
        if (session.RevokedAt is null)
        {
            var now = clock.GetCurrentInstant();
            session.Revoke(now, RefreshSessionRevocationReason.SessionRevoked);
            database.AuditRecords.Add(NewAudit(userId, "auth.session.revoked", "refresh_session", session.Id,
                "{\"reason\":\"user_request\"}", now));
            await database.SaveChangesAsync(cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    private Task<List<RefreshSession>> LockActiveSessionsAsync(Guid userId, CancellationToken cancellationToken) =>
        database.RefreshSessions
            .FromSqlInterpolated($"SELECT * FROM refresh_sessions WHERE user_id = {userId} AND revoked_at IS NULL FOR UPDATE")
            .ToListAsync(cancellationToken);

    private Task<RefreshToken?> LockTokenAsync(string tokenHash, CancellationToken cancellationToken) =>
        database.RefreshTokens
            .FromSqlInterpolated($"SELECT * FROM refresh_tokens WHERE token_hash = {tokenHash} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);

    private Task<RefreshSession> LockSessionAsync(Guid sessionId, CancellationToken cancellationToken) =>
        database.RefreshSessions
            .FromSqlInterpolated($"SELECT * FROM refresh_sessions WHERE id = {sessionId} FOR UPDATE")
            .SingleAsync(cancellationToken);

    private static (RefreshToken Record, string Plaintext) CreateToken(Guid sessionId, Instant now)
    {
        var plaintext = Microsoft.AspNetCore.WebUtilities.WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        return (RefreshToken.Create(sessionId, HashToken(plaintext)!, now), plaintext);
    }

    private static string? HashToken(string? plaintext)
    {
        if (string.IsNullOrWhiteSpace(plaintext) || plaintext.Length > 256) return null;
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(plaintext)));
    }

    private static string RequiredSecurityStamp(ApplicationUser user) =>
        string.IsNullOrWhiteSpace(user.SecurityStamp)
            ? throw new InvalidOperationException("Identity user security stamp is required.")
            : user.SecurityStamp;

    private static bool CryptographicEquals(string left, string right) =>
        CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(left), Encoding.UTF8.GetBytes(right));

    private static AuditRecord NewAudit(Guid actorId, string action, string entityType, Guid entityId, string diff, Instant now) => new()
    {
        ActorId = actorId,
        Action = action,
        EntityType = entityType,
        EntityId = entityId.ToString("D"),
        RedactedDiff = diff,
        OccurredAt = now
    };
}

internal sealed record IssuedRefreshSession(RefreshSession Session, string PlaintextToken);

internal sealed record RefreshAttempt(bool IsSuccess, ApplicationUser? User, RefreshSession? Session, string? PlaintextToken)
{
    public static RefreshAttempt Rejected { get; } = new(false, null, null, null);
    public static RefreshAttempt Succeeded(ApplicationUser user, RefreshSession session, string plaintextToken) =>
        new(true, user, session, plaintextToken);
}

internal static class RefreshCookie
{
    public const string Name = "gones_refresh";
    public const string Path = "/api/auth";
    public static void Issue(HttpResponse response, string plaintextToken, Instant absoluteExpiry, Instant now)
    {
        response.Cookies.Append(Name, plaintextToken, Options(absoluteExpiry, now));
    }

    public static void Clear(HttpResponse response)
    {
        response.Cookies.Delete(Name, Options(null, null));
    }

    private static CookieOptions Options(Instant? absoluteExpiry, Instant? now) => new()
    {
        Secure = true,
        HttpOnly = true,
        SameSite = SameSiteMode.Lax,
        Path = Path,
        IsEssential = true,
        Expires = absoluteExpiry?.ToDateTimeOffset(),
        MaxAge = absoluteExpiry is not null && now is not null ? (absoluteExpiry.Value - now.Value).ToTimeSpan() : null
        // Domain intentionally omitted: cookie remains host-only.
    };
}
