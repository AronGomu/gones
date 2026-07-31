using System.Text.Json;
using Gones.Domain.Notifications;
using Gones.Infrastructure.Notifications;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using NodaTime;

namespace Gones.Api.Health;

public sealed class NotificationOutboxHealthCheck(
    GonesDbContext database,
    IClock clock,
    NotificationHealthOptions options) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        var active = database.NotificationOutboxRecords.Where(item =>
            item.Status == NotificationOutboxStatus.Pending || item.Status == NotificationOutboxStatus.Sending);
        var backlogCount = await active.LongCountAsync(cancellationToken);
        var oldest = await active.Select(item => (Instant?)item.CreatedAt).MinAsync(cancellationToken);
        var deadLetterCount = await database.NotificationOutboxRecords.LongCountAsync(item => item.Status == NotificationOutboxStatus.DeadLetter, cancellationToken);
        var lag = oldest is null ? Duration.Zero : clock.GetCurrentInstant() - oldest.Value;
        var data = new Dictionary<string, object>
        {
            ["backlogCount"] = backlogCount,
            ["oldestLagSeconds"] = Math.Max(0, lag.TotalSeconds),
            ["deadLetterCount"] = deadLetterCount
        };

        return lag > options.DegradedAfter || deadLetterCount > 0
            ? HealthCheckResult.Degraded("Notification delivery is delayed or dead-lettered.", data: data)
            : HealthCheckResult.Healthy("Notification outbox is current.", data);
    }
}

public static class ReadinessResponseWriter
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public static Task WriteAsync(HttpContext context, HealthReport report)
    {
        context.Response.ContentType = "application/json";
        var checks = report.Entries.ToDictionary(
            entry => entry.Key,
            entry => new ReadinessCheck(entry.Value.Status.ToString(), entry.Value.Data),
            StringComparer.Ordinal);
        return context.Response.WriteAsync(JsonSerializer.Serialize(new ReadinessResponse(report.Status.ToString(), checks), JsonOptions));
    }

    private sealed record ReadinessResponse(string Status, IReadOnlyDictionary<string, ReadinessCheck> Checks);
    private sealed record ReadinessCheck(string Status, IReadOnlyDictionary<string, object> Data);
}
