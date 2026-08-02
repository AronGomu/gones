using NodaTime;

namespace Gones.Domain.Notifications;

public enum NotificationDeliveryStatus
{
    Sent,
    Delivered,
    Deferred,
    SoftBounce,
    HardBounce,
    Spam,
    Invalid,
    Blocked,
    Error
}

public sealed record NotificationDeliveryEventMapping(NotificationDeliveryStatus Status, bool IsPermanent);

public static class NotificationDeliveryPolicy
{
    public static NotificationDeliveryEventMapping MapProviderEvent(string providerEvent) => providerEvent switch
    {
        "sent" => new(NotificationDeliveryStatus.Sent, false),
        "delivered" => new(NotificationDeliveryStatus.Delivered, false),
        "deferred" => new(NotificationDeliveryStatus.Deferred, false),
        "soft_bounce" => new(NotificationDeliveryStatus.SoftBounce, false),
        "hard_bounce" => new(NotificationDeliveryStatus.HardBounce, true),
        "spam" => new(NotificationDeliveryStatus.Spam, true),
        "invalid" => new(NotificationDeliveryStatus.Invalid, true),
        "blocked" => new(NotificationDeliveryStatus.Blocked, true),
        "error" => new(NotificationDeliveryStatus.Error, false),
        _ => throw new ArgumentOutOfRangeException(nameof(providerEvent), "notification_delivery_event_unknown")
    };
}

public sealed class NotificationDeliveryEvent
{
    public const int MaximumReplayKeyLength = 200;
    public const int MaximumProviderMessageIdLength = 200;

    private NotificationDeliveryEvent() { }

    public Guid Id { get; private init; } = Guid.NewGuid();
    public string ReplayKey { get; private init; } = string.Empty;
    public Guid OutboxId { get; private init; }
    public string ProviderMessageId { get; private init; } = string.Empty;
    public NotificationDeliveryStatus Status { get; private init; }
    public Instant OccurredAt { get; private init; }
    public Instant ReceivedAt { get; private init; }

    public static NotificationDeliveryEvent Create(
        string replayKey,
        Guid outboxId,
        string providerMessageId,
        NotificationDeliveryStatus status,
        Instant occurredAt,
        Instant receivedAt)
    {
        if (outboxId == Guid.Empty) throw new ArgumentException("Outbox ID cannot be empty.", nameof(outboxId));
        return new NotificationDeliveryEvent
        {
            ReplayKey = RequireText(replayKey, MaximumReplayKeyLength, nameof(replayKey)),
            OutboxId = outboxId,
            ProviderMessageId = RequireText(providerMessageId, MaximumProviderMessageIdLength, nameof(providerMessageId)),
            Status = status,
            OccurredAt = occurredAt,
            ReceivedAt = receivedAt
        };
    }

    private static string RequireText(string value, int maximumLength, string parameterName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value, parameterName);
        var normalized = value.Trim();
        return normalized.Length <= maximumLength && !normalized.Any(char.IsControl)
            ? normalized
            : throw new ArgumentOutOfRangeException(parameterName);
    }
}
