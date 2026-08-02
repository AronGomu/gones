using Gones.Domain.Calendar;
using NodaTime;

namespace Gones.UnitTests;

public sealed class ScheduledNotificationTests
{
    private static readonly Instant Now = Instant.FromUtc(2030, 1, 1, 0, 0);

    [Fact]
    public void Dedupe_is_deterministic_and_past_intent_is_rejected()
    {
        var tournamentId = Guid.NewGuid();
        var registrationId = Guid.NewGuid();
        var occurrence = new ReminderOccurrence(ScheduledNotificationType.DayOne, new LocalDate(2030, 1, 2), Now + Duration.FromHours(1));

        var first = ScheduledNotification.Create(tournamentId, registrationId, Guid.NewGuid(), occurrence, Now);
        var second = ScheduledNotification.Create(tournamentId, registrationId, Guid.NewGuid(), occurrence, Now);

        Assert.Equal(first.DedupeKey, second.DedupeKey);
        Assert.Throws<ArgumentOutOfRangeException>(() => ScheduledNotification.Create(
            tournamentId,
            registrationId,
            Guid.NewGuid(),
            occurrence with { ScheduledAtUtc = Now },
            Now));
    }

    [Fact]
    public void Cancel_only_mutates_unsent_planned_rows_and_cancelled_future_can_replan()
    {
        var occurrence = new ReminderOccurrence(ScheduledNotificationType.DayTwo, new LocalDate(2030, 1, 2), Now + Duration.FromHours(1));
        var planned = ScheduledNotification.Create(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), occurrence, Now);
        planned.Cancel(Now);
        Assert.Equal(ScheduledNotificationStatus.Cancelled, planned.Status);
        planned.Replan(Now);
        Assert.Equal(ScheduledNotificationStatus.Planned, planned.Status);

        var enqueued = ScheduledNotification.Create(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), occurrence, Now);
        enqueued.MarkEnqueued(Guid.NewGuid(), Now);
        enqueued.Cancel(Now);
        Assert.Equal(ScheduledNotificationStatus.Enqueued, enqueued.Status);

        var missed = ScheduledNotification.Create(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), occurrence, Now);
        missed.MarkMissed(Now);
        missed.Cancel(Now);
        Assert.Equal(ScheduledNotificationStatus.Missed, missed.Status);
    }
}
