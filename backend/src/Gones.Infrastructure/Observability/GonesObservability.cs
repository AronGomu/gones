using System.Diagnostics;
using System.Diagnostics.Metrics;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;
using OpenTelemetry;
using OpenTelemetry.Logs;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

namespace Gones.Infrastructure.Observability;

public static class GonesTelemetry
{
    public const string ActivitySourceName = "Gones";
    public const string OperationalMeterName = "Gones.Operational";
    public const string NotificationMeterName = "Gones.Notifications";
    public static readonly ActivitySource Activities = new(ActivitySourceName, "1.0.0");
}

public static class GonesObservabilityExtensions
{
    public static IServiceCollection AddGonesObservability(
        this IServiceCollection services,
        ILoggingBuilder logging,
        IConfiguration configuration,
        string serviceName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(serviceName);
        var consoleExporter = ReadBoolean(configuration, "GONES_OTEL_CONSOLE_EXPORTER", defaultValue: false);
        var otlpExporter = !string.IsNullOrWhiteSpace(configuration["OTEL_EXPORTER_OTLP_ENDPOINT"]);
        var resource = ResourceBuilder.CreateDefault().AddService(serviceName, serviceVersion: "1.0.0");

        services.AddSingleton<OperationalMetrics>();
        services.AddOpenTelemetry()
            .ConfigureResource(builder => builder.AddService(serviceName, serviceVersion: "1.0.0"))
            .WithTracing(tracing =>
            {
                tracing.AddSource(GonesTelemetry.ActivitySourceName).AddHttpClientInstrumentation().AddNpgsql();
                if (consoleExporter) tracing.AddConsoleExporter();
                if (otlpExporter) tracing.AddOtlpExporter();
            })
            .WithMetrics(metrics =>
            {
                metrics.AddMeter(GonesTelemetry.OperationalMeterName, GonesTelemetry.NotificationMeterName, "Npgsql")
                    .AddHttpClientInstrumentation()
                    .AddRuntimeInstrumentation();
                if (consoleExporter) metrics.AddConsoleExporter();
                if (otlpExporter) metrics.AddOtlpExporter();
            });

        logging.AddOpenTelemetry(options =>
        {
            options.SetResourceBuilder(resource);
            options.IncludeScopes = true;
            options.ParseStateValues = true;
            options.AddProcessor(new SensitiveDataRedactionProcessor());
            if (consoleExporter) options.AddConsoleExporter();
            if (otlpExporter) options.AddOtlpExporter();
        });
        return services;
    }

    private static bool ReadBoolean(IConfiguration configuration, string key, bool defaultValue)
    {
        var raw = configuration[key];
        if (string.IsNullOrWhiteSpace(raw)) return defaultValue;
        return bool.TryParse(raw, out var value)
            ? value
            : throw new InvalidOperationException($"{key} must be true or false.");
    }
}

public sealed class OperationalMetrics : IDisposable
{
    private readonly Meter meter = new(GonesTelemetry.OperationalMeterName, "1.0.0");
    private readonly Histogram<double> requestDuration;
    private readonly Counter<long> requestErrors;
    private readonly Counter<long> workerHeartbeats;
    private readonly Counter<long> authSuccesses;
    private readonly Counter<long> authRejections;
    private readonly Counter<long> authLockouts;
    private long outboxBacklog;
    private long outboxDeadLetters;
    private double outboxLagSeconds;
    private double workerHeartbeatAgeSeconds;

    public OperationalMetrics()
    {
        requestDuration = meter.CreateHistogram<double>("gones.api.request.duration", "s");
        requestErrors = meter.CreateCounter<long>("gones.api.request.errors");
        workerHeartbeats = meter.CreateCounter<long>("gones.worker.heartbeats");
        authSuccesses = meter.CreateCounter<long>("gones.auth.successes");
        authRejections = meter.CreateCounter<long>("gones.auth.rejections");
        authLockouts = meter.CreateCounter<long>("gones.auth.lockouts");
        meter.CreateObservableGauge("gones.outbox.backlog", () => Interlocked.Read(ref outboxBacklog));
        meter.CreateObservableGauge("gones.outbox.dead_letters", () => Interlocked.Read(ref outboxDeadLetters));
        meter.CreateObservableGauge("gones.outbox.lag", () => Volatile.Read(ref outboxLagSeconds), "s");
        meter.CreateObservableGauge("gones.worker.heartbeat.age", () => Volatile.Read(ref workerHeartbeatAgeSeconds), "s");
    }

    public void RecordRequest(double elapsedSeconds, int statusCode, string method, string route)
    {
        var tags = new TagList { { "http.request.method", method }, { "http.route", route }, { "http.response.status_code", statusCode } };
        requestDuration.Record(elapsedSeconds, tags);
        if (statusCode >= 500) requestErrors.Add(1, tags);
    }

    public void RecordOutboxSnapshot(long backlog, double lagSeconds, long deadLetters)
    {
        Interlocked.Exchange(ref outboxBacklog, backlog);
        Interlocked.Exchange(ref outboxDeadLetters, deadLetters);
        Volatile.Write(ref outboxLagSeconds, Math.Max(0, lagSeconds));
    }

    public void RecordWorkerHeartbeat() => workerHeartbeats.Add(1);
    public void RecordWorkerHeartbeatAge(double ageSeconds) => Volatile.Write(ref workerHeartbeatAgeSeconds, Math.Max(0, ageSeconds));
    public void RecordAuthSuccess(string operation) => authSuccesses.Add(1, new KeyValuePair<string, object?>("auth.operation", operation));
    public void RecordAuthRejection(string operation) => authRejections.Add(1, new KeyValuePair<string, object?>("auth.operation", operation));
    public void RecordAuthLockout() => authLockouts.Add(1);
    public void Dispose() => meter.Dispose();
}

public static class TelemetryRedaction
{
    private static readonly string[] SensitiveKeyParts =
    [
        "authorization", "password", "secret", "cookie", "recipient", "email", "token", "body", "content",
        "clientip", "ipaddress", "rawip", "exceptionmessage", "exceptionstacktrace"
    ];

    public static IReadOnlyDictionary<string, object?> Redact(IEnumerable<KeyValuePair<string, object?>> attributes)
    {
        var safe = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var attribute in attributes)
        {
            var normalized = Normalize(attribute.Key);
            if (normalized == "ratelimitkey")
            {
                if (attribute.Value is not null) safe["RateLimitKeyHash"] = HashRateLimitKey(attribute.Value.ToString() ?? string.Empty);
                continue;
            }
            if (SensitiveKeyParts.Any(normalized.Contains) || IsSensitiveValue(attribute.Value)) continue;
            safe[attribute.Key] = attribute.Value;
        }
        return safe;
    }

    public static string HashRateLimitKey(string value)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value);
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    }

    private static string Normalize(string key) => string.Concat(key.Where(char.IsLetterOrDigit)).ToLowerInvariant();

    private static bool IsSensitiveValue(object? value)
    {
        if (value is not string text) return false;
        return text.Contains('@', StringComparison.Ordinal)
            || text.Contains("bearer ", StringComparison.OrdinalIgnoreCase)
            || text.Contains("token=", StringComparison.OrdinalIgnoreCase);
    }
}

public sealed class SensitiveDataRedactionProcessor : BaseProcessor<LogRecord>
{
    public override void OnEnd(LogRecord data)
    {
        data.FormattedMessage = null;
        data.Exception = null;
        if (data.Attributes is not null) data.Attributes = TelemetryRedaction.Redact(data.Attributes).ToArray();
    }
}
