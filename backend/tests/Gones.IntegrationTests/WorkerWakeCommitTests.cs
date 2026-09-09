using System.Data.Common;
using Gones.Application.Notifications;
using Gones.Domain.Calendar;
using Gones.Infrastructure.Notifications;
using Gones.Infrastructure.Persistence;
using Gones.Infrastructure.Workers;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using NodaTime;

namespace Gones.IntegrationTests;

public sealed class WorkerWakeCommitTests : IAsyncLifetime
{
    private readonly PostgreSqlTestContainer postgres = new();
    private readonly RecordingWake wake = new();
    private readonly IClock clock = SystemClock.Instance;

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using var database = CreateContext();
        await database.Database.MigrateAsync();
    }

    public Task DisposeAsync() => postgres.DisposeAsync().AsTask();

    [Theory]
    [InlineData(false, 1)]
    [InlineData(true, 1)]
    [InlineData(false, 2)]
    [InlineData(true, 2)]
    public async Task Implicit_single_and_multi_command_saves_signal_only_committed_rows(bool asynchronous, int count)
    {
        await using var database = CreateContext();
        for (var index = 0; index < count; index++) Enqueue(database);
        var visibleAtNotification = -1;
        wake.OnNotify = () =>
        {
            using var committed = CreateContext(withWake: false);
            visibleAtNotification = committed.NotificationOutboxRecords.Count();
        };
        Assert.Equal(0, wake.Count);
        if (asynchronous) await database.SaveChangesAsync();
        else database.SaveChanges();
        Assert.Equal(1, wake.Count);
        Assert.Equal(count, visibleAtNotification);
        await database.SaveChangesAsync();
        Assert.Equal(1, wake.Count);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Explicit_multiple_saves_emit_one_hint_only_after_outer_commit(bool asynchronous)
    {
        await using var database = CreateContext();
        await using var transaction = await database.Database.BeginTransactionAsync();
        Enqueue(database);
        await database.SaveChangesAsync();
        Enqueue(database);
        await database.SaveChangesAsync();
        Assert.Equal(0, wake.Count);
        if (asynchronous) await transaction.CommitAsync();
        else transaction.Commit();
        Assert.Equal(1, wake.Count);
        await using var committed = CreateContext(withWake: false);
        Assert.Equal(2, await committed.NotificationOutboxRecords.CountAsync());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Full_rollback_or_disposal_emits_no_hint_and_next_transaction_does_not_inherit_it(bool rollback)
    {
        await using var database = CreateContext();
        await using (var transaction = await database.Database.BeginTransactionAsync())
        {
            Enqueue(database);
            await database.SaveChangesAsync();
            if (rollback) await transaction.RollbackAsync();
        }
        Assert.Equal(0, wake.Count);
        database.ChangeTracker.Clear();
        await using (var empty = await database.Database.BeginTransactionAsync()) await empty.CommitAsync();
        Assert.Equal(0, wake.Count);
        await using var committed = CreateContext(withWake: false);
        Assert.Empty(await committed.NotificationOutboxRecords.ToListAsync());
        Enqueue(database);
        await database.SaveChangesAsync();
        Assert.Equal(1, wake.Count);
    }

    [Fact]
    public async Task Failed_later_save_preserves_hint_for_earlier_successful_transaction_work()
    {
        await using var database = CreateContext();
        await using var transaction = await database.Database.BeginTransactionAsync();
        var key = Guid.NewGuid().ToString("N");
        Enqueue(database, key);
        await database.SaveChangesAsync();
        Enqueue(database, key);
        await Assert.ThrowsAsync<DbUpdateException>(() => database.SaveChangesAsync());
        Assert.Equal(0, wake.Count);
        database.ChangeTracker.Clear();
        await transaction.CommitAsync();
        Assert.Equal(1, wake.Count);
        await using var committed = CreateContext(withWake: false);
        Assert.Single(await committed.NotificationOutboxRecords.ToListAsync());
    }

    [Fact]
    public async Task Manual_savepoint_rollback_may_hint_after_outer_commit_but_never_exposes_rolled_back_work()
    {
        await using var database = CreateContext();
        await using var transaction = await database.Database.BeginTransactionAsync();
        await transaction.CreateSavepointAsync("before_work");
        Enqueue(database);
        await database.SaveChangesAsync();
        await transaction.RollbackToSavepointAsync("before_work");
        database.ChangeTracker.Clear();
        await transaction.CommitAsync();
        Assert.Equal(1, wake.Count);
        await using var committed = CreateContext(withWake: false);
        Assert.Empty(await new NotificationOutboxStore(committed, clock).ClaimAsync(1, Duration.FromMinutes(2), CancellationToken.None));
    }

    [Fact]
    public async Task Failed_save_does_not_signal_and_worker_registration_omits_signal_interceptor()
    {
        await using (var worker = CreateContext(withWake: false))
        {
            Enqueue(worker, "duplicate");
            await worker.SaveChangesAsync();
        }
        await using var database = CreateContext();
        Enqueue(database, "duplicate");
        await Assert.ThrowsAsync<DbUpdateException>(() => database.SaveChangesAsync());
        Assert.Equal(0, wake.Count);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Non_outbox_image_cleanup_producer_signals_only_after_commit(bool rollback)
    {
        await using var database = CreateContext();
        await using var transaction = await database.Database.BeginTransactionAsync();
        var deletion = EventImageObjectDeletion.Create(Guid.NewGuid(), "wake-test/image.webp", clock.GetCurrentInstant());
        database.EventImageObjectDeletions.Add(deletion);
        await database.SaveChangesAsync();
        Assert.Equal(0, wake.Count);
        if (rollback) await transaction.RollbackAsync();
        else await transaction.CommitAsync();
        Assert.Equal(rollback ? 0 : 1, wake.Count);
        await using var committed = CreateContext(withWake: false);
        Assert.Equal(!rollback, await committed.EventImageObjectDeletions.AnyAsync(item => item.ObjectKey == deletion.ObjectKey));
        Assert.Empty(await committed.NotificationOutboxRecords.ToListAsync());
    }

    [Fact]
    public async Task Failed_outer_commit_emits_no_hint()
    {
        await using var database = CreateContext();
        await database.Database.ExecuteSqlRawAsync("ALTER TABLE notification_outbox ADD CONSTRAINT wake_test_deferred UNIQUE (recipient) DEFERRABLE INITIALLY DEFERRED");
        await using var transaction = await database.Database.BeginTransactionAsync();
        Enqueue(database);
        Enqueue(database);
        await database.SaveChangesAsync();
        Assert.Equal(0, wake.Count);
        await Assert.ThrowsAsync<Npgsql.PostgresException>(() => transaction.CommitAsync());
        Assert.Equal(0, wake.Count);
        await using var committed = CreateContext(withWake: false);
        Assert.Empty(await committed.NotificationOutboxRecords.ToListAsync());
    }

    [Fact]
    public async Task Shared_interceptor_keeps_context_transaction_state_separate()
    {
        var interceptor = new WorkerWakeInterceptor(wake, NullLogger<WorkerWakeInterceptor>.Instance);
        var options = new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(postgres.GetConnectionString()).AddInterceptors(interceptor).Options;
        await using var first = new GonesDbContext(options);
        await using var second = new GonesDbContext(options);
        await using var transaction = await first.Database.BeginTransactionAsync();
        Enqueue(first);
        await first.SaveChangesAsync();
        Enqueue(second);
        await second.SaveChangesAsync();
        Assert.Equal(1, wake.Count);
        await transaction.RollbackAsync();
        Assert.Equal(1, wake.Count);
        await using var committed = CreateContext(withWake: false);
        Assert.Single(await committed.NotificationOutboxRecords.ToListAsync());
    }

    [Fact]
    public async Task Signal_failure_does_not_fail_committed_business_mutation()
    {
        wake.Throw = true;
        await using var database = CreateContext();
        Enqueue(database);
        await database.SaveChangesAsync();
        Assert.Equal(1, wake.Count);
        await using var committed = CreateContext(withWake: false);
        Assert.Single(await committed.NotificationOutboxRecords.ToListAsync());
    }

    [Fact]
    public async Task Request_cancellation_after_commit_does_not_suppress_hint()
    {
        using var cancellation = new CancellationTokenSource();
        await using var database = CreateContext(beforeWake: new CancelAfterCommit(cancellation));
        await using var transaction = await database.Database.BeginTransactionAsync();
        Enqueue(database);
        await database.SaveChangesAsync();
        await transaction.CommitAsync(cancellation.Token);
        Assert.True(cancellation.IsCancellationRequested);
        Assert.Equal(1, wake.Count);
    }

    private void Enqueue(GonesDbContext database, string? key = null) => new NotificationOutbox(database, clock).Enqueue(new NotificationRequest(
        "wake@example.test", "en", key ?? Guid.NewGuid().ToString("N"),
        new VerifyEmailTemplateModel("Wake", new Uri("https://app.example/verify"))));

    private GonesDbContext CreateContext(bool withWake = true, IInterceptor? beforeWake = null)
    {
        var options = new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(postgres.GetConnectionString());
        if (beforeWake is not null) options.AddInterceptors(beforeWake);
        if (withWake) options.AddInterceptors(new WorkerWakeInterceptor(wake, NullLogger<WorkerWakeInterceptor>.Instance));
        return new GonesDbContext(options.Options);
    }

    private sealed class RecordingWake : IWorkerWakeNotifier
    {
        public int Count { get; private set; }
        public bool Throw { get; set; }
        public Action? OnNotify { get; set; }
        public void Notify()
        {
            Count++;
            OnNotify?.Invoke();
            if (Throw) throw new IOException("test signal unavailable");
        }
    }

    private sealed class CancelAfterCommit(CancellationTokenSource cancellation) : DbTransactionInterceptor
    {
        public override Task TransactionCommittedAsync(DbTransaction transaction, TransactionEndEventData eventData, CancellationToken cancellationToken = default)
        {
            cancellation.Cancel();
            return Task.CompletedTask;
        }
    }
}
