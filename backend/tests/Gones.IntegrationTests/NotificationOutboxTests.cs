using Gones.Api.Health;
using Gones.Application.Notifications;
using Gones.Domain.Notifications;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Notifications;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Logging.Abstractions;
using NodaTime;
using Testcontainers.PostgreSql;

namespace Gones.IntegrationTests;

public sealed class NotificationOutboxTests : IAsyncLifetime
{
    private readonly PostgreSqlContainer postgres = new PostgreSqlBuilder().WithImage("postgres:17-alpine").Build();
    private readonly MutableClock clock = new(Instant.FromUtc(2026, 7, 31, 12, 0));

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
    }

    public Task DisposeAsync() => postgres.DisposeAsync().AsTask();

    [Fact]
    public async Task App_write_and_notification_roll_back_together()
    {
        await using var db = CreateContext();
        var markerName = $"rollback-{Guid.NewGuid():N}";
        var outbox = new NotificationOutbox(db, clock);
        Guid notificationId;

        await using (var transaction = await db.Database.BeginTransactionAsync())
        {
            db.SchemaVersions.Add(new SchemaVersion { Name = markerName, AppliedAt = clock.GetCurrentInstant() });
            notificationId = outbox.Enqueue(Request($"rollback-{Guid.NewGuid():N}"));
            await db.SaveChangesAsync();
            await transaction.RollbackAsync();
        }

        db.ChangeTracker.Clear();
        Assert.False(await db.SchemaVersions.AnyAsync(item => item.Name == markerName));
        Assert.False(await db.NotificationOutboxRecords.AnyAsync(item => item.Id == notificationId));
    }

    [Fact]
    public async Task Invalid_model_is_rejected_before_staging_database_write()
    {
        await using var db = CreateContext();
        var outbox = new NotificationOutbox(db, clock);
        var invalid = new NotificationRequest(
            "alice@example.test",
            "en",
            $"invalid-{Guid.NewGuid():N}",
            new VerifyEmailTemplateModel("Alice", new Uri("http://app.example/verify")));

        Assert.Throws<NotificationTemplateException>(() => outbox.Enqueue(invalid));
        Assert.Empty(db.ChangeTracker.Entries<NotificationOutboxRecord>());
    }

    [Fact]
    public async Task Dedupe_key_is_unique()
    {
        await using var db = CreateContext();
        var dedupe = $"dedupe-{Guid.NewGuid():N}";
        var outbox = new NotificationOutbox(db, clock);
        outbox.Enqueue(Request(dedupe));
        outbox.Enqueue(Request(dedupe));

        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Concurrent_claimers_receive_disjoint_rows()
    {
        var prefix = $"claim-{Guid.NewGuid():N}";
        await using (var seed = CreateContext())
        {
            var outbox = new NotificationOutbox(seed, clock);
            for (var index = 0; index < 8; index++) outbox.Enqueue(Request($"{prefix}-{index}"));
            await seed.SaveChangesAsync();
        }

        await using var firstDb = CreateContext();
        await using var secondDb = CreateContext();
        var firstStore = new NotificationOutboxStore(firstDb, clock);
        var secondStore = new NotificationOutboxStore(secondDb, clock);
        var claims = await Task.WhenAll(
            firstStore.ClaimAsync(4, Duration.FromMinutes(2), CancellationToken.None),
            secondStore.ClaimAsync(4, Duration.FromMinutes(2), CancellationToken.None));

        var firstIds = claims[0].Select(item => item.Id).ToHashSet();
        var secondIds = claims[1].Select(item => item.Id).ToHashSet();
        Assert.Empty(firstIds.Intersect(secondIds));
        Assert.Equal(8, firstIds.Union(secondIds).Count());
    }

    [Fact]
    public async Task Expired_lease_is_recovered_after_crash()
    {
        var id = await EnqueueAsync($"lease-{Guid.NewGuid():N}");
        await using (var firstDb = CreateContext())
        {
            var first = Assert.Single(await new NotificationOutboxStore(firstDb, clock).ClaimAsync(1, Duration.FromMinutes(2), CancellationToken.None));
            Assert.Equal(id, first.Id);
        }

        clock.Advance(Duration.FromMinutes(2));
        await using var recoveryDb = CreateContext();
        var recovered = Assert.Single(await new NotificationOutboxStore(recoveryDb, clock).ClaimAsync(1, Duration.FromMinutes(2), CancellationToken.None));

        Assert.Equal(id, recovered.Id);
        Assert.Equal(2, recovered.AttemptCount);
    }

    [Fact]
    public async Task Provider_outage_does_not_roll_back_committed_app_write_and_schedules_retry()
    {
        var markerName = $"outage-{Guid.NewGuid():N}";
        Guid notificationId;
        await using (var db = CreateContext())
        {
            var outbox = new NotificationOutbox(db, clock);
            db.SchemaVersions.Add(new SchemaVersion { Name = markerName, AppliedAt = clock.GetCurrentInstant() });
            notificationId = outbox.Enqueue(Request($"outage-{Guid.NewGuid():N}"));
            await db.SaveChangesAsync();
        }

        var transport = new FakeTransport { Error = new EmailTransportException("provider_unavailable", isTransient: true) };
        await ProcessOnceAsync(transport);

        await using var verify = CreateContext();
        Assert.True(await verify.SchemaVersions.AnyAsync(item => item.Name == markerName));
        var notification = await verify.NotificationOutboxRecords.SingleAsync(item => item.Id == notificationId);
        Assert.Equal(NotificationOutboxStatus.Pending, notification.Status);
        Assert.Equal(1, notification.AttemptCount);
        Assert.Equal(clock.GetCurrentInstant() + Duration.FromMinutes(1), notification.AvailableAt);
        Assert.Equal("provider_unavailable", notification.LastErrorCode);
    }

    [Fact]
    public async Task Lost_provider_response_is_held_for_reconciliation_without_blind_retry()
    {
        var id = await EnqueueAsync($"uncertain-{Guid.NewGuid():N}");
        var transport = new FakeTransport { Error = new EmailTransportException("brevo_acceptance_uncertain", true, acceptanceUncertain: true) };

        await ProcessOnceAsync(transport);
        await ProcessOnceAsync(transport);

        Assert.Equal(1, transport.SendCount);
        await using var verify = CreateContext();
        var record = await verify.NotificationOutboxRecords.SingleAsync(item => item.Id == id);
        Assert.Equal(NotificationOutboxStatus.Reconciliation, record.Status);
        Assert.NotNull(record.Recipient);
        Assert.Equal("brevo_acceptance_uncertain", record.LastErrorCode);
    }

    [Fact]
    public async Task Crash_after_provider_acceptance_reuses_idempotency_key_and_provider_accepts_once()
    {
        var id = await EnqueueAsync($"provider-crash-{Guid.NewGuid():N}");
        var transport = new IdempotentTransport();
        await using (var crashedDb = CreateContext())
        {
            var claimed = Assert.Single(await new NotificationOutboxStore(crashedDb, clock).ClaimAsync(1, Duration.FromMinutes(2), CancellationToken.None));
            await transport.SendAsync(ToEmail(claimed), CancellationToken.None);
        }

        clock.Advance(Duration.FromMinutes(2));
        await ProcessOnceAsync(transport);

        Assert.Equal(2, transport.SendCount);
        Assert.Equal(1, transport.AcceptedCount);
        await using var verify = CreateContext();
        Assert.Equal(NotificationOutboxStatus.Sent, (await verify.NotificationOutboxRecords.SingleAsync(item => item.Id == id)).Status);
    }

    [Fact]
    public async Task Recovery_beyond_provider_idempotency_window_holds_for_operator_without_send()
    {
        var id = await EnqueueAsync($"provider-window-{Guid.NewGuid():N}");
        var transport = new IdempotentTransport();
        await using (var crashedDb = CreateContext())
        {
            var claimed = Assert.Single(await new NotificationOutboxStore(crashedDb, clock).ClaimAsync(1, Duration.FromMinutes(2), CancellationToken.None));
            await transport.SendAsync(ToEmail(claimed), CancellationToken.None);
        }

        clock.Advance(Duration.FromHours(24));
        await ProcessOnceAsync(transport);

        Assert.Equal(1, transport.SendCount);
        await using var verify = CreateContext();
        Assert.Equal(NotificationOutboxStatus.Reconciliation, (await verify.NotificationOutboxRecords.SingleAsync(item => item.Id == id)).Status);
    }

    [Fact]
    public async Task Known_transient_rejection_can_retry_after_provider_idempotency_window()
    {
        var id = await EnqueueAsync($"known-rejection-{Guid.NewGuid():N}");
        await ProcessOnceAsync(new FakeTransport { Error = new EmailTransportException("provider_unavailable", true) });
        clock.Advance(Duration.FromHours(24));
        var recovered = new FakeTransport();

        await ProcessOnceAsync(recovered);

        Assert.Equal(1, recovered.SendCount);
        await using var verify = CreateContext();
        Assert.Equal(NotificationOutboxStatus.Sent, (await verify.NotificationOutboxRecords.SingleAsync(item => item.Id == id)).Status);
    }

    [Fact]
    public async Task Five_transient_retries_follow_locked_clock_then_sixth_failure_dead_letters()
    {
        var id = await EnqueueAsync($"retry-clock-{Guid.NewGuid():N}");
        var transport = new FakeTransport { Error = new EmailTransportException("provider_unavailable", true) };
        var delays = new[]
        {
            Duration.FromMinutes(1),
            Duration.FromMinutes(5),
            Duration.FromMinutes(30),
            Duration.FromHours(2),
            Duration.FromHours(12)
        };
        foreach (var delay in delays)
        {
            await ProcessOnceAsync(transport);
            clock.Advance(delay);
        }
        await ProcessOnceAsync(transport);

        await using var verify = CreateContext();
        var record = await verify.NotificationOutboxRecords.SingleAsync(item => item.Id == id);
        Assert.Equal(6, record.AttemptCount);
        Assert.Equal(NotificationOutboxStatus.DeadLetter, record.Status);
        Assert.Null(record.Recipient);
        Assert.Null(record.TemplateModelJson);
    }

    [Fact]
    public async Task Permanent_failure_dead_letters_and_scrubs_payload()
    {
        var id = await EnqueueAsync($"dead-{Guid.NewGuid():N}");
        var transport = new FakeTransport { Error = new EmailTransportException("recipient_rejected", isTransient: false) };

        await ProcessOnceAsync(transport);

        await using var verify = CreateContext();
        var notification = await verify.NotificationOutboxRecords.SingleAsync(item => item.Id == id);
        Assert.Equal(NotificationOutboxStatus.DeadLetter, notification.Status);
        Assert.Null(notification.Recipient);
        Assert.Null(notification.TemplateModelJson);
        Assert.NotNull(notification.ScrubbedAt);
        Assert.False(await verify.NotificationHistory.AnyAsync(item => item.OutboxId == id));
    }

    [Fact]
    public async Task Successful_delivery_is_sent_once_scrubs_payload_and_writes_one_history_row()
    {
        var id = await EnqueueAsync($"sent-{Guid.NewGuid():N}");
        var transport = new FakeTransport();

        await ProcessOnceAsync(transport);
        await ProcessOnceAsync(transport);

        Assert.Equal(1, transport.SendCount);
        await using var verify = CreateContext();
        var notification = await verify.NotificationOutboxRecords.SingleAsync(item => item.Id == id);
        Assert.Equal(NotificationOutboxStatus.Sent, notification.Status);
        Assert.Null(notification.Recipient);
        Assert.Null(notification.TemplateModelJson);
        Assert.NotNull(notification.ScrubbedAt);
        var history = await verify.NotificationHistory.SingleAsync(item => item.OutboxId == id);
        Assert.Equal(notification.DedupeKey, history.DedupeKey);
        Assert.Equal(notification.TemplateKey, history.TemplateKey);
        Assert.Equal(notification.SentAt, history.SentAt);
    }

    [Fact]
    public async Task File_sink_accepts_same_delivery_key_once()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"gones-email-{Guid.NewGuid():N}");
        try
        {
            var transport = new FileEmailTransport(directory, clock);
            var rendered = new NotificationTemplateRenderer().Render("en", new VerifyEmailTemplateModel("Alice", new Uri("https://app.example/verify?token=secret-value")));
            var email = new OutgoingEmail(Guid.NewGuid(), "file-dedupe", NotificationTemplateKeys.VerifyEmail, "alice@example.test", rendered);

            await transport.SendAsync(email, CancellationToken.None);
            await transport.SendAsync(email, CancellationToken.None);

            var file = Assert.Single(Directory.GetFiles(directory, "*.json"));
            var preview = await File.ReadAllTextAsync(file);
            Assert.DoesNotContain("secret-value", preview, StringComparison.Ordinal);
            Assert.DoesNotContain("alice@example.test", preview, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public async Task Crash_after_sink_acceptance_recovers_without_second_file_and_reaches_sent()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"gones-email-crash-{Guid.NewGuid():N}");
        var id = await EnqueueAsync($"crash-after-send-{Guid.NewGuid():N}");
        try
        {
            var transport = new FileEmailTransport(directory, clock);
            await using (var crashedDb = CreateContext())
            {
                var claimed = Assert.Single(await new NotificationOutboxStore(crashedDb, clock).ClaimAsync(1, Duration.FromMinutes(2), CancellationToken.None));
                await transport.SendAsync(ToEmail(claimed), CancellationToken.None);
            }

            clock.Advance(Duration.FromMinutes(2));
            await using (var recoveryDb = CreateContext())
            {
                var store = new NotificationOutboxStore(recoveryDb, clock);
                var recovered = Assert.Single(await store.ClaimAsync(1, Duration.FromMinutes(2), CancellationToken.None));
                await transport.SendAsync(ToEmail(recovered), CancellationToken.None);
                recovered.MarkSent(recovered.LeaseToken!.Value, clock.GetCurrentInstant());
                store.RecordSuccessful(recovered, clock.GetCurrentInstant());
                await store.SaveAsync(CancellationToken.None);
            }

            Assert.Single(Directory.GetFiles(directory, "*.json"));
            await using var verify = CreateContext();
            var notification = await verify.NotificationOutboxRecords.SingleAsync(item => item.Id == id);
            Assert.Equal(NotificationOutboxStatus.Sent, notification.Status);
            Assert.Null(notification.Recipient);
            Assert.Null(notification.TemplateModelJson);
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public async Task Stale_backlog_degrades_readiness_without_becoming_unhealthy()
    {
        await EnqueueAsync($"health-{Guid.NewGuid():N}");
        clock.Advance(Duration.FromMinutes(10));
        await using var db = CreateContext();
        var check = new NotificationOutboxHealthCheck(db, clock, new NotificationHealthOptions(Duration.FromMinutes(5)));

        var result = await check.CheckHealthAsync(new HealthCheckContext(), CancellationToken.None);

        Assert.Equal(HealthStatus.Degraded, result.Status);
        Assert.Equal(1L, result.Data["backlogCount"]);
        Assert.Equal(600d, result.Data["oldestLagSeconds"]);
    }

    private async Task<Guid> EnqueueAsync(string dedupe)
    {
        await using var db = CreateContext();
        var id = new NotificationOutbox(db, clock).Enqueue(Request(dedupe));
        await db.SaveChangesAsync();
        return id;
    }

    private async Task ProcessOnceAsync(IEmailTransport transport)
    {
        await using var db = CreateContext();
        var options = new NotificationWorkerOptions(
            BatchSize: 10,
            PollInterval: Duration.FromMilliseconds(10),
            LeaseDuration: Duration.FromMinutes(2),
            SendTimeout: Duration.FromSeconds(30),
            SinkPath: Path.GetTempPath());
        var processor = new NotificationProcessor(
            new NotificationOutboxStore(db, clock),
            new NotificationTemplateRenderer(),
            transport,
            DefaultNotificationRetryPolicy.Instance,
            new NotificationMetrics(),
            options,
            clock,
            NullLogger<NotificationProcessor>.Instance);
        await processor.ProcessBatchAsync(CancellationToken.None);
    }

    private NotificationRequest Request(string dedupe) => new(
        "alice@example.test",
        "en",
        dedupe,
        new VerifyEmailTemplateModel("Alice", new Uri("https://app.example/verify?token=test-token")));

    private static OutgoingEmail ToEmail(NotificationOutboxRecord record)
    {
        var model = NotificationModelSerializer.Deserialize(record.TemplateKey, record.TemplateModelJson!);
        var rendered = new NotificationTemplateRenderer().Render(record.Locale, model);
        return new OutgoingEmail(record.Id, record.DedupeKey, record.TemplateKey, record.Recipient!, rendered);
    }

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString())
        .Options);

    private sealed class MutableClock(Instant current) : IClock
    {
        public Instant GetCurrentInstant() => current;
        public void Advance(Duration duration) => current += duration;
    }

    private sealed class IdempotentTransport : IEmailTransport
    {
        private readonly HashSet<string> accepted = new(StringComparer.Ordinal);
        public int SendCount { get; private set; }
        public int AcceptedCount => accepted.Count;

        public Task<EmailTransportResult> SendAsync(OutgoingEmail email, CancellationToken cancellationToken)
        {
            SendCount++;
            accepted.Add(email.DedupeKey);
            return Task.FromResult(new EmailTransportResult("provider-id"));
        }
    }

    private sealed class FakeTransport : IEmailTransport
    {
        public EmailTransportException? Error { get; init; }
        public int SendCount { get; private set; }

        public Task<EmailTransportResult> SendAsync(OutgoingEmail email, CancellationToken cancellationToken)
        {
            SendCount++;
            if (Error is not null) throw Error;
            return Task.FromResult(new EmailTransportResult());
        }
    }
}
