using Gones.Infrastructure.Workers;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using NodaTime;

namespace Gones.Api.Health;

public sealed class WorkerRuntimeHealthCheck(WorkerRuntimeFile snapshot, IClock clock) : IHealthCheck
{
    public Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        if (!OperatingSystem.IsLinux()) return Task.FromResult(HealthCheckResult.Unhealthy("Worker idle health requires Linux."));
        return Task.FromResult(snapshot.Check(clock.GetCurrentInstant()) switch
        {
            WorkerRuntimeHealth.Healthy => HealthCheckResult.Healthy(),
            WorkerRuntimeHealth.Degraded => HealthCheckResult.Degraded("Worker work is in retry backoff."),
            _ => HealthCheckResult.Unhealthy("Worker snapshot is unavailable or stalled.")
        });
    }
}
