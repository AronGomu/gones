using Gones.Domain.Notifications;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using NodaTime;

namespace Gones.Api.Health;

public sealed class NotificationDeliveryHealthCheck(GonesDbContext database, IClock clock) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        var deadLetters = await database.NotificationOutboxRecords.CountAsync(item => item.Status == NotificationOutboxStatus.DeadLetter, cancellationToken);
        var reconciliation = await database.NotificationOutboxRecords.CountAsync(item => item.Status == NotificationOutboxStatus.Reconciliation, cancellationToken);
        var staleReconciliation = await database.NotificationOutboxRecords.CountAsync(
            item => item.Status == NotificationOutboxStatus.Reconciliation && item.LastProviderEventAt < clock.GetCurrentInstant() - Duration.FromHours(24),
            cancellationToken);
        var data = new Dictionary<string, object>
        {
            ["deadLetterCount"] = deadLetters,
            ["reconciliationCount"] = reconciliation,
            ["staleReconciliationCount"] = staleReconciliation
        };
        return deadLetters > 0 || staleReconciliation > 0
            ? HealthCheckResult.Degraded("Notification delivery needs operator attention.", data: data)
            : HealthCheckResult.Healthy("Notification delivery is operational.", data);
    }
}
