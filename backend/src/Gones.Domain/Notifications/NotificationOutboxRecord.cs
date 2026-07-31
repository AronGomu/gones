using NodaTime;

namespace Gones.Domain.Notifications;

public enum NotificationOutboxStatus
{
    Pending,
    Sending,
    Sent,
    DeadLetter
}

public sealed class NotificationOutboxRecord : Persistence.VersionedEntity
{
    private NotificationOutboxRecord() { }

    public NotificationOutboxRecord(
        string dedupeKey,
        string templateKey,
        string locale,
        string recipient,
        string templateModelJson,
        Guid? userId,
        Guid? tournamentId,
        Instant createdAt)
    {
        DedupeKey = dedupeKey;
        TemplateKey = templateKey;
        Locale = locale;
        Recipient = recipient;
        TemplateModelJson = templateModelJson;
        UserId = userId;
        TournamentId = tournamentId;
        CreatedAt = createdAt;
        AvailableAt = createdAt;
        Status = NotificationOutboxStatus.Pending;
    }

    public string DedupeKey { get; private init; } = string.Empty;
    public string TemplateKey { get; private init; } = string.Empty;
    public string Locale { get; private init; } = string.Empty;
    public string? Recipient { get; private set; }
    public string? TemplateModelJson { get; private set; }
    public Guid? UserId { get; private init; }
    public Guid? TournamentId { get; private init; }
    public NotificationOutboxStatus Status { get; private set; }
    public Instant CreatedAt { get; private init; }
    public Instant AvailableAt { get; private set; }
    public Guid? LeaseToken { get; private set; }
    public Instant? LeaseExpiresAt { get; private set; }
    public Instant? LastAttemptAt { get; private set; }
    public int AttemptCount { get; private set; }
    public string? LastErrorCode { get; private set; }
    public Instant? SentAt { get; private set; }
    public Instant? DeadLetteredAt { get; private set; }
    public Instant? ScrubbedAt { get; private set; }

    public bool CanClaim(Instant now) =>
        Status == NotificationOutboxStatus.Pending && AvailableAt <= now
        || Status == NotificationOutboxStatus.Sending && LeaseExpiresAt <= now;

    public Guid Claim(Instant now, Duration leaseDuration)
    {
        if (leaseDuration <= Duration.Zero) throw new ArgumentOutOfRangeException(nameof(leaseDuration));
        if (!CanClaim(now)) throw new InvalidOperationException("notification_not_claimable");

        var leaseToken = Guid.NewGuid();
        Status = NotificationOutboxStatus.Sending;
        LeaseToken = leaseToken;
        LeaseExpiresAt = now + leaseDuration;
        LastAttemptAt = now;
        AttemptCount++;
        return leaseToken;
    }

    public void MarkSent(Guid leaseToken, Instant now)
    {
        EnsureLease(leaseToken);
        Status = NotificationOutboxStatus.Sent;
        SentAt = now;
        LastErrorCode = null;
        ClearLease();
        Scrub(now);
    }

    public void MarkRetry(Guid leaseToken, Instant availableAt, string errorCode)
    {
        EnsureLease(leaseToken);
        Status = NotificationOutboxStatus.Pending;
        AvailableAt = availableAt;
        LastErrorCode = NotificationErrorCode.Require(errorCode);
        ClearLease();
    }

    public void MarkDeadLetter(Guid leaseToken, Instant now, string errorCode)
    {
        EnsureLease(leaseToken);
        Status = NotificationOutboxStatus.DeadLetter;
        DeadLetteredAt = now;
        LastErrorCode = NotificationErrorCode.Require(errorCode);
        ClearLease();
        Scrub(now);
    }

    private void EnsureLease(Guid leaseToken)
    {
        if (Status != NotificationOutboxStatus.Sending || LeaseToken != leaseToken)
        {
            throw new InvalidOperationException("notification_lease_lost");
        }
    }

    private void ClearLease()
    {
        LeaseToken = null;
        LeaseExpiresAt = null;
    }

    private void Scrub(Instant now)
    {
        Recipient = null;
        TemplateModelJson = null;
        ScrubbedAt = now;
    }

}

public static class NotificationErrorCode
{
    public static string Require(string errorCode)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(errorCode);
        return errorCode.Length <= 100 && errorCode.All(character => character is >= 'a' and <= 'z' or >= '0' and <= '9' or '_' or '-' or '.')
            ? errorCode
            : throw new ArgumentOutOfRangeException(nameof(errorCode));
    }
}
