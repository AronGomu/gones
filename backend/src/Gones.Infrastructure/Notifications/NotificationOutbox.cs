using System.Diagnostics;
using System.Net.Mail;
using Gones.Application.Notifications;
using Gones.Domain.Notifications;
using Gones.Infrastructure.Observability;
using Gones.Infrastructure.Persistence;
using NodaTime;

namespace Gones.Infrastructure.Notifications;

public sealed class NotificationOutbox(GonesDbContext database, IClock clock) : INotificationOutbox
{
    public Guid Enqueue(NotificationRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        var recipient = ValidateRecipient(request.Recipient);
        var dedupeKey = ValidateText(request.DedupeKey, 200, "notification_dedupe_key_invalid");
        var locale = NotificationTemplateRenderer.NormalizeLocale(request.Locale);
        NotificationTemplateRenderer.ValidateModel(locale, request.Model);
        var templateKey = NotificationModelSerializer.TemplateKey(request.Model);
        var modelJson = NotificationModelSerializer.Serialize(request.Model);
        using var enqueueActivity = GonesTelemetry.Activities.StartActivity("notification.enqueue", ActivityKind.Producer);
        var traceCarrier = enqueueActivity ?? Activity.Current;
        enqueueActivity?.SetTag("messaging.system", "gones.notification_outbox");
        enqueueActivity?.SetTag("messaging.operation.name", "enqueue");
        var record = new NotificationOutboxRecord(
            dedupeKey,
            templateKey,
            locale,
            recipient,
            modelJson,
            request.UserId,
            request.TournamentId,
            clock.GetCurrentInstant(),
            traceCarrier?.Id,
            traceCarrier?.GetBaggageItem("gones.correlation_id"));
        database.NotificationOutboxRecords.Add(record);
        return record.Id;
    }

    private static string ValidateRecipient(string? recipient)
    {
        var normalized = recipient?.Trim();
        if (string.IsNullOrWhiteSpace(normalized)
            || normalized.Length > 320
            || !MailAddress.TryCreate(normalized, out var parsed)
            || !string.Equals(parsed.Address, normalized, StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException("notification_recipient_invalid", nameof(recipient));
        }
        return normalized;
    }

    private static string ValidateText(string? value, int maxLength, string code)
    {
        var normalized = value?.Trim();
        if (string.IsNullOrWhiteSpace(normalized) || normalized.Length > maxLength || normalized.Any(char.IsControl))
        {
            throw new ArgumentException(code, nameof(value));
        }
        return normalized;
    }
}
