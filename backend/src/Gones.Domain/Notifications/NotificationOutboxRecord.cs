using NodaTime;

namespace Gones.Domain.Notifications;

public enum NotificationOutboxStatus
{
    Pending,
    Sending,
    Sent,
    Reconciliation,
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
        Instant createdAt,
        string? traceParent = null,
        string? correlationId = null)
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
        TraceParent = traceParent;
        CorrelationId = correlationId;
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
    public Instant? ProviderFirstAttemptAt { get; private set; }
    public string? ProviderMessageId { get; private set; }
    public NotificationDeliveryStatus? DeliveryStatus { get; private set; }
    public Instant? LastProviderEventAt { get; private set; }
    public Instant? DeliveryMetadataScrubbedAt { get; private set; }
    public string? TraceParent { get; private init; }
    public string? CorrelationId { get; private init; }

    public string ProviderCorrelationId => Id.ToString("N");
    public bool RecoveredFromExpiredLease { get; private set; }

    public bool CanClaim(Instant now) =>
        Status == NotificationOutboxStatus.Pending && AvailableAt <= now
        || Status == NotificationOutboxStatus.Sending && LeaseExpiresAt <= now;

    public Guid Claim(Instant now, Duration leaseDuration)
    {
        if (leaseDuration <= Duration.Zero) throw new ArgumentOutOfRangeException(nameof(leaseDuration));
        if (!CanClaim(now)) throw new InvalidOperationException("notification_not_claimable");

        var leaseToken = Guid.NewGuid();
        RecoveredFromExpiredLease = Status == NotificationOutboxStatus.Sending;
        Status = NotificationOutboxStatus.Sending;
        LeaseToken = leaseToken;
        LeaseExpiresAt = now + leaseDuration;
        LastAttemptAt = now;
        ProviderFirstAttemptAt ??= now;
        AttemptCount++;
        return leaseToken;
    }

    public void MarkSent(Guid leaseToken, Instant now, string? providerMessageId = null)
    {
        EnsureLease(leaseToken);
        Status = NotificationOutboxStatus.Sent;
        SentAt = now;
        ProviderMessageId = ValidateProviderMessageId(providerMessageId);
        DeliveryStatus = NotificationDeliveryStatus.Sent;
        LastProviderEventAt = now;
        LastErrorCode = null;
        ClearLease();
        Scrub(now);
    }

    public bool IsBeyondProviderIdempotencyWindow(Instant now, Duration window) =>
        ProviderFirstAttemptAt is not null && now - ProviderFirstAttemptAt.Value >= window;

    public void MarkReconciliation(Guid leaseToken, Instant now, string errorCode)
    {
        EnsureLease(leaseToken);
        Status = NotificationOutboxStatus.Reconciliation;
        LastErrorCode = NotificationErrorCode.Require(errorCode);
        LastProviderEventAt = now;
        ClearLease();
    }

    public void ApplyDeliveryEvent(string providerMessageId, NotificationDeliveryStatus deliveryStatus, Instant occurredAt, Instant receivedAt)
    {
        ProviderMessageId = ValidateProviderMessageId(providerMessageId);
        DeliveryStatus = deliveryStatus;
        LastProviderEventAt = occurredAt > receivedAt ? receivedAt : occurredAt;
        if (Status is NotificationOutboxStatus.Sending or NotificationOutboxStatus.Reconciliation)
        {
            Status = NotificationOutboxStatus.Sent;
            SentAt ??= receivedAt;
            LastErrorCode = null;
            ClearLease();
            Scrub(receivedAt);
        }
    }

    public NotificationOutboxRecord CreateOperatorRetry(Instant now)
    {
        if (Status != NotificationOutboxStatus.Reconciliation || Recipient is null || TemplateModelJson is null)
        {
            throw new InvalidOperationException("notification_retry_not_allowed");
        }

        var retry = new NotificationOutboxRecord(
            $"operator-retry:{Id:N}:{Guid.NewGuid():N}",
            TemplateKey,
            Locale,
            Recipient,
            TemplateModelJson,
            UserId,
            TournamentId,
            now,
            TraceParent,
            CorrelationId);
        Status = NotificationOutboxStatus.DeadLetter;
        DeadLetteredAt = now;
        LastErrorCode = "operator_retry_created";
        Scrub(now);
        return retry;
    }

    public void ExpireReconciliation(Instant now)
    {
        if (Status != NotificationOutboxStatus.Reconciliation) return;
        Status = NotificationOutboxStatus.DeadLetter;
        DeadLetteredAt = now;
        LastErrorCode = "reconciliation_expired";
        Scrub(now);
    }

    public void ScrubDeliveryMetadata(Instant now)
    {
        ProviderFirstAttemptAt = null;
        ProviderMessageId = null;
        DeliveryStatus = null;
        LastProviderEventAt = null;
        DeliveryMetadataScrubbedAt = now;
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

    private static string? ValidateProviderMessageId(string? providerMessageId)
    {
        if (providerMessageId is null) return null;
        var normalized = providerMessageId.Trim();
        return normalized.Length is > 0 and <= NotificationDeliveryEvent.MaximumProviderMessageIdLength && !normalized.Any(char.IsControl)
            ? normalized
            : throw new ArgumentOutOfRangeException(nameof(providerMessageId));
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
