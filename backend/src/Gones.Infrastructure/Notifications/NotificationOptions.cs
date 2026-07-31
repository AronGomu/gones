using System.Diagnostics.Metrics;
using Microsoft.Extensions.Configuration;
using NodaTime;

namespace Gones.Infrastructure.Notifications;

public sealed record NotificationWorkerOptions(
    int BatchSize,
    Duration PollInterval,
    Duration LeaseDuration,
    Duration SendTimeout,
    string SinkPath)
{
    public static NotificationWorkerOptions Load(IConfiguration configuration)
    {
        var transport = configuration["GONES_EMAIL_TRANSPORT"];
        if (!string.Equals(transport, "File", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("GONES_EMAIL_TRANSPORT must be File until an external transport is configured.");
        }

        var sinkPath = configuration["GONES_EMAIL_SINK_PATH"];
        if (string.IsNullOrWhiteSpace(sinkPath) || !Path.IsPathRooted(sinkPath))
        {
            throw new InvalidOperationException("GONES_EMAIL_SINK_PATH must be an absolute path.");
        }

        return Validate(new NotificationWorkerOptions(
            ReadInt(configuration, "GONES_NOTIFICATION_BATCH_SIZE", 25),
            Duration.FromMilliseconds(ReadInt(configuration, "GONES_NOTIFICATION_POLL_MILLISECONDS", 5000)),
            Duration.FromSeconds(ReadInt(configuration, "GONES_NOTIFICATION_LEASE_SECONDS", 120)),
            Duration.FromSeconds(ReadInt(configuration, "GONES_NOTIFICATION_SEND_TIMEOUT_SECONDS", 30)),
            sinkPath));
    }

    public static NotificationWorkerOptions Validate(NotificationWorkerOptions options)
    {
        if (options.BatchSize is < 1 or > 100) throw new InvalidOperationException("Notification batch size must be between 1 and 100.");
        if (options.PollInterval < Duration.FromMilliseconds(100) || options.PollInterval > Duration.FromMinutes(1)) throw new InvalidOperationException("Notification poll interval must be between 100ms and 1m.");
        if (options.SendTimeout < Duration.FromSeconds(1)) throw new InvalidOperationException("Notification send timeout must be at least 1s.");
        if (options.LeaseDuration <= options.SendTimeout) throw new InvalidOperationException("Notification lease duration must exceed send timeout.");
        if (string.IsNullOrWhiteSpace(options.SinkPath) || !Path.IsPathRooted(options.SinkPath)) throw new InvalidOperationException("Notification sink path must be absolute.");
        return options;
    }

    private static int ReadInt(IConfiguration configuration, string key, int defaultValue)
    {
        var raw = configuration[key];
        if (string.IsNullOrWhiteSpace(raw)) return defaultValue;
        return int.TryParse(raw, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var value)
            ? value
            : throw new InvalidOperationException($"{key} must be an integer.");
    }
}

public sealed record NotificationHealthOptions(Duration DegradedAfter)
{
    public static NotificationHealthOptions Load(IConfiguration configuration)
    {
        var raw = configuration["GONES_NOTIFICATION_BACKLOG_DEGRADED_SECONDS"];
        var seconds = string.IsNullOrWhiteSpace(raw)
            ? 300
            : int.TryParse(raw, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var parsed)
                ? parsed
                : throw new InvalidOperationException("GONES_NOTIFICATION_BACKLOG_DEGRADED_SECONDS must be an integer.");
        if (seconds < 1) throw new InvalidOperationException("Notification backlog threshold must be positive.");
        return new NotificationHealthOptions(Duration.FromSeconds(seconds));
    }
}

public sealed class NotificationMetrics : IDisposable
{
    private readonly Meter meter = new("Gones.Notifications", "1.0.0");
    private readonly Counter<long> claimed;
    private readonly Counter<long> sent;
    private readonly Counter<long> retried;
    private readonly Counter<long> deadLettered;
    private readonly Histogram<double> deliveryLag;

    public NotificationMetrics()
    {
        claimed = meter.CreateCounter<long>("gones.notifications.claimed");
        sent = meter.CreateCounter<long>("gones.notifications.sent");
        retried = meter.CreateCounter<long>("gones.notifications.retried");
        deadLettered = meter.CreateCounter<long>("gones.notifications.dead_lettered");
        deliveryLag = meter.CreateHistogram<double>("gones.notifications.delivery_lag", "s");
    }

    public void RecordClaimed(int count) => claimed.Add(count);
    public void RecordSent(Duration lag)
    {
        sent.Add(1);
        deliveryLag.Record(Math.Max(0, lag.TotalSeconds));
    }
    public void RecordRetried() => retried.Add(1);
    public void RecordDeadLettered() => deadLettered.Add(1);
    public void Dispose() => meter.Dispose();
}
