using System.Diagnostics.Metrics;
using System.Net;
using System.Net.Sockets;
using System.Runtime.Versioning;
using Gones.Infrastructure.Observability;

namespace Gones.Infrastructure.Workers;

[SupportedOSPlatform("linux")]
public sealed class WorkerWakeListener : IDisposable
{
    public const int MaximumClients = 8;
    private static readonly Meter Meter = new(GonesTelemetry.OperationalMeterName, "1.0.0");
    private static readonly Counter<long> Received = Meter.CreateCounter<long>("gones.worker.wake.received");
    private readonly WorkerWakeOptions options;
    private readonly Socket listener;
    private readonly FileStream ownership;
    private readonly WorkerWakeSocketPath.FileIdentity identity;

    public WorkerWakeListener(WorkerWakeOptions options)
    {
        this.options = options;
        WorkerWakeSocketPath.ValidateParent(options.SocketPath);
        var lockPath = options.SocketPath + ".lock";
        var existingLock = WorkerWakeSocketPath.RequireOwnedType(lockPath, WorkerWakeSocketPath.RegularFileType);
        if (existingLock is { } file && (file.Mode & 0x1ff) != 0x180)
            throw new InvalidOperationException("Worker wake ownership file must be private.");
        try
        {
            ownership = new FileStream(lockPath, new FileStreamOptions
            {
                Mode = FileMode.OpenOrCreate,
                Access = FileAccess.ReadWrite,
                Share = FileShare.None,
                UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite
            });
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            throw new IOException("Worker wake ownership could not be acquired.");
        }
        listener = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
        try
        {
            if (WorkerWakeSocketPath.RequireOwnedType(options.SocketPath, WorkerWakeSocketPath.SocketType) is { } stale)
            {
                using var probe = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(1));
                try
                {
                    probe.ConnectAsync(new UnixDomainSocketEndPoint(options.SocketPath), timeout.Token).AsTask().GetAwaiter().GetResult();
                    throw new InvalidOperationException("Worker wake socket already has a live owner.");
                }
                catch (SocketException exception) when (exception.SocketErrorCode == SocketError.ConnectionRefused)
                {
                    if (!WorkerWakeSocketPath.DeleteIfUnchanged(options.SocketPath, stale))
                        throw new InvalidOperationException("Worker wake socket changed during initialization.");
                }
            }
            listener.Bind(new OwnedUnixEndPoint(new UnixDomainSocketEndPoint(options.SocketPath)));
            File.SetUnixFileMode(options.SocketPath, UnixFileMode.UserRead | UnixFileMode.UserWrite);
            identity = WorkerWakeSocketPath.RequireOwnedType(options.SocketPath, WorkerWakeSocketPath.SocketType)!.Value;
            listener.Listen(16);
        }
        catch
        {
            listener.Dispose();
            ownership.Dispose();
            throw;
        }
    }

    public Task RunAsync(WorkerWakeSignal signal, CancellationToken cancellationToken) =>
        Task.WhenAll(Enumerable.Range(0, MaximumClients).Select(_ => ReceiveAsync(signal, cancellationToken)));

    private async Task ReceiveAsync(WorkerWakeSignal signal, CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            Socket client;
            try { client = await listener.AcceptAsync(stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            using (client)
            using (var deadline = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken))
            {
                deadline.CancelAfter(TimeSpan.FromSeconds(1));
                try
                {
                    var frame = new byte[WorkerWakeProtocol.RequestLength + 1];
                    var count = 0;
                    while (count < frame.Length)
                    {
                        var received = await client.ReceiveAsync(frame.AsMemory(count), SocketFlags.None, deadline.Token);
                        if (received == 0) break;
                        count += received;
                    }
                    if (!WorkerWakeProtocol.Authenticate(frame.AsSpan(0, count), options))
                    {
                        Received.Add(1, new KeyValuePair<string, object?>("outcome", "rejected"));
                        continue;
                    }
                    Received.Add(1, new KeyValuePair<string, object?>("outcome", "accepted"));
                    signal.Notify();
                    var acknowledgement = WorkerWakeProtocol.Acknowledgement.ToArray();
                    var sent = 0;
                    while (sent < acknowledgement.Length)
                        sent += await client.SendAsync(acknowledgement.AsMemory(sent), SocketFlags.None, deadline.Token);
                }
                catch (OperationCanceledException) when (deadline.IsCancellationRequested)
                {
                    Received.Add(1, new KeyValuePair<string, object?>("outcome", "timeout"));
                }
                catch (SocketException)
                {
                    Received.Add(1, new KeyValuePair<string, object?>("outcome", "disconnected"));
                }
            }
        }
    }

    // Socket.Bind(UnixDomainSocketEndPoint) unconditionally unlinks the path on Dispose in .NET 10.
    // Own cleanup instead: only the inode we bound may be removed, never a replacement file.
    private sealed class OwnedUnixEndPoint(UnixDomainSocketEndPoint endpoint) : EndPoint
    {
        public override AddressFamily AddressFamily => AddressFamily.Unix;
        public override SocketAddress Serialize() => endpoint.Serialize();
        public override EndPoint Create(SocketAddress address) => new OwnedUnixEndPoint((UnixDomainSocketEndPoint)endpoint.Create(address));
    }

    public void Dispose()
    {
        listener.Dispose();
        try
        {
            // Do not remove a file/socket replaced since this listener bound its own inode.
            WorkerWakeSocketPath.DeleteIfUnchanged(options.SocketPath, identity);
        }
        finally { ownership.Dispose(); }
    }
}
