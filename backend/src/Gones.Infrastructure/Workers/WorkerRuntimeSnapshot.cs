using System.Runtime.Versioning;
using System.Text.Json;
using NodaTime;

namespace Gones.Infrastructure.Workers;

public enum WorkerRuntimeHealth { Healthy, Degraded, Unhealthy }

public enum WorkerRuntimeState { Starting, Busy, Idle, Failed, Stopped }

public sealed record WorkerRuntimeSnapshot(int Version, WorkerRuntimeState State, long ObservedAt, long ProgressAt, long NextDueAt)
{
    public static WorkerRuntimeSnapshot Create(WorkerRuntimeState state, Instant now, Instant progress, Instant due) =>
        new(1, state, now.ToUnixTimeTicks(), progress.ToUnixTimeTicks(), due.ToUnixTimeTicks());

    public WorkerRuntimeHealth Check(Instant now)
    {
        var current = now.ToUnixTimeTicks();
        var freshness = TimeSpan.FromSeconds(45).Ticks;
        if (Version != 1 || !Enum.IsDefined(State) || ObservedAt > current || ProgressAt > ObservedAt
            || current - ObservedAt > freshness || ObservedAt <= 0 || ProgressAt <= 0 || NextDueAt <= 0)
            return WorkerRuntimeHealth.Unhealthy;
        if (State is WorkerRuntimeState.Starting or WorkerRuntimeState.Stopped)
            return WorkerRuntimeHealth.Unhealthy;
        if (current - NextDueAt > freshness || (State == WorkerRuntimeState.Busy && current - ProgressAt > freshness))
            return WorkerRuntimeHealth.Unhealthy;
        return State == WorkerRuntimeState.Failed
            ? WorkerRuntimeHealth.Degraded
            : WorkerRuntimeHealth.Healthy;
    }
}

[SupportedOSPlatform("linux")]
public sealed class WorkerRuntimeFile(WorkerIdleOptions options)
{
    private const int MaximumBytes = 1024;
    private WorkerWakeSocketPath.FileIdentity? publishedIdentity;
    private bool initialized;

    public void Publish(WorkerRuntimeSnapshot snapshot)
    {
        var before = Inspect();
        if (initialized && before != publishedIdentity)
            throw new IOException("Worker health destination changed.");
        var bytes = JsonSerializer.SerializeToUtf8Bytes(snapshot);
        if (bytes.Length > MaximumBytes) throw new IOException("Worker health snapshot is too large.");
        var temporary = options.HealthPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
        WorkerWakeSocketPath.FileIdentity? temporaryIdentity = null;
        try
        {
            using (var stream = new FileStream(temporary, new FileStreamOptions
            {
                Mode = FileMode.CreateNew,
                Access = FileAccess.Write,
                Share = FileShare.None,
                UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite
            }))
            {
                temporaryIdentity = WorkerWakeSocketPath.Read(temporary);
                stream.Write(bytes);
                stream.Flush(true);
            }
            if (Inspect() != before) throw new IOException("Worker health destination changed.");
            File.Move(temporary, options.HealthPath, overwrite: true);
            publishedIdentity = WorkerWakeSocketPath.Read(options.HealthPath);
            initialized = true;
        }
        finally
        {
            if (temporaryIdentity is { } identity) WorkerWakeSocketPath.DeleteIfUnchanged(temporary, identity);
        }
    }

    public WorkerRuntimeHealth Check(Instant now)
    {
        try
        {
            if (Inspect() is not { } before) return WorkerRuntimeHealth.Unhealthy;
            using var stream = new FileStream(options.HealthPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            if (stream.Length is <= 0 or > MaximumBytes || Inspect() != before)
                return WorkerRuntimeHealth.Unhealthy;
            var bytes = new byte[MaximumBytes + 1];
            var length = stream.ReadAtLeast(bytes, MaximumBytes + 1, throwOnEndOfStream: false);
            if (length > MaximumBytes) return WorkerRuntimeHealth.Unhealthy;
            var snapshot = JsonSerializer.Deserialize<WorkerRuntimeSnapshot>(bytes.AsSpan(0, length));
            return snapshot?.Check(now) ?? WorkerRuntimeHealth.Unhealthy;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidOperationException or JsonException or ArgumentException)
        {
            return WorkerRuntimeHealth.Unhealthy;
        }
    }

    private WorkerWakeSocketPath.FileIdentity? Inspect()
    {
        WorkerWakeSocketPath.ValidateParent(options.HealthPath);
        var identity = WorkerWakeSocketPath.RequireOwnedType(options.HealthPath, WorkerWakeSocketPath.RegularFileType);
        if (identity is { } value)
        {
            if ((value.Mode & 0x1ff) != 0x180) throw new IOException("Worker health file must be private.");
            foreach (var reserved in options.ReservedPaths)
            {
                if (WorkerWakeSocketPath.Read(reserved) is { } other
                    && value.Inode == other.Inode && value.DeviceMajor == other.DeviceMajor && value.DeviceMinor == other.DeviceMinor)
                    throw new IOException("Worker health file aliases a reserved path.");
            }
        }
        return identity;
    }
}
