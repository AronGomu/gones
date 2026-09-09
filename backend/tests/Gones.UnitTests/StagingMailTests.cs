using System.Net;
using System.Text;
using System.Text.Json;
using Gones.Application.Notifications;
using Gones.Infrastructure.Notifications;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NodaTime;

namespace Gones.UnitTests;

public sealed class StagingMailTests : IDisposable
{
    private readonly string directory = Path.Combine(Directory.GetCurrentDirectory(), ".tmp", $"staging-mail-{Guid.NewGuid():N}");
    public StagingMailTests() => Directory.CreateDirectory(directory);
    public void Dispose()
    {
        var sink = Path.Combine(directory, "sink");
        if (Directory.Exists(sink)) { foreach (var path in Directory.GetFiles(sink)) File.Delete(path); Directory.Delete(sink); }
        foreach (var path in Directory.GetFiles(directory)) File.Delete(path);
        Directory.Delete(directory);
    }

    [Theory]
    [InlineData("File")]
    [InlineData("Brevo")]
    public async Task Blocked_concrete_transport_never_calls_HTTP_or_creates_file(string kind)
    {
        var handler = new Handler();
        using var services = Services(kind, handler);
        var transport = services.GetRequiredService<IEmailTransport>();
        var error = await Assert.ThrowsAsync<EmailTransportException>(() => transport.SendAsync(Email("blocked@example.test", "Subject"), CancellationToken.None));
        Assert.Equal("staging_recipient_blocked", error.Code);
        Assert.False(error.IsTransient);
        Assert.False(error.AcceptanceUncertain);
        Assert.Equal(0, handler.Calls);
        Assert.False(Directory.Exists(Path.Combine(directory, "sink")));
    }

    [Theory]
    [InlineData("Subject")]
    [InlineData("[STAGING] Subject")]
    [InlineData("[STAGING] [STAGING] Subject")]
    public async Task Allowed_Brevo_send_marks_subject_once_preserves_body_and_provider_identity(string subject)
    {
        var handler = new Handler();
        using var services = Services("Brevo", handler);
        var email = Email("owner@example.test", subject);
        var result = await services.GetRequiredService<IEmailTransport>().SendAsync(email, CancellationToken.None);
        Assert.Equal("test-provider-id", result.ProviderMessageId);
        Assert.Equal(1, handler.Calls);
        using var body = JsonDocument.Parse(handler.Body!);
        Assert.Equal("[STAGING] Subject", body.RootElement.GetProperty("subject").GetString());
        Assert.Equal(email.Content.HtmlBody, body.RootElement.GetProperty("htmlContent").GetString());
        Assert.Equal(email.Content.TextBody, body.RootElement.GetProperty("textContent").GetString());
        Assert.Equal(email.DedupeKey, handler.Dedupe);
        Assert.Equal(email.OutboxId.ToString("N"), body.RootElement.GetProperty("headers").GetProperty("X-Gones-Correlation").GetString());
    }

    [Fact]
    public async Task Blocked_recipient_is_permanent_even_when_Brevo_circuit_open()
    {
        var handler = new Handler { Status = HttpStatusCode.ServiceUnavailable };
        using var services = Services("Brevo", handler);
        var transport = services.GetRequiredService<IEmailTransport>();
        await Assert.ThrowsAsync<EmailTransportException>(() => transport.SendAsync(Email("owner@example.test", "Subject"), CancellationToken.None));
        var error = await Assert.ThrowsAsync<EmailTransportException>(() => transport.SendAsync(Email("blocked@example.test", "Subject"), CancellationToken.None));
        Assert.Equal("staging_recipient_blocked", error.Code);
        Assert.False(error.IsTransient);
        Assert.Equal(1, handler.Calls);
    }

    [Fact]
    public async Task Blocked_recipient_does_not_wait_for_full_Brevo_semaphore()
    {
        var handler = new Handler { Release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously) };
        using var services = Services("Brevo", handler);
        var transport = services.GetRequiredService<IEmailTransport>();
        var allowed = transport.SendAsync(Email("owner@example.test", "Subject"), CancellationToken.None);
        await handler.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        try
        {
            var error = await Assert.ThrowsAsync<EmailTransportException>(() => transport.SendAsync(Email("blocked@example.test", "Subject"), CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(2)));
            Assert.Equal("staging_recipient_blocked", error.Code);
            Assert.Equal(1, handler.Calls);
        }
        finally { handler.Release.SetResult(); await allowed; }
    }

    [Fact]
    public async Task File_dedupe_cannot_bypass_policy_after_recipient_revocation()
    {
        using (var first = Services("File", new Handler(), includeTester: true))
            await first.GetRequiredService<IEmailTransport>().SendAsync(Email("tester@example.test", "Subject"), CancellationToken.None);
        using var second = Services("File", new Handler());
        var error = await Assert.ThrowsAsync<EmailTransportException>(() => second.GetRequiredService<IEmailTransport>().SendAsync(Email("tester@example.test", "Subject"), CancellationToken.None));
        Assert.Equal("staging_recipient_blocked", error.Code);
        var file = Assert.Single(Directory.GetFiles(Path.Combine(directory, "sink")));
        using var body = JsonDocument.Parse(await File.ReadAllTextAsync(file));
        Assert.Equal("[STAGING] Subject", body.RootElement.GetProperty("subject").GetString());
    }

    private ServiceProvider Services(string kind, Handler handler, bool includeTester = false)
    {
        var path = Path.Combine(directory, "policy.json");
        var emails = includeTester ? new[] { "owner@example.test", "tester@example.test" } : ["owner@example.test"];
        File.WriteAllText(path, JsonSerializer.Serialize(new { revision = "test", validAfterUtc = "2026-01-01T00:00:00Z", invitedEmails = emails, recipientEmails = emails }));
        var config = new ConfigurationManager();
        config["GONES_DEPLOYMENT_ENVIRONMENT"] = "staging";
        config["GONES_STAGING_POLICY_FILE"] = path;
        config["GONES_BOOTSTRAP_ADMIN_EMAIL"] = "owner@example.test";
        config["GONES_EMAIL_TRANSPORT"] = kind;
        config["GONES_EMAIL_SINK_PATH"] = Path.Combine(directory, "sink");
        config["GONES_BREVO_API_KEY"] = "test-provider-key";
        config["GONES_BREVO_API_BASE_URL"] = "https://mail.example.test/v3/";
        config["GONES_BREVO_SENDER_EMAIL"] = "sender@example.test";
        config["GONES_BREVO_SENDER_NAME"] = "Fixture";
        config["GONES_BREVO_CIRCUIT_FAILURES"] = "1";
        config["GONES_BREVO_MAX_CONCURRENCY"] = "1";
        var services = new ServiceCollection();
        services.AddSingleton<IClock>(SystemClock.Instance);
        services.AddNotificationWorker(config);
        services.AddHttpClient<BrevoEmailTransport>().ConfigurePrimaryHttpMessageHandler(() => handler);
        return services.BuildServiceProvider();
    }
    private static OutgoingEmail Email(string recipient, string subject) => new(Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), "dedupe-fixture", NotificationTemplateKeys.VerifyEmail, recipient, new RenderedEmail(subject, "<p>Body</p>", "Body", "<p>Body</p>", "Body"));
    private sealed class Handler : HttpMessageHandler
    {
        public int Calls { get; private set; }
        public string? Body { get; private set; }
        public string? Dedupe { get; private set; }
        public HttpStatusCode Status { get; init; } = HttpStatusCode.Created;
        public TaskCompletionSource? Release { get; init; }
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            Body = await request.Content!.ReadAsStringAsync(cancellationToken);
            Dedupe = request.Headers.GetValues("idempotency-key").Single();
            Entered.TrySetResult();
            if (Release is not null) await Release.Task.WaitAsync(cancellationToken);
            return new HttpResponseMessage(Status) { Content = new StringContent("{\"messageId\":\"test-provider-id\"}", Encoding.UTF8, "application/json") };
        }
    }
}
