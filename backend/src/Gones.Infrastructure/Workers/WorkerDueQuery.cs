using Gones.Domain.Calendar;
using Gones.Domain.Notifications;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.Infrastructure.Workers;

public enum WorkerWorkKind { Reminders, Lifecycle, Outbox, ImageDeletion, ImageExpiry, Markers, ReminderPlan, DeliveryMetadata, EmailHistory, Idempotency }

public sealed record WorkerDue(Instant? At, bool HasFailed = false);

public sealed class WorkerDueQuery(GonesDbContext database, IClock clock)
{
    public static bool IsDaily(WorkerWorkKind kind) => kind >= WorkerWorkKind.ReminderPlan;

    public async Task<WorkerDue> ReadAsync(WorkerWorkKind kind, CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        Instant? due = kind switch
        {
            WorkerWorkKind.Reminders => await database.ScheduledNotifications
                .Where(item => item.Status == ScheduledNotificationStatus.Planned)
                .MinAsync(item => (Instant?)item.ScheduledAtUtc, cancellationToken),
            WorkerWorkKind.Lifecycle => await database.Events
                .Where(item => item.DeletedAt == null && (item.Status == ScheduledTournamentStatus.Published || item.Status == ScheduledTournamentStatus.InProgress))
                .MinAsync(item => (Instant?)(item.Status == ScheduledTournamentStatus.Published ? item.StartsAtUtc : item.EndsAtUtc), cancellationToken),
            WorkerWorkKind.Outbox => await database.NotificationOutboxRecords
                .Where(item => item.Status == NotificationOutboxStatus.Pending || item.Status == NotificationOutboxStatus.Sending)
                .MinAsync(item => item.Status == NotificationOutboxStatus.Pending ? (Instant?)item.AvailableAt : item.LeaseExpiresAt, cancellationToken),
            WorkerWorkKind.Markers => await database.EventLifecycleEntries.AnyAsync(
                item => item.ReminderPlanAction != TournamentReminderPlanAction.None && item.ReminderPlanProcessedAt == null, cancellationToken) ? now : null,
            WorkerWorkKind.ImageDeletion => await database.EventImageObjectDeletions.MinAsync(item => (Instant?)item.NextAttemptAt, cancellationToken),
            WorkerWorkKind.ImageExpiry => await ImageExpiryAsync(now, cancellationToken),
            _ => null
        };
        if (!IsDaily(kind)) return new WorkerDue(due);
        var state = await MaintenanceAsync(kind, cancellationToken);
        return new WorkerDue(state.NextDueAt, state.HasFailed);
    }

    public async Task<WorkerMaintenanceState> MaintenanceAsync(WorkerWorkKind kind, CancellationToken cancellationToken)
    {
        var key = kind.ToString();
        var state = await database.WorkerMaintenance.SingleOrDefaultAsync(item => item.Key == key, cancellationToken);
        if (state is not null) return state;
        state = new WorkerMaintenanceState(key, clock.GetCurrentInstant());
        database.WorkerMaintenance.Add(state);
        await database.SaveChangesAsync(cancellationToken);
        return state;
    }

    public async Task CompleteAsync(WorkerWorkKind kind, bool failed, CancellationToken cancellationToken)
    {
        var state = await MaintenanceAsync(kind, cancellationToken);
        if (failed) state.Fail(clock.GetCurrentInstant());
        else state.Complete(clock.GetCurrentInstant());
        await database.SaveChangesAsync(cancellationToken);
    }

    private async Task<Instant?> ImageExpiryAsync(Instant now, CancellationToken cancellationToken)
    {
        var temporary = await database.EventImages.Where(item => item.State == EventImageState.Temporary)
            .MinAsync(item => item.ExpiresAt, cancellationToken);
        var proposal = await database.EventProposals
            .Where(item => (item.Status == TournamentProposalStatus.Rejected || item.Status == TournamentProposalStatus.Pending)
                && database.EventImages.Any(image => image.ProposalId == item.Id && image.State == EventImageState.ProposalOwned))
            .MinAsync(item => (Instant?)(item.Status == TournamentProposalStatus.Rejected ? now : item.ExpiresAt), cancellationToken);
        return temporary is null ? proposal : proposal is null ? temporary : Instant.Min(temporary.Value, proposal.Value);
    }
}
