using System.Diagnostics;
using Gones.Application.Notifications;
using Gones.Infrastructure.Observability;
using Microsoft.Extensions.Logging;
using NodaTime;

namespace Gones.Infrastructure.Notifications;

public sealed class NotificationProcessor(
    NotificationOutboxStore store,
    NotificationTemplateRenderer renderer,
    IEmailTransport transport,
    INotificationRetryPolicy retryPolicy,
    NotificationMetrics metrics,
    NotificationWorkerOptions options,
    IClock clock,
    ILogger<NotificationProcessor> logger)
{
    public async Task<int> ProcessBatchAsync(CancellationToken cancellationToken)
    {
        using var pollActivity = GonesTelemetry.Activities.StartActivity("notification.poll", ActivityKind.Internal);
        var records = await store.ClaimAsync(options.BatchSize, options.LeaseDuration, cancellationToken);
        if (records.Count == 0) return 0;
        metrics.RecordClaimed(records.Count);

        foreach (var record in records)
        {
            if (cancellationToken.IsCancellationRequested) break;
            var leaseToken = record.LeaseToken ?? throw new InvalidOperationException("notification_claim_missing_lease");
            var parentContext = ActivityContext.TryParse(record.TraceParent, null, out var parsedParent) ? parsedParent : default;
            using var deliveryActivity = GonesTelemetry.Activities.StartActivity("notification.process", ActivityKind.Consumer, parentContext);
            deliveryActivity?.SetTag("messaging.system", "gones.notification_outbox");
            deliveryActivity?.SetTag("messaging.operation.name", "process");
            deliveryActivity?.SetTag("messaging.message.id", record.Id.ToString("D"));
            deliveryActivity?.SetTag("gones.correlation_id", record.CorrelationId);
            using var logScope = logger.BeginScope(new Dictionary<string, object?>
            {
                ["CorrelationId"] = record.CorrelationId,
                ["TraceId"] = deliveryActivity?.TraceId.ToString() ?? parentContext.TraceId.ToString()
            });
            logger.LogInformation(NotificationLogEvents.Claimed, "Event={Event} OutboxId={OutboxId} Template={Template} Attempt={Attempt}", "notification.claimed", record.Id, record.TemplateKey, record.AttemptCount);

            try
            {
                var recipient = record.Recipient ?? throw new NotificationTemplateException("notification_recipient_missing");
                var modelJson = record.TemplateModelJson ?? throw new NotificationTemplateException("notification_model_missing");
                var model = NotificationModelSerializer.Deserialize(record.TemplateKey, modelJson);
                var content = renderer.Render(record.Locale, model);
                var email = new OutgoingEmail(record.Id, record.DedupeKey, record.TemplateKey, recipient, content);
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                timeout.CancelAfter(options.SendTimeout.ToTimeSpan());
                await transport.SendAsync(email, timeout.Token);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (OperationCanceledException)
            {
                await HandleFailureAsync(record, leaseToken, "transport_timeout", isTransient: true, cancellationToken);
                continue;
            }
            catch (EmailTransportException exception)
            {
                await HandleFailureAsync(record, leaseToken, exception.Code, exception.IsTransient, cancellationToken);
                continue;
            }
            catch (NotificationTemplateException exception)
            {
                await HandleFailureAsync(record, leaseToken, exception.Code, isTransient: false, cancellationToken);
                continue;
            }
            catch (Exception exception)
            {
                deliveryActivity?.SetStatus(ActivityStatusCode.Error, "transport_unexpected");
                logger.LogWarning(NotificationLogEvents.TransportFailed, "Event={Event} OutboxId={OutboxId} ExceptionType={ExceptionType}", "notification.transport.failed", record.Id, exception.GetType().Name);
                await HandleFailureAsync(record, leaseToken, "transport_unexpected", isTransient: true, cancellationToken);
                continue;
            }

            var completedAt = clock.GetCurrentInstant();
            record.MarkSent(leaseToken, completedAt);
            store.RecordSuccessful(record, completedAt);
            try
            {
                await store.SaveAsync(cancellationToken);
            }
            catch (Exception exception)
            {
                deliveryActivity?.SetStatus(ActivityStatusCode.Error, "acknowledgement_failed");
                logger.LogError(NotificationLogEvents.AcknowledgementFailed, "Event={Event} OutboxId={OutboxId} ExceptionType={ExceptionType}", "notification.acknowledgement.failed", record.Id, exception.GetType().Name);
                throw;
            }
            metrics.RecordSent(completedAt - record.CreatedAt);
            logger.LogInformation(NotificationLogEvents.Completed, "Event={Event} OutboxId={OutboxId} Template={Template} Attempt={Attempt}", "notification.completed", record.Id, record.TemplateKey, record.AttemptCount);
        }

        return records.Count;
    }

    private async Task HandleFailureAsync(
        Domain.Notifications.NotificationOutboxRecord record,
        Guid leaseToken,
        string errorCode,
        bool isTransient,
        CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        Activity.Current?.SetStatus(ActivityStatusCode.Error, errorCode);
        var retry = isTransient ? retryPolicy.Decide(record.AttemptCount) : new NotificationRetryDecision(false, Duration.Zero);
        if (retry.ShouldRetry)
        {
            record.MarkRetry(leaseToken, now + retry.Delay, errorCode);
            await store.SaveAsync(cancellationToken);
            metrics.RecordRetried();
            logger.LogWarning(NotificationLogEvents.Retried, "Event={Event} OutboxId={OutboxId} Template={Template} Attempt={Attempt} ErrorCode={ErrorCode}", "notification.retried", record.Id, record.TemplateKey, record.AttemptCount, errorCode);
            return;
        }

        record.MarkDeadLetter(leaseToken, now, errorCode);
        await store.SaveAsync(cancellationToken);
        metrics.RecordDeadLettered();
        logger.LogError(NotificationLogEvents.DeadLettered, "Event={Event} OutboxId={OutboxId} Template={Template} Attempt={Attempt} ErrorCode={ErrorCode}", "notification.deadlettered", record.Id, record.TemplateKey, record.AttemptCount, errorCode);
    }
}

public static class NotificationLogEvents
{
    public static readonly EventId Claimed = new(6001, "NotificationClaimed");
    public static readonly EventId Completed = new(6002, "NotificationCompleted");
    public static readonly EventId Retried = new(6003, "NotificationRetried");
    public static readonly EventId DeadLettered = new(6004, "NotificationDeadLettered");
    public static readonly EventId TransportFailed = new(6005, "NotificationTransportFailed");
    public static readonly EventId AcknowledgementFailed = new(6006, "NotificationAcknowledgementFailed");
}
