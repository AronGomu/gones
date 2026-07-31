using Gones.Infrastructure.Notifications;
using Microsoft.Extensions.Configuration;
using NodaTime;

namespace Gones.IntegrationTests;

public sealed class NotificationOptionsTests
{
    [Fact]
    public void Worker_options_require_explicit_file_transport_and_absolute_sink()
    {
        var missingTransport = Assert.Throws<InvalidOperationException>(() => NotificationWorkerOptions.Load(Configuration(new Dictionary<string, string?>
        {
            ["GONES_EMAIL_SINK_PATH"] = "/tmp/email"
        })));
        var relativeSink = Assert.Throws<InvalidOperationException>(() => NotificationWorkerOptions.Load(Configuration(new Dictionary<string, string?>
        {
            ["GONES_EMAIL_TRANSPORT"] = "File",
            ["GONES_EMAIL_SINK_PATH"] = "relative/email"
        })));

        Assert.Contains("GONES_EMAIL_TRANSPORT", missingTransport.Message, StringComparison.Ordinal);
        Assert.Contains("absolute", relativeSink.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Send_timeout_must_be_shorter_than_lease()
    {
        var error = Assert.Throws<InvalidOperationException>(() => NotificationWorkerOptions.Validate(new NotificationWorkerOptions(
            10,
            Duration.FromSeconds(1),
            Duration.FromSeconds(30),
            Duration.FromSeconds(30),
            "/tmp/email")));

        Assert.Contains("lease duration", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Defaults_are_bounded()
    {
        var options = NotificationWorkerOptions.Load(Configuration(new Dictionary<string, string?>
        {
            ["GONES_EMAIL_TRANSPORT"] = "File",
            ["GONES_EMAIL_SINK_PATH"] = "/tmp/email"
        }));

        Assert.Equal(25, options.BatchSize);
        Assert.Equal(Duration.FromSeconds(5), options.PollInterval);
        Assert.Equal(Duration.FromMinutes(2), options.LeaseDuration);
        Assert.Equal(Duration.FromSeconds(30), options.SendTimeout);
    }

    private static IConfiguration Configuration(IReadOnlyDictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();
}
