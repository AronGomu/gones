using System.Diagnostics;
using System.Diagnostics.Metrics;
using Gones.Application.Notifications;
using Gones.Domain.Calendar;
using Gones.Domain.Identity;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Notifications;
using Gones.Infrastructure.Observability;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NodaTime;

namespace Gones.Infrastructure.Calendar;

public sealed record TournamentSchedulerOptions(
    int BatchSize,
    Duration LateTolerance,
    Duration DailyRefreshInterval,
    string PublicAppOrigin)
{
    public static TournamentSchedulerOptions Load(IConfiguration configuration)
    {
        var origin = configuration["GONES_PUBLIC_APP_ORIGIN"];
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps
            || string.IsNullOrWhiteSpace(uri.Host)
            || uri.AbsolutePath != "/"
            || !string.IsNullOrWhiteSpace(uri.Query)
            || !string.IsNullOrWhiteSpace(uri.Fragment))
        {
            throw new InvalidOperationException("GONES_PUBLIC_APP_ORIGIN must be an HTTPS origin.");
        }

        return new TournamentSchedulerOptions(
            ReadInt(configuration, "GONES_SCHEDULER_BATCH_SIZE", 100, 1, 500),
            Duration.FromSeconds(ReadInt(configuration, "GONES_SCHEDULER_LATE_TOLERANCE_SECONDS", 60, 1, 60)),
            Duration.FromHours(24),
            uri.AbsoluteUri);
    }

    private static int ReadInt(IConfiguration configuration, string key, int fallback, int minimum, int maximum)
    {
        var raw = configuration[key];
        var value = string.IsNullOrWhiteSpace(raw)
            ? fallback
            : int.TryParse(raw, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var parsed)
                ? parsed
                : throw new InvalidOperationException($"{key} must be an integer.");
        return value >= minimum && value <= maximum
            ? value
            : throw new InvalidOperationException($"{key} must be between {minimum} and {maximum}.");
    }
}

public static class TournamentSchedulerServiceCollectionExtensions
{
    public static IServiceCollection AddTournamentScheduler(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton(TournamentSchedulerOptions.Load(configuration));
        services.AddSingleton<TournamentSchedulerMetrics>();
        services.AddScoped<TournamentScheduleReconciler>();
        services.AddScoped<TournamentReminderDispatcher>();
        services.AddScoped<TournamentLifecyclePoller>();
        return services;
    }
}

public sealed class TournamentScheduleReconciler(
    GonesDbContext database,
    IClock clock,
    TournamentSchedulerOptions options,
    TournamentSchedulerMetrics metrics)
{
    private const long PlannerAdvisoryLock = 0x474F4E4553433237;

    public async Task<bool> RefreshDailyAsync(CancellationToken cancellationToken)
    {
        Guid? cursor = null;
        while (true)
        {
            var (acquired, count, lastTournamentId) = await RefreshDailyPageAsync(cursor, cancellationToken);
            if (!acquired) return false;
            if (count < options.BatchSize) return true;
            cursor = lastTournamentId;
        }
    }

    public async Task<bool> RefreshPendingChangesAsync(CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        if (!await TryAcquirePlannerLockAsync(cancellationToken))
        {
            await transaction.RollbackAsync(cancellationToken);
            return false;
        }

        var pendingEvents = await database.EventLifecycleEntries
            .Where(item => item.ReminderPlanAction != TournamentReminderPlanAction.None && item.ReminderPlanProcessedAt == null)
            .OrderBy(item => item.OccurredAt)
            .ThenBy(item => item.Id)
            .Take(options.BatchSize)
            .ToListAsync(cancellationToken);
        if (pendingEvents.Count == 0)
        {
            await transaction.CommitAsync(cancellationToken);
            return true;
        }

        await PlanTournamentsAsync(pendingEvents.Select(item => item.EventId).Distinct().ToArray(), pendingEvents, now, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    private async Task<(bool Acquired, int Count, Guid LastTournamentId)> RefreshDailyPageAsync(Guid? cursor, CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        if (!await TryAcquirePlannerLockAsync(cancellationToken))
        {
            await transaction.RollbackAsync(cancellationToken);
            return (false, 0, Guid.Empty);
        }

        var page = database.Events.AsNoTracking()
            .Where(item =>
                (item.Status == ScheduledTournamentStatus.Published && item.DeletedAt == null && item.StartsAtUtc > now)
                || database.ScheduledNotifications.Any(notification => notification.EventId == item.Id && notification.ScheduledAtUtc > now));
        if (cursor is { } after) page = page.Where(item => item.Id.CompareTo(after) > 0);
        var tournamentIds = await page
            .OrderBy(item => item.Id)
            .Select(item => item.Id)
            .Take(options.BatchSize)
            .ToArrayAsync(cancellationToken);
        if (tournamentIds.Length == 0)
        {
            await transaction.CommitAsync(cancellationToken);
            return (true, 0, Guid.Empty);
        }

        await PlanTournamentsAsync(tournamentIds, [], now, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return (true, tournamentIds.Length, tournamentIds[^1]);
    }

    private async Task<bool> TryAcquirePlannerLockAsync(CancellationToken cancellationToken) =>
        await database.Database
            .SqlQueryRaw<bool>($"SELECT pg_try_advisory_xact_lock({PlannerAdvisoryLock}) AS \"Value\"")
            .SingleAsync(cancellationToken);

    private async Task PlanTournamentsAsync(Guid[] tournamentIds, List<EventLifecycleEntry> pendingEvents, Instant now, CancellationToken cancellationToken)
    {
        using var activity = GonesTelemetry.Activities.StartActivity("scheduler.plan", ActivityKind.Internal);
        var candidates = await (
            from registration in database.EventRegistrationAttempts.AsNoTracking()
            join tournament in database.Events.AsNoTracking() on registration.EventId equals tournament.Id
            join user in database.Users.AsNoTracking() on registration.UserId equals user.Id
            join profile in database.UserProfiles.AsNoTracking() on registration.UserId equals profile.UserId
            where registration.Status == TournamentRegistrationStatus.Confirmed
                && tournament.Status == ScheduledTournamentStatus.Published
                && tournament.DeletedAt == null
                && tournament.StartsAtUtc > now
                && user.EmailConfirmed
                && user.Email != null
                && profile.ClosedAt == null
                && tournamentIds.Contains(tournament.Id)
            select new PlanCandidate(
                tournament.Id,
                registration.Id,
                registration.UserId,
                tournament.VenueStartDate,
                tournament.TimeZoneId)
        ).ToListAsync(cancellationToken);

        var existing = await database.ScheduledNotifications
            .Where(item => item.ScheduledAtUtc > now && tournamentIds.Contains(item.EventId))
            .ToListAsync(cancellationToken);
        var existingByDedupe = existing.ToDictionary(item => item.DedupeKey, StringComparer.Ordinal);
        var expectedDedupe = new HashSet<string>(StringComparer.Ordinal);
        var planned = 0;
        foreach (var candidate in candidates)
        {
            foreach (var occurrence in TournamentReminderPlanner.Plan(candidate.EventDate, candidate.TimeZoneId, now))
            {
                var dedupe = ScheduledNotification.BuildDedupeKey(candidate.TournamentId, candidate.RegistrationAttemptId, occurrence);
                expectedDedupe.Add(dedupe);
                if (existingByDedupe.TryGetValue(dedupe, out var current))
                {
                    if (current.Status == ScheduledNotificationStatus.Cancelled)
                    {
                        current.Replan(now);
                        planned++;
                    }
                    continue;
                }

                var notification = ScheduledNotification.Create(
                    candidate.TournamentId,
                    candidate.RegistrationAttemptId,
                    candidate.UserId,
                    occurrence,
                    now);
                database.ScheduledNotifications.Add(notification);
                existingByDedupe.Add(notification.DedupeKey, notification);
                planned++;
            }
        }

        var cancelled = 0;
        foreach (var notification in existing.Where(item => item.Status == ScheduledNotificationStatus.Planned && !expectedDedupe.Contains(item.DedupeKey)))
        {
            notification.Cancel(now);
            cancelled++;
        }
        foreach (var lifecycleEvent in pendingEvents) lifecycleEvent.MarkReminderPlanProcessed(now);

        await database.SaveChangesAsync(cancellationToken);
        metrics.RecordPlan(planned, cancelled);
        activity?.SetTag("scheduler.planned", planned);
        activity?.SetTag("scheduler.cancelled", cancelled);
    }

    private sealed record PlanCandidate(
        Guid TournamentId,
        Guid RegistrationAttemptId,
        Guid UserId,
        LocalDate EventDate,
        string TimeZoneId);
}

public sealed class TournamentReminderDispatcher(
    GonesDbContext database,
    INotificationOutbox outbox,
    IClock clock,
    TournamentSchedulerOptions options,
    TournamentSchedulerMetrics metrics)
{
    public async Task<int> DispatchDueAsync(CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var due = await database.ScheduledNotifications
            .FromSqlInterpolated($"""
                SELECT *
                FROM scheduled_notifications
                WHERE status = 'Planned' AND scheduled_at_utc <= {now}
                ORDER BY scheduled_at_utc, id
                FOR UPDATE SKIP LOCKED
                LIMIT {options.BatchSize}
                """)
            .ToListAsync(cancellationToken);
        if (due.Count == 0)
        {
            await transaction.CommitAsync(cancellationToken);
            return 0;
        }

        var timely = due.Where(item => item.ScheduledAtUtc >= now - options.LateTolerance).ToArray();
        var registrationIds = timely.Select(item => item.RegistrationAttemptId).Distinct().ToArray();
        var recipients = await (
            from registration in database.EventRegistrationAttempts.AsNoTracking()
            join tournament in database.Events.AsNoTracking() on registration.EventId equals tournament.Id
            join user in database.Users.AsNoTracking() on registration.UserId equals user.Id
            join profile in database.UserProfiles.AsNoTracking() on registration.UserId equals profile.UserId
            where registrationIds.Contains(registration.Id)
                && registration.Status == TournamentRegistrationStatus.Confirmed
                && tournament.Status == ScheduledTournamentStatus.Published
                && tournament.DeletedAt == null
                && tournament.StartsAtUtc > now
                && user.EmailConfirmed
                && user.Email != null
                && profile.ClosedAt == null
            select new ReminderRecipient(
                registration.Id,
                user.Id,
                user.Email!,
                profile.Username,
                profile.PreferredLanguage,
                tournament.Id,
                tournament.Title,
                tournament.Slug,
                tournament.StartsAtUtc,
                tournament.TimeZoneId)
        ).ToDictionaryAsync(item => item.RegistrationAttemptId, cancellationToken);

        var enqueued = 0;
        var missed = 0;
        foreach (var notification in due)
        {
            if (notification.ScheduledAtUtc < now - options.LateTolerance)
            {
                notification.MarkMissed(now);
                missed++;
                continue;
            }
            if (!recipients.TryGetValue(notification.RegistrationAttemptId, out var recipient))
            {
                notification.Cancel(now);
                continue;
            }

            var outboxId = outbox.Enqueue(new NotificationRequest(
                recipient.Email,
                recipient.Locale,
                notification.DedupeKey,
                new ReminderTemplateModel(
                    recipient.Username,
                    recipient.TournamentTitle,
                    recipient.StartsAtUtc.ToDateTimeOffset(),
                    recipient.TimeZoneId,
                    TournamentUrl(recipient.Slug)),
                recipient.UserId,
                recipient.TournamentId));
            notification.MarkEnqueued(outboxId, now);
            enqueued++;
        }

        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        metrics.RecordDispatch(enqueued, missed, due.Count == 0 ? Duration.Zero : now - due[0].ScheduledAtUtc);
        return due.Count;
    }

    private Uri TournamentUrl(string slug) =>
        new(new Uri(options.PublicAppOrigin, UriKind.Absolute), $"/events/{Uri.EscapeDataString(slug)}");

    private sealed record ReminderRecipient(
        Guid RegistrationAttemptId,
        Guid UserId,
        string Email,
        string Username,
        string Locale,
        Guid TournamentId,
        string TournamentTitle,
        string Slug,
        Instant StartsAtUtc,
        string TimeZoneId);
}

public sealed class TournamentLifecyclePoller(
    GonesDbContext database,
    IClock clock,
    TournamentSchedulerOptions options,
    TournamentSchedulerMetrics metrics)
{
    public async Task<int> AdvanceAsync(CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var tournaments = await database.Events
            .FromSqlInterpolated($"""
                SELECT *
                FROM events
                WHERE deleted_at IS NULL
                  AND ((status = 'Published' AND starts_at_utc <= {now})
                    OR (status = 'InProgress' AND ends_at_utc <= {now}))
                ORDER BY starts_at_utc, id
                FOR UPDATE SKIP LOCKED
                LIMIT {options.BatchSize}
                """)
            .ToListAsync(cancellationToken);
        var transitions = 0;
        foreach (var tournament in tournaments)
        {
            var before = tournament.Status;
            tournament.AdvanceLifecycle(now);
            if (tournament.Status != before) transitions++;
            before = tournament.Status;
            tournament.AdvanceLifecycle(now);
            if (tournament.Status != before) transitions++;
        }
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        metrics.RecordLifecycleTransitions(transitions);
        return tournaments.Count;
    }
}

public sealed class TournamentSchedulerMetrics : IDisposable
{
    private readonly Meter meter = new(GonesTelemetry.OperationalMeterName, "1.0.0");
    private readonly Counter<long> planned;
    private readonly Counter<long> cancelled;
    private readonly Counter<long> enqueued;
    private readonly Counter<long> missed;
    private readonly Counter<long> lifecycleTransitions;
    private readonly Histogram<double> dispatchLag;

    public TournamentSchedulerMetrics()
    {
        planned = meter.CreateCounter<long>("gones.scheduler.planned");
        cancelled = meter.CreateCounter<long>("gones.scheduler.cancelled");
        enqueued = meter.CreateCounter<long>("gones.scheduler.enqueued");
        missed = meter.CreateCounter<long>("gones.scheduler.missed");
        lifecycleTransitions = meter.CreateCounter<long>("gones.scheduler.lifecycle_transitions");
        dispatchLag = meter.CreateHistogram<double>("gones.scheduler.dispatch_lag", "s");
    }

    public void RecordPlan(int plannedCount, int cancelledCount)
    {
        planned.Add(plannedCount);
        cancelled.Add(cancelledCount);
    }

    public void RecordDispatch(int enqueuedCount, int missedCount, Duration lag)
    {
        enqueued.Add(enqueuedCount);
        missed.Add(missedCount);
        dispatchLag.Record(Math.Max(0, lag.TotalSeconds));
    }

    public void RecordLifecycleTransitions(int count) => lifecycleTransitions.Add(count);
    public void Dispose() => meter.Dispose();
}
