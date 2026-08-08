using System.Text.Json;
using Gones.Domain.Notifications;
using NodaTime;

namespace Gones.Application.Notifications;

public static class NotificationTemplateKeys
{
    public const string VerifyEmail = "verify-email";
    public const string ResetPassword = "reset-password";
    public const string Registration = "registration";
    public const string Unregistration = "unregistration";
    public const string MajorUpdate = "major-update";
    public const string Cancellation = "cancellation";
    public const string Reminder = "reminder";
    public const string OrganizerNotice = "organizer-notice";
    public const string TournamentProposal = "tournament-proposal";
    public const string TournamentProposalRejected = "tournament-proposal-rejected";
}

public abstract record NotificationTemplateModel;

public sealed record VerifyEmailTemplateModel(string Username, Uri ActionUrl) : NotificationTemplateModel;
public sealed record ResetPasswordTemplateModel(string Username, Uri ActionUrl) : NotificationTemplateModel;
public sealed record RegistrationTemplateModel(string Username, string TournamentName, Uri TournamentUrl) : NotificationTemplateModel;
public sealed record UnregistrationTemplateModel(string Username, string TournamentName, Uri TournamentUrl) : NotificationTemplateModel;
public sealed record MajorUpdateTemplateModel(string Username, string TournamentName, string ChangeSummary, Uri TournamentUrl) : NotificationTemplateModel;
public sealed record CancellationTemplateModel(string Username, string TournamentName, Uri TournamentUrl) : NotificationTemplateModel;
public sealed record ReminderTemplateModel(string Username, string TournamentName, DateTimeOffset StartsAtUtc, string TimeZoneId, Uri TournamentUrl) : NotificationTemplateModel;
public sealed record OrganizerNoticeTemplateModel(string OrganizerName, string ParticipantName, string TournamentName, string Notice, Uri TournamentUrl) : NotificationTemplateModel;
/// <summary>
/// Carries every field the submitter typed, so an approver can decide from the mail alone.
/// <paramref name="ReviewUrl"/> holds that approver's own single-use token — one recipient, one token.
/// </summary>
public sealed record TournamentProposalTemplateModel(
    string ApproverName,
    string SubmitterName,
    string TournamentName,
    string TournamentSummary,
    string VenueAddress,
    string StartsAt,
    string EndsAt,
    string TimeZoneId,
    string Formats,
    string Capacity,
    Uri ReviewUrl) : NotificationTemplateModel;

/// <summary>
/// T17. Sent to the submitter when an approver declines the request. <paramref name="Reason"/> is the
/// approver's own words, so it reaches the submitter through the mail body and nowhere else — never
/// an audit diff and never a log line.
/// </summary>
public sealed record TournamentProposalRejectedTemplateModel(
    string SubmitterName,
    string TournamentName,
    string ApproverName,
    string Reason,
    Uri CalendarUrl) : NotificationTemplateModel;

public sealed record NotificationRequest(
    string Recipient,
    string Locale,
    string DedupeKey,
    NotificationTemplateModel Model,
    Guid? UserId = null,
    Guid? TournamentId = null);

public sealed record RenderedEmail(
    string Subject,
    string HtmlBody,
    string TextBody,
    string SafePreviewHtmlBody,
    string SafePreviewTextBody);

public sealed record OutgoingEmail(
    Guid OutboxId,
    string DedupeKey,
    string TemplateKey,
    string Recipient,
    RenderedEmail Content);

public interface INotificationOutbox
{
    Guid Enqueue(NotificationRequest request);
}

public sealed record EmailTransportResult(string? ProviderMessageId = null);

public interface IEmailTransport
{
    Task<EmailTransportResult> SendAsync(OutgoingEmail email, CancellationToken cancellationToken);
}

public sealed class EmailTransportException(
    string code,
    bool isTransient,
    Exception? innerException = null,
    bool acceptanceUncertain = false)
    : Exception(code, innerException)
{
    public string Code { get; } = NotificationErrorCode.Require(code);
    public bool IsTransient { get; } = isTransient;
    public bool AcceptanceUncertain { get; } = acceptanceUncertain;
}

public sealed class NotificationTemplateException(string code) : Exception(code)
{
    public string Code { get; } = code;
}

public static class NotificationModelSerializer
{
    public const int MaxModelBytes = 16 * 1024;

    private static readonly JsonSerializerOptions Options = new()
    {
        MaxDepth = 16,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public static string TemplateKey(NotificationTemplateModel model) => model switch
    {
        VerifyEmailTemplateModel => NotificationTemplateKeys.VerifyEmail,
        ResetPasswordTemplateModel => NotificationTemplateKeys.ResetPassword,
        RegistrationTemplateModel => NotificationTemplateKeys.Registration,
        UnregistrationTemplateModel => NotificationTemplateKeys.Unregistration,
        MajorUpdateTemplateModel => NotificationTemplateKeys.MajorUpdate,
        CancellationTemplateModel => NotificationTemplateKeys.Cancellation,
        ReminderTemplateModel => NotificationTemplateKeys.Reminder,
        OrganizerNoticeTemplateModel => NotificationTemplateKeys.OrganizerNotice,
        TournamentProposalTemplateModel => NotificationTemplateKeys.TournamentProposal,
        TournamentProposalRejectedTemplateModel => NotificationTemplateKeys.TournamentProposalRejected,
        _ => throw new NotificationTemplateException("notification_template_unknown")
    };

    public static string Serialize(NotificationTemplateModel model)
    {
        ArgumentNullException.ThrowIfNull(model);
        var json = JsonSerializer.Serialize(model, model.GetType(), Options);
        if (System.Text.Encoding.UTF8.GetByteCount(json) > MaxModelBytes)
        {
            throw new NotificationTemplateException("notification_model_too_large");
        }
        return json;
    }

    public static NotificationTemplateModel Deserialize(string templateKey, string json)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(templateKey);
        ArgumentException.ThrowIfNullOrWhiteSpace(json);
        if (System.Text.Encoding.UTF8.GetByteCount(json) > MaxModelBytes)
        {
            throw new NotificationTemplateException("notification_model_too_large");
        }

        try
        {
            return templateKey switch
            {
                NotificationTemplateKeys.VerifyEmail => Required<VerifyEmailTemplateModel>(json),
                NotificationTemplateKeys.ResetPassword => Required<ResetPasswordTemplateModel>(json),
                NotificationTemplateKeys.Registration => Required<RegistrationTemplateModel>(json),
                NotificationTemplateKeys.Unregistration => Required<UnregistrationTemplateModel>(json),
                NotificationTemplateKeys.MajorUpdate => Required<MajorUpdateTemplateModel>(json),
                NotificationTemplateKeys.Cancellation => Required<CancellationTemplateModel>(json),
                NotificationTemplateKeys.Reminder => Required<ReminderTemplateModel>(json),
                NotificationTemplateKeys.OrganizerNotice => Required<OrganizerNoticeTemplateModel>(json),
                NotificationTemplateKeys.TournamentProposal => Required<TournamentProposalTemplateModel>(json),
                NotificationTemplateKeys.TournamentProposalRejected => Required<TournamentProposalRejectedTemplateModel>(json),
                _ => throw new NotificationTemplateException("notification_template_unknown")
            };
        }
        catch (JsonException)
        {
            throw new NotificationTemplateException("notification_model_invalid");
        }
    }

    private static T Required<T>(string json) where T : NotificationTemplateModel =>
        JsonSerializer.Deserialize<T>(json, Options) ?? throw new NotificationTemplateException("notification_model_invalid");
}

public sealed record NotificationRetryDecision(bool ShouldRetry, Duration Delay);

public interface INotificationRetryPolicy
{
    NotificationRetryDecision Decide(int attemptCount);
}

public sealed class DefaultNotificationRetryPolicy : INotificationRetryPolicy
{
    private static readonly Duration[] Delays =
    [
        Duration.FromMinutes(1),
        Duration.FromMinutes(5),
        Duration.FromMinutes(30),
        Duration.FromHours(2),
        Duration.FromHours(12)
    ];

    public static DefaultNotificationRetryPolicy Instance { get; } = new();

    private DefaultNotificationRetryPolicy() { }

    public NotificationRetryDecision Decide(int attemptCount)
    {
        if (attemptCount <= 0) throw new ArgumentOutOfRangeException(nameof(attemptCount));
        return attemptCount <= Delays.Length
            ? new NotificationRetryDecision(true, Delays[attemptCount - 1])
            : new NotificationRetryDecision(false, Duration.Zero);
    }
}
