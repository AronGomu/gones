using Gones.Domain.Calendar;
using Gones.Domain.Catalog;
using Gones.Domain.Identity;
using Gones.Domain.Organizations;
using Gones.Infrastructure.Calendar;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Notifications;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using Testcontainers.PostgreSql;

namespace Gones.IntegrationTests;

public sealed class TournamentSchedulerTests : IAsyncLifetime
{
    private readonly PostgreSqlContainer postgres = new PostgreSqlBuilder().WithImage("postgres:17-alpine").Build();
    private readonly MutableClock clock = new(Instant.FromUtc(2030, 1, 1, 0, 0));
    private SeedRows seed = null!;

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using var database = CreateContext();
        await database.Database.MigrateAsync();
        seed = await SeedAsync(database);
    }

    public Task DisposeAsync() => postgres.DisposeAsync().AsTask();

    [Fact]
    public async Task Daily_planner_is_replica_safe_and_late_registration_gets_only_future_unique_intents()
    {
        var tournament = await CreateTournamentAsync(new LocalDate(2030, 5, 15));
        var firstRegistration = await RegisterAsync(tournament.Id, seed.User.Id);
        await using var firstDatabase = CreateContext();
        await using var secondDatabase = CreateContext();
        var runs = await Task.WhenAll(
            Reconciler(firstDatabase).RefreshDailyAsync(CancellationToken.None),
            Reconciler(secondDatabase).RefreshDailyAsync(CancellationToken.None));
        Assert.Contains(true, runs);

        await using (var verification = CreateContext())
        {
            var rows = await verification.ScheduledNotifications.Where(item => item.RegistrationAttemptId == firstRegistration.Id).ToListAsync();
            Assert.NotEmpty(rows);
            Assert.Equal(rows.Count, rows.Select(item => item.DedupeKey).Distinct(StringComparer.Ordinal).Count());
            Assert.All(rows, item => Assert.True(item.ScheduledAtUtc > clock.GetCurrentInstant()));
        }

        var lateUser = await CreateUserAsync("late");
        var lateRegistration = await RegisterAsync(tournament.Id, lateUser.Id);
        clock.Set(Instant.FromUtc(2030, 4, 20, 12, 0));
        await using var lateDatabase = CreateContext();
        Assert.True(await Reconciler(lateDatabase).RefreshDailyAsync(CancellationToken.None));

        await using var lateVerification = CreateContext();
        var lateRows = await lateVerification.ScheduledNotifications.Where(item => item.RegistrationAttemptId == lateRegistration.Id).ToListAsync();
        Assert.NotEmpty(lateRows);
        Assert.All(lateRows, item => Assert.True(item.ScheduledAtUtc > clock.GetCurrentInstant()));
    }

    [Fact]
    public async Task Major_date_change_cancels_future_planned_rows_replans_and_marks_marker_processed()
    {
        var tournament = await CreateTournamentAsync(new LocalDate(2030, 5, 15));
        await RegisterAsync(tournament.Id, seed.User.Id);
        await using (var initial = CreateContext()) Assert.True(await Reconciler(initial).RefreshDailyAsync(CancellationToken.None));
        List<string> oldDedupe;
        await using (var before = CreateContext())
        {
            oldDedupe = await before.ScheduledNotifications.Where(item => item.TournamentId == tournament.Id).Select(item => item.DedupeKey).ToListAsync();
        }

        var changedDate = new LocalDate(2030, 6, 20);
        var zone = DateTimeZoneProviders.Tzdb["Europe/Paris"];
        var changedStart = zone.AtStrictly(changedDate.At(new LocalTime(12, 0))).ToInstant();
        var changedEnd = zone.AtStrictly(changedDate.At(new LocalTime(18, 0))).ToInstant();
        Guid markerId;
        await using (var update = CreateContext())
        {
            await update.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE scheduled_tournaments
                SET venue_start_date = {changedDate}, venue_end_date = {changedDate},
                    starts_at_utc = {changedStart}, ends_at_utc = {changedEnd}, updated_at = {clock.GetCurrentInstant()}, version = version + 1
                WHERE id = {tournament.Id}
                """);
            var marker = TournamentLifecycleEvent.Create(
                tournament.Id,
                seed.User.Id,
                TournamentLifecycleEventType.MajorDetailsUpdated,
                TournamentReminderPlanAction.RecalculateFuture,
                clock.GetCurrentInstant());
            markerId = marker.Id;
            update.TournamentLifecycleEvents.Add(marker);
            await update.SaveChangesAsync();
        }

        await using (var changed = CreateContext()) Assert.True(await Reconciler(changed).RefreshPendingChangesAsync(CancellationToken.None));
        await using var verification = CreateContext();
        Assert.All(
            await verification.ScheduledNotifications.Where(item => oldDedupe.Contains(item.DedupeKey)).ToListAsync(),
            item => Assert.Equal(ScheduledNotificationStatus.Cancelled, item.Status));
        Assert.Contains(await verification.ScheduledNotifications.Where(item => item.TournamentId == tournament.Id).ToListAsync(),
            item => item.Status == ScheduledNotificationStatus.Planned && !oldDedupe.Contains(item.DedupeKey));
        Assert.NotNull((await verification.TournamentLifecycleEvents.SingleAsync(item => item.Id == markerId)).ReminderPlanProcessedAt);
    }

    [Fact]
    public async Task Cancel_delete_and_unregister_make_future_intents_ineligible()
    {
        var cancelled = await CreateTournamentAsync(new LocalDate(2030, 5, 15));
        var deleted = await CreateTournamentAsync(new LocalDate(2030, 5, 16));
        var unregistered = await CreateTournamentAsync(new LocalDate(2030, 5, 17));
        var cancelledRegistration = await RegisterAsync(cancelled.Id, seed.User.Id);
        var deletedRegistration = await RegisterAsync(deleted.Id, seed.User.Id);
        var unregisteredRegistration = await RegisterAsync(unregistered.Id, seed.User.Id);
        await using (var initial = CreateContext()) Assert.True(await Reconciler(initial).RefreshDailyAsync(CancellationToken.None));

        await using (var mutation = CreateContext())
        {
            (await mutation.ScheduledTournaments.SingleAsync(item => item.Id == cancelled.Id)).Cancel(clock.GetCurrentInstant());
            (await mutation.ScheduledTournaments.SingleAsync(item => item.Id == deleted.Id)).SoftDelete(seed.User.Id, null, clock.GetCurrentInstant());
            (await mutation.TournamentRegistrationAttempts.SingleAsync(item => item.Id == unregisteredRegistration.Id)).CancelByUser(seed.User.Id, clock.GetCurrentInstant());
            await mutation.SaveChangesAsync();
        }
        await using (var refresh = CreateContext()) Assert.True(await Reconciler(refresh).RefreshDailyAsync(CancellationToken.None));

        await using var verification = CreateContext();
        foreach (var registrationId in new[] { cancelledRegistration.Id, deletedRegistration.Id, unregisteredRegistration.Id })
        {
            var rows = await verification.ScheduledNotifications.Where(item => item.RegistrationAttemptId == registrationId).ToListAsync();
            Assert.NotEmpty(rows);
            Assert.All(rows, item => Assert.Equal(ScheduledNotificationStatus.Cancelled, item.Status));
        }
    }

    [Fact]
    public async Task Dispatcher_is_replica_safe_marks_downtime_due_missed_and_restart_never_sends_late()
    {
        var timelyTournament = await CreateTournamentAsync(new LocalDate(2030, 3, 15));
        var timelyRegistration = await RegisterAsync(timelyTournament.Id, seed.User.Id);
        await using (var plan = CreateContext()) Assert.True(await Reconciler(plan).RefreshDailyAsync(CancellationToken.None));
        Instant dueAt;
        await using (var lookup = CreateContext())
        {
            dueAt = await lookup.ScheduledNotifications.Where(item => item.RegistrationAttemptId == timelyRegistration.Id).MinAsync(item => item.ScheduledAtUtc);
        }
        clock.Set(dueAt);
        await using var firstDatabase = CreateContext();
        await using var secondDatabase = CreateContext();
        await Task.WhenAll(
            Dispatcher(firstDatabase).DispatchDueAsync(CancellationToken.None),
            Dispatcher(secondDatabase).DispatchDueAsync(CancellationToken.None));
        await using (var verification = CreateContext())
        {
            var row = await verification.ScheduledNotifications.SingleAsync(item => item.RegistrationAttemptId == timelyRegistration.Id && item.ScheduledAtUtc == dueAt);
            Assert.Equal(ScheduledNotificationStatus.Enqueued, row.Status);
            Assert.Equal(1, await verification.NotificationOutboxRecords.CountAsync(item => item.DedupeKey == row.DedupeKey));
        }

        var downtimeTournament = await CreateTournamentAsync(new LocalDate(2030, 8, 15));
        var downtimeRegistration = await RegisterAsync(downtimeTournament.Id, seed.User.Id);
        await using (var plan = CreateContext()) Assert.True(await Reconciler(plan).RefreshDailyAsync(CancellationToken.None));
        Instant missedAt;
        await using (var lookup = CreateContext())
        {
            missedAt = await lookup.ScheduledNotifications.Where(item => item.RegistrationAttemptId == downtimeRegistration.Id).MinAsync(item => item.ScheduledAtUtc);
        }
        clock.Set(missedAt + Duration.FromMinutes(2));
        await using (var stoppedWorker = CreateContext()) await Dispatcher(stoppedWorker).DispatchDueAsync(CancellationToken.None);
        await using (var restartedWorker = CreateContext()) await Dispatcher(restartedWorker).DispatchDueAsync(CancellationToken.None);

        await using var downtimeVerification = CreateContext();
        var missed = await downtimeVerification.ScheduledNotifications.SingleAsync(item => item.RegistrationAttemptId == downtimeRegistration.Id && item.ScheduledAtUtc == missedAt);
        Assert.Equal(ScheduledNotificationStatus.Missed, missed.Status);
        Assert.False(await downtimeVerification.NotificationOutboxRecords.AnyAsync(item => item.DedupeKey == missed.DedupeKey));
    }

    [Fact]
    public async Task Lifecycle_poller_advances_start_explicit_end_and_venue_end_day_but_not_cancelled_or_deleted()
    {
        var explicitEnd = await CreateTournamentAsync(new LocalDate(2030, 1, 2), new LocalTime(12, 0), new LocalTime(13, 0));
        var venueEndDay = await CreateTournamentAsync(new LocalDate(2030, 1, 2), new LocalTime(12, 0), null);
        var cancelled = await CreateTournamentAsync(new LocalDate(2030, 1, 2), new LocalTime(12, 0), new LocalTime(13, 0));
        var deleted = await CreateTournamentAsync(new LocalDate(2030, 1, 2), new LocalTime(12, 0), new LocalTime(13, 0));
        await using (var mutation = CreateContext())
        {
            (await mutation.ScheduledTournaments.SingleAsync(item => item.Id == cancelled.Id)).Cancel(clock.GetCurrentInstant());
            (await mutation.ScheduledTournaments.SingleAsync(item => item.Id == deleted.Id)).SoftDelete(seed.User.Id, null, clock.GetCurrentInstant());
            await mutation.SaveChangesAsync();
        }

        clock.Set(explicitEnd.StartsAtUtc);
        await using (var start = CreateContext()) await Poller(start).AdvanceAsync(CancellationToken.None);
        await AssertStatus(explicitEnd.Id, ScheduledTournamentStatus.InProgress);
        await AssertStatus(venueEndDay.Id, ScheduledTournamentStatus.InProgress);

        clock.Set(explicitEnd.EndsAtUtc);
        await using (var end = CreateContext()) await Poller(end).AdvanceAsync(CancellationToken.None);
        await AssertStatus(explicitEnd.Id, ScheduledTournamentStatus.Completed);
        await AssertStatus(venueEndDay.Id, ScheduledTournamentStatus.InProgress);

        clock.Set(venueEndDay.EndsAtUtc);
        await using (var endDay = CreateContext()) await Poller(endDay).AdvanceAsync(CancellationToken.None);
        await AssertStatus(venueEndDay.Id, ScheduledTournamentStatus.Completed);
        await AssertStatus(cancelled.Id, ScheduledTournamentStatus.Cancelled);
        await AssertStatus(deleted.Id, ScheduledTournamentStatus.Published);
    }

    private TournamentScheduleReconciler Reconciler(GonesDbContext database) => new(database, clock, Options, new TournamentSchedulerMetrics());
    private TournamentReminderDispatcher Dispatcher(GonesDbContext database) => new(database, new NotificationOutbox(database, clock), clock, Options, new TournamentSchedulerMetrics());
    private TournamentLifecyclePoller Poller(GonesDbContext database) => new(database, clock, Options, new TournamentSchedulerMetrics());

    private async Task AssertStatus(Guid tournamentId, ScheduledTournamentStatus status)
    {
        await using var database = CreateContext();
        Assert.Equal(status, (await database.ScheduledTournaments.SingleAsync(item => item.Id == tournamentId)).Status);
    }

    private async Task<ScheduledTournament> CreateTournamentAsync(LocalDate date, LocalTime? start = null, LocalTime? end = null)
    {
        await using var database = CreateContext();
        var legacy = await database.TournamentFormats.SingleAsync(item => item.Slug == TournamentFormat.LegacySlug);
        var slug = $"cup-{Guid.NewGuid():N}";
        var tournament = ScheduledTournament.Create(
            seed.Organization.Id,
            seed.User.Id,
            new ScheduledTournamentDraft(
                "Scheduler Cup",
                slug,
                null,
                null,
                "1 Main Street",
                null,
                "Paris",
                "France",
                "Europe/Paris",
                date.At(start ?? new LocalTime(12, 0)),
                end is null ? null : date.At(end.Value),
                64),
            [legacy],
            clock.GetCurrentInstant());
        database.ScheduledTournaments.Add(tournament);
        await database.SaveChangesAsync();
        return tournament;
    }

    private async Task<TournamentRegistrationAttempt> RegisterAsync(Guid tournamentId, Guid userId)
    {
        await using var database = CreateContext();
        var attempt = TournamentRegistrationAttempt.Register(tournamentId, userId, userId, clock.GetCurrentInstant());
        database.TournamentRegistrationAttempts.Add(attempt);
        await database.SaveChangesAsync();
        return attempt;
    }

    private async Task<ApplicationUser> CreateUserAsync(string prefix)
    {
        await using var database = CreateContext();
        var user = User(prefix);
        database.Users.Add(user);
        database.UserProfiles.Add(UserProfile.Create(user.Id, $"{prefix}{Guid.NewGuid():N}"[..12], "Test", "User", clock.GetCurrentInstant()));
        await database.SaveChangesAsync();
        return user;
    }

    private async Task<SeedRows> SeedAsync(GonesDbContext database)
    {
        var user = User("main");
        var organization = Organization.Create($"Scheduler Club {Guid.NewGuid():N}", null, null, null, clock.GetCurrentInstant());
        database.Users.Add(user);
        database.UserProfiles.Add(UserProfile.Create(user.Id, "SchedulerUser", "Test", "User", clock.GetCurrentInstant()));
        database.Organizations.Add(organization);
        if (!await database.TournamentFormats.AnyAsync(item => item.Slug == TournamentFormat.LegacySlug))
        {
            database.TournamentFormats.Add(TournamentFormat.CreateLegacy(clock.GetCurrentInstant()));
        }
        await database.SaveChangesAsync();
        return new SeedRows(user, organization);
    }

    private static ApplicationUser User(string prefix)
    {
        var unique = Guid.NewGuid().ToString("N");
        var email = $"{prefix}-{unique}@example.test";
        return new ApplicationUser
        {
            Id = Guid.NewGuid(),
            UserName = email,
            NormalizedUserName = email.ToUpperInvariant(),
            Email = email,
            NormalizedEmail = email.ToUpperInvariant(),
            EmailConfirmed = true,
            SecurityStamp = Guid.NewGuid().ToString("N"),
            ConcurrencyStamp = Guid.NewGuid().ToString("N")
        };
    }

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString())
        .Options);

    private static readonly TournamentSchedulerOptions Options = new(
        100,
        Duration.FromMinutes(1),
        Duration.FromHours(24),
        "https://app.example/");

    private sealed record SeedRows(ApplicationUser User, Organization Organization);

    private sealed class MutableClock(Instant current) : IClock
    {
        public Instant GetCurrentInstant() => current;
        public void Set(Instant value) => current = value;
    }
}
