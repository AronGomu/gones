using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Gones.Api.Errors;
using Gones.Domain.Notifications;
using Gones.Infrastructure.Notifications;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using Npgsql;

namespace Gones.Api.Notifications;

internal sealed record BrevoWebhookOptions(string PathToken, int RequestsPerMinute)
{
    public const int MaximumBodyBytes = 32 * 1024;

    public static BrevoWebhookOptions? TryLoad(IConfiguration configuration)
    {
        var direct = configuration["GONES_BREVO_WEBHOOK_PATH_TOKEN"];
        var path = configuration["GONES_BREVO_WEBHOOK_PATH_TOKEN_FILE"];
        if (!string.IsNullOrWhiteSpace(direct) && !string.IsNullOrWhiteSpace(path)) throw new InvalidOperationException("Configure only one Brevo webhook path token source.");
        if (!string.IsNullOrWhiteSpace(path))
        {
            if (!Path.IsPathRooted(path)) throw new InvalidOperationException("GONES_BREVO_WEBHOOK_PATH_TOKEN_FILE must be absolute.");
            direct = File.ReadAllText(path).Trim();
        }
        if (string.IsNullOrWhiteSpace(direct)) return null;
        if (direct.Length < 32 || direct.Length > 128 || direct.Any(character => !char.IsAsciiLetterOrDigit(character) && character is not '-' and not '_'))
        {
            throw new InvalidOperationException("Brevo webhook path token must be 32-128 base64url characters.");
        }
        var configuredLimit = configuration["GONES_BREVO_WEBHOOK_RATE_LIMIT_PER_MINUTE"];
        var limit = string.IsNullOrWhiteSpace(configuredLimit) ? 60
            : int.TryParse(configuredLimit, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed) ? parsed
            : throw new InvalidOperationException("GONES_BREVO_WEBHOOK_RATE_LIMIT_PER_MINUTE must be an integer.");
        if (limit is < 1 or > 1000) throw new InvalidOperationException("Brevo webhook rate limit must be between 1 and 1000.");
        return new BrevoWebhookOptions(direct, limit);
    }
}

internal sealed class BrevoWebhookRateGate(BrevoWebhookOptions options, IClock clock)
{
    private readonly Queue<Instant> accepted = new();
    private readonly object sync = new();

    public bool TryAcquire()
    {
        lock (sync)
        {
            var cutoff = clock.GetCurrentInstant() - Duration.FromMinutes(1);
            while (accepted.TryPeek(out var instant) && instant <= cutoff) accepted.Dequeue();
            if (accepted.Count >= options.RequestsPerMinute) return false;
            accepted.Enqueue(clock.GetCurrentInstant());
            return true;
        }
    }
}

internal sealed class BrevoWebhookService(
    GonesDbContext database,
    IClock clock,
    NotificationMetrics metrics,
    ILogger<BrevoWebhookService> logger)
{
    public async Task<bool> ProcessAsync(JsonElement payload, CancellationToken cancellationToken)
    {
        var parsed = Parse(payload);
        if (await database.NotificationDeliveryEvents.AsNoTracking().AnyAsync(item => item.ReplayKey == parsed.ReplayKey, cancellationToken))
        {
            logger.LogInformation(BrevoWebhookLogEvents.Replayed, "Event={Event} OutboxId={OutboxId}", "notification.webhook.replayed", parsed.OutboxId);
            return false;
        }
        var outbox = await database.NotificationOutboxRecords.SingleOrDefaultAsync(item => item.Id == parsed.OutboxId, cancellationToken)
            ?? throw new ResourceNotFoundException();
        var mapping = NotificationDeliveryPolicy.MapProviderEvent(parsed.ProviderEvent);
        database.NotificationDeliveryEvents.Add(NotificationDeliveryEvent.Create(
            parsed.ReplayKey,
            outbox.Id,
            parsed.ProviderMessageId,
            mapping.Status,
            parsed.OccurredAt,
            clock.GetCurrentInstant()));
        outbox.ApplyDeliveryEvent(parsed.ProviderMessageId, mapping.Status, parsed.OccurredAt, clock.GetCurrentInstant());
        try
        {
            await database.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return false;
        }
        metrics.RecordProviderEvent(mapping.Status);
        logger.LogInformation(BrevoWebhookLogEvents.Accepted, "Event={Event} OutboxId={OutboxId} DeliveryStatus={DeliveryStatus}", "notification.webhook.accepted", outbox.Id, mapping.Status);
        return true;
    }

    private static ParsedWebhook Parse(JsonElement payload)
    {
        if (payload.ValueKind != JsonValueKind.Object || payload.EnumerateObject().Count() > 32) throw Malformed();
        var eventName = RequiredString(payload, "event", 30);
        try { _ = NotificationDeliveryPolicy.MapProviderEvent(eventName); }
        catch (ArgumentOutOfRangeException) { throw Malformed(); }
        var eventId = RequiredScalar(payload, "id", 100);
        var messageId = RequiredString(payload, "message-id", NotificationDeliveryEvent.MaximumProviderMessageIdLength);
        var correlation = RequiredCorrelation(payload);
        if (!Guid.TryParseExact(correlation, "N", out var outboxId)) throw Malformed();
        if (!payload.TryGetProperty("ts_event", out var timestampProperty)
            || timestampProperty.ValueKind != JsonValueKind.Number
            || !timestampProperty.TryGetInt64(out var unixSeconds)) throw Malformed();
        Instant occurredAt;
        try { occurredAt = Instant.FromUnixTimeSeconds(unixSeconds); }
        catch (ArgumentOutOfRangeException) { throw Malformed(); }
        var replayMaterial = $"{eventName}\n{eventId}\n{messageId}\n{unixSeconds.ToString(CultureInfo.InvariantCulture)}";
        var replayKey = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(replayMaterial)));
        return new ParsedWebhook(eventName, replayKey, messageId, outboxId, occurredAt);
    }

    private static string RequiredString(JsonElement payload, string name, int maximumLength)
    {
        if (!payload.TryGetProperty(name, out var property) || property.ValueKind != JsonValueKind.String) throw Malformed();
        var value = property.GetString();
        return !string.IsNullOrWhiteSpace(value) && value.Length <= maximumLength && !value.Any(char.IsControl) ? value : throw Malformed();
    }

    private static string RequiredScalar(JsonElement payload, string name, int maximumLength)
    {
        if (!payload.TryGetProperty(name, out var property) || property.ValueKind is not (JsonValueKind.String or JsonValueKind.Number)) throw Malformed();
        var value = property.ValueKind == JsonValueKind.String ? property.GetString() : property.GetRawText();
        return !string.IsNullOrWhiteSpace(value) && value.Length <= maximumLength && !value.Any(char.IsControl) ? value : throw Malformed();
    }

    private static string RequiredCorrelation(JsonElement payload)
    {
        if (payload.TryGetProperty("tag", out var tag) && tag.ValueKind == JsonValueKind.String) return RequiredString(payload, "tag", 32);
        if (!payload.TryGetProperty("tags", out var tags) || tags.ValueKind != JsonValueKind.Array || tags.GetArrayLength() is < 1 or > 10) throw Malformed();
        var correlations = tags.EnumerateArray()
            .Where(item => item.ValueKind == JsonValueKind.String)
            .Select(item => item.GetString())
            .Where(item => item is { Length: 32 } && Guid.TryParseExact(item, "N", out _))
            .ToArray();
        return correlations.Length == 1 ? correlations[0]! : throw Malformed();
    }

    private static ApiValidationException Malformed() => new(new Dictionary<string, string[]> { ["webhook"] = ["Webhook payload is invalid."] });
    private sealed record ParsedWebhook(string ProviderEvent, string ReplayKey, string ProviderMessageId, Guid OutboxId, Instant OccurredAt);
}

internal static class BrevoWebhookEndpoints
{
    public static void MapBrevoWebhook(this WebApplication app, BrevoWebhookOptions options)
    {
        app.MapPost("/api/notifications/webhooks/brevo/{webhookToken}", HandleAsync)
            .AllowAnonymous()
            .DisableAntiforgery()
            .Accepts<BrevoWebhookRequest>("application/json")
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status413PayloadTooLarge)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);
    }

    private static async Task<IResult> HandleAsync(
        string webhookToken,
        HttpRequest request,
        BrevoWebhookOptions options,
        BrevoWebhookRateGate rateGate,
        BrevoWebhookService service,
        CancellationToken cancellationToken)
    {
        if (!FixedTimeEquals(webhookToken, options.PathToken)) return Results.NotFound();
        if (!request.IsHttps) return Results.BadRequest();
        if (!rateGate.TryAcquire()) return Results.StatusCode(StatusCodes.Status429TooManyRequests);
        if (request.ContentLength > BrevoWebhookOptions.MaximumBodyBytes) return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
        if (request.ContentType is null || !request.ContentType.StartsWith("application/json", StringComparison.OrdinalIgnoreCase)) return Results.BadRequest();
        try
        {
            await using var buffer = new MemoryStream();
            var chunk = new byte[8192];
            while (true)
            {
                var read = await request.Body.ReadAsync(chunk, cancellationToken);
                if (read == 0) break;
                if (buffer.Length + read > BrevoWebhookOptions.MaximumBodyBytes) return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
                await buffer.WriteAsync(chunk.AsMemory(0, read), cancellationToken);
            }
            buffer.Position = 0;
            using var document = await JsonDocument.ParseAsync(buffer, new JsonDocumentOptions { MaxDepth = 8 }, cancellationToken);
            await service.ProcessAsync(document.RootElement, cancellationToken);
            return Results.NoContent();
        }
        catch (JsonException)
        {
            return Results.BadRequest();
        }
    }

    private static bool FixedTimeEquals(string supplied, string expected)
    {
        var suppliedBytes = Encoding.UTF8.GetBytes(supplied);
        var expectedBytes = Encoding.UTF8.GetBytes(expected);
        return CryptographicOperations.FixedTimeEquals(suppliedBytes, expectedBytes);
    }
}

internal sealed record BrevoWebhookRequest(
    string Event,
    long Id,
    [property: JsonPropertyName("message-id")] string MessageId,
    string Tag,
    [property: JsonPropertyName("ts_event")] long EventTimestamp);

internal static class BrevoWebhookLogEvents
{
    public static readonly EventId Accepted = new(6201, "NotificationWebhookAccepted");
    public static readonly EventId Replayed = new(6202, "NotificationWebhookReplayed");
}
