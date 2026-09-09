extern alias WorkerHost;

using System.Collections.Concurrent;
using System.Data.Common;
using Gones.Application.Events;
using Gones.Application.Notifications;
using Gones.Domain.Calendar;
using Gones.Domain.Catalog;
using Gones.Domain.Identity;
using Gones.Domain.Organizations;
using Gones.Domain.Persistence;
using Gones.Domain.Notifications;
using Gones.Api.Security;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.IdentityModel.Tokens;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Gones.Infrastructure.Calendar;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Notifications;
using Gones.Infrastructure.Observability;
using Gones.Infrastructure.Persistence;
using Gones.Infrastructure.Workers;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NodaTime;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Gones.IntegrationTests;

public sealed class WorkerDueRuntimeTests : IAsyncLifetime
{
    [Fact]
    public void Idle_mode_requires_private_wake_and_health_configuration_before_startup()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["GONES_WORKER_IDLE_MODE"] = "true",
            ["GONES_PUBLIC_APP_ORIGIN"] = "https://app.example",
            ["GONES_EMAIL_TRANSPORT"] = "File",
            ["GONES_EMAIL_SINK_PATH"] = Path.GetTempPath()
        }).Build();
        Assert.Throws<InvalidOperationException>(() =>
            WorkerHost::Gones.Worker.Worker.AddRuntimeServices(new ServiceCollection(), configuration));
    }

    private readonly PostgreSqlTestContainer postgres = new();
    private readonly WorkerTestTime time = new(Instant.FromUtc(2030, 1, 1, 12, 0));
    private readonly DatabaseObserver observer = new();
    private readonly ConnectionObserver connections = new();
    private readonly Transport transport = new();
    private readonly Objects objects = new();
    private string directory = null!;
    private IConfigurationRoot config = null!;
    private ServiceProvider? provider;
    private IHostedService[] hosted = [];
    private WorkerDueDispatcher Dispatcher => provider!.GetRequiredService<WorkerDueDispatcher>();

    public async Task InitializeAsync()
    {
        if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException();
        await postgres.StartAsync();
        var root = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (root is not null && !File.Exists(Path.Combine(root.FullName, "AGENT.md"))) root = root.Parent;
        directory = Path.Combine(root!.FullName, ".tmp", $"d-{Guid.NewGuid():N}"[..10]);
        Directory.CreateDirectory(directory, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            [WorkerIdleOptions.ModeKey] = "true",
            [WorkerIdleOptions.HealthPathKey] = Path.Combine(directory, "health.json"),
            [WorkerWakeOptions.SocketKey] = Path.Combine(directory, "w.sock"),
            [WorkerWakeOptions.TokenKey] = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32)),
            [PersistenceServiceCollectionExtensions.ConnectionStringKey] = postgres.GetConnectionString(),
            ["GONES_PUBLIC_APP_ORIGIN"] = "https://app.example",
            ["GONES_EMAIL_TRANSPORT"] = "File",
            ["GONES_EMAIL_SINK_PATH"] = directory,
            ["GONES_SCHEDULER_BATCH_SIZE"] = "2"
        }).Build();
        await using var database = CreateContext();
        await database.GetService<IMigrator>().MigrateAsync("20260903174856_SingularEventImage");
        database.WorkerHeartbeats.Add(new WorkerHeartbeatRecord { WorkerId = "upgrade-proof", LastSeenAt = time.GetCurrentInstant() });
        await database.SaveChangesAsync();
        await database.Database.MigrateAsync();
        Assert.Equal("upgrade-proof", (await database.WorkerHeartbeats.SingleAsync()).WorkerId);
        Assert.False(database.Database.HasPendingModelChanges());
    }

    public async Task DisposeAsync()
    {
        await StopAsync();
        await postgres.DisposeAsync();
        if (directory is not null) Directory.Delete(directory, recursive: true);
    }

    [Fact]
    public async Task Actual_worker_ten_minutes_idle_has_zero_DB_activity_then_persisted_deadline_sends()
    {
        var due = time.GetCurrentInstant() + Duration.FromMinutes(11);
        await EnqueueAsync(due);
        await StartAsync();
        await IdleAsync();
        var count = observer.Commands;
        var opens = connections.Opens;
        Assert.True(count > 0, "Startup must exercise command instrumentation.");
        Assert.True(opens > 0, "Startup must exercise connection instrumentation.");
        await using (var scope = provider!.CreateAsyncScope())
        {
            var control = scope.ServiceProvider.GetRequiredService<GonesDbContext>();
            await control.Database.OpenConnectionAsync();
            Assert.Equal(opens + 1, connections.Opens);
            Assert.Equal(1, connections.Active);
            await control.Database.CloseConnectionAsync();
            Assert.Equal(0, connections.Active);
        }
        opens = connections.Opens;
        var start = time.GetCurrentInstant();
        for (var index = 0; index < 60; index++)
        {
            time.Advance(Duration.FromSeconds(10));
            await IdleAsync();
            Assert.Equal(count, observer.Commands);
            Assert.Equal(opens, connections.Opens);
            Assert.Equal(0, connections.Active);
            Assert.Equal(WorkerRuntimeHealth.Healthy, Dispatcher.Snapshot!.Check(time.GetCurrentInstant()));
        }
        Assert.Equal(Duration.FromMinutes(10), time.GetCurrentInstant() - start);
        Assert.Empty(transport.Sent);
        for (var index = 0; index < 6; index++)
        {
            time.Advance(Duration.FromSeconds(10));
            await IdleAsync();
        }
        Assert.Single(transport.Sent);
        Assert.Equal(due, transport.Sent.Single().At);
        await using var database = CreateContext();
        Assert.Single(await database.NotificationHistory.ToListAsync());
        Assert.Equal(4, await database.WorkerMaintenance.CountAsync());
        Assert.Equal(1, await database.WorkerHeartbeats.CountAsync());
    }

    [Fact]
    public async Task External_committed_work_wakes_actual_idle_worker_independently_of_scheduled_timer()
    {
        await StartAsync();
        await IdleAsync();
        var committedAt = time.GetCurrentInstant();
        await EnqueueAsync();
        await WakeAsync();
        await IdleAsync();
        Assert.Single(transport.Sent);
        Assert.InRange((transport.Sent.Single().At - committedAt).TotalSeconds, 0, 5);
        await using var database = CreateContext();
        Assert.Single(await database.NotificationHistory.ToListAsync());
    }

    [Fact]
    public async Task Removed_stale_deadline_is_requeried_not_authorized_by_timer()
    {
        await EnqueueAsync(time.GetCurrentInstant() + Duration.FromMinutes(1));
        await StartAsync();
        await IdleAsync();
        await using (var database = CreateContext())
        {
            database.NotificationOutboxRecords.Remove(await database.NotificationOutboxRecords.SingleAsync());
            await database.SaveChangesAsync();
        }
        for (var index = 0; index < 6; index++)
        {
            time.Advance(Duration.FromSeconds(10));
            await IdleAsync();
        }
        Assert.Empty(transport.Sent);
    }

    [Fact]
    public async Task Registration_without_marker_is_reconciled_on_external_commit_hint()
    {
        var (eventId, userId) = await EventAsync(register: false);
        await StartAsync();
        await IdleAsync();
        await using (var database = CreateContext())
        {
            Assert.Empty(await database.EventLifecycleEntries.ToListAsync());
            database.EventRegistrationAttempts.Add(EventRegistrationAttempt.Register(eventId, userId, userId, time.GetCurrentInstant()));
            await database.SaveChangesAsync();
        }
        await WakeAsync();
        await IdleAsync();
        await using var check = CreateContext();
        var rows = await check.ScheduledNotifications.ToListAsync();
        Assert.NotEmpty(rows);
        Assert.All(rows, row => Assert.True(row.ScheduledAtUtc > time.GetCurrentInstant()));
        Assert.Equal(rows.Count, rows.Select(row => row.DedupeKey).Distinct().Count());
    }

    [Fact]
    public async Task Registration_hint_consumed_near_wait_deadline_plans_before_hourly_recovery()
    {
        var (eventId, userId) = await EventAsync(register: false);
        var started = time.GetCurrentInstant();
        var due = started + Duration.FromSeconds(0.5);
        await EnqueueAsync(due);
        await StartAsync();
        await IdleAsync();
        time.Advance(Duration.FromSeconds(0.25));
        await using (var database = CreateContext())
        {
            Assert.Empty(await database.EventLifecycleEntries.ToListAsync());
            Assert.Empty(await database.ScheduledNotifications.ToListAsync());
            database.EventRegistrationAttempts.Add(EventRegistrationAttempt.Register(eventId, userId, userId, time.GetCurrentInstant()));
            await database.SaveChangesAsync();
        }
        var client = new WorkerWakeClient(WorkerWakeOptions.TryLoad(config)!, Microsoft.Extensions.Logging.Abstractions.NullLogger<WorkerWakeClient>.Instance);
        Assert.True(await client.SendAsync(CancellationToken.None));
        await WaitUntilAsync(() => time.TimerCount == 2);
        time.Advance(Duration.FromSeconds(0.25));
        await IdleAsync();
        Assert.Equal(due, time.GetCurrentInstant());
        Assert.Equal(due, Assert.Single(transport.Sent).At);
        await using var check = CreateContext();
        Assert.Empty(await check.EventLifecycleEntries.ToListAsync());
        var plans = await check.ScheduledNotifications.Where(row => row.EventId == eventId).ToListAsync();
        Assert.NotEmpty(plans);
        Assert.All(plans, row => Assert.True(row.ScheduledAtUtc > due));
        Assert.Equal(plans.Count, plans.Select(row => row.DedupeKey).Distinct().Count());
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Pacing_timeout_preserves_consumed_hint_without_orphan_reader_or_deadline_extension(bool hint)
    {
        var signal = new WorkerWakeSignal(time);
        if (hint) signal.Notify();
        var started = time.GetCurrentInstant();
        var waiting = signal.WaitAsync(TimeSpan.FromMilliseconds(500), CancellationToken.None, TimeSpan.FromSeconds(1));
        time.Advance(Duration.FromSeconds(0.5));
        Assert.Equal(hint, await waiting.WaitAsync(TimeSpan.FromSeconds(5)));
        Assert.Equal(Duration.FromSeconds(0.5), time.GetCurrentInstant() - started);
        Assert.Equal(0, time.TimerCount);
        Assert.False(signal.TryTake());
        signal.Notify();
        Assert.True(signal.TryTake());
    }

    [Fact]
    public async Task Stopping_cancellation_during_consumed_hint_pacing_still_throws()
    {
        var signal = new WorkerWakeSignal(time);
        signal.Notify();
        using var stopping = new CancellationTokenSource();
        var waiting = signal.WaitAsync(TimeSpan.FromMilliseconds(500), stopping.Token, TimeSpan.FromSeconds(1));
        stopping.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => waiting);
        Assert.Equal(0, time.TimerCount);
        signal.Notify();
        Assert.True(signal.TryTake());
    }

    [Fact]
    public async Task Three_slow_sends_do_not_make_already_due_reminder_missed()
    {
        await EventAsync(register: true, reminderAt: time.GetCurrentInstant());
        for (var index = 0; index < 3; index++) await EnqueueAsync();
        transport.OnSend = _ => { time.Advance(Duration.FromSeconds(29)); return Task.CompletedTask; };
        await StartAsync();
        await IdleAsync();
        await using var database = CreateContext();
        var due = await database.ScheduledNotifications.Where(row => row.ScheduledAtUtc < time.GetCurrentInstant()).ToListAsync();
        Assert.Single(due);
        Assert.Equal(ScheduledNotificationStatus.Enqueued, due[0].Status);
        Assert.Equal(4, transport.Sent.Count);
        Assert.Equal(4, await database.NotificationHistory.CountAsync());
    }

    [Fact]
    public async Task Image_backlog_rechecks_reminders_and_new_outbox_between_provider_operations()
    {
        var due = time.GetCurrentInstant() + Duration.FromSeconds(5);
        await EventAsync(register: true, reminderAt: due);
        await using (var database = CreateContext())
        {
            for (var index = 0; index < 3; index++)
            {
                var id = Guid.NewGuid();
                database.EventImageObjectDeletions.Add(EventImageObjectDeletion.Create(id, EventImageObjectKeys.Variant(id, 640), time.GetCurrentInstant()));
            }
            await database.SaveChangesAsync();
        }
        var deletes = 0;
        objects.OnDelete = async _ =>
        {
            time.Advance(Duration.FromSeconds(10));
            if (++deletes == 1) await EnqueueAsync();
            if (deletes == 2)
            {
                Assert.NotEmpty(transport.Sent);
                await using var database = CreateContext();
                Assert.Equal(ScheduledNotificationStatus.Enqueued, (await database.ScheduledNotifications.SingleAsync(row => row.ScheduledAtUtc == due)).Status);
            }
        };
        await StartAsync();
        await IdleAsync();
        Assert.Equal(3, deletes);
        Assert.Equal(2, transport.Sent.Count);
    }

    [Fact]
    public async Task Daily_failed_state_survives_restart_full_batch_drain_clears_only_own_failure()
    {
        await StartAsync();
        await IdleAsync();
        var succeededAt = time.GetCurrentInstant();
        await StopAsync();
        await using (var database = CreateContext())
        {
            var state = await database.WorkerMaintenance.SingleAsync(row => row.Key == "Idempotency");
            state.Fail(time.GetCurrentInstant());
            for (var index = 0; index < 501; index++) database.IdempotencyRecords.Add(new IdempotencyRecord
            {
                Scope = "worker-test", Key = index.ToString(), ResponseStatusCode = 200, ResponseBody = "{}",
                CreatedAt = time.GetCurrentInstant() - Duration.FromDays(1), ExpiresAt = time.GetCurrentInstant()
            });
            await database.SaveChangesAsync();
        }
        await StartAsync();
        await IdleAsync(WorkerRuntimeState.Failed);
        Assert.Equal(WorkerRuntimeHealth.Degraded, Dispatcher.Snapshot!.Check(time.GetCurrentInstant()));
        await using (var database = CreateContext())
        {
            Assert.Equal(501, await database.IdempotencyRecords.CountAsync());
            Assert.Equal(succeededAt, (await database.WorkerMaintenance.SingleAsync(row => row.Key == "Idempotency")).LastSucceededAt);
        }
        for (var index = 0; index < 360; index++)
        {
            time.Advance(Duration.FromSeconds(10));
            await IdleAsync(index == 359 ? WorkerRuntimeState.Idle : WorkerRuntimeState.Failed);
        }
        await using var check = CreateContext();
        Assert.Empty(await check.IdempotencyRecords.ToListAsync());
        var completed = await check.WorkerMaintenance.SingleAsync(row => row.Key == "Idempotency");
        Assert.False(completed.HasFailed);
        Assert.Equal(time.GetCurrentInstant(), completed.LastSucceededAt);
        Assert.Equal(Instant.FromUtc(2030, 1, 2, 0, 0), completed.NextDueAt);
    }

    [Fact]
    public async Task Recovered_empty_outbox_scan_returns_to_bounded_healthy_idle()
    {
        observer.FailOnlyMin = true;
        observer.FailContaining = "FROM notification_outbox";
        await StartAsync();
        await IdleAsync(WorkerRuntimeState.Failed);
        Assert.True(observer.Failures > 0);
        observer.FailContaining = null;
        time.Advance(Duration.FromSeconds(5));
        try { await IdleAsync(); }
        catch (OperationCanceledException) { Assert.Fail("Recovered empty scan must register a bounded healthy idle wait."); }
        var count = observer.Commands;
        var opens = connections.Opens;
        await Task.Delay(200);
        Assert.Equal(count, observer.Commands);
        Assert.Equal(opens, connections.Opens);
        Assert.Equal(0, connections.Active);
        Assert.True(time.TimerCount > 0);
        Assert.Equal(WorkerRuntimeHealth.Healthy, Dispatcher.Snapshot!.Check(time.GetCurrentInstant()));
    }

    [Fact]
    public async Task Recovered_scan_does_not_clear_independent_persisted_daily_failure()
    {
        await using (var database = CreateContext())
        {
            var state = new WorkerMaintenanceState("Idempotency", time.GetCurrentInstant());
            state.Fail(time.GetCurrentInstant());
            database.WorkerMaintenance.Add(state);
            await database.SaveChangesAsync();
        }
        observer.FailOnlyMin = true;
        observer.FailContaining = "FROM notification_outbox";
        await StartAsync();
        await IdleAsync(WorkerRuntimeState.Failed);
        observer.FailContaining = null;
        time.Advance(Duration.FromSeconds(5));
        await IdleAsync(WorkerRuntimeState.Failed);
        var count = observer.Commands;
        await Task.Delay(200);
        Assert.Equal(count, observer.Commands);
        await using var check = CreateContext();
        var failed = await check.WorkerMaintenance.SingleAsync(row => row.Key == "Idempotency");
        Assert.True(failed.HasFailed);
        Assert.Null(failed.LastSucceededAt);
        Assert.Equal(WorkerRuntimeHealth.Degraded, Dispatcher.Snapshot!.Check(time.GetCurrentInstant()));
    }

    [Fact]
    public async Task Scheduler_scan_failure_does_not_block_outbox_or_bypass_retry_floor_on_flood()
    {
        observer.FailContaining = "FROM events";
        await EnqueueAsync();
        await StartAsync();
        await IdleAsync(WorkerRuntimeState.Failed);
        Assert.Single(transport.Sent);
        var failed = observer.Failures;
        for (var index = 0; index < 20; index++) provider!.GetRequiredService<WorkerWakeSignal>().Notify();
        await WaitUntilAsync(() => time.TimerCount >= 2);
        time.Advance(Duration.FromSeconds(1));
        await IdleAsync(WorkerRuntimeState.Failed);
        Assert.Equal(failed, observer.Failures);
        Assert.Equal(0, connections.Active);
        await using var database = CreateContext();
        Assert.Single(await database.NotificationHistory.ToListAsync());
        Assert.Null((await database.WorkerMaintenance.SingleAsync(row => row.Key == "ReminderPlan")).LastSucceededAt);
    }

    [Fact]
    public async Task Busy_hint_replans_registration_behind_committed_page_cursor_without_duplicates()
    {
        for (var index = 0; index < 3; index++) await EventAsync(register: false);
        Guid eventId;
        Guid userId;
        await using (var database = CreateContext())
        {
            var first = await database.Events.OrderBy(row => row.Id).FirstAsync();
            eventId = first.Id;
            userId = first.CreatedByUserId;
        }
        for (var index = 0; index < 6; index++) await EnqueueAsync();
        var sends = 0;
        transport.OnSend = async _ =>
        {
            time.Advance(Duration.FromSeconds(1));
            if (++sends != 2) return;
            await using var database = CreateContext();
            Assert.Null((await database.WorkerMaintenance.SingleAsync(row => row.Key == "ReminderPlan")).LastSucceededAt);
            database.EventRegistrationAttempts.Add(EventRegistrationAttempt.Register(eventId, userId, userId, time.GetCurrentInstant()));
            await database.SaveChangesAsync();
            provider!.GetRequiredService<WorkerWakeSignal>().Notify();
        };
        await StartAsync();
        await IdleAsync();
        await using var check = CreateContext();
        var plans = await check.ScheduledNotifications.Where(row => row.EventId == eventId).ToListAsync();
        Assert.NotEmpty(plans);
        Assert.Equal(plans.Count, plans.Select(row => row.DedupeKey).Distinct().Count());
        Assert.Equal(6, transport.Sent.Count);
        Assert.Empty(await check.EventLifecycleEntries.ToListAsync());
    }

    [Fact]
    public async Task Planner_lock_contention_never_advances_success_or_blocks_notification_send()
    {
        await EventAsync(register: true);
        await EnqueueAsync();
        await using var locked = CreateContext();
        await using var transaction = await locked.Database.BeginTransactionAsync();
        // Match the existing planner's single advisory lock, not a second leadership mechanism.
        await locked.Database.ExecuteSqlRawAsync($"SELECT pg_advisory_xact_lock({0x474F4E4553433237L})");
        await StartAsync();
        await IdleAsync(WorkerRuntimeState.Failed);
        Assert.Single(transport.Sent);
        await using (var check = CreateContext())
        {
            var row = await check.WorkerMaintenance.SingleAsync(row => row.Key == "ReminderPlan");
            Assert.Null(row.LastSucceededAt);
            Assert.False(row.HasFailed);
        }
        await transaction.CommitAsync();
        time.Advance(Duration.FromSeconds(5));
        await IdleAsync();
        await using var completed = CreateContext();
        Assert.NotNull((await completed.WorkerMaintenance.SingleAsync(row => row.Key == "ReminderPlan")).LastSucceededAt);
        Assert.NotEmpty(await completed.ScheduledNotifications.ToListAsync());
    }

    [Fact]
    public async Task Actual_cleaner_failure_persists_failure_without_success_then_restart_honors_retry()
    {
        observer.FailContaining = "FROM idempotency_records";
        await StartAsync();
        await IdleAsync(WorkerRuntimeState.Failed);
        await StopAsync();
        observer.FailContaining = null;
        await using (var check = CreateContext())
        {
            var row = await check.WorkerMaintenance.SingleAsync(row => row.Key == "Idempotency");
            Assert.Null(row.LastSucceededAt);
            Assert.True(row.HasFailed);
            Assert.Equal(time.GetCurrentInstant() + Duration.FromHours(1), row.NextDueAt);
        }
        var failures = observer.Failures;
        await StartAsync();
        await IdleAsync(WorkerRuntimeState.Failed);
        await WakeAsync();
        await IdleAsync(WorkerRuntimeState.Failed);
        Assert.Equal(failures, observer.Failures);
        await using var unchanged = CreateContext();
        Assert.Null((await unchanged.WorkerMaintenance.SingleAsync(row => row.Key == "Idempotency")).LastSucceededAt);
    }

    [Fact]
    public async Task Metadata_501_per_source_drains_before_success_and_image_101_failures_are_not_empty_queue()
    {
        var now = time.GetCurrentInstant();
        var old = now - Duration.FromDays(366);
        await using (var database = CreateContext())
        {
            for (var index = 0; index < 501; index++)
            {
                var record = new NotificationOutboxRecord(Guid.NewGuid().ToString("N"), "verify-email", "en", "worker@example.test", "{}", null, null, old);
                var lease = record.Claim(old, Duration.FromMinutes(2));
                record.MarkSent(lease, old, $"provider-{index}");
                database.NotificationOutboxRecords.Add(record);
                database.NotificationDeliveryEvents.Add(NotificationDeliveryEvent.Create($"replay-{index}", record.Id, $"provider-{index}", NotificationDeliveryStatus.Delivered, old, old));
            }
            for (var index = 0; index < 101; index++)
            {
                var id = Guid.NewGuid();
                database.EventImageObjectDeletions.Add(EventImageObjectDeletion.Create(id, EventImageObjectKeys.Variant(id, 640), now));
            }
            await database.SaveChangesAsync();
        }
        var observedPartial = false;
        observer.OnCommand = command =>
        {
            if (!command.CommandText.Contains("FROM notification_delivery_events", StringComparison.Ordinal)) return;
            using var database = CreateContext();
            if (database.NotificationDeliveryEvents.Count() != 1) return;
            Assert.Null(database.WorkerMaintenance.Single(row => row.Key == "DeliveryMetadata").LastSucceededAt);
            observedPartial = true;
        };
        var failures = 0;
        objects.OnDelete = _ => { Interlocked.Increment(ref failures); throw new IOException("injected-object-delete-failure"); };
        await StartAsync();
        await IdleAsync();
        for (var index = 0; index < 100; index++)
        {
            time.Advance(Duration.FromSeconds(1));
            await IdleAsync();
        }
        Assert.Equal(101, failures);
        Assert.True(observedPartial);
        await using var check = CreateContext();
        Assert.Empty(await check.NotificationDeliveryEvents.ToListAsync());
        Assert.Equal(501, await check.NotificationOutboxRecords.CountAsync(row => row.DeliveryMetadataScrubbedAt != null));
        var deletions = await check.EventImageObjectDeletions.ToListAsync();
        Assert.Equal(101, deletions.Count);
        Assert.All(deletions, row => { Assert.Equal(1, row.Attempts); Assert.True(row.NextAttemptAt >= now + Duration.FromMinutes(15)); });
        Assert.NotNull((await check.WorkerMaintenance.SingleAsync(row => row.Key == "DeliveryMetadata")).LastSucceededAt);
    }

    [Fact]
    public async Task Local_health_anonymous_and_valid_bearer_bypass_DB_auth_deep_readiness_and_business_auth_do_not()
    {
        var (_, userId) = await EventAsync(register: false);
        await StartAsync();
        await IdleAsync();
        var apiObserver = new DatabaseObserver();
        var apiConnections = new ConnectionObserver();
        const string signingKey = "worker-health-test-signing-key-at-least-thirty-two-characters";
        await using var app = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            foreach (var item in config.AsEnumerable()) builder.UseSetting(item.Key, item.Value);
            builder.UseSetting("GONES_FEATURES:AUTH_V1", "true");
            builder.UseSetting("GONES_AUTH_PROVIDER", "Local");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", signingKey);
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.ConfigureTestServices(services =>
            {
                services.AddSingleton<IClock>(time);
                services.ConfigureDbContext<GonesDbContext>(options => options.AddInterceptors(apiObserver, apiConnections));
            });
        });
        using var client = app.CreateClient();
        var before = apiObserver.Commands;
        var opens = apiConnections.Opens;
        using var anonymous = await client.GetAsync("/health/worker");
        Assert.Equal(HttpStatusCode.OK, anonymous.StatusCode);
        var token = new JwtSecurityToken(AuthorizationPolicies.JwtIssuer, AuthorizationPolicies.JwtAudience,
            [new Claim("sub", userId.ToString()), new Claim("role", "User"), new Claim(AuthorizationPolicies.SecurityStampClaim, "test-stamp")],
            DateTime.UtcNow.AddMinutes(-1), DateTime.UtcNow.AddMinutes(5),
            new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey)), SecurityAlgorithms.HmacSha256));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", new JwtSecurityTokenHandler().WriteToken(token));
        using var authenticated = await client.GetAsync("/health/worker");
        Assert.Equal(HttpStatusCode.OK, authenticated.StatusCode);
        Assert.Equal(before, apiObserver.Commands);
        Assert.Equal(opens, apiConnections.Opens);
        Assert.Equal(0, apiConnections.Active);
        using var business = await client.GetAsync("/api/auth/me");
        Assert.True(apiObserver.Commands > before, "Valid bearer still invokes DB security-stamp validation on business routes.");
        before = apiObserver.Commands;
        client.DefaultRequestHeaders.Authorization = null;
        using var deep = await client.GetAsync("/health/ready");
        Assert.Equal(HttpStatusCode.OK, deep.StatusCode);
        Assert.True(apiObserver.Commands > before);
        apiObserver.FailContaining = "notification_outbox";
        using var failedDeep = await client.GetAsync("/health/ready");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, failedDeep.StatusCode);
        using var unaffectedLocal = await client.GetAsync("/health/worker");
        Assert.Equal(HttpStatusCode.OK, unaffectedLocal.StatusCode);
    }

    [Fact]
    public async Task Due_minima_preserve_pending_retry_sending_lease_and_exclude_terminal_outbox_states()
    {
        var now = time.GetCurrentInstant();
        await using var database = CreateContext();
        NotificationOutboxRecord NewRecord() => new(Guid.NewGuid().ToString("N"), "verify-email", "en", "worker@example.test", "{}", null, null, now);
        var pending = NewRecord();
        pending.MarkRetry(pending.Claim(now, Duration.FromMinutes(2)), now + Duration.FromMinutes(20), "transport_unexpected");
        var sending = NewRecord();
        sending.Claim(now, Duration.FromMinutes(5));
        var held = NewRecord();
        held.MarkReconciliation(held.Claim(now, Duration.FromMinutes(1)), now, "transport_acceptance_uncertain");
        var sent = NewRecord();
        sent.MarkSent(sent.Claim(now, Duration.FromMinutes(1)), now);
        var dead = NewRecord();
        dead.MarkDeadLetter(dead.Claim(now, Duration.FromMinutes(1)), now, "transport_unexpected");
        database.NotificationOutboxRecords.AddRange(pending, sending, held, sent, dead);
        await database.SaveChangesAsync();
        var query = new WorkerDueQuery(database, time);
        Assert.Equal(now + Duration.FromMinutes(5), (await query.ReadAsync(WorkerWorkKind.Outbox, CancellationToken.None)).At);
        sending.MarkSent(sending.LeaseToken!.Value, now);
        await database.SaveChangesAsync();
        Assert.Equal(now + Duration.FromMinutes(20), (await query.ReadAsync(WorkerWorkKind.Outbox, CancellationToken.None)).At);
        pending.MarkReconciliation(pending.Claim(now + Duration.FromMinutes(20), Duration.FromMinutes(1)), now + Duration.FromMinutes(20), "transport_acceptance_uncertain");
        await database.SaveChangesAsync();
        Assert.Null((await query.ReadAsync(WorkerWorkKind.Outbox, CancellationToken.None)).At);
    }

    [Fact]
    public async Task Due_minima_cover_image_states_pending_markers_reminders_and_double_lifecycle_catchup()
    {
        var now = time.GetCurrentInstant();
        var (eventId, userId) = await EventAsync(register: true, reminderAt: now + Duration.FromMinutes(3));
        await using var database = CreateContext();
        var query = new WorkerDueQuery(database, time);
        var item = await database.Events.SingleAsync(row => row.Id == eventId);
        Assert.Equal(item.StartsAtUtc, (await query.ReadAsync(WorkerWorkKind.Lifecycle, CancellationToken.None)).At);
        Assert.Equal(now + Duration.FromMinutes(3), (await query.ReadAsync(WorkerWorkKind.Reminders, CancellationToken.None)).At);
        var marker = EventLifecycleEntry.Create(eventId, userId, TournamentLifecycleEventType.MajorDetailsUpdated, TournamentReminderPlanAction.RecalculateFuture, now);
        database.EventLifecycleEntries.Add(marker);
        var temporary = EventImage.CreateTemporary(Guid.NewGuid(), userId, 640, 480, now);
        database.EventImages.Add(temporary);
        var proposal = EventProposal.Create(userId, "{}", now);
        var owned = EventImage.CreateTemporary(Guid.NewGuid(), userId, 640, 480, now);
        owned.AttachToProposal(proposal.Id, userId, proposal.ExpiresAt, now);
        database.EventProposals.Add(proposal);
        database.EventImages.Add(owned);
        await database.SaveChangesAsync();
        Assert.Equal(now, (await query.ReadAsync(WorkerWorkKind.Markers, CancellationToken.None)).At);
        Assert.Equal(temporary.ExpiresAt, (await query.ReadAsync(WorkerWorkKind.ImageExpiry, CancellationToken.None)).At);
        temporary.AttachToEvent(eventId, userId, now);
        marker.MarkReminderPlanProcessed(now);
        (await database.ScheduledNotifications.SingleAsync()).Cancel(now);
        await database.SaveChangesAsync();
        Assert.Null((await query.ReadAsync(WorkerWorkKind.Markers, CancellationToken.None)).At);
        Assert.Null((await query.ReadAsync(WorkerWorkKind.Reminders, CancellationToken.None)).At);
        Assert.Equal(proposal.ExpiresAt, (await query.ReadAsync(WorkerWorkKind.ImageExpiry, CancellationToken.None)).At);
        proposal.Reject(userId, "test", now);
        await database.SaveChangesAsync();
        Assert.Equal(now, (await query.ReadAsync(WorkerWorkKind.ImageExpiry, CancellationToken.None)).At);
        var deletion = EventImageObjectDeletion.Create(Guid.NewGuid(), "event-images/test/640.webp", now);
        deletion.DeferUntil(now + Duration.FromMinutes(15));
        database.EventImageObjectDeletions.Add(deletion);
        await database.SaveChangesAsync();
        Assert.Equal(now + Duration.FromMinutes(15), (await query.ReadAsync(WorkerWorkKind.ImageDeletion, CancellationToken.None)).At);
        time.Advance(item.EndsAtUtc - now);
        using var metrics = new TournamentSchedulerMetrics();
        var poller = new TournamentLifecyclePoller(database, time, TournamentSchedulerOptions.Load(config), metrics);
        Assert.Equal(1, await poller.AdvanceAsync(CancellationToken.None));
        Assert.Equal(ScheduledTournamentStatus.Completed, item.Status);
        Assert.Null((await query.ReadAsync(WorkerWorkKind.Lifecycle, CancellationToken.None)).At);
    }

    [Fact]
    public async Task Snapshot_IO_failure_after_provider_acceptance_never_reclassifies_ack_as_send_failure()
    {
        if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException();
        await EnqueueAsync();
        transport.OnSend = _ =>
        {
            if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException();
            File.SetUnixFileMode(config[WorkerIdleOptions.HealthPathKey]!, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.OtherRead);
            return Task.CompletedTask;
        };
        await StartAsync();
        var worker = hosted.OfType<BackgroundService>().Last();
        await WaitUntilAsync(() => worker.ExecuteTask!.IsCompleted);
        Assert.True(worker.ExecuteTask!.IsFaulted);
        await using var database = CreateContext();
        var row = await database.NotificationOutboxRecords.SingleAsync();
        Assert.Equal(NotificationOutboxStatus.Sent, row.Status);
        Assert.Equal(1, row.AttemptCount);
        Assert.Null(row.LastErrorCode);
        Assert.Single(await database.NotificationHistory.ToListAsync());
    }

    private async Task StartAsync()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddGonesPersistence(postgres.GetConnectionString());
        services.ConfigureDbContext<GonesDbContext>(options => options.AddInterceptors(observer, connections));
        services.AddSingleton<IClock>(time);
        services.AddSingleton<TimeProvider>(time);
        services.AddSingleton<OperationalMetrics>();
        WorkerHost::Gones.Worker.Worker.AddRuntimeServices(services, config);
        services.AddSingleton<IEmailTransport>(transport);
        services.AddSingleton<IEventImageObjectStore>(objects);
        transport.Clock = time;
        provider = services.BuildServiceProvider();
        Assert.Null(provider.GetService<WorkerWakeInterceptor>());
        hosted = provider.GetServices<IHostedService>().ToArray();
        foreach (var service in hosted) await service.StartAsync(CancellationToken.None);
    }

    private async Task StopAsync()
    {
        if (provider is null) return;
        using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        foreach (var service in hosted.Reverse()) await service.StopAsync(stop.Token);
        await provider.DisposeAsync();
        provider = null;
        hosted = [];
    }

    private async Task IdleAsync(WorkerRuntimeState state = WorkerRuntimeState.Idle)
    {
        await WaitUntilAsync(() => Dispatcher.Snapshot is { } value && value.State == state
            && value.ObservedAt == time.GetCurrentInstant().ToUnixTimeTicks() && time.TimerCount > 0);
        Assert.Equal(0, connections.Active);
    }

    private async Task WakeAsync()
    {
        var client = new WorkerWakeClient(WorkerWakeOptions.TryLoad(config)!, Microsoft.Extensions.Logging.Abstractions.NullLogger<WorkerWakeClient>.Instance);
        Assert.True(await client.SendAsync(CancellationToken.None));
        await WaitUntilAsync(() => time.TimerCount >= 2);
        time.Advance(Duration.FromSeconds(1));
    }

    private static async Task WaitUntilAsync(Func<bool> condition)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        while (!condition()) await Task.Delay(5, timeout.Token);
    }

    private async Task EnqueueAsync(Instant? availableAt = null)
    {
        await using var database = CreateContext();
        var id = new NotificationOutbox(database, time).Enqueue(new NotificationRequest("worker@example.test", "en", Guid.NewGuid().ToString("N"),
            new VerifyEmailTemplateModel("Worker", new Uri("https://app.example/verify"))));
        await database.SaveChangesAsync();
        if (availableAt is { } due) await database.Database.ExecuteSqlInterpolatedAsync($"UPDATE notification_outbox SET available_at = {due} WHERE id = {id}");
    }

    private async Task<(Guid EventId, Guid UserId)> EventAsync(bool register, Instant? reminderAt = null)
    {
        await using var database = CreateContext();
        var user = new ApplicationUser { Id = Guid.NewGuid(), UserName = $"worker-{Guid.NewGuid():N}", Email = "worker@example.test", EmailConfirmed = true, SecurityStamp = "test-stamp" };
        var organization = Organization.Create($"Worker Club {Guid.NewGuid():N}", null, null, null, time.GetCurrentInstant());
        var format = await database.TournamentFormats.SingleAsync(row => row.Slug == TournamentFormat.LegacySlug);
        database.Users.Add(user);
        database.UserProfiles.Add(UserProfile.Create(user.Id, $"u{Guid.NewGuid():N}"[..12], "Worker", "Test", time.GetCurrentInstant()));
        database.Organizations.Add(organization);
        var date = new LocalDate(2030, 6, 15);
        var item = Event.Create(organization.Id, user.Id, new ScheduledTournamentDraft("Worker Cup", $"cup-{Guid.NewGuid():N}", null, null,
            "1 Main Street", "75001", "Paris", "France", "UTC", date.At(new LocalTime(12, 0)), date.At(new LocalTime(18, 0)), 64, Region: "Île-de-France"), [format], time.GetCurrentInstant());
        database.Events.Add(item);
        if (register)
        {
            var registration = EventRegistrationAttempt.Register(item.Id, user.Id, user.Id, time.GetCurrentInstant());
            database.EventRegistrationAttempts.Add(registration);
            if (reminderAt is { } due) database.ScheduledNotifications.Add(ScheduledNotification.Create(item.Id, registration.Id, user.Id,
                new ReminderOccurrence(ScheduledNotificationType.DayOne, date.PlusDays(-1), due), time.GetCurrentInstant() - Duration.FromSeconds(1)));
        }
        await database.SaveChangesAsync();
        return (item.Id, user.Id);
    }

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(postgres.GetConnectionString()).Options);

    private sealed class Transport : IEmailTransport
    {
        public IClock Clock { get; set; } = null!;
        public ConcurrentQueue<(Guid Id, Instant At)> Sent { get; } = new();
        public Func<OutgoingEmail, Task>? OnSend { get; set; }
        public async Task<EmailTransportResult> SendAsync(OutgoingEmail email, CancellationToken cancellationToken)
        {
            if (OnSend is not null) await OnSend(email);
            Sent.Enqueue((email.OutboxId, Clock.GetCurrentInstant()));
            return new EmailTransportResult();
        }
    }

    private sealed class Objects : IEventImageObjectStore
    {
        public Func<string, Task>? OnDelete { get; set; }
        public Task DeleteAsync(string key, CancellationToken cancellationToken) => OnDelete?.Invoke(key) ?? Task.CompletedTask;
        public Task PutAsync(string key, Stream content, string contentType, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<Stream> OpenReadAsync(string key, CancellationToken cancellationToken) => throw new NotSupportedException();
    }

    private sealed class DatabaseObserver : DbCommandInterceptor
    {
        private int commands;
        private int failures;
        public int Commands => Volatile.Read(ref commands);
        public int Failures => Volatile.Read(ref failures);
        public string? FailContaining { get; set; }
        public bool FailOnlyMin { get; set; }
        public Action<DbCommand>? OnCommand { get; set; }
        private void Observe(DbCommand command)
        {
            Interlocked.Increment(ref commands);
            OnCommand?.Invoke(command);
            if (FailContaining is { } match && command.CommandText.Contains(match, StringComparison.Ordinal)
                && (!FailOnlyMin || command.CommandText.StartsWith("SELECT min(", StringComparison.Ordinal)))
            {
                Interlocked.Increment(ref failures);
                throw new InvalidOperationException("injected-worker-query-failure");
            }
        }
        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        { Observe(command); return ValueTask.FromResult(result); }
        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        { Observe(command); return ValueTask.FromResult(result); }
        public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<object> result, CancellationToken cancellationToken = default)
        { Observe(command); return ValueTask.FromResult(result); }
        public override InterceptionResult<DbDataReader> ReaderExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result)
        { Observe(command); return result; }
        public override InterceptionResult<int> NonQueryExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<int> result)
        { Observe(command); return result; }
        public override InterceptionResult<object> ScalarExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<object> result)
        { Observe(command); return result; }
    }

    private sealed class ConnectionObserver : DbConnectionInterceptor
    {
        private int active;
        private int opens;
        public int Active => Volatile.Read(ref active);
        public int Opens => Volatile.Read(ref opens);
        public override Task ConnectionOpenedAsync(DbConnection connection, ConnectionEndEventData eventData, CancellationToken cancellationToken = default)
        { Interlocked.Increment(ref active); Interlocked.Increment(ref opens); return Task.CompletedTask; }
        public override Task ConnectionClosedAsync(DbConnection connection, ConnectionEndEventData eventData)
        { Interlocked.Decrement(ref active); return Task.CompletedTask; }
        public override void ConnectionOpened(DbConnection connection, ConnectionEndEventData eventData)
        { Interlocked.Increment(ref active); Interlocked.Increment(ref opens); }
        public override void ConnectionClosed(DbConnection connection, ConnectionEndEventData eventData) => Interlocked.Decrement(ref active);
    }
}
