using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Gones.Application.Notifications;
using Gones.Infrastructure.Observability;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using NodaTime;

namespace Gones.Infrastructure.Notifications;

public sealed record BrevoOptions(
    string ApiKey,
    Uri ApiBaseUri,
    string SenderEmail,
    string SenderName,
    int MaximumConcurrency,
    Duration RequestTimeout,
    int CircuitFailureThreshold,
    Duration CircuitBreakDuration,
    Duration IdempotencyWindow)
{
    public static BrevoOptions Load(IConfiguration configuration)
    {
        var apiKey = ReadSecret(configuration, "GONES_BREVO_API_KEY", "GONES_BREVO_API_KEY_FILE");
        var baseUriText = configuration["GONES_BREVO_API_BASE_URL"] ?? "https://api.brevo.com/v3/";
        if (!Uri.TryCreate(baseUriText, UriKind.Absolute, out var baseUri) || baseUri.Scheme != Uri.UriSchemeHttps)
        {
            throw new InvalidOperationException("GONES_BREVO_API_BASE_URL must be an absolute HTTPS URL.");
        }
        var senderEmail = Require(configuration, "GONES_BREVO_SENDER_EMAIL");
        var senderName = Require(configuration, "GONES_BREVO_SENDER_NAME");
        return Validate(new BrevoOptions(
            apiKey,
            baseUri,
            senderEmail,
            senderName,
            ReadInt(configuration, "GONES_BREVO_MAX_CONCURRENCY", 4),
            Duration.FromSeconds(ReadInt(configuration, "GONES_BREVO_TIMEOUT_SECONDS", 25)),
            ReadInt(configuration, "GONES_BREVO_CIRCUIT_FAILURES", 5),
            Duration.FromSeconds(ReadInt(configuration, "GONES_BREVO_CIRCUIT_BREAK_SECONDS", 30)),
            Duration.FromHours(ReadInt(configuration, "GONES_BREVO_IDEMPOTENCY_WINDOW_HOURS", 24))));
    }

    public static BrevoOptions Validate(BrevoOptions options)
    {
        if (string.IsNullOrWhiteSpace(options.ApiKey)) throw new InvalidOperationException("Brevo API key is required.");
        if (!options.ApiBaseUri.IsAbsoluteUri || options.ApiBaseUri.Scheme != Uri.UriSchemeHttps) throw new InvalidOperationException("Brevo API base URL must use HTTPS.");
        if (string.IsNullOrWhiteSpace(options.SenderEmail) || options.SenderEmail.Length > 320) throw new InvalidOperationException("Brevo sender email is invalid.");
        if (string.IsNullOrWhiteSpace(options.SenderName) || options.SenderName.Length > 100) throw new InvalidOperationException("Brevo sender name is invalid.");
        if (options.MaximumConcurrency is < 1 or > 32) throw new InvalidOperationException("Brevo maximum concurrency must be between 1 and 32.");
        if (options.RequestTimeout < Duration.FromSeconds(1) || options.RequestTimeout > Duration.FromMinutes(1)) throw new InvalidOperationException("Brevo timeout must be between 1s and 1m.");
        if (options.CircuitFailureThreshold is < 1 or > 20) throw new InvalidOperationException("Brevo circuit threshold must be between 1 and 20.");
        if (options.CircuitBreakDuration < Duration.FromSeconds(1) || options.CircuitBreakDuration > Duration.FromMinutes(10)) throw new InvalidOperationException("Brevo circuit break duration must be between 1s and 10m.");
        if (options.IdempotencyWindow < Duration.FromHours(1)) throw new InvalidOperationException("Brevo idempotency window must be at least 1h.");
        return options;
    }

    private static string ReadSecret(IConfiguration configuration, string directKey, string fileKey)
    {
        var direct = configuration[directKey];
        var path = configuration[fileKey];
        if (!string.IsNullOrWhiteSpace(direct) && !string.IsNullOrWhiteSpace(path)) throw new InvalidOperationException($"Configure only one of {directKey} or {fileKey}.");
        if (!string.IsNullOrWhiteSpace(path))
        {
            if (!Path.IsPathRooted(path)) throw new InvalidOperationException($"{fileKey} must be an absolute path.");
            direct = File.ReadAllText(path).Trim();
        }
        return !string.IsNullOrWhiteSpace(direct) ? direct : throw new InvalidOperationException($"{directKey} or {fileKey} is required.");
    }

    private static string Require(IConfiguration configuration, string key) =>
        !string.IsNullOrWhiteSpace(configuration[key]) ? configuration[key]! : throw new InvalidOperationException($"{key} is required.");

    private static int ReadInt(IConfiguration configuration, string key, int defaultValue) =>
        string.IsNullOrWhiteSpace(configuration[key]) ? defaultValue
        : int.TryParse(configuration[key], System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var value) ? value
        : throw new InvalidOperationException($"{key} must be an integer.");
}

public sealed class BrevoEmailTransport : IEmailTransport, IDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly HttpClient client;
    private readonly BrevoOptions options;
    private readonly IClock clock;
    private readonly ILogger<BrevoEmailTransport> logger;
    private readonly SemaphoreSlim concurrency;
    private readonly object circuitLock = new();
    private int consecutiveFailures;
    private Instant? circuitOpenUntil;

    public BrevoEmailTransport(HttpClient client, BrevoOptions options, IClock clock, ILogger<BrevoEmailTransport> logger)
    {
        this.client = client;
        this.options = BrevoOptions.Validate(options);
        this.clock = clock;
        this.logger = logger;
        concurrency = new SemaphoreSlim(options.MaximumConcurrency, options.MaximumConcurrency);
        client.BaseAddress = options.ApiBaseUri;
        client.Timeout = Timeout.InfiniteTimeSpan;
    }

    public async Task<EmailTransportResult> SendAsync(OutgoingEmail email, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(email);
        ThrowIfCircuitOpen();
        await concurrency.WaitAsync(cancellationToken);
        try
        {
            ThrowIfCircuitOpen();
            using var request = new HttpRequestMessage(HttpMethod.Post, "smtp/email");
            request.Headers.Add("api-key", options.ApiKey);
            request.Headers.Add("idempotency-key", email.DedupeKey);
            request.Content = JsonContent.Create(new BrevoSendRequest(
                new BrevoSender(options.SenderEmail, options.SenderName),
                [new BrevoRecipient(email.Recipient)],
                email.Content.Subject,
                email.Content.HtmlBody,
                email.Content.TextBody,
                new Dictionary<string, string> { ["X-Gones-Correlation"] = email.OutboxId.ToString("N") },
                [email.OutboxId.ToString("N")]),
                options: JsonOptions);
            using var activity = GonesTelemetry.Activities.StartActivity("notification.provider.send", ActivityKind.Client);
            var started = Stopwatch.GetTimestamp();
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(options.RequestTimeout.ToTimeSpan());
            try
            {
                using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
                if (!response.IsSuccessStatusCode)
                {
                    var failure = Classify(response.StatusCode);
                    if (failure.IsTransient) RecordTransientFailure(); else ResetCircuit();
                    activity?.SetStatus(ActivityStatusCode.Error, failure.Code);
                    throw failure;
                }

                var body = await response.Content.ReadFromJsonAsync<BrevoSendResponse>(JsonOptions, timeout.Token);
                if (string.IsNullOrWhiteSpace(body?.MessageId) || body.MessageId.Length > 200)
                {
                    RecordTransientFailure();
                    throw new EmailTransportException("brevo_response_invalid", true, acceptanceUncertain: true);
                }
                ResetCircuit();
                activity?.SetTag("gones.notification.provider_latency_ms", Stopwatch.GetElapsedTime(started).TotalMilliseconds);
                return new EmailTransportResult(body.MessageId);
            }
            catch (OperationCanceledException exception) when (!cancellationToken.IsCancellationRequested)
            {
                RecordTransientFailure();
                throw new EmailTransportException("brevo_acceptance_uncertain", true, exception, acceptanceUncertain: true);
            }
            catch (HttpRequestException exception)
            {
                RecordTransientFailure();
                throw new EmailTransportException("brevo_acceptance_uncertain", true, exception, acceptanceUncertain: true);
            }
        }
        finally
        {
            concurrency.Release();
        }
    }

    public void Dispose() => concurrency.Dispose();

    private void ThrowIfCircuitOpen()
    {
        lock (circuitLock)
        {
            if (circuitOpenUntil is null || clock.GetCurrentInstant() >= circuitOpenUntil.Value) return;
        }
        throw new EmailTransportException("notification_provider_circuit_open", true);
    }

    private void RecordTransientFailure()
    {
        lock (circuitLock)
        {
            consecutiveFailures++;
            if (consecutiveFailures < options.CircuitFailureThreshold) return;
            circuitOpenUntil = clock.GetCurrentInstant() + options.CircuitBreakDuration;
            logger.LogWarning(BrevoLogEvents.CircuitOpened, "Event={Event} Provider={Provider} BreakSeconds={BreakSeconds}", "notification.provider.circuit_opened", "email", options.CircuitBreakDuration.TotalSeconds);
        }
    }

    private void ResetCircuit()
    {
        lock (circuitLock)
        {
            consecutiveFailures = 0;
            circuitOpenUntil = null;
        }
    }

    private static EmailTransportException Classify(HttpStatusCode status) => status switch
    {
        HttpStatusCode.TooManyRequests => new("brevo_rate_limited", true),
        HttpStatusCode.RequestTimeout or HttpStatusCode.BadGateway or HttpStatusCode.ServiceUnavailable or HttpStatusCode.GatewayTimeout => new("brevo_unavailable", true),
        HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden => new("brevo_auth_failed", false),
        _ when (int)status >= 500 => new("brevo_unavailable", true),
        _ => new("brevo_rejected", false)
    };

    private sealed record BrevoSendRequest(
        BrevoSender Sender,
        IReadOnlyList<BrevoRecipient> To,
        string Subject,
        string HtmlContent,
        string TextContent,
        IReadOnlyDictionary<string, string> Headers,
        IReadOnlyList<string> Tags);
    private sealed record BrevoSender(string Email, string Name);
    private sealed record BrevoRecipient(string Email);
    private sealed record BrevoSendResponse(string MessageId);
}

public static class BrevoLogEvents
{
    public static readonly EventId CircuitOpened = new(6101, "NotificationProviderCircuitOpened");
}
