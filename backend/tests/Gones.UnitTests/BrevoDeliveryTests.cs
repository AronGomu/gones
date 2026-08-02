using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.Json;
using Gones.Application.Notifications;
using Gones.Domain.Notifications;
using Gones.Infrastructure.Notifications;
using Microsoft.Extensions.Logging.Abstractions;
using NodaTime;

namespace Gones.UnitTests;

public sealed class BrevoDeliveryTests
{
    [Fact]
    public async Task Success_sends_stable_idempotency_and_correlation_and_returns_message_id_only()
    {
        var handler = new RecordingHandler(_ => Json(HttpStatusCode.Created, "{\"messageId\":\"provider-123\",\"ignored\":\"secret\"}"));
        var transport = CreateTransport(handler);
        var email = Email();

        var first = await transport.SendAsync(email, CancellationToken.None);
        var second = await transport.SendAsync(email, CancellationToken.None);

        Assert.Equal("provider-123", first.ProviderMessageId);
        Assert.Equal("provider-123", second.ProviderMessageId);
        Assert.All(handler.Requests, request => Assert.Equal(email.DedupeKey, request.IdempotencyKey));
        Assert.All(handler.Requests, request => Assert.Equal(email.OutboxId.ToString("N"), request.CorrelationId));
        Assert.All(handler.Requests, request => Assert.DoesNotContain("ignored", request.Body, StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(HttpStatusCode.TooManyRequests, true, "brevo_rate_limited")]
    [InlineData(HttpStatusCode.ServiceUnavailable, true, "brevo_unavailable")]
    [InlineData(HttpStatusCode.BadRequest, false, "brevo_rejected")]
    [InlineData(HttpStatusCode.Unauthorized, false, "brevo_auth_failed")]
    public async Task Http_failures_are_classified(HttpStatusCode status, bool transient, string code)
    {
        var transport = CreateTransport(new RecordingHandler(_ => Json(status, "{}")));

        var error = await Assert.ThrowsAsync<EmailTransportException>(() => transport.SendAsync(Email(), CancellationToken.None));

        Assert.Equal(code, error.Code);
        Assert.Equal(transient, error.IsTransient);
        Assert.False(error.AcceptanceUncertain);
    }

    [Fact]
    public async Task Lost_response_after_dispatch_is_uncertain()
    {
        var transport = CreateTransport(new RecordingHandler((Func<HttpRequestMessage, Task<HttpResponseMessage>>)(_ => Task.FromException<HttpResponseMessage>(new TaskCanceledException("lost response")))));

        var error = await Assert.ThrowsAsync<EmailTransportException>(() => transport.SendAsync(Email(), CancellationToken.None));

        Assert.True(error.AcceptanceUncertain);
        Assert.Equal("brevo_acceptance_uncertain", error.Code);
    }

    [Fact]
    public async Task Bounded_concurrency_caps_in_flight_requests()
    {
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var handler = new RecordingHandler(async _ =>
        {
            await release.Task;
            return Json(HttpStatusCode.Created, "{\"messageId\":\"provider-123\"}");
        });
        var transport = CreateTransport(handler, maxConcurrency: 2);
        var sends = Enumerable.Range(0, 5).Select(_ => transport.SendAsync(Email(), CancellationToken.None)).ToArray();
        await handler.WaitForInFlightAsync(2);

        Assert.Equal(2, handler.MaximumInFlight);
        release.SetResult();
        await Task.WhenAll(sends);
    }

    [Theory]
    [InlineData("sent", NotificationDeliveryStatus.Sent, false)]
    [InlineData("delivered", NotificationDeliveryStatus.Delivered, false)]
    [InlineData("deferred", NotificationDeliveryStatus.Deferred, false)]
    [InlineData("soft_bounce", NotificationDeliveryStatus.SoftBounce, false)]
    [InlineData("hard_bounce", NotificationDeliveryStatus.HardBounce, true)]
    [InlineData("spam", NotificationDeliveryStatus.Spam, true)]
    [InlineData("invalid", NotificationDeliveryStatus.Invalid, true)]
    [InlineData("blocked", NotificationDeliveryStatus.Blocked, true)]
    [InlineData("error", NotificationDeliveryStatus.Error, false)]
    public void Webhook_event_mapping_is_provider_neutral(string providerEvent, NotificationDeliveryStatus status, bool permanent)
    {
        var mapped = NotificationDeliveryPolicy.MapProviderEvent(providerEvent);

        Assert.Equal(status, mapped.Status);
        Assert.Equal(permanent, mapped.IsPermanent);
    }

    [Theory]
    [InlineData("hard_bounce")]
    [InlineData("invalid")]
    [InlineData("blocked")]
    public void Permanent_provider_failure_never_retries(string eventName)
    {
        Assert.True(NotificationDeliveryPolicy.MapProviderEvent(eventName).IsPermanent);
    }

    private static BrevoEmailTransport CreateTransport(RecordingHandler handler, int maxConcurrency = 4) =>
        new(
            new HttpClient(handler) { BaseAddress = new Uri("https://api.brevo.test/") },
            new BrevoOptions("test-api-key", new Uri("https://api.brevo.test/v3/"), "sender@example.test", "Gones", maxConcurrency, Duration.FromSeconds(30), 3, Duration.FromSeconds(30), Duration.FromHours(24)),
            SystemClock.Instance,
            NullLogger<BrevoEmailTransport>.Instance);

    private static OutgoingEmail Email() => new(
        Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        "stable-dedupe-key",
        NotificationTemplateKeys.VerifyEmail,
        "alice@example.test",
        new RenderedEmail("Subject", "<p>Body</p>", "Body", "<p>Body</p>", "Body"));

    private static HttpResponseMessage Json(HttpStatusCode status, string json) => new(status)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json")
    };

    private sealed class RecordingHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> response) : HttpMessageHandler
    {
        private readonly ConcurrentQueue<RequestSnapshot> requests = [];
        private int inFlight;
        private int maximumInFlight;

        public RecordingHandler(Func<HttpRequestMessage, HttpResponseMessage> response)
            : this(request => Task.FromResult(response(request))) { }

        public IReadOnlyList<RequestSnapshot> Requests => requests.ToArray();
        public int MaximumInFlight => maximumInFlight;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var current = Interlocked.Increment(ref inFlight);
            int observed;
            while (current > (observed = maximumInFlight)) Interlocked.CompareExchange(ref maximumInFlight, current, observed);
            try
            {
                var body = request.Content is null ? string.Empty : await request.Content.ReadAsStringAsync(cancellationToken);
                using var json = JsonDocument.Parse(body);
                requests.Enqueue(new RequestSnapshot(
                    request.Headers.GetValues("idempotency-key").Single(),
                    json.RootElement.GetProperty("headers").GetProperty("X-Gones-Correlation").GetString()!,
                    body));
                return await response(request);
            }
            finally
            {
                Interlocked.Decrement(ref inFlight);
            }
        }

        public async Task WaitForInFlightAsync(int count)
        {
            var deadline = DateTime.UtcNow.AddSeconds(5);
            while (maximumInFlight < count && DateTime.UtcNow < deadline) await Task.Delay(10);
        }
    }

    private sealed record RequestSnapshot(string IdempotencyKey, string CorrelationId, string Body);
}
