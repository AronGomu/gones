extern alias WorkerHost;

using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using Gones.Application.Notifications;
using Gones.Infrastructure.EventProviders;
using Gones.Infrastructure.Notifications;
using Gones.Infrastructure.Observability;
using Gones.Infrastructure.Persistence;
using Gones.Infrastructure.Workers;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NodaTime;

namespace Gones.IntegrationTests;

public sealed class WorkerWakeRuntimeTests(Xunit.Abstractions.ITestOutputHelper output)
{
    [Theory]
    [InlineData(0)]
    [InlineData(6000)]
    public async Task Actual_worker_consumes_private_wake_before_sixty_second_poll_deadline(int precommitDelayMilliseconds)
    {
        if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException();
        await using var postgres = new PostgreSqlTestContainer();
        await postgres.StartAsync();
        var root = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (root is not null && !File.Exists(Path.Combine(root.FullName, "AGENT.md"))) root = root.Parent;
        var directory = Path.Combine(root!.FullName, ".tmp", $"wk-{Guid.NewGuid():N}"[..11]);
        Directory.CreateDirectory(directory, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            [WorkerWakeOptions.SocketKey] = Path.Combine(directory, "w.sock"),
            [WorkerWakeOptions.TokenKey] = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)),
            [PersistenceServiceCollectionExtensions.ConnectionStringKey] = postgres.GetConnectionString(),
            ["GONES_PUBLIC_APP_ORIGIN"] = "https://app.example",
            ["GONES_EMAIL_TRANSPORT"] = "File",
            ["GONES_EMAIL_SINK_PATH"] = Path.Combine(directory, "sink"),
            ["GONES_NOTIFICATION_POLL_MILLISECONDS"] = "60000"
        }).Build();
        var observer = new InitialPassObserver();
        var services = new ServiceCollection();
        services.AddLogging(builder => builder.AddProvider(observer));
        services.AddGonesPersistence(postgres.GetConnectionString());
        services.AddEventProviderFoundations(configuration);
        services.AddSingleton<OperationalMetrics>();
        WorkerHost::Gones.Worker.Worker.AddRuntimeServices(services, configuration);
        await using var provider = services.BuildServiceProvider();
        Assert.Null(provider.GetService<WorkerWakeInterceptor>());
        Assert.Null(provider.GetService<IWorkerWakeNotifier>());
        using (var scope = provider.CreateScope())
            await scope.ServiceProvider.GetRequiredService<GonesDbContext>().Database.MigrateAsync();
        var hosted = provider.GetServices<IHostedService>().ToArray();
        try
        {
            foreach (var service in hosted) await service.StartAsync(CancellationToken.None);
            await observer.Completed.Task.WaitAsync(TimeSpan.FromSeconds(10));
            Assert.Equal(0, observer.SchedulerFailureCount);
            Assert.Equal(0, observer.FailureCount);
            // Empty successful initial pass reaches the normal 60s polling wait, not failure backoff.
            await Task.Delay(150);
            using var app = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            {
                builder.UseEnvironment("Testing");
                foreach (var item in configuration.AsEnumerable()) builder.UseSetting(item.Key, item.Value);
                builder.UseSetting("GONES_OTEL_CONSOLE_EXPORTER", "false");
                builder.UseSetting("GONES_ALLOW_TEST_NOTIFICATION", "true");
                builder.ConfigureTestServices(apiServices =>
                {
                    apiServices.ConfigureDbContext<GonesDbContext>(options =>
                        options.AddInterceptors(new DelayedSaveInterceptor(precommitDelayMilliseconds)));
                    var notifier = apiServices.Single(service => service.ServiceType == typeof(IWorkerWakeNotifier));
                    apiServices.Remove(notifier);
                    apiServices.AddSingleton(provider => new CommitObserver((IWorkerWakeNotifier)notifier.ImplementationFactory!(provider)));
                    apiServices.AddSingleton<IWorkerWakeNotifier>(provider => provider.GetRequiredService<CommitObserver>());
                });
            });
            using var client = app.CreateClient();
            var commit = app.Services.GetRequiredService<CommitObserver>();
            Assert.Equal(0, commit.CommittedAt);
            var started = Stopwatch.StartNew();
            using var response = await client.PostAsJsonAsync("/ops/probes/notification", new { });
            Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
            Assert.NotEqual(0, commit.CommittedAt);
            output.WriteLine($"Probe response at {started.Elapsed.TotalMilliseconds:F0}ms; scheduler failures={observer.SchedulerFailureCount}; outer failures={observer.FailureCount}.");
            var deliveredAt = await observer.Delivered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            // Measure before forwarding the real post-commit hint through persistence completion,
            // never from the HTTP response: request setup/delay is not committed-job latency.
            var deliveryLatency = Stopwatch.GetElapsedTime(commit.CommittedAt, deliveredAt);
            output.WriteLine($"Post-commit hint to persisted delivery: {deliveryLatency.TotalMilliseconds:F0}ms.");
            Assert.True(deliveryLatency >= TimeSpan.Zero && deliveryLatency <= TimeSpan.FromSeconds(5),
                "Actual Worker must consume the wake and persist delivery history before the 60s polling fallback.");
            Assert.Equal(0, observer.SchedulerFailureCount);
            Assert.Equal(0, observer.FailureCount);
            using (var scope = provider.CreateScope())
                Assert.Equal(1, await scope.ServiceProvider.GetRequiredService<GonesDbContext>().NotificationHistory.CountAsync());
            Assert.Single(Directory.GetFiles(Path.Combine(directory, "sink"), "*.json"));

            // Break only this disposable DB's claim table. Authenticated hints must not bypass failed-pass backoff.
            using (var scope = provider.CreateScope())
                await scope.ServiceProvider.GetRequiredService<GonesDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE notification_outbox RENAME TO wake_test_outbox");
            var wakeClient = new WorkerWakeClient(WorkerWakeOptions.TryLoad(configuration)!, Microsoft.Extensions.Logging.Abstractions.NullLogger<WorkerWakeClient>.Instance);
            Assert.True(await wakeClient.SendAsync(CancellationToken.None));
            await observer.Failed.Task.WaitAsync(TimeSpan.FromSeconds(5));
            for (var index = 0; index < 5; index++)
            {
                Assert.True(await wakeClient.SendAsync(CancellationToken.None));
                await Task.Delay(100);
            }
            await Task.Delay(1200);
            Assert.Equal(1, observer.FailureCount);
        }
        finally
        {
            using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            foreach (var service in hosted.Reverse()) await service.StopAsync(stop.Token);
            await provider.DisposeAsync();
            Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public async Task Scheduler_failure_with_full_notification_batch_preserves_poll_backoff_under_authenticated_hints()
    {
        if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException();
        await using var postgres = new PostgreSqlTestContainer();
        await postgres.StartAsync();
        var root = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (root is not null && !File.Exists(Path.Combine(root.FullName, "AGENT.md"))) root = root.Parent;
        var directory = Path.Combine(root!.FullName, ".tmp", $"wk-{Guid.NewGuid():N}"[..11]);
        Directory.CreateDirectory(directory, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        var pollInterval = TimeSpan.FromSeconds(3);
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            [WorkerWakeOptions.SocketKey] = Path.Combine(directory, "w.sock"),
            [WorkerWakeOptions.TokenKey] = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)),
            ["GONES_PUBLIC_APP_ORIGIN"] = "https://app.example",
            ["GONES_EMAIL_TRANSPORT"] = "File",
            ["GONES_EMAIL_SINK_PATH"] = Path.Combine(directory, "sink"),
            ["GONES_NOTIFICATION_POLL_MILLISECONDS"] = "3000",
            ["GONES_NOTIFICATION_BATCH_SIZE"] = "1"
        }).Build();
        var observer = new InitialPassObserver();
        var services = new ServiceCollection();
        services.AddLogging(builder => builder.AddProvider(observer));
        services.AddGonesPersistence(postgres.GetConnectionString());
        services.AddEventProviderFoundations(configuration);
        services.AddSingleton<OperationalMetrics>();
        WorkerHost::Gones.Worker.Worker.AddRuntimeServices(services, configuration);
        await using var provider = services.BuildServiceProvider();
        using (var scope = provider.CreateScope())
        {
            var database = scope.ServiceProvider.GetRequiredService<GonesDbContext>();
            await database.Database.MigrateAsync();
            new NotificationOutbox(database, SystemClock.Instance).Enqueue(new NotificationRequest(
                "backoff@example.test", "en", Guid.NewGuid().ToString("N"),
                new VerifyEmailTemplateModel("Backoff", new Uri("https://app.example/verify"))));
            await database.SaveChangesAsync();
            // Scheduler fails; notification claim/send/ack remain real and successful in this disposable DB.
            await database.Database.ExecuteSqlRawAsync("ALTER TABLE events RENAME TO wake_test_events");
        }
        var hosted = provider.GetServices<IHostedService>().ToArray();
        try
        {
            foreach (var service in hosted) await service.StartAsync(CancellationToken.None);
            await observer.Completed.Task.WaitAsync(TimeSpan.FromSeconds(10));
            using (var scope = provider.CreateScope())
                Assert.Equal(1, await scope.ServiceProvider.GetRequiredService<GonesDbContext>().NotificationHistory.CountAsync());
            Assert.Single(Directory.GetFiles(Path.Combine(directory, "sink"), "*.json"));
            Assert.Equal(1, observer.SchedulerFailureCount);
            Assert.Equal(0, observer.FailureCount);

            var client = new WorkerWakeClient(WorkerWakeOptions.TryLoad(configuration)!, Microsoft.Extensions.Logging.Abstractions.NullLogger<WorkerWakeClient>.Instance);
            for (var index = 0; index < 10; index++)
            {
                Assert.True(await client.SendAsync(CancellationToken.None));
                await Task.Delay(75);
            }
            await Task.Delay(750);
            Assert.False(observer.NextSchedulerFailure.Task.IsCompleted, "Full successful batch and authenticated hints must not bypass scheduler-failure backoff.");
            var nextScan = await observer.NextSchedulerFailure.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.True(System.Diagnostics.Stopwatch.GetElapsedTime(observer.CompletedAt, nextScan) >= pollInterval,
                "Next scheduler scan must occur no earlier than the failed pass polling deadline.");
        }
        finally
        {
            using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            foreach (var service in hosted.Reverse()) await service.StopAsync(stop.Token);
            await provider.DisposeAsync();
            Directory.Delete(directory, recursive: true);
        }
    }

    private sealed class DelayedSaveInterceptor(int milliseconds) : SaveChangesInterceptor
    {
        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            await Task.Delay(milliseconds, cancellationToken);
            return result;
        }
    }

    private sealed class CommitObserver(IWorkerWakeNotifier notifier) : IWorkerWakeNotifier
    {
        public long CommittedAt { get; private set; }
        public void Notify()
        {
            CommittedAt = Stopwatch.GetTimestamp();
            notifier.Notify();
        }
    }

    private sealed class InitialPassObserver : ILoggerProvider, ILogger
    {
        private int failureCount;
        private int schedulerFailureCount;
        public int SchedulerFailureCount => Volatile.Read(ref schedulerFailureCount);
        public long CompletedAt { get; private set; }
        public TaskCompletionSource<long> NextSchedulerFailure { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public int FailureCount => Volatile.Read(ref failureCount);
        public TaskCompletionSource Completed { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Failed { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource<long> Delivered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public ILogger CreateLogger(string categoryName) => this;
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (eventId == NotificationLogEvents.Completed)
                Delivered.TrySetResult(Stopwatch.GetTimestamp());
            if (eventId == WorkerHost::Gones.Worker.WorkerLogEvents.EventImagesSwept)
            {
                CompletedAt = System.Diagnostics.Stopwatch.GetTimestamp();
                Completed.TrySetResult();
            }
            if (eventId == WorkerHost::Gones.Worker.WorkerLogEvents.SchedulerFailed && Interlocked.Increment(ref schedulerFailureCount) == 2)
                NextSchedulerFailure.TrySetResult(System.Diagnostics.Stopwatch.GetTimestamp());
            if (eventId == WorkerHost::Gones.Worker.WorkerLogEvents.PollFailed)
            {
                Interlocked.Increment(ref failureCount);
                Failed.TrySetResult();
            }
        }
        public void Dispose() { }
    }
}
