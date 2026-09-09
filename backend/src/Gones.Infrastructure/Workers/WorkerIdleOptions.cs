using Microsoft.Extensions.Configuration;
using Npgsql;

namespace Gones.Infrastructure.Workers;

public sealed record WorkerIdleOptions(string HealthPath, string[] ReservedPaths)
{
    public const string ModeKey = "GONES_WORKER_IDLE_MODE";
    public const string HealthPathKey = "GONES_WORKER_HEALTH_PATH";

    public static WorkerIdleOptions? TryLoad(IConfiguration configuration)
    {
        var raw = configuration[ModeKey];
        var path = configuration[HealthPathKey];
        if (raw is not null && raw is not ("true" or "false"))
            throw new InvalidOperationException("GONES_WORKER_IDLE_MODE must be true or false.");
        if (raw != "true")
        {
            if (path is not null) throw new InvalidOperationException("Worker health path requires idle mode.");
            return null;
        }
        var wake = WorkerWakeOptions.TryLoad(configuration)
            ?? throw new InvalidOperationException("Idle mode requires private Worker wake configuration.");
        if (string.IsNullOrWhiteSpace(path) || !Path.IsPathFullyQualified(path)
            || path.Contains('\0') || path != Path.GetFullPath(path) || path.EndsWith('/')
            || Path.GetDirectoryName(path) != Path.GetDirectoryName(wake.SocketPath))
            throw new InvalidOperationException("Worker health path must be canonical in the private wake directory.");
        var reserved = new List<string> { wake.SocketPath, wake.SocketPath + ".lock" };
        if (configuration[WorkerWakeOptions.TokenKey + "_FILE"] is { } tokenPath && !string.IsNullOrWhiteSpace(tokenPath))
        {
            tokenPath = tokenPath.Trim();
            // Inspect before canonicalization: a symlink followed by '..' must not disappear.
            for (var component = tokenPath; component is not null; component = Path.GetDirectoryName(component))
                if ((File.GetAttributes(component) & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidOperationException("Idle mode requires a token file path free of symlinks.");
            reserved.Add(Path.GetFullPath(tokenPath));
        }
        if (reserved.Contains(path, StringComparer.Ordinal))
            throw new InvalidOperationException("Worker health path is reserved.");
        if (configuration[Persistence.PersistenceServiceCollectionExtensions.ConnectionStringKey] is { Length: > 0 } connection)
        {
            var settings = new NpgsqlConnectionStringBuilder(connection);
            if (settings.KeepAlive != 0 || settings.TcpKeepAlive || settings.TcpKeepAliveTime != 0 || settings.TcpKeepAliveInterval != 0)
                throw new InvalidOperationException("Idle mode requires disabled database connection keepalive.");
        }
        if (!OperatingSystem.IsLinux()) throw new InvalidOperationException("Worker idle health requires Linux.");
        WorkerWakeSocketPath.ValidateParent(path);
        return new WorkerIdleOptions(path, reserved.ToArray());
    }
}
