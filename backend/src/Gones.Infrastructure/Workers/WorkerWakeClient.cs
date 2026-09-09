using System.Diagnostics.Metrics;
using System.Net.Sockets;
using Gones.Infrastructure.Observability;
using Microsoft.Extensions.Logging;

namespace Gones.Infrastructure.Workers;

public sealed class WorkerWakeClient(WorkerWakeOptions options, ILogger<WorkerWakeClient> logger)
{
    private static readonly Meter Meter = new(GonesTelemetry.OperationalMeterName, "1.0.0");
    private static readonly Counter<long> Outcomes = Meter.CreateCounter<long>("gones.worker.wake.sent");

    public async Task<bool> SendAsync(CancellationToken cancellationToken)
    {
        using var budget = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        budget.CancelAfter(TimeSpan.FromSeconds(2));
        var failure = "unavailable";
        for (var attempt = 0; attempt < 2 && !budget.IsCancellationRequested; attempt++)
        {
            try
            {
                if (!OperatingSystem.IsLinux()) throw new InvalidOperationException("Worker wake requires Linux.");
                WorkerWakeSocketPath.ValidateParent(options.SocketPath);
                _ = WorkerWakeSocketPath.RequireOwnedType(options.SocketPath, WorkerWakeSocketPath.SocketType);
                using var deadline = CancellationTokenSource.CreateLinkedTokenSource(budget.Token);
                deadline.CancelAfter(TimeSpan.FromMilliseconds(900));
                using var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
                await socket.ConnectAsync(new UnixDomainSocketEndPoint(options.SocketPath), deadline.Token);
                using var stream = new NetworkStream(socket, ownsSocket: false);
                await stream.WriteAsync(WorkerWakeProtocol.Request(options), deadline.Token);
                socket.Shutdown(SocketShutdown.Send);
                var response = new byte[4];
                await stream.ReadExactlyAsync(response, deadline.Token);
                if (!response.AsSpan().SequenceEqual(WorkerWakeProtocol.Acknowledgement)
                    || await stream.ReadAsync(new byte[1], deadline.Token) != 0)
                    throw new IOException("Worker wake acknowledgement is invalid.");
                Outcomes.Add(1, new KeyValuePair<string, object?>("outcome", "accepted"));
                return true;
            }
            catch (Exception exception) when (exception is IOException or SocketException or OperationCanceledException or InvalidOperationException or UnauthorizedAccessException)
            {
                failure = exception.GetType().Name;
            }
            if (attempt == 0)
            {
                try { await Task.Delay(TimeSpan.FromMilliseconds(100), budget.Token); }
                catch (OperationCanceledException) when (budget.IsCancellationRequested) { break; }
            }
        }
        Outcomes.Add(1, new KeyValuePair<string, object?>("outcome", "failed"));
        logger.LogWarning("Event={Event}; ExceptionType={ExceptionType}", "worker.wake.failed", failure);
        return false;
    }
}
