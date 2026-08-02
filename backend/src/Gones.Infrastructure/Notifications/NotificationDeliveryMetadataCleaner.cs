using Gones.Domain.Notifications;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.Infrastructure.Notifications;

public sealed class NotificationDeliveryMetadataCleaner(
    GonesDbContext database,
    IClock clock,
    NotificationMetrics metrics)
{
    public const int BatchSize = 500;
    public static readonly Duration Retention = Duration.FromDays(365);

    public async Task<int> CleanBatchAsync(CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        var cutoff = now - Retention;
        var events = await database.NotificationDeliveryEvents
            .Where(item => item.ReceivedAt < cutoff)
            .OrderBy(item => item.ReceivedAt)
            .Take(BatchSize)
            .ToListAsync(cancellationToken);
        foreach (var group in events.GroupBy(item => item.Status)) metrics.RecordMetadataCleaned(group.Key, group.Count());
        if (events.Count > 0) database.NotificationDeliveryEvents.RemoveRange(events);

        var outbox = await database.NotificationOutboxRecords
            .Where(item => item.LastProviderEventAt < cutoff && item.DeliveryMetadataScrubbedAt == null)
            .OrderBy(item => item.LastProviderEventAt)
            .Take(BatchSize)
            .ToListAsync(cancellationToken);
        foreach (var record in outbox)
        {
            record.ExpireReconciliation(now);
            record.ScrubDeliveryMetadata(now);
        }

        if (events.Count > 0 || outbox.Count > 0) await database.SaveChangesAsync(cancellationToken);
        return events.Count + outbox.Count;
    }
}
