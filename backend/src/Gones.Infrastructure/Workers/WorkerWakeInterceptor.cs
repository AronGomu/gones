using System.Data.Common;
using System.Runtime.CompilerServices;
using Gones.Domain.Calendar;
using Gones.Domain.Identity;
using Gones.Domain.Notifications;
using Gones.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging;

namespace Gones.Infrastructure.Workers;

public interface IWorkerWakeNotifier
{
    void Notify();
}

/// <summary>Hints only; PostgreSQL remains authoritative. Register on producer contexts, never Worker contexts.</summary>
public sealed class WorkerWakeInterceptor(IWorkerWakeNotifier notifier, ILogger<WorkerWakeInterceptor> logger)
    : SaveChangesInterceptor, IDbTransactionInterceptor
{
    private readonly ConditionalWeakTable<DbContext, PendingWake> pending = new();

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        BeginSave(eventData.Context);
        return result;
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        BeginSave(eventData.Context);
        return ValueTask.FromResult(result);
    }

    public override int SavedChanges(SaveChangesCompletedEventData eventData, int result)
    {
        CompleteSave(eventData.Context, result);
        return result;
    }

    public override ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default)
    {
        CompleteSave(eventData.Context, result);
        return ValueTask.FromResult(result);
    }

    public override void SaveChangesFailed(DbContextErrorEventData eventData) => AbandonSave(eventData.Context);
    public override Task SaveChangesFailedAsync(DbContextErrorEventData eventData, CancellationToken cancellationToken = default)
    {
        AbandonSave(eventData.Context);
        return Task.CompletedTask;
    }
    public override void SaveChangesCanceled(DbContextEventData eventData) => AbandonSave(eventData.Context);
    public override Task SaveChangesCanceledAsync(DbContextEventData eventData, CancellationToken cancellationToken = default)
    {
        AbandonSave(eventData.Context);
        return Task.CompletedTask;
    }

    public void TransactionCommitted(DbTransaction transaction, TransactionEndEventData eventData) => Commit(eventData);
    public Task TransactionCommittedAsync(DbTransaction transaction, TransactionEndEventData eventData, CancellationToken cancellationToken = default)
    {
        Commit(eventData);
        return Task.CompletedTask;
    }
    public void TransactionRolledBack(DbTransaction transaction, TransactionEndEventData eventData) => ForgetTransaction(eventData);
    public Task TransactionRolledBackAsync(DbTransaction transaction, TransactionEndEventData eventData, CancellationToken cancellationToken = default)
    {
        ForgetTransaction(eventData);
        return Task.CompletedTask;
    }

    private void BeginSave(DbContext? database)
    {
        if (database is null) return;
        var state = pending.GetOrCreateValue(database);
        state.SaveTransaction = database.Database.CurrentTransaction?.TransactionId;
        if (state.Transaction != state.SaveTransaction) state.Transaction = null;
        state.SaveNeedsWake = database.ChangeTracker.Entries().Any(entry =>
            entry.State is EntityState.Added or EntityState.Modified or EntityState.Deleted
            && entry.Entity is NotificationOutboxRecord or ScheduledNotification or Event or EventLifecycleEntry
                or EventRegistrationAttempt or EventImage or EventImageObjectDeletion or EventProposal
                or ApplicationUser or UserProfile);
    }

    private void CompleteSave(DbContext? database, int result)
    {
        if (database is null || !pending.TryGetValue(database, out var state)) return;
        var needsWake = state.SaveNeedsWake && result > 0;
        state.SaveNeedsWake = false;
        if (!needsWake) return;
        if (state.SaveTransaction is { } transaction) state.Transaction = transaction;
        // EF may omit the implicit transaction for a single command, or commit it before SavedChanges.
        // Both paths signal here, not from the implicit transaction callback.
        else Notify();
    }

    private void AbandonSave(DbContext? database)
    {
        if (database is not null && pending.TryGetValue(database, out var state)) state.SaveNeedsWake = false;
        // A failed later save/savepoint must not erase earlier successful writes in the outer transaction.
    }

    private void Commit(TransactionEndEventData eventData)
    {
        if (eventData.Context is null || !pending.TryGetValue(eventData.Context, out var state)
            || state.Transaction != eventData.TransactionId) return;
        state.Transaction = null;
        Notify();
    }

    private void ForgetTransaction(TransactionEndEventData eventData)
    {
        if (eventData.Context is not null && pending.TryGetValue(eventData.Context, out var state)
            && state.Transaction == eventData.TransactionId) state.Transaction = null;
    }

    private void Notify()
    {
        try { notifier.Notify(); }
        catch (Exception exception)
        {
            // Never propagate a post-commit signal failure as a failed business mutation.
            logger.LogWarning("Event={Event}; ExceptionType={ExceptionType}", "worker.wake.enqueue_failed", exception.GetType().Name);
        }
    }

    private sealed class PendingWake
    {
        public Guid? Transaction { get; set; }
        public Guid? SaveTransaction { get; set; }
        public bool SaveNeedsWake { get; set; }
    }
}
