using Gones.Infrastructure.Calendar;
using Gones.Infrastructure.EventProviders;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Notifications;
using Gones.Infrastructure.Observability;
using Gones.Infrastructure.Persistence;
using Gones.Infrastructure.Workers;
using NodaTime;

namespace Gones.Worker;

public sealed class Worker(
    IServiceScopeFactory scopeFactory,
    NotificationWorkerOptions options,
    TournamentSchedulerOptions schedulerOptions,
    IClock clock,
    OperationalMetrics metrics,
    WorkerWakeSignal wake,
    IServiceProvider services,
    ILogger<Worker> logger) : BackgroundService
{
    public static void AddRuntimeServices(IServiceCollection services, IConfiguration configuration)
    {
        services.AddNotificationWorker(configuration);
        services.AddTournamentScheduler(configuration);
        services.AddScoped<WorkerHeartbeatStore>();
        services.AddScoped<EventImageCleanupService>();
        services.AddScoped<UserEmailHistoryRedactor>();
        services.AddScoped<IdempotencyRecordSweeper>();
        services.AddWorkerWakeReceiver(configuration);
        if (WorkerIdleOptions.TryLoad(configuration) is { } idle)
        {
            if (!OperatingSystem.IsLinux()) throw new InvalidOperationException("Worker idle health requires Linux.");
            services.AddSingleton(idle);
            services.AddSingleton<WorkerRuntimeFile>();
            services.AddScoped<WorkerDueQuery>();
            services.AddSingleton<WorkerDueDispatcher>();
        }
        services.AddHostedService<Worker>();
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation(WorkerLogEvents.Started, "Event={Event}", "worker.started");
        if (services.GetService<WorkerDueDispatcher>() is { } dispatcher)
        {
            await dispatcher.RunAsync(stoppingToken);
            return;
        }
        var nextHeartbeat = Instant.MinValue;
        var nextEmailHistoryRedaction = Instant.MinValue;
        var nextDeliveryMetadataCleanup = Instant.MinValue;
        var nextIdempotencySweep = Instant.MinValue;
        var nextEventImageCleanup = Instant.MinValue;
        var nextDailyPlan = Instant.MinValue;
        while (!stoppingToken.IsCancellationRequested)
        {
            var now = clock.GetCurrentInstant();
            var heartbeatDue = now >= nextHeartbeat;
            var processed = 0;
            var failed = false;
            try
            {
                using var scope = scopeFactory.CreateScope();
                if (heartbeatDue)
                {
                    await scope.ServiceProvider.GetRequiredService<WorkerHeartbeatStore>().RecordAsync(stoppingToken);
                    metrics.RecordWorkerHeartbeat();
                    logger.LogInformation(WorkerLogEvents.Heartbeat, "Gones Worker heartbeat; Event={Event}; HeartbeatAt={HeartbeatAt}", "worker.heartbeat", now.ToDateTimeOffset());
                    nextHeartbeat = now + Duration.FromSeconds(15);
                }

                try
                {
                    var reconciler = scope.ServiceProvider.GetRequiredService<TournamentScheduleReconciler>();
                    if (now >= nextDailyPlan)
                    {
                        if (await reconciler.RefreshDailyAsync(stoppingToken)) nextDailyPlan = now + schedulerOptions.DailyRefreshInterval;
                    }
                    else
                    {
                        await reconciler.RefreshPendingChangesAsync(stoppingToken);
                    }

                    processed += await scope.ServiceProvider.GetRequiredService<TournamentReminderDispatcher>().DispatchDueAsync(stoppingToken);
                    processed += await scope.ServiceProvider.GetRequiredService<TournamentLifecyclePoller>().AdvanceAsync(stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception exception)
                {
                    failed = true;
                    logger.LogError(WorkerLogEvents.SchedulerFailed, "Event={Event} ExceptionType={ExceptionType}", "scheduler.poll.failed", exception.GetType().Name);
                }

                processed += await scope.ServiceProvider.GetRequiredService<NotificationProcessor>().ProcessBatchAsync(stoppingToken);
                if (now >= nextDeliveryMetadataCleanup)
                {
                    try
                    {
                        var cleaned = await scope.ServiceProvider.GetRequiredService<NotificationDeliveryMetadataCleaner>().CleanBatchAsync(stoppingToken);
                        logger.LogInformation(WorkerLogEvents.DeliveryMetadataCleaned, "Event={Event}; Count={Count}", "notification.delivery_metadata.cleaned", cleaned);
                        nextDeliveryMetadataCleanup = cleaned >= NotificationDeliveryMetadataCleaner.BatchSize ? now : now + Duration.FromHours(24);
                    }
                    catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                    {
                        throw;
                    }
                    catch (Exception exception)
                    {
                        logger.LogError(WorkerLogEvents.DeliveryMetadataCleanupFailed, "Event={Event}; ExceptionType={ExceptionType}", "notification.delivery_metadata.cleanup_failed", exception.GetType().Name);
                        nextDeliveryMetadataCleanup = now + Duration.FromHours(1);
                    }
                }
                if (now >= nextEmailHistoryRedaction)
                {
                    try
                    {
                        var redacted = await scope.ServiceProvider.GetRequiredService<UserEmailHistoryRedactor>().RedactBatchAsync(stoppingToken);
                        logger.LogInformation(WorkerLogEvents.EmailHistoryRedacted, "Event={Event}; Count={Count}", "identity.email_history.redacted", redacted);
                        nextEmailHistoryRedaction = redacted >= UserEmailHistoryRedactor.BatchSize ? now : now + Duration.FromHours(24);
                    }
                    catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                    {
                        throw;
                    }
                    catch (Exception exception)
                    {
                        logger.LogError(WorkerLogEvents.EmailHistoryRedactionFailed, "Event={Event}; ExceptionType={ExceptionType}", "identity.email_history.redaction_failed", exception.GetType().Name);
                        nextEmailHistoryRedaction = now + Duration.FromHours(1);
                    }
                }
                if (now >= nextIdempotencySweep)
                {
                    try
                    {
                        var swept = await scope.ServiceProvider.GetRequiredService<IdempotencyRecordSweeper>().SweepBatchAsync(stoppingToken);
                        logger.LogInformation(WorkerLogEvents.IdempotencyRecordsSwept, "Event={Event}; Count={Count}", "idempotency.records.swept", swept);
                        nextIdempotencySweep = swept >= IdempotencyRecordSweeper.BatchSize ? now : now + Duration.FromHours(24);
                    }
                    catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                    {
                        throw;
                    }
                    catch (Exception exception)
                    {
                        logger.LogError(WorkerLogEvents.IdempotencySweepFailed, "Event={Event}; ExceptionType={ExceptionType}", "idempotency.sweep_failed", exception.GetType().Name);
                        nextIdempotencySweep = now + Duration.FromHours(1);
                    }
                }
                if (now >= nextEventImageCleanup)
                {
                    try
                    {
                        var swept = await scope.ServiceProvider.GetRequiredService<EventImageCleanupService>().SweepExpiredAsync(stoppingToken);
                        logger.LogInformation(WorkerLogEvents.EventImagesSwept, "Event={Event}; Count={Count}", "event_image.expired.swept", swept);
                        nextEventImageCleanup = swept >= EventImageCleanupService.BatchSize ? now : now + Duration.FromMinutes(15);
                    }
                    catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                    {
                        throw;
                    }
                    catch (Exception exception)
                    {
                        logger.LogError(WorkerLogEvents.EventImageSweepFailed, "Event={Event}; ExceptionType={ExceptionType}", "event_image.cleanup_failed", exception.GetType().Name);
                        nextEventImageCleanup = now + Duration.FromMinutes(15);
                    }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                failed = true;
                logger.LogError(WorkerLogEvents.PollFailed, "Event={Event} ExceptionType={ExceptionType}", "worker.poll.failed", exception.GetType().Name);
            }

            if (!failed && processed >= options.BatchSize) continue;
            try
            {
                if (failed) await Task.Delay(options.PollInterval.ToTimeSpan(), stoppingToken);
                else await wake.WaitAsync(options.PollInterval.ToTimeSpan(), stoppingToken, TimeSpan.FromSeconds(1));
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
    public static readonly EventId SchedulerFailed = new(7006, "SchedulerFailed");
    public static readonly EventId DeliveryMetadataCleaned = new(7007, "DeliveryMetadataCleaned");
    public static readonly EventId DeliveryMetadataCleanupFailed = new(7008, "DeliveryMetadataCleanupFailed");
    public static readonly EventId IdempotencyRecordsSwept = new(7009, "IdempotencyRecordsSwept");
    public static readonly EventId IdempotencySweepFailed = new(7010, "IdempotencySweepFailed");
    public static readonly EventId EventImagesSwept = new(7011, "EventImagesSwept");
    public static readonly EventId EventImageSweepFailed = new(7012, "EventImageSweepFailed");
}
