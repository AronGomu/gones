using Gones.Domain.Persistence;
using Gones.Infrastructure.Configuration;
using System.Runtime.InteropServices;
using Gones.Infrastructure.Workers;
using Microsoft.Extensions.Configuration;
using NodaTime;

namespace Gones.UnitTests;

public sealed class WorkerRuntimeTests
{
    private static readonly Instant Now = Instant.FromUtc(2030, 3, 30, 23, 59);

    [Fact]
    public void Daily_success_uses_UTC_midnight_failure_keeps_actual_success()
    {
        var state = new WorkerMaintenanceState("Idempotency", Now);
        Assert.Null(state.LastSucceededAt);
        state.Complete(Now);
        Assert.Equal(Instant.FromUtc(2030, 3, 31, 0, 0), state.NextDueAt);
        state.Fail(Now + Duration.FromDays(3));
        Assert.True(state.HasFailed);
        Assert.Equal(Now, state.LastSucceededAt);
        Assert.Equal(Now + Duration.FromDays(3) + Duration.FromHours(1), state.NextDueAt);
        state.Complete(Now + Duration.FromDays(5));
        Assert.False(state.HasFailed);
        Assert.Equal(Instant.FromUtc(2030, 4, 5, 0, 0), state.NextDueAt);
    }

    [Fact]
    public void Fresh_publication_cannot_hide_stalled_busy_or_overdue_idle_scheduler()
    {
        var future = Now + Duration.FromHours(1);
        Assert.Equal(WorkerRuntimeHealth.Healthy, WorkerRuntimeSnapshot.Create(WorkerRuntimeState.Idle, Now, Now - Duration.FromMinutes(10), future).Check(Now));
        Assert.Equal(WorkerRuntimeHealth.Unhealthy, WorkerRuntimeSnapshot.Create(WorkerRuntimeState.Busy, Now, Now - Duration.FromSeconds(46), future).Check(Now));
        Assert.Equal(WorkerRuntimeHealth.Unhealthy, WorkerRuntimeSnapshot.Create(WorkerRuntimeState.Busy, Now, Now, Now - Duration.FromSeconds(46)).Check(Now));
        Assert.Equal(WorkerRuntimeHealth.Unhealthy, WorkerRuntimeSnapshot.Create(WorkerRuntimeState.Idle, Now, Now, Now - Duration.FromSeconds(46)).Check(Now));
        Assert.Equal(WorkerRuntimeHealth.Degraded, WorkerRuntimeSnapshot.Create(WorkerRuntimeState.Failed, Now, Now, future).Check(Now));
        Assert.Equal(WorkerRuntimeHealth.Unhealthy, WorkerRuntimeSnapshot.Create(WorkerRuntimeState.Failed, Now, Now, future).Check(Now + Duration.FromSeconds(46)));
        Assert.Equal(WorkerRuntimeHealth.Unhealthy, WorkerRuntimeSnapshot.Create(WorkerRuntimeState.Stopped, Now, Now, future).Check(Now));
        Assert.Equal(WorkerRuntimeHealth.Unhealthy, WorkerRuntimeSnapshot.Create(WorkerRuntimeState.Idle, Now + Duration.FromSeconds(1), Now, future).Check(Now));
        Assert.Equal(WorkerRuntimeHealth.Unhealthy, WorkerRuntimeSnapshot.Create(WorkerRuntimeState.Idle, Now, Now + Duration.FromSeconds(1), future).Check(Now));
    }

    [Fact]
    public void Private_snapshot_accepts_atomic_republication_rejects_tampering_and_malformed_reads()
    {
        if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException();
        using var directory = new PrivateDirectory();
        var path = Path.Combine(directory.Path, "health.json");
        var options = new WorkerIdleOptions(path, [Path.Combine(directory.Path, "w.sock.lock")]);
        var writer = new WorkerRuntimeFile(options);
        var reader = new WorkerRuntimeFile(options);
        Assert.Equal(WorkerRuntimeHealth.Unhealthy, reader.Check(Now));
        writer.Publish(WorkerRuntimeSnapshot.Create(WorkerRuntimeState.Idle, Now, Now, Now + Duration.FromHours(1)));
        writer.Publish(WorkerRuntimeSnapshot.Create(WorkerRuntimeState.Busy, Now, Now, Now + Duration.FromHours(1)));
        Assert.Equal(WorkerRuntimeHealth.Healthy, reader.Check(Now));
        Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(path));
        File.WriteAllText(path, "{");
        Assert.Equal(WorkerRuntimeHealth.Unhealthy, reader.Check(Now));
        File.WriteAllText(path, new string('x', 1025));
        Assert.Equal(WorkerRuntimeHealth.Unhealthy, reader.Check(Now));
        File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.OtherRead);
        Assert.Equal(WorkerRuntimeHealth.Unhealthy, reader.Check(Now));
        Assert.Throws<IOException>(() => { if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException(); writer.Publish(WorkerRuntimeSnapshot.Create(WorkerRuntimeState.Idle, Now, Now, Now)); });
        File.Delete(path);
        File.CreateSymbolicLink(path, options.ReservedPaths[0]);
        Assert.Equal(WorkerRuntimeHealth.Unhealthy, reader.Check(Now));
        Assert.Throws<InvalidOperationException>(() => { if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException(); writer.Publish(WorkerRuntimeSnapshot.Create(WorkerRuntimeState.Idle, Now, Now, Now)); });
        Assert.Single(Directory.GetFileSystemEntries(directory.Path));
    }

    [Theory]
    [InlineData("true", null)]
    [InlineData("false", "health.json")]
    [InlineData("yes", null)]
    [InlineData("true", "./w.sock.lock")]
    [InlineData("true", "x/../w.sock.lock")]
    [InlineData("true", "w.sock.lock")]
    [InlineData("true", "w.sock")]
    public void Partial_malformed_or_reserved_idle_configuration_fails_closed(string mode, string? name)
    {
        if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException();
        using var directory = new PrivateDirectory();
        var config = Config(directory.Path, mode, name);
        Assert.Throws<InvalidOperationException>(() => WorkerIdleOptions.TryLoad(config));
    }

    [Theory]
    [InlineData("Keepalive=10")]
    [InlineData("Tcp Keepalive=true")]
    [InlineData("Tcp Keepalive Time=10")]
    public void Effective_connection_keepalive_is_rejected_for_both_runtime_roles(string connectionOption)
    {
        if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException();
        using var directory = new PrivateDirectory();
        var config = Config(directory.Path, "true", "health.json");
        config["GONES_DB_CONNECTION"] = "Host=localhost;" + connectionOption;
        Assert.Throws<InvalidOperationException>(() => WorkerIdleOptions.TryLoad(config));
        config["GONES_DB_CONNECTION"] = "Host=localhost";
        Assert.NotNull(WorkerIdleOptions.TryLoad(config));
    }

    [Fact]
    public void Reserved_inode_alias_and_replaced_destination_are_never_overwritten()
    {
        if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException();
        using var directory = new PrivateDirectory();
        var reserved = Path.Combine(directory.Path, "w.sock.lock");
        var destination = Path.Combine(directory.Path, "health.json");
        File.WriteAllText(reserved, "reserved-marker");
        File.SetUnixFileMode(reserved, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        Assert.Equal(0, Link(reserved, destination));
        var options = new WorkerIdleOptions(destination, [reserved]);
        var file = new WorkerRuntimeFile(options);
        Assert.Equal(WorkerRuntimeHealth.Unhealthy, file.Check(Now));
        Assert.Throws<IOException>(() =>
        {
            if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException();
            file.Publish(WorkerRuntimeSnapshot.Create(WorkerRuntimeState.Idle, Now, Now, Now + Duration.FromHours(1)));
        });
        Assert.Equal("reserved-marker", File.ReadAllText(reserved));
        File.Delete(destination);
        file.Publish(WorkerRuntimeSnapshot.Create(WorkerRuntimeState.Idle, Now, Now, Now + Duration.FromHours(1)));
        File.Delete(destination);
        File.WriteAllText(destination, "replacement");
        File.SetUnixFileMode(destination, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        Assert.Throws<IOException>(() =>
        {
            if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException();
            file.Publish(WorkerRuntimeSnapshot.Create(WorkerRuntimeState.Idle, Now, Now, Now + Duration.FromHours(1)));
        });
        Assert.Equal("replacement", File.ReadAllText(destination));
        Assert.Equal("reserved-marker", File.ReadAllText(reserved));
    }

    [Theory]
    [InlineData("whitespace")]
    [InlineData("symlink")]
    [InlineData("ancestor")]
    [InlineData("hardlink")]
    [InlineData("direct")]
    public void Effective_token_alias_is_rejected_before_snapshot_can_replace_loaded_secret(string alias)
    {
        if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException();
        using var directory = new PrivateDirectory();
        var tokenPath = Path.Combine(directory.Path, "token");
        var token = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
        File.WriteAllText(tokenPath, token);
        File.SetUnixFileMode(tokenPath, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        var configuredPath = tokenPath;
        var destination = tokenPath;
        if (alias == "whitespace") configuredPath = " " + tokenPath + " ";
        if (alias == "symlink")
        {
            configuredPath = Path.Combine(directory.Path, "token-link");
            File.CreateSymbolicLink(configuredPath, tokenPath);
        }
        if (alias == "ancestor")
        {
            var ancestor = Path.Combine(directory.Path, "alias");
            Directory.CreateSymbolicLink(ancestor, directory.Path);
            configuredPath = Path.Combine(ancestor, "token");
        }
        if (alias == "hardlink")
        {
            destination = Path.Combine(directory.Path, "health.json");
            Assert.Equal(0, Link(tokenPath, destination));
        }
        var configuration = new ConfigurationManager();
        configuration[WorkerIdleOptions.ModeKey] = "true";
        configuration[WorkerIdleOptions.HealthPathKey] = destination;
        configuration[WorkerWakeOptions.SocketKey] = Path.Combine(directory.Path, "w.sock");
        configuration[WorkerWakeOptions.TokenKey + "_FILE"] = configuredPath;
        configuration.AddGonesSecretFiles();
        Assert.True(configuration[WorkerWakeOptions.TokenKey] == token);
        var entries = Directory.GetFileSystemEntries(directory.Path).Order().ToArray();
        var exception = Record.Exception(() =>
        {
            if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException();
            var options = WorkerIdleOptions.TryLoad(configuration)!;
            new WorkerRuntimeFile(options).Publish(WorkerRuntimeSnapshot.Create(WorkerRuntimeState.Idle, Now, Now, Now + Duration.FromHours(1)));
        });
        Assert.True(exception is InvalidOperationException or IOException, "Token alias must be rejected before snapshot publication.");
        if (alias is "symlink" or "ancestor") Assert.IsType<InvalidOperationException>(exception);
        Assert.True(File.ReadAllText(tokenPath) == token, "Original generated token bytes must survive.");
        Assert.True(File.ReadAllText(destination) == token, "Destination token bytes must survive.");
        Assert.Equal(entries, Directory.GetFileSystemEntries(directory.Path).Order().ToArray());
    }

    [DllImport("libc", EntryPoint = "link", SetLastError = true)]
    private static extern int Link(string existing, string link);

    private static IConfigurationRoot Config(string directory, string mode, string? name) => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
    {
        [WorkerIdleOptions.ModeKey] = mode,
        [WorkerIdleOptions.HealthPathKey] = name is null ? null : directory + "/" + name,
        [WorkerWakeOptions.SocketKey] = Path.Combine(directory, "w.sock"),
        [WorkerWakeOptions.TokenKey] = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32))
    }).Build();

    private sealed class PrivateDirectory : IDisposable
    {
        public string Path { get; }
        public PrivateDirectory()
        {
            if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException();
            var root = new DirectoryInfo(Directory.GetCurrentDirectory());
            while (root is not null && !File.Exists(System.IO.Path.Combine(root.FullName, "AGENT.md"))) root = root.Parent;
            Path = System.IO.Path.Combine(root!.FullName, ".tmp", $"h-{Guid.NewGuid():N}"[..10]);
            Directory.CreateDirectory(Path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        }
        public void Dispose() => Directory.Delete(Path, recursive: true);
    }
}
