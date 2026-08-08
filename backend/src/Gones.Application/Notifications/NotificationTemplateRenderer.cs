using System.Collections.Concurrent;
using System.Globalization;
using System.Reflection;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.RegularExpressions;

namespace Gones.Application.Notifications;

public sealed class NotificationTemplateRenderer
{
    public const int MaxSubjectLength = 200;

    private const string PreviewUrl = "https://preview.invalid/redacted";
    private static readonly Regex PlaceholderPattern = new("\\{\\{([A-Za-z][A-Za-z0-9]*)\\}\\}", RegexOptions.CultureInvariant);
    private static readonly ConcurrentDictionary<string, string> TemplateCache = new(StringComparer.Ordinal);
    private static readonly IReadOnlyDictionary<string, (string French, string English)> Subjects =
        new Dictionary<string, (string French, string English)>(StringComparer.Ordinal)
        {
            [NotificationTemplateKeys.VerifyEmail] = ("Vérifiez votre adresse email", "Verify your email address"),
            [NotificationTemplateKeys.ResetPassword] = ("Réinitialisez votre mot de passe", "Reset your password"),
            [NotificationTemplateKeys.Registration] = ("Inscription au tournoi confirmée", "Tournament registration confirmed"),
            [NotificationTemplateKeys.Unregistration] = ("Désinscription du tournoi", "Tournament registration cancelled"),
            [NotificationTemplateKeys.MajorUpdate] = ("Modification importante du tournoi", "Important tournament update"),
            [NotificationTemplateKeys.Cancellation] = ("Tournoi annulé", "Tournament cancelled"),
            [NotificationTemplateKeys.Reminder] = ("Rappel de tournoi", "Tournament reminder"),
            [NotificationTemplateKeys.OrganizerNotice] = ("Nouvelle activité sur votre tournoi", "New activity on your tournament"),
            [NotificationTemplateKeys.TournamentProposal] = ("Demande de validation de tournoi", "Tournament approval request")
        };

    public RenderedEmail Render(string? locale, NotificationTemplateModel model)
    {
        ArgumentNullException.ThrowIfNull(model);
        var normalizedLocale = NormalizeLocale(locale);
        var templateKey = NotificationModelSerializer.TemplateKey(model);
        var values = Values(model, normalizedLocale, safePreview: false);
        var previewValues = Values(model, normalizedLocale, safePreview: true);
        var subject = normalizedLocale == "en" ? Subjects[templateKey].English : Subjects[templateKey].French;
        subject = NormalizeSubject(subject);

        var htmlTemplate = LoadTemplate(normalizedLocale, templateKey, "html");
        var textTemplate = LoadTemplate(normalizedLocale, templateKey, "txt");
        return new RenderedEmail(
            subject,
            Apply(htmlTemplate, values, htmlEncode: true),
            Apply(textTemplate, values, htmlEncode: false),
            Apply(htmlTemplate, previewValues, htmlEncode: true),
            Apply(textTemplate, previewValues, htmlEncode: false));
    }

    public static void ValidateModel(string? locale, NotificationTemplateModel model)
    {
        ArgumentNullException.ThrowIfNull(model);
        _ = Values(model, NormalizeLocale(locale), safePreview: false);
    }

    public static string NormalizeLocale(string? locale)
    {
        if (string.IsNullOrWhiteSpace(locale)) return "fr";
        var language = locale.Trim().Split(['-', '_'], 2)[0];
        return string.Equals(language, "en", StringComparison.OrdinalIgnoreCase) ? "en" : "fr";
    }

    private static IReadOnlyDictionary<string, string> Values(NotificationTemplateModel model, string locale, bool safePreview)
    {
        var previewUrl = new Uri(PreviewUrl);
        return model switch
        {
            VerifyEmailTemplateModel value => new Dictionary<string, string>
            {
                ["Username"] = Text(value.Username, safePreview),
                ["ActionUrl"] = Url(safePreview ? previewUrl : value.ActionUrl)
            },
            ResetPasswordTemplateModel value => new Dictionary<string, string>
            {
                ["Username"] = Text(value.Username, safePreview),
                ["ActionUrl"] = Url(safePreview ? previewUrl : value.ActionUrl)
            },
            RegistrationTemplateModel value => TournamentValues(value.Username, value.TournamentName, value.TournamentUrl, safePreview),
            UnregistrationTemplateModel value => TournamentValues(value.Username, value.TournamentName, value.TournamentUrl, safePreview),
            MajorUpdateTemplateModel value => new Dictionary<string, string>
            {
                ["Username"] = Text(value.Username, safePreview),
                ["TournamentName"] = Text(value.TournamentName, safePreview),
                ["ChangeSummary"] = Text(value.ChangeSummary, safePreview),
                ["TournamentUrl"] = Url(safePreview ? previewUrl : value.TournamentUrl)
            },
            CancellationTemplateModel value => TournamentValues(value.Username, value.TournamentName, value.TournamentUrl, safePreview),
            ReminderTemplateModel value => new Dictionary<string, string>
            {
                ["Username"] = Text(value.Username, safePreview),
                ["TournamentName"] = Text(value.TournamentName, safePreview),
                ["StartsAt"] = Text(FormatStartsAt(value.StartsAtUtc, value.TimeZoneId, locale), safePreview),
                ["TournamentUrl"] = Url(safePreview ? previewUrl : value.TournamentUrl)
            },
            OrganizerNoticeTemplateModel value => new Dictionary<string, string>
            {
                ["OrganizerName"] = Text(value.OrganizerName, safePreview),
                ["ParticipantName"] = Text(value.ParticipantName, safePreview),
                ["TournamentName"] = Text(value.TournamentName, safePreview),
                ["Notice"] = Text(value.Notice, safePreview),
                ["TournamentUrl"] = Url(safePreview ? previewUrl : value.TournamentUrl)
            },
            TournamentProposalTemplateModel value => new Dictionary<string, string>
            {
                ["ApproverName"] = Text(value.ApproverName, safePreview),
                ["SubmitterName"] = Text(value.SubmitterName, safePreview),
                ["TournamentName"] = Text(value.TournamentName, safePreview),
                ["TournamentSummary"] = Text(value.TournamentSummary, safePreview),
                ["VenueAddress"] = Text(value.VenueAddress, safePreview),
                ["StartsAt"] = Text(value.StartsAt, safePreview),
                ["EndsAt"] = Text(value.EndsAt, safePreview),
                ["TimeZoneId"] = Text(value.TimeZoneId, safePreview),
                ["Formats"] = Text(value.Formats, safePreview),
                ["Capacity"] = Text(value.Capacity, safePreview),
                // The review token lives in this URL only; the safe preview redacts it like every other link.
                ["ReviewUrl"] = Url(safePreview ? previewUrl : value.ReviewUrl)
            },
            _ => throw new NotificationTemplateException("notification_template_unknown")
        };
    }

    private static IReadOnlyDictionary<string, string> TournamentValues(string username, string tournamentName, Uri tournamentUrl, bool safePreview) =>
        new Dictionary<string, string>
        {
            ["Username"] = Text(username, safePreview),
            ["TournamentName"] = Text(tournamentName, safePreview),
            ["TournamentUrl"] = Url(safePreview ? new Uri(PreviewUrl) : tournamentUrl)
        };

    private static string Apply(string template, IReadOnlyDictionary<string, string> values, bool htmlEncode)
    {
        var placeholders = PlaceholderPattern.Matches(template).Select(match => match.Groups[1].Value).ToHashSet(StringComparer.Ordinal);
        if (!placeholders.SetEquals(values.Keys)) throw new NotificationTemplateException("notification_template_placeholders_invalid");

        var rendered = template;
        foreach (var (key, value) in values)
        {
            rendered = rendered.Replace($"{{{{{key}}}}}", htmlEncode ? HtmlEncoder.Default.Encode(value) : value, StringComparison.Ordinal);
        }
        return rendered;
    }

    private static string LoadTemplate(string locale, string templateKey, string extension)
    {
        var suffix = $".Notifications.Templates.{locale}.{templateKey}.{extension}";
        return TemplateCache.GetOrAdd(suffix, static resourceSuffix =>
        {
            var assembly = typeof(NotificationTemplateRenderer).Assembly;
            var resourceName = assembly.GetManifestResourceNames().SingleOrDefault(name => name.EndsWith(resourceSuffix, StringComparison.Ordinal))
                ?? throw new NotificationTemplateException("notification_template_missing");
            using var stream = assembly.GetManifestResourceStream(resourceName)
                ?? throw new NotificationTemplateException("notification_template_missing");
            using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
            return reader.ReadToEnd();
        });
    }

    private static string Url(Uri? value)
    {
        if (value is null || !value.IsAbsoluteUri || !string.Equals(value.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) || !string.IsNullOrEmpty(value.UserInfo))
        {
            throw new NotificationTemplateException("notification_link_must_be_https");
        }
        return value.AbsoluteUri;
    }

    private static string Text(string? value, bool safePreview)
    {
        var required = RequireText(value);
        return safePreview ? "[redacted]" : required;
    }

    private static string RequireText(string? value) =>
        !string.IsNullOrWhiteSpace(value) ? value : throw new NotificationTemplateException("notification_model_invalid");

    private static string FormatStartsAt(DateTimeOffset startsAtUtc, string timeZoneId, string locale)
    {
        try
        {
            var zone = TimeZoneInfo.FindSystemTimeZoneById(RequireText(timeZoneId));
            var local = TimeZoneInfo.ConvertTime(startsAtUtc, zone);
            return local.ToString("f", CultureInfo.GetCultureInfo(locale == "en" ? "en-US" : "fr-FR"));
        }
        catch (TimeZoneNotFoundException)
        {
            throw new NotificationTemplateException("notification_time_zone_invalid");
        }
        catch (InvalidTimeZoneException)
        {
            throw new NotificationTemplateException("notification_time_zone_invalid");
        }
    }

    private static string NormalizeSubject(string value)
    {
        var normalized = value.Replace("\r", string.Empty, StringComparison.Ordinal).Replace("\n", " ", StringComparison.Ordinal).Trim();
        if (normalized.Length is 0 or > MaxSubjectLength) throw new NotificationTemplateException("notification_subject_invalid");
        return normalized;
    }
}
