using Gones.Infrastructure.Calendar;
using Gones.Infrastructure.EventProviders;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Notifications;
using Gones.Infrastructure.Persistence;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NodaTime;

namespace Gones.Infrastructure.Workers;

public sealed class WorkerDueDispatcher(
    IServiceScopeFactory scopes,
    IClock clock,
    WorkerWakeSignal wake,
    WorkerRuntimeFile health,
    TournamentSchedulerOptions schedulerOptions,
    ILogger<WorkerDueDispatcher> logger)
{
    private readonly Dictionary<WorkerWorkKind, WorkState> states = Enum.GetValues<WorkerWorkKind>().ToDictionary(kind => kind, _ => new WorkState());
    private Instant recoveryAt;
    private Instant hintNotBefore;
    private Instant progressAt;
    private bool planning = true;
    private bool replan;
    private Guid? plannerCursor;
    private WorkerRuntimeSnapshot? snapshot;
    public WorkerRuntimeSnapshot? Snapshot => Volatile.Read(ref snapshot);

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        progressAt = clock.GetCurrentInstant();
        recoveryAt = progressAt + Duration.FromHours(1);
        Publish(WorkerRuntimeState.Starting);
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var now = clock.GetCurrentInstant();
                if (now >= recoveryAt)
                {
                    RequestReconciliation();
                    recoveryAt = now + Duration.FromHours(1);
                }
                if (now >= hintNotBefore && wake.TryTake())
                {
                    RequestReconciliation();
                    hintNotBefore = now + Duration.FromSeconds(1);
                }

                // Provider work is quantum-one. Recheck expiring work BETWEEN provider operations.
                await ExpiringWorkAsync(cancellationToken);
                await RunKindAsync(WorkerWorkKind.Outbox, cancellationToken);
                await ExpiringWorkAsync(cancellationToken);
                await RunKindAsync(WorkerWorkKind.ImageDeletion, cancellationToken);
                await RunKindAsync(WorkerWorkKind.ImageExpiry, cancellationToken);
                await RunKindAsync(WorkerWorkKind.Markers, cancellationToken);
                await RunKindAsync(WorkerWorkKind.ReminderPlan, cancellationToken);
                await RunKindAsync(WorkerWorkKind.DeliveryMetadata, cancellationToken);
                await RunKindAsync(WorkerWorkKind.EmailHistory, cancellationToken);
                await RunKindAsync(WorkerWorkKind.Idempotency, cancellationToken);
                // Planner/sweep/reminder writes can introduce earlier work in an already visited kind.
                foreach (var kind in states.Keys) await RunKindAsync(kind, cancellationToken, execute: false);

                if (NextDue() <= clock.GetCurrentInstant())
                {
                    await Task.Yield();
                    continue;
                }
                await WaitAsync(cancellationToken);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
        finally
        {
            Publish(WorkerRuntimeState.Stopped);
        }
    }

    private async Task ExpiringWorkAsync(CancellationToken cancellationToken)
    {
        await RunKindAsync(WorkerWorkKind.Reminders, cancellationToken);
        await RunKindAsync(WorkerWorkKind.Lifecycle, cancellationToken);
    }

    private async Task RunKindAsync(WorkerWorkKind kind, CancellationToken cancellationToken, bool execute = true)
    {
        var state = states[kind];
        if (clock.GetCurrentInstant() < state.NotBefore) return;
        Publish(WorkerRuntimeState.Busy);
        var readingDue = true;
        try
        {
            var due = await InScopeAsync(provider => provider.GetRequiredService<WorkerDueQuery>().ReadAsync(kind, cancellationToken));
            state.Due = due.At;
            state.QueryFailed = false;
            if (!state.WorkFailed)
            {
                state.Failures = 0;
                state.NotBefore = Instant.MinValue;
            }
            if (due.HasFailed)
            {
                state.WorkFailed = true;
                state.NotBefore = due.At!.Value;
                if (clock.GetCurrentInstant() < state.NotBefore) return;
            }
            if (kind == WorkerWorkKind.ReminderPlan && planning) state.Due = clock.GetCurrentInstant();
            if (!execute) return;
            if (state.Due is not { } at || at > clock.GetCurrentInstant()) return;

            readingDue = false;
            var (count, complete) = await ExecuteAsync(kind, cancellationToken);
            if (WorkerDueQuery.IsDaily(kind) && complete)
                await RecordMaintenanceAsync(kind, false, cancellationToken);
            if (!WorkerDueQuery.IsDaily(kind) || complete)
            {
                state.WorkFailed = false;
                state.Failures = 0;
            }
            state.NotBefore = count == 0 && !complete ? clock.GetCurrentInstant() + Duration.FromSeconds(1) : Instant.MinValue;
            readingDue = true;
            state.Due = (await InScopeAsync(provider => provider.GetRequiredService<WorkerDueQuery>().ReadAsync(kind, cancellationToken))).At;
            if (kind == WorkerWorkKind.ReminderPlan && planning) state.Due = clock.GetCurrentInstant();
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception exception)
        {
            if (readingDue) state.QueryFailed = true;
            else state.WorkFailed = true;
            state.NotBefore = clock.GetCurrentInstant() + Duration.FromSeconds(Math.Min(60, 5 * (1 << Math.Min(state.Failures++, 4))));
            if (WorkerDueQuery.IsDaily(kind) && exception is not PlannerContendedException)
            {
                try
                {
                    await RecordMaintenanceAsync(kind, true, cancellationToken);
                    state.WorkFailed = true;
                    state.NotBefore = clock.GetCurrentInstant() + Duration.FromHours(1);
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
                catch (Exception persistenceException)
                {
                    logger.LogError("Event={Event}; Kind={Kind}; ExceptionType={ExceptionType}", "worker.maintenance.retry_not_persisted", kind, persistenceException.GetType().Name);
                }
            }
            if (kind == WorkerWorkKind.ImageExpiry) state.NotBefore = clock.GetCurrentInstant() + Duration.FromMinutes(15);
            logger.LogError("Event={Event}; Kind={Kind}; ExceptionType={ExceptionType}", "worker.due.failed", kind, exception.GetType().Name);
        }
        finally
        {
            progressAt = clock.GetCurrentInstant();
        }
        // File failure never enters provider send/ack/retry exception classification.
        Publish(WorkerRuntimeState.Busy);
    }

    private async Task<(int Count, bool Complete)> ExecuteAsync(WorkerWorkKind kind, CancellationToken cancellationToken)
    {
        if (kind == WorkerWorkKind.ReminderPlan)
        {
            planning = true;
            var page = await InScopeAsync(provider => provider.GetRequiredService<TournamentScheduleReconciler>().RefreshDailyPageAsync(plannerCursor, cancellationToken));
            if (!page.Acquired) throw new PlannerContendedException();
            if (page.Count >= schedulerOptions.BatchSize)
            {
                plannerCursor = page.LastTournamentId;
                return (page.Count, false);
            }
            plannerCursor = null;
            planning = replan;
            replan = false;
            return (page.Count, true);
        }
        var count = await InScopeAsync(async provider => kind switch
        {
            WorkerWorkKind.Reminders => await provider.GetRequiredService<TournamentReminderDispatcher>().DispatchDueAsync(cancellationToken),
            WorkerWorkKind.Lifecycle => await provider.GetRequiredService<TournamentLifecyclePoller>().AdvanceAsync(cancellationToken),
            WorkerWorkKind.Outbox => await provider.GetRequiredService<NotificationProcessor>().ProcessBatchAsync(cancellationToken, batchLimit: 1),
            WorkerWorkKind.ImageDeletion => await provider.GetRequiredService<EventImageCleanupService>().ProcessDueObjectDeletionsAsync(cancellationToken, batchLimit: 1),
            WorkerWorkKind.ImageExpiry => await provider.GetRequiredService<EventImageCleanupService>().SweepExpiredAsync(cancellationToken, processDeletions: false),
            WorkerWorkKind.Markers => await provider.GetRequiredService<TournamentScheduleReconciler>().RefreshPendingChangesAsync(cancellationToken) ? 1 : throw new PlannerContendedException(),
            WorkerWorkKind.DeliveryMetadata => await provider.GetRequiredService<NotificationDeliveryMetadataCleaner>().CleanBatchAsync(cancellationToken),
            WorkerWorkKind.EmailHistory => await provider.GetRequiredService<UserEmailHistoryRedactor>().RedactBatchAsync(cancellationToken),
            WorkerWorkKind.Idempotency => await provider.GetRequiredService<IdempotencyRecordSweeper>().SweepBatchAsync(cancellationToken),
            _ => throw new ArgumentOutOfRangeException(nameof(kind))
        });
        var complete = kind switch
        {
            WorkerWorkKind.DeliveryMetadata => count < NotificationDeliveryMetadataCleaner.BatchSize,
            WorkerWorkKind.EmailHistory => count < UserEmailHistoryRedactor.BatchSize,
            WorkerWorkKind.Idempotency => count < IdempotencyRecordSweeper.BatchSize,
            _ => false
        };
        return (count, complete);
    }

    private Task<bool> RecordMaintenanceAsync(WorkerWorkKind kind, bool failed, CancellationToken cancellationToken) => InScopeAsync(async provider =>
    {
        await provider.GetRequiredService<WorkerDueQuery>().CompleteAsync(kind, failed, cancellationToken);
        return true;
    });

    private async Task<T> InScopeAsync<T>(Func<IServiceProvider, Task<T>> action)
    {
        await using var scope = scopes.CreateAsyncScope();
        return await action(scope.ServiceProvider);
    }

    private void RequestReconciliation()
    {
        if (planning) replan = true;
        else planning = true;
    }

    private Instant NextDue()
    {
        var next = recoveryAt;
        foreach (var pair in states)
        {
            var due = pair.Value.Due;
            if (pair.Key == WorkerWorkKind.ReminderPlan && planning) due = clock.GetCurrentInstant();
            if (pair.Value.QueryFailed) due = pair.Value.NotBefore;
            if (due is { } at) next = Instant.Min(next, Instant.Max(at, pair.Value.NotBefore));
        }
        return next;
    }

    private void Publish(WorkerRuntimeState state)
    {
        if (state == WorkerRuntimeState.Busy && states.Values.Any(item => item.Failed)) state = WorkerRuntimeState.Failed;
        var value = WorkerRuntimeSnapshot.Create(state, clock.GetCurrentInstant(), progressAt, NextDue());
        if (!OperatingSystem.IsLinux()) throw new InvalidOperationException("Worker idle health requires Linux.");
        health.Publish(value);
        Volatile.Write(ref snapshot, value);
    }

    private async Task WaitAsync(CancellationToken cancellationToken)
    {
        while (NextDue() > clock.GetCurrentInstant())
        {
            Publish(states.Values.Any(item => item.Failed) ? WorkerRuntimeState.Failed : WorkerRuntimeState.Idle);
            var remaining = (NextDue() - clock.GetCurrentInstant()).ToTimeSpan();
            var slice = remaining < TimeSpan.FromSeconds(10) ? remaining : TimeSpan.FromSeconds(10);
            if (await wake.WaitAsync(slice, cancellationToken, TimeSpan.FromSeconds(1)))
            {
                RequestReconciliation();
                hintNotBefore = clock.GetCurrentInstant() + Duration.FromSeconds(1);
                return;
            }
        }
    }

    private sealed class WorkState
    {
        public Instant? Due { get; set; }
        public Instant NotBefore { get; set; } = Instant.MinValue;
        public bool QueryFailed { get; set; }
        public bool WorkFailed { get; set; }
        public bool Failed => QueryFailed || WorkFailed;
        public int Failures { get; set; }
    }

    private sealed class PlannerContendedException : Exception;
}
