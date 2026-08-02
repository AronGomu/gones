using NodaTime;

namespace Gones.Domain.Calendar;

public enum ScheduledNotificationType
{
    Monthly,
    Saturday,
    DayTwo,
    DayOne
}

public enum ScheduledNotificationStatus
{
    Planned,
    Enqueued,
    Missed,
    Cancelled
}

public sealed record ReminderOccurrence(ScheduledNotificationType Type, LocalDate VenueDate, Instant ScheduledAtUtc);

public static class TournamentReminderPlanner
{
    private static readonly LocalTime ReminderTime = new(10, 0);

    public static IReadOnlyList<ReminderOccurrence> Plan(LocalDate eventDate, string timeZoneId, Instant now)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(timeZoneId);
        var zone = DateTimeZoneProviders.Tzdb.GetZoneOrNull(timeZoneId)
            ?? throw new ArgumentException("Time zone must be a valid IANA zone.", nameof(timeZoneId));
        var occurrences = new Dictionary<Instant, ReminderOccurrence>();

        for (var monthsBefore = 2; monthsBefore <= 2400; monthsBefore++)
        {
            var date = eventDate.PlusMonths(-monthsBefore);
            var occurrence = Create(ScheduledNotificationType.Monthly, date, zone);
            if (occurrence.ScheduledAtUtc <= now) break;
            occurrences[occurrence.ScheduledAtUtc] = occurrence;
        }

        var finalMonthStart = eventDate.PlusMonths(-1);
        var daysUntilSaturday = ((int)IsoDayOfWeek.Saturday - (int)finalMonthStart.DayOfWeek + 7) % 7;
        for (var date = finalMonthStart.PlusDays(daysUntilSaturday); date < eventDate; date = date.PlusDays(7))
        {
            AddFuture(occurrences, Create(ScheduledNotificationType.Saturday, date, zone), now);
        }

        AddFuture(occurrences, Create(ScheduledNotificationType.DayTwo, eventDate.PlusDays(-2), zone), now);
        AddFuture(occurrences, Create(ScheduledNotificationType.DayOne, eventDate.PlusDays(-1), zone), now);
        return occurrences.Values.OrderBy(item => item.ScheduledAtUtc).ToArray();
    }

    private static ReminderOccurrence Create(ScheduledNotificationType type, LocalDate date, DateTimeZone zone) =>
        new(type, date, zone.AtLeniently(date.At(ReminderTime)).ToInstant());

    private static void AddFuture(IDictionary<Instant, ReminderOccurrence> occurrences, ReminderOccurrence occurrence, Instant now)
    {
        if (occurrence.ScheduledAtUtc > now) occurrences[occurrence.ScheduledAtUtc] = occurrence;
    }
}

public sealed class ScheduledNotification
{
    public const int MaximumDedupeKeyLength = 200;

    private ScheduledNotification() { }

    public Guid Id { get; private init; } = Guid.NewGuid();
    public Guid TournamentId { get; private init; }
    public Guid RegistrationAttemptId { get; private init; }
    public Guid UserId { get; private init; }
    public ScheduledNotificationType Type { get; private init; }
    public Instant ScheduledAtUtc { get; private init; }
    public string DedupeKey { get; private init; } = string.Empty;
    public ScheduledNotificationStatus Status { get; private set; }
    public Instant CreatedAt { get; private init; }
    public Instant UpdatedAt { get; private set; }
    public Guid? OutboxId { get; private set; }

    public static ScheduledNotification Create(
        Guid tournamentId,
        Guid registrationAttemptId,
        Guid userId,
        ReminderOccurrence occurrence,
        Instant now)
    {
        RequireId(tournamentId, nameof(tournamentId));
        RequireId(registrationAttemptId, nameof(registrationAttemptId));
        RequireId(userId, nameof(userId));
        ArgumentNullException.ThrowIfNull(occurrence);
        if (occurrence.ScheduledAtUtc <= now) throw new ArgumentOutOfRangeException(nameof(occurrence), "Past reminders cannot be planned.");
        return new ScheduledNotification
        {
            TournamentId = tournamentId,
            RegistrationAttemptId = registrationAttemptId,
            UserId = userId,
            Type = occurrence.Type,
            ScheduledAtUtc = occurrence.ScheduledAtUtc,
            DedupeKey = BuildDedupeKey(tournamentId, registrationAttemptId, occurrence),
            Status = ScheduledNotificationStatus.Planned,
            CreatedAt = now,
            UpdatedAt = now
        };
    }

    public void MarkEnqueued(Guid outboxId, Instant now)
    {
        RequireId(outboxId, nameof(outboxId));
        EnsurePlanned();
        OutboxId = outboxId;
        Status = ScheduledNotificationStatus.Enqueued;
        UpdatedAt = now;
    }

    public void MarkMissed(Instant now)
    {
        EnsurePlanned();
        Status = ScheduledNotificationStatus.Missed;
        UpdatedAt = now;
    }

    public void Cancel(Instant now)
    {
        if (Status != ScheduledNotificationStatus.Planned) return;
        Status = ScheduledNotificationStatus.Cancelled;
        UpdatedAt = now;
    }

    public void Replan(Instant now)
    {
        if (Status != ScheduledNotificationStatus.Cancelled) return;
        if (ScheduledAtUtc <= now) throw new InvalidOperationException("Past reminders cannot be replanned.");
        Status = ScheduledNotificationStatus.Planned;
        UpdatedAt = now;
    }

    public static string BuildDedupeKey(Guid tournamentId, Guid registrationAttemptId, ReminderOccurrence occurrence) =>
        $"tournament-reminder:{tournamentId:N}:{registrationAttemptId:N}:{occurrence.Type}:{occurrence.ScheduledAtUtc.ToUnixTimeTicks()}";

    private void EnsurePlanned()
    {
        if (Status != ScheduledNotificationStatus.Planned) throw new InvalidOperationException("scheduled_notification_not_planned");
    }

    private static void RequireId(Guid value, string parameterName)
    {
        if (value == Guid.Empty) throw new ArgumentException("ID cannot be empty.", parameterName);
    }
}

public sealed class NotificationHistory
{
    public const int MaximumTemplateKeyLength = 80;
    public const int MaximumDedupeKeyLength = 200;

    private NotificationHistory() { }

    public Guid Id { get; private init; } = Guid.NewGuid();
    public Guid OutboxId { get; private init; }
    public string TemplateKey { get; private init; } = string.Empty;
    public string DedupeKey { get; private init; } = string.Empty;
    public Guid? UserId { get; private init; }
    public Guid? TournamentId { get; private init; }
    public Instant SentAt { get; private init; }

    public static NotificationHistory Successful(
        Guid outboxId,
        string templateKey,
        string dedupeKey,
        Guid? userId,
        Guid? tournamentId,
        Instant sentAt)
    {
        if (outboxId == Guid.Empty) throw new ArgumentException("Outbox ID cannot be empty.", nameof(outboxId));
        return new NotificationHistory
        {
            OutboxId = outboxId,
            TemplateKey = RequireText(templateKey, MaximumTemplateKeyLength, nameof(templateKey)),
            DedupeKey = RequireText(dedupeKey, MaximumDedupeKeyLength, nameof(dedupeKey)),
            UserId = userId,
            TournamentId = tournamentId,
            SentAt = sentAt
        };
    }

    private static string RequireText(string value, int maximumLength, string parameterName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value, parameterName);
        return value.Length <= maximumLength ? value : throw new ArgumentOutOfRangeException(parameterName);
    }
}
