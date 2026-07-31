using Gones.Infrastructure.Notifications;

namespace Gones.Worker;

public sealed class Worker(
    IServiceScopeFactory scopeFactory,
    NotificationWorkerOptions options,
    ILogger<Worker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("Gones Worker started");
        var nextHeartbeat = DateTimeOffset.MinValue;
        while (!stoppingToken.IsCancellationRequested)
        {
            var now = DateTimeOffset.UtcNow;
            if (now >= nextHeartbeat)
            {
                logger.LogInformation("Gones Worker heartbeat at {HeartbeatAt}", now);
                nextHeartbeat = now.AddSeconds(15);
            }

            var processed = 0;
            try
            {
                using var scope = scopeFactory.CreateScope();
                processed = await scope.ServiceProvider.GetRequiredService<NotificationProcessor>().ProcessBatchAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "Event={Event} ExceptionType={ExceptionType}", "notification.poll.failed", exception.GetType().Name);
            }

            if (processed >= options.BatchSize) continue;
            try
            {
                await Task.Delay(options.PollInterval.ToTimeSpan(), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }
}
