using System.Collections.Concurrent;
using System.Diagnostics.Metrics;
using System.Net;
using System.Net.Sockets;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using Gones.Infrastructure.Configuration;
using Gones.Infrastructure.Workers;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace Gones.UnitTests;

[SupportedOSPlatform("linux")]
public sealed class WorkerWakeTests
{
    [Fact]
    public async Task Hint_between_scan_and_wait_survives_and_duplicates_coalesce()
    {
        var signal = new WorkerWakeSignal();
        for (var index = 0; index < 1000; index++) signal.Notify();
        Assert.True(await signal.WaitAsync(TimeSpan.FromSeconds(1), CancellationToken.None));
        Assert.False(await signal.WaitAsync(TimeSpan.FromMilliseconds(20), CancellationToken.None));
    }

    [Fact]
    public async Task Wait_cancellation_does_not_leave_orphan_reader_stealing_next_hint()
    {
        var signal = new WorkerWakeSignal();
        using var cancellation = new CancellationTokenSource();
        var waiting = signal.WaitAsync(TimeSpan.FromMinutes(1), cancellation.Token);
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => waiting);
        signal.Notify();
        Assert.True(await signal.WaitAsync(TimeSpan.FromSeconds(1), CancellationToken.None));
    }

    [Fact]
    public void Missing_configuration_retains_polling_but_partial_or_malformed_fails_closed()
    {
        Assert.Null(WorkerWakeOptions.TryLoad(Config()));
        Assert.Throws<InvalidOperationException>(() => WorkerWakeOptions.TryLoad(Config(("GONES_WORKER_WAKE_SOCKET", "/run/wake/socket"))));
        Assert.Throws<InvalidOperationException>(() => WorkerWakeOptions.TryLoad(Config(("GONES_WORKER_WAKE_TOKEN", Token()))));
        Assert.Throws<InvalidOperationException>(() => WorkerWakeOptions.TryLoad(Config(("GONES_WORKER_WAKE_SOCKET", "relative"), ("GONES_WORKER_WAKE_TOKEN", Token()))));
        Assert.Throws<InvalidOperationException>(() => WorkerWakeOptions.TryLoad(Config(("GONES_WORKER_WAKE_SOCKET", "/run/wake/socket"), ("GONES_WORKER_WAKE_TOKEN", "bad"))));
    }

    [Fact]
    public async Task Authenticated_socket_wake_interrupts_wait_without_payload_or_tcp_listener()
    {
        using var directory = new SocketDirectory();
        var options = Options(directory);
        var signal = new WorkerWakeSignal();
        using var stopping = new CancellationTokenSource();
        using var listener = new WorkerWakeListener(options);
        var run = listener.RunAsync(signal, stopping.Token);
        try
        {
            Assert.True(await Client(options).SendAsync(CancellationToken.None));
            Assert.True(await signal.WaitAsync(TimeSpan.FromSeconds(1), CancellationToken.None));
            Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(options.SocketPath));
        }
        finally { stopping.Cancel(); await run; }
    }

    [Theory]
    [InlineData("token")]
    [InlineData("version")]
    [InlineData("operation")]
    [InlineData("short")]
    [InlineData("oversize")]
    public async Task Wrong_environment_token_and_invalid_frames_never_signal(string fault)
    {
        using var directory = new SocketDirectory();
        var options = Options(directory);
        var signal = new WorkerWakeSignal();
        using var stopping = new CancellationTokenSource();
        using var listener = new WorkerWakeListener(options);
        var run = listener.RunAsync(signal, stopping.Token);
        try
        {
            var frame = WorkerWakeProtocol.Request(options);
            if (fault == "token") frame[4] ^= 0xff;
            if (fault == "version") frame[2] = 2;
            if (fault == "operation") frame[3] = 2;
            if (fault == "short") frame = frame[..^1];
            if (fault == "oversize") frame = [.. frame, 0];
            using var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
            await socket.ConnectAsync(new UnixDomainSocketEndPoint(options.SocketPath));
            await socket.SendAsync(frame);
            socket.Shutdown(SocketShutdown.Send);
            var response = new byte[4];
            Assert.Equal(0, await socket.ReceiveAsync(response));
            Assert.False(await signal.WaitAsync(TimeSpan.FromMilliseconds(20), CancellationToken.None));
        }
        finally { stopping.Cancel(); await run; }
    }

    [Fact]
    public async Task Slow_clients_expire_and_authenticated_flood_coalesces()
    {
        using var directory = new SocketDirectory();
        var options = Options(directory);
        var signal = new WorkerWakeSignal();
        using var stopping = new CancellationTokenSource();
        using var listener = new WorkerWakeListener(options);
        var run = listener.RunAsync(signal, stopping.Token);
        var slow = new List<Socket>();
        try
        {
            for (var index = 0; index < WorkerWakeListener.MaximumClients; index++)
            {
                var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
                await socket.ConnectAsync(new UnixDomainSocketEndPoint(options.SocketPath));
                slow.Add(socket);
            }
            await Task.Delay(TimeSpan.FromMilliseconds(1200));
            foreach (var socket in slow) Assert.Equal(0, await socket.ReceiveAsync(new byte[4]));
            Assert.All(await Task.WhenAll(Enumerable.Range(0, 16).Select(_ => Client(options).SendAsync(CancellationToken.None))), Assert.True);
            Assert.True(await signal.WaitAsync(TimeSpan.FromSeconds(1), CancellationToken.None));
            Assert.False(await signal.WaitAsync(TimeSpan.FromMilliseconds(20), CancellationToken.None));
        }
        finally
        {
            foreach (var socket in slow) socket.Dispose();
            stopping.Cancel();
            await run;
        }
    }

    [Fact]
    public void Live_owner_regular_file_symlink_and_untrusted_directory_are_not_deleted()
    {
        using var directory = new SocketDirectory();
        var options = Options(directory);
        using (var listener = new WorkerWakeListener(options))
        {
            var contention = Assert.Throws<IOException>(() => new WorkerWakeListener(options));
            Assert.DoesNotContain(options.SocketPath, contention.ToString(), StringComparison.Ordinal);
            Assert.True(File.Exists(options.SocketPath));
        }
        File.WriteAllText(options.SocketPath, "owned-data");
        Assert.Throws<InvalidOperationException>(() => new WorkerWakeListener(options));
        Assert.Equal("owned-data", File.ReadAllText(options.SocketPath));
        File.Delete(options.SocketPath);
        File.CreateSymbolicLink(options.SocketPath, "missing-target");
        Assert.Throws<InvalidOperationException>(() => new WorkerWakeListener(options));
        Assert.Equal("missing-target", new FileInfo(options.SocketPath).LinkTarget);
        File.Delete(options.SocketPath);
        File.SetUnixFileMode(directory.Path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute | UnixFileMode.OtherWrite);
        Assert.Throws<InvalidOperationException>(() => new WorkerWakeListener(options));
    }

    [Fact]
    public void Live_socket_without_ownership_file_is_never_unlinked()
    {
        using var directory = new SocketDirectory();
        var options = Options(directory);
        using var other = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
        other.Bind(new UnixDomainSocketEndPoint(options.SocketPath));
        other.Listen(1);
        Assert.Throws<InvalidOperationException>(() => new WorkerWakeListener(options));
        Assert.True(File.Exists(options.SocketPath));
    }

    [Fact]
    public void Lock_file_and_parent_symlinks_are_rejected_without_touching_targets()
    {
        using var directory = new SocketDirectory();
        var options = Options(directory);
        File.CreateSymbolicLink(options.SocketPath + ".lock", "missing-lock");
        Assert.Throws<InvalidOperationException>(() => new WorkerWakeListener(options));
        Assert.Equal("missing-lock", new FileInfo(options.SocketPath + ".lock").LinkTarget);
        File.Delete(options.SocketPath + ".lock");
        var link = Path.Combine(directory.Path, "link");
        Directory.CreateSymbolicLink(link, directory.Path);
        var linked = WorkerWakeOptions.TryLoad(Config((WorkerWakeOptions.SocketKey, Path.Combine(link, "s")), (WorkerWakeOptions.TokenKey, Token())))!;
        Assert.Throws<InvalidOperationException>(() => new WorkerWakeListener(linked));
        Assert.False(File.Exists(Path.Combine(directory.Path, "s")));
        Directory.Delete(link);
    }

    [Fact]
    public void Wake_secret_loader_is_closed_absolute_and_rejects_ambiguity()
    {
        using var directory = new SocketDirectory();
        var file = Path.Combine(directory.Path, "token");
        var token = Token();
        File.WriteAllText(file, token);
        Assert.Equal(token, GonesSecretFiles.Resolve(Config((WorkerWakeOptions.TokenKey + "_FILE", file)))[WorkerWakeOptions.TokenKey]);
        Assert.Throws<InvalidOperationException>(() => GonesSecretFiles.Resolve(Config((WorkerWakeOptions.TokenKey + "_FILE", "relative"))));
        Assert.Throws<InvalidOperationException>(() => GonesSecretFiles.Resolve(Config((WorkerWakeOptions.TokenKey + "_FILE", file), (WorkerWakeOptions.TokenKey, token))));
        var missingPath = Path.Combine(directory.Path, "missing-token");
        var missing = Assert.Throws<InvalidOperationException>(() => GonesSecretFiles.Resolve(Config((WorkerWakeOptions.TokenKey + "_FILE", missingPath))));
        Assert.Null(missing.InnerException);
        Assert.DoesNotContain(missingPath, missing.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Signal_failures_log_only_allowlisted_event_and_exception_type()
    {
        using var directory = new SocketDirectory();
        var options = Options(directory);
        var logger = new CapturingLogger();
        Assert.False(await new WorkerWakeClient(options, logger).SendAsync(CancellationToken.None));
        var output = Assert.Single(logger.Messages);
        Assert.Contains("worker.wake.failed", output, StringComparison.Ordinal);
        Assert.DoesNotContain(options.SocketPath, output, StringComparison.Ordinal);
        Assert.DoesNotContain(Convert.ToHexString(WorkerWakeProtocol.Request(options)[4..]), output, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Flood_pacing_never_extends_existing_poll_deadline()
    {
        var signal = new WorkerWakeSignal();
        signal.Notify();
        var started = System.Diagnostics.Stopwatch.StartNew();
        await signal.WaitAsync(TimeSpan.FromMilliseconds(80), CancellationToken.None, TimeSpan.FromSeconds(1));
        Assert.InRange(started.Elapsed.TotalMilliseconds, 50, 800);
        signal.Notify();
        started.Restart();
        Assert.True(await signal.WaitAsync(TimeSpan.FromSeconds(5), CancellationToken.None, TimeSpan.FromMilliseconds(100)));
        Assert.InRange(started.Elapsed.TotalMilliseconds, 80, 1000);
    }

    [Fact]
    public void Stale_socket_after_crash_is_replaced_but_shutdown_preserves_replacement_file()
    {
        using var directory = new SocketDirectory();
        var options = Options(directory);
        using (var crashed = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified))
            crashed.Bind(new RetainedUnixEndPoint(new UnixDomainSocketEndPoint(options.SocketPath)));
        Assert.True(File.Exists(options.SocketPath));
        using (var listener = new WorkerWakeListener(options))
        {
            File.Delete(options.SocketPath);
            File.WriteAllText(options.SocketPath, "replacement");
        }
        Assert.Equal("replacement", File.ReadAllText(options.SocketPath));
    }

    [Fact]
    public void Replacement_at_stale_probe_boundary_is_preserved_by_identity_recheck()
    {
        using var directory = new SocketDirectory();
        var options = Options(directory);
        using var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
        socket.Bind(new RetainedUnixEndPoint(new UnixDomainSocketEndPoint(options.SocketPath)));
        var beforeProbe = WorkerWakeSocketPath.RequireOwnedType(options.SocketPath, WorkerWakeSocketPath.SocketType)!.Value;
        File.Delete(options.SocketPath);
        File.WriteAllText(options.SocketPath, "replacement-during-probe");
        Assert.False(WorkerWakeSocketPath.DeleteIfUnchanged(options.SocketPath, beforeProbe));
        Assert.Equal("replacement-during-probe", File.ReadAllText(options.SocketPath));
    }

    [Fact]
    public void Coalescing_metric_counts_actual_buffered_and_rejected_try_writes()
    {
        var outcomes = new ConcurrentDictionary<string, long>();
        using var meter = new MeterListener();
        meter.InstrumentPublished = (instrument, listener) =>
        {
            if (instrument.Name == "gones.worker.wake.hints") listener.EnableMeasurementEvents(instrument);
        };
        meter.SetMeasurementEventCallback<long>((_, value, tags, _) =>
        {
            var outcome = tags[0].Value!.ToString()!;
            outcomes.AddOrUpdate(outcome, value, (_, current) => current + value);
        });
        meter.Start();
        var signal = new WorkerWakeSignal();
        Parallel.For(0, 10000, _ => signal.Notify());
        Assert.Equal(1, outcomes["buffered"]);
        Assert.Equal(9999, outcomes["coalesced"]);
    }

    [Fact]
    public async Task Hosted_sender_coalesces_burst_and_spaces_real_socket_sends()
    {
        using var directory = new SocketDirectory();
        var token = Token();
        var configuration = Config((WorkerWakeOptions.SocketKey, Path.Combine(directory.Path, "w.sock")), (WorkerWakeOptions.TokenKey, token));
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddWorkerWakeProducer(configuration);
        await using var provider = services.BuildServiceProvider();
        var sender = Assert.Single(provider.GetServices<IHostedService>());
        var notifier = provider.GetRequiredService<IWorkerWakeNotifier>();
        var signal = new WorkerWakeSignal();
        using var stop = new CancellationTokenSource();
        using var listener = new WorkerWakeListener(WorkerWakeOptions.TryLoad(configuration)!);
        var receiving = listener.RunAsync(signal, stop.Token);
        try
        {
            for (var index = 0; index < 100; index++) notifier.Notify();
            await sender.StartAsync(CancellationToken.None);
            Assert.True(await signal.WaitAsync(TimeSpan.FromSeconds(3), CancellationToken.None));
            var started = System.Diagnostics.Stopwatch.StartNew();
            for (var index = 0; index < 100; index++) notifier.Notify();
            Assert.True(await signal.WaitAsync(TimeSpan.FromSeconds(3), CancellationToken.None));
            Assert.True(started.Elapsed >= TimeSpan.FromMilliseconds(500));
            Assert.False(await signal.WaitAsync(TimeSpan.FromMilliseconds(100), CancellationToken.None));
        }
        finally
        {
            await sender.StopAsync(CancellationToken.None);
            stop.Cancel();
            await receiving;
        }
    }

    [Fact]
    public async Task Unreachable_socket_returns_failure_within_bounded_budget()
    {
        using var directory = new SocketDirectory();
        var start = System.Diagnostics.Stopwatch.StartNew();
        Assert.False(await Client(Options(directory)).SendAsync(CancellationToken.None));
        Assert.True(start.Elapsed < TimeSpan.FromSeconds(3));
    }

    private static WorkerWakeClient Client(WorkerWakeOptions options) => new(options, NullLogger<WorkerWakeClient>.Instance);
    private static WorkerWakeOptions Options(SocketDirectory directory) => WorkerWakeOptions.TryLoad(Config(
        ("GONES_WORKER_WAKE_SOCKET", System.IO.Path.Combine(directory.Path, "w.sock")),
        ("GONES_WORKER_WAKE_TOKEN", Token())))!;
    private static string Token() => Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    private static IConfiguration Config(params (string Key, string Value)[] values) => new ConfigurationBuilder()
        .AddInMemoryCollection(values.Select(item => new KeyValuePair<string, string?>(item.Key, item.Value))).Build();

    private sealed class RetainedUnixEndPoint(UnixDomainSocketEndPoint endpoint) : EndPoint
    {
        public override AddressFamily AddressFamily => AddressFamily.Unix;
        public override SocketAddress Serialize() => endpoint.Serialize();
        public override EndPoint Create(SocketAddress address) => endpoint.Create(address);
    }

    private sealed class CapturingLogger : ILogger<WorkerWakeClient>
    {
        public List<string> Messages { get; } = [];
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) => Messages.Add(formatter(state, exception));
    }

    private sealed class SocketDirectory : IDisposable
    {
        public string Path { get; }
        public SocketDirectory()
        {
            var root = new DirectoryInfo(Directory.GetCurrentDirectory());
            while (root is not null && !File.Exists(System.IO.Path.Combine(root.FullName, "AGENT.md"))) root = root.Parent;
            Path = System.IO.Path.Combine(root!.FullName, ".tmp", $"wk-{Guid.NewGuid():N}"[..11]);
            Directory.CreateDirectory(Path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        }
        public void Dispose() => Directory.Delete(Path, recursive: true);
    }
}
