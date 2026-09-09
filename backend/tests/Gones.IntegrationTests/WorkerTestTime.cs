using NodaTime;

namespace Gones.IntegrationTests;

internal sealed class WorkerTestTime(Instant initial) : TimeProvider, IClock
{
    private readonly object gate = new();
    private readonly HashSet<TestTimer> timers = [];
    private Instant current = initial;
    private long ticks;
    public Instant GetCurrentInstant() { lock (gate) return current; }
    public override DateTimeOffset GetUtcNow() => GetCurrentInstant().ToDateTimeOffset();
    public override long GetTimestamp() { lock (gate) return ticks; }
    public override long TimestampFrequency => TimeSpan.TicksPerSecond;
    public int TimerCount { get { lock (gate) return timers.Count(item => item.Due != long.MaxValue); } }

    public void Advance(Duration duration)
    {
        TestTimer[] ready;
        lock (gate)
        {
            current += duration;
            ticks += duration.ToTimeSpan().Ticks;
            ready = timers.Where(item => item.Due <= ticks).ToArray();
            foreach (var timer in ready) timer.Due = timer.Period > 0 ? ticks + timer.Period : long.MaxValue;
        }
        foreach (var timer in ready) timer.Callback(timer.State);
    }

    public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
    {
        var timer = new TestTimer(this, callback, state);
        lock (gate) timers.Add(timer);
        timer.Change(dueTime, period);
        return timer;
    }

    private sealed class TestTimer(WorkerTestTime owner, TimerCallback callback, object? state) : ITimer
    {
        public TimerCallback Callback { get; } = callback;
        public object? State { get; } = state;
        public long Due { get; set; } = long.MaxValue;
        public long Period { get; private set; }
        public bool Change(TimeSpan dueTime, TimeSpan period)
        {
            lock (owner.gate)
            {
                Due = dueTime == Timeout.InfiniteTimeSpan ? long.MaxValue : owner.ticks + dueTime.Ticks;
                Period = period.Ticks;
            }
            if (dueTime == TimeSpan.Zero) ThreadPool.QueueUserWorkItem(_ => Callback(State));
            return true;
        }
        public void Dispose() { lock (owner.gate) owner.timers.Remove(this); }
        public ValueTask DisposeAsync() { Dispose(); return ValueTask.CompletedTask; }
    }
}
