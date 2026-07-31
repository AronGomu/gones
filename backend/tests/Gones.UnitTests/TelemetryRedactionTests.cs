using Gones.Infrastructure.Observability;
using Microsoft.Extensions.Logging;
using OpenTelemetry;
using OpenTelemetry.Logs;

namespace Gones.UnitTests;

public sealed class TelemetryRedactionTests
{
    [Fact]
    public void Sensitive_log_fields_are_rejected_before_export()
    {
        var attributes = new Dictionary<string, object?>
        {
            ["Event"] = "request.completed",
            ["Email"] = "alice@example.test",
            ["Token"] = "secret-token",
            ["Body"] = "private content",
            ["ClientIp"] = "192.0.2.1",
            ["SafeCode"] = "invalid_request"
        };

        var redacted = TelemetryRedaction.Redact(attributes);

        Assert.Equal("request.completed", redacted["Event"]);
        Assert.Equal("invalid_request", redacted["SafeCode"]);
        Assert.DoesNotContain(redacted.Keys, key => key.Contains("email", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(redacted.Keys, key => key.Contains("token", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(redacted.Keys, key => key.Contains("body", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(redacted.Keys, key => key.Contains("ip", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain("alice@example.test", string.Join(';', redacted.Values), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("secret-token", string.Join(';', redacted.Values), StringComparison.Ordinal);
        Assert.DoesNotContain("private content", string.Join(';', redacted.Values), StringComparison.Ordinal);
        Assert.DoesNotContain("192.0.2.1", string.Join(';', redacted.Values), StringComparison.Ordinal);
    }

    [Fact]
    public void OpenTelemetry_log_sink_receives_only_redacted_attributes()
    {
        var exporter = new CollectingLogExporter();
        using var factory = LoggerFactory.Create(logging => logging.AddOpenTelemetry(options =>
        {
            options.AddProcessor(new SensitiveDataRedactionProcessor());
            options.AddProcessor(new SimpleLogRecordExportProcessor(exporter));
        }));
        var logger = factory.CreateLogger("redaction-test");

        logger.LogInformation(
            "Event={Event} Email={Email} Token={Token} Body={Body} SafeCode={SafeCode}",
            "probe.completed",
            "alice@example.test",
            "secret-token",
            "private content",
            "ok");

        var attributes = Assert.Single(exporter.Exported);
        Assert.Equal("probe.completed", attributes["Event"]);
        Assert.Equal("ok", attributes["SafeCode"]);
        Assert.DoesNotContain(attributes.Keys, key => key is "Email" or "Token" or "Body");
    }

    [Fact]
    public void Rate_limit_keys_are_stable_hashes_without_raw_input()
    {
        var first = TelemetryRedaction.HashRateLimitKey("192.0.2.1:user@example.test");
        var second = TelemetryRedaction.HashRateLimitKey("192.0.2.1:user@example.test");

        Assert.Equal(first, second);
        Assert.Equal(64, first.Length);
        Assert.DoesNotContain("192.0.2.1", first, StringComparison.Ordinal);
        Assert.DoesNotContain("user@example.test", first, StringComparison.Ordinal);
    }

    private sealed class CollectingLogExporter : BaseExporter<LogRecord>
    {
        public List<IReadOnlyDictionary<string, object?>> Exported { get; } = [];

        public override ExportResult Export(in Batch<LogRecord> batch)
        {
            foreach (var record in batch)
            {
                Exported.Add(record.Attributes?.ToDictionary(item => item.Key, item => item.Value, StringComparer.Ordinal)
                    ?? new Dictionary<string, object?>());
            }
            return ExportResult.Success;
        }
    }
}
