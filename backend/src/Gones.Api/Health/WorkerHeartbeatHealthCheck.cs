using Gones.Domain.Persistence;
using Gones.Infrastructure.Observability;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using NodaTime;

namespace Gones.Api.Health;

public sealed record WorkerHealthOptions(Duration DegradedAfter)
{
    public static WorkerHealthOptions Load(IConfiguration configuration)
    {
        var raw = configuration["GONES_WORKER_HEARTBEAT_DEGRADED_SECONDS"];
        var seconds = string.IsNullOrWhiteSpace(raw)
            ? 45
            : int.TryParse(raw, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var parsed)
                ? parsed
                : throw new InvalidOperationException("GONES_WORKER_HEARTBEAT_DEGRADED_SECONDS must be an integer.");
        if (seconds < 1) throw new InvalidOperationException("Worker heartbeat threshold must be positive.");
        return new WorkerHealthOptions(Duration.FromSeconds(seconds));
    }
}

public sealed class WorkerHeartbeatHealthCheck(
    GonesDbContext database,
    IClock clock,
    WorkerHealthOptions options,
    OperationalMetrics? metrics = null) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        var lastSeen = await database.WorkerHeartbeats.AsNoTracking()
            .Where(item => item.WorkerId == WorkerHeartbeatRecord.NotificationWorkerId)
            .Select(item => (Instant?)item.LastSeenAt)
            .SingleOrDefaultAsync(cancellationToken);
        if (lastSeen is null)
        {
            metrics?.RecordWorkerHeartbeatAge(options.DegradedAfter.TotalSeconds + 1);
            return HealthCheckResult.Degraded("Worker heartbeat has not been observed.", data: new Dictionary<string, object> { ["observed"] = false });
        }

        var age = clock.GetCurrentInstant() - lastSeen.Value;
        var ageSeconds = Math.Max(0, age.TotalSeconds);
        metrics?.RecordWorkerHeartbeatAge(ageSeconds);
        var data = new Dictionary<string, object> { ["observed"] = true, ["ageSeconds"] = ageSeconds };
        return age > options.DegradedAfter
            ? HealthCheckResult.Degraded("Worker heartbeat is stale.", data: data)
            : HealthCheckResult.Healthy("Worker heartbeat is current.", data);
    }
}
