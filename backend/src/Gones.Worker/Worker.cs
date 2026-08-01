using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Notifications;
using Gones.Infrastructure.Observability;

namespace Gones.Worker;

public sealed class Worker(
    IServiceScopeFactory scopeFactory,
    NotificationWorkerOptions options,
    OperationalMetrics metrics,
    ILogger<Worker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation(WorkerLogEvents.Started, "Event={Event}", "worker.started");
        var nextHeartbeat = DateTimeOffset.MinValue;
        var nextEmailHistoryRedaction = DateTimeOffset.MinValue;
        while (!stoppingToken.IsCancellationRequested)
        {
            var now = DateTimeOffset.UtcNow;
            var heartbeatDue = now >= nextHeartbeat;
            var processed = 0;
            try
            {
                using var scope = scopeFactory.CreateScope();
                if (heartbeatDue)
                {
                    await scope.ServiceProvider.GetRequiredService<WorkerHeartbeatStore>().RecordAsync(stoppingToken);
                    metrics.RecordWorkerHeartbeat();
                    logger.LogInformation(WorkerLogEvents.Heartbeat, "Gones Worker heartbeat; Event={Event}; HeartbeatAt={HeartbeatAt}", "worker.heartbeat", now);
                    nextHeartbeat = now.AddSeconds(15);
                }
                processed = await scope.ServiceProvider.GetRequiredService<NotificationProcessor>().ProcessBatchAsync(stoppingToken);
                if (now >= nextEmailHistoryRedaction)
                {
                    try
                    {
                        var redacted = await scope.ServiceProvider.GetRequiredService<UserEmailHistoryRedactor>().RedactBatchAsync(stoppingToken);
                        logger.LogInformation(WorkerLogEvents.EmailHistoryRedacted, "Event={Event}; Count={Count}", "identity.email_history.redacted", redacted);
                        nextEmailHistoryRedaction = redacted >= UserEmailHistoryRedactor.BatchSize ? now : now.AddHours(24);
                    }
                    catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                    {
                        throw;
                    }
                    catch (Exception exception)
                    {
                        logger.LogError(WorkerLogEvents.EmailHistoryRedactionFailed, "Event={Event}; ExceptionType={ExceptionType}", "identity.email_history.redaction_failed", exception.GetType().Name);
                        nextEmailHistoryRedaction = now.AddHours(1);
                    }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogError(WorkerLogEvents.PollFailed, "Event={Event} ExceptionType={ExceptionType}", "notification.poll.failed", exception.GetType().Name);
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

public static class WorkerLogEvents
{
    public static readonly EventId Started = new(7001, "WorkerStarted");
    public static readonly EventId Heartbeat = new(7002, "WorkerHeartbeat");
    public static readonly EventId PollFailed = new(7003, "WorkerPollFailed");
    public static readonly EventId EmailHistoryRedacted = new(7004, "EmailHistoryRedacted");
    public static readonly EventId EmailHistoryRedactionFailed = new(7005, "EmailHistoryRedactionFailed");
}
