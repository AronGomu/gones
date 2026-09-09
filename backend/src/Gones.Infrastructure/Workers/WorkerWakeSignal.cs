using System.Diagnostics.Metrics;
using System.Threading.Channels;
using Gones.Infrastructure.Observability;

namespace Gones.Infrastructure.Workers;

/// <summary>One buffered hint survives the final database scan / wait transition.</summary>
public sealed class WorkerWakeSignal(TimeProvider? timeProvider = null) : IWorkerWakeNotifier
{
    private readonly TimeProvider time = timeProvider ?? TimeProvider.System;
    private static readonly Meter Meter = new(GonesTelemetry.OperationalMeterName, "1.0.0");
    private static readonly Counter<long> Hints = Meter.CreateCounter<long>("gones.worker.wake.hints");
    private readonly Channel<bool> hints = Channel.CreateBounded<bool>(new BoundedChannelOptions(1)
    {
        FullMode = BoundedChannelFullMode.Wait,
        SingleReader = true,
        AllowSynchronousContinuations = false
    });

    public void Notify() => Hints.Add(1, new KeyValuePair<string, object?>("outcome", hints.Writer.TryWrite(true) ? "buffered" : "coalesced"));

    public bool TryTake() => hints.Reader.TryRead(out _);

    public async Task<bool> WaitAsync(TimeSpan timeout, CancellationToken cancellationToken, TimeSpan minimumInterval = default)
    {
        var started = time.GetTimestamp();
        using var deadline = new CancellationTokenSource(timeout, time);
        using var wait = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, deadline.Token);
        var consumed = false;
        try
        {
            await hints.Reader.ReadAsync(wait.Token);
            consumed = true;
            // A valid-token flood cannot spin the Worker. Never extend the existing poll deadline.
            var floor = timeout != Timeout.InfiniteTimeSpan && timeout < minimumInterval ? timeout : minimumInterval;
            var remaining = floor - time.GetElapsedTime(started);
            if (remaining > TimeSpan.Zero) await Task.Delay(remaining, time, wait.Token);
            return true;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return consumed;
        }
    }
}
