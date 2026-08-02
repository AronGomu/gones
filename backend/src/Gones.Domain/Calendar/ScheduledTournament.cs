using System.Globalization;
using System.Security;
using System.Text;
using System.Xml;
using System.Xml.Linq;
using Gones.Domain.Catalog;
using Gones.Domain.Persistence;
using NodaTime;

namespace Gones.Domain.Calendar;

public enum ScheduledTournamentStatus
{
    Published,
    InProgress,
    Completed,
    Cancelled
}

public enum TournamentChangeSeverity
{
    None,
    Minor,
    Major
}

public enum TournamentLifecycleEventType
{
    MajorDetailsUpdated,
    Cancelled,
    Deleted,
    Restored
}

public enum TournamentReminderPlanAction
{
    None,
    RecalculateFuture,
    CancelFuture
}

public sealed class TournamentLifecycleEvent
{
    private TournamentLifecycleEvent() { }

    public Guid Id { get; private init; } = Guid.NewGuid();
    public Guid TournamentId { get; private init; }
    public Guid ActorUserId { get; private init; }
    public TournamentLifecycleEventType EventType { get; private init; }
    public TournamentReminderPlanAction ReminderPlanAction { get; private init; }
    public Instant OccurredAt { get; private init; }

    public static TournamentLifecycleEvent Create(
        Guid tournamentId,
        Guid actorUserId,
        TournamentLifecycleEventType eventType,
        TournamentReminderPlanAction reminderPlanAction,
        Instant occurredAt)
    {
        if (tournamentId == Guid.Empty) throw new ArgumentException("Tournament ID cannot be empty.", nameof(tournamentId));
        if (actorUserId == Guid.Empty) throw new ArgumentException("Actor user ID cannot be empty.", nameof(actorUserId));
        return new TournamentLifecycleEvent
        {
            TournamentId = tournamentId,
            ActorUserId = actorUserId,
            EventType = eventType,
            ReminderPlanAction = reminderPlanAction,
            OccurredAt = occurredAt
        };
    }
}

public sealed record ScheduledTournamentDraft(
    string Title,
    string Slug,
    string? Summary,
    string? BodyHtml,
    string StreetAddress,
    string? PostalCode,
    string City,
    string Country,
    string TimeZoneId,
    LocalDateTime StartsAtLocal,
    LocalDateTime? EndsAtLocal,
    int? Capacity);

public sealed class ScheduledTournament : VersionedEntity
{
    public const int MaximumTitleLength = 160;
    public const int MaximumSlugLength = 120;
    public const int MaximumSummaryLength = 50;
    public const int MaximumBodyHtmlLength = 10000;
    public const int MaximumAddressLength = 240;
    public const int MaximumPostalCodeLength = 32;
    public const int MaximumCityLength = 120;
    public const int MaximumCountryLength = 120;
    public const int MaximumTimeZoneLength = 100;
    public const int MaximumDeletedReasonLength = 300;
    public const int MaximumSearchTextLength = 600;

    private ScheduledTournament() { }

    public Guid OrganizationId { get; private init; }
    public string Title { get; private set; } = string.Empty;
    public string Slug { get; private set; } = string.Empty;
    public string? Summary { get; private set; }
    public string? BodyHtml { get; private set; }
    public string StreetAddress { get; private set; } = string.Empty;
    public string? PostalCode { get; private set; }
    public string City { get; private set; } = string.Empty;
    public string Country { get; private set; } = string.Empty;
    public string TimeZoneId { get; private set; } = string.Empty;
    public LocalDate VenueStartDate { get; private set; }
    public LocalTime VenueStartTime { get; private set; }
    public LocalDate VenueEndDate { get; private set; }
    public LocalTime VenueEndTime { get; private set; }
    public Instant StartsAtUtc { get; private set; }
    public Instant EndsAtUtc { get; private set; }
    public int? Capacity { get; private set; }
    public ScheduledTournamentStatus Status { get; private set; } = ScheduledTournamentStatus.Published;
    public Guid CreatedByUserId { get; private init; }
    public Instant CreatedAt { get; private init; }
    public Instant UpdatedAt { get; private set; }
    public Instant? DeletedAt { get; private set; }
    public Guid? DeletedByUserId { get; private set; }
    public string? DeletedReason { get; private set; }
    public string NormalizedSearchText { get; private set; } = string.Empty;
    public ICollection<ScheduledTournamentFormat> Formats { get; private set; } = new List<ScheduledTournamentFormat>();

    public bool IsDeleted => DeletedAt is not null;

    public static ScheduledTournament Create(
        Guid organizationId,
        Guid createdByUserId,
        ScheduledTournamentDraft draft,
        IReadOnlyCollection<TournamentFormat> selectedFormats,
        Instant now)
    {
        if (organizationId == Guid.Empty) throw new ArgumentException("Organization ID cannot be empty.", nameof(organizationId));
        if (createdByUserId == Guid.Empty) throw new ArgumentException("Creator user ID cannot be empty.", nameof(createdByUserId));
        TournamentFormatSelection.RequireLegacyForV1(selectedFormats);
        var tournament = new ScheduledTournament
        {
            OrganizationId = organizationId,
            CreatedByUserId = createdByUserId,
            CreatedAt = now,
            UpdatedAt = now
        };
        tournament.ApplyDraft(draft, selectedFormats, now);
        return tournament;
    }

    public TournamentChangeSeverity ClassifyChange(ScheduledTournamentDraft draft, IReadOnlyCollection<TournamentFormat> selectedFormats)
    {
        var normalized = NormalizeDraft(draft, selectedFormats);
        var major = StartsAtUtc != normalized.StartsAtUtc
            || EndsAtUtc != normalized.EndsAtUtc
            || TimeZoneId != normalized.TimeZone.Id
            || StreetAddress != normalized.StreetAddress
            || PostalCode != normalized.PostalCode
            || City != normalized.City
            || Country != normalized.Country
            || Capacity != normalized.Capacity
            || !Formats.Select(format => format.TournamentFormatId).OrderBy(id => id).SequenceEqual(selectedFormats.Select(format => format.Id).OrderBy(id => id));
        if (major) return TournamentChangeSeverity.Major;

        var minor = Title != normalized.Title
            || Slug != normalized.Slug
            || Summary != normalized.Summary
            || BodyHtml != normalized.BodyHtml;
        return minor ? TournamentChangeSeverity.Minor : TournamentChangeSeverity.None;
    }

    public void UpdateDetails(ScheduledTournamentDraft draft, IReadOnlyCollection<TournamentFormat> selectedFormats, Instant now)
    {
        EnsureEditable(now);
        ApplyDraft(draft, selectedFormats, now);
    }

    public void AdvanceLifecycle(Instant now)
    {
        if (IsDeleted || Status is ScheduledTournamentStatus.Cancelled or ScheduledTournamentStatus.Completed) return;
        if (Status == ScheduledTournamentStatus.Published && now >= StartsAtUtc)
        {
            Status = ScheduledTournamentStatus.InProgress;
            UpdatedAt = now;
            return;
        }

        if (Status == ScheduledTournamentStatus.InProgress && now >= EndsAtUtc)
        {
            Status = ScheduledTournamentStatus.Completed;
            UpdatedAt = now;
        }
    }

    public void Cancel(Instant now)
    {
        if (IsDeleted) throw new InvalidOperationException("Deleted tournament cannot be cancelled.");
        if (Status == ScheduledTournamentStatus.Cancelled) return;
        Status = ScheduledTournamentStatus.Cancelled;
        UpdatedAt = now;
    }

    public void SoftDelete(Guid deletedByUserId, string? reason, Instant now)
    {
        if (deletedByUserId == Guid.Empty) throw new ArgumentException("Deleted-by user ID cannot be empty.", nameof(deletedByUserId));
        EnsureEditable(now);
        DeletedAt = now;
        DeletedByUserId = deletedByUserId;
        DeletedReason = ValidateOptional(reason, nameof(reason), MaximumDeletedReasonLength);
        UpdatedAt = now;
    }

    public void Restore(Instant now)
    {
        if (!IsDeleted) return;
        if (Status != ScheduledTournamentStatus.Published || now >= StartsAtUtc)
        {
            throw new InvalidOperationException("Tournament restore deadline has passed.");
        }

        DeletedAt = null;
        DeletedByUserId = null;
        DeletedReason = null;
        UpdatedAt = now;
    }

    private void ApplyDraft(ScheduledTournamentDraft draft, IReadOnlyCollection<TournamentFormat> selectedFormats, Instant now)
    {
        var normalized = NormalizeDraft(draft, selectedFormats);
        Title = normalized.Title;
        Slug = normalized.Slug;
        Summary = normalized.Summary;
        BodyHtml = normalized.BodyHtml;
        StreetAddress = normalized.StreetAddress;
        PostalCode = normalized.PostalCode;
        City = normalized.City;
        Country = normalized.Country;
        TimeZoneId = normalized.TimeZone.Id;
        VenueStartDate = normalized.StartsAtLocal.Date;
        VenueStartTime = normalized.StartsAtLocal.TimeOfDay;
        VenueEndDate = normalized.EndsAtLocal.Date;
        VenueEndTime = normalized.EndsAtLocal.TimeOfDay;
        StartsAtUtc = normalized.StartsAtUtc;
        EndsAtUtc = normalized.EndsAtUtc;
        Capacity = normalized.Capacity;
        NormalizedSearchText = BuildSearchText(Title, Summary, City, Country);
        Formats.Clear();
        foreach (var format in selectedFormats.OrderBy(format => format.Slug, StringComparer.Ordinal))
        {
            Formats.Add(ScheduledTournamentFormat.Create(Id, format.Id));
        }
        UpdatedAt = now;
    }

    private void EnsureEditable(Instant now)
    {
        if (IsDeleted) throw new InvalidOperationException("Deleted tournament cannot be edited.");
        if (Status != ScheduledTournamentStatus.Published || now >= StartsAtUtc)
        {
            throw new InvalidOperationException("Tournament edit deadline has passed.");
        }
    }

    private static NormalizedDraft NormalizeDraft(ScheduledTournamentDraft draft, IReadOnlyCollection<TournamentFormat> selectedFormats)
    {
        ArgumentNullException.ThrowIfNull(draft);
        TournamentFormatSelection.RequireLegacyForV1(selectedFormats);
        var title = ValidateRequired(draft.Title, nameof(draft.Title), MaximumTitleLength);
        var slug = TournamentSlug.Normalize(draft.Slug);
        var summary = ValidateOptional(draft.Summary, nameof(draft.Summary), MaximumSummaryLength);
        var bodyHtml = TournamentContentSanitizer.Sanitize(draft.BodyHtml);
        var streetAddress = ValidateRequired(draft.StreetAddress, nameof(draft.StreetAddress), MaximumAddressLength);
        var postalCode = ValidateOptional(draft.PostalCode, nameof(draft.PostalCode), MaximumPostalCodeLength);
        var city = ValidateRequired(draft.City, nameof(draft.City), MaximumCityLength);
        var country = ValidateRequired(draft.Country, nameof(draft.Country), MaximumCountryLength);
        var zone = DateTimeZoneProviders.Tzdb.GetZoneOrNull(ValidateRequired(draft.TimeZoneId, nameof(draft.TimeZoneId), MaximumTimeZoneLength))
            ?? throw new ArgumentException("Time zone must be a valid IANA zone.", nameof(draft));
        var endLocal = draft.EndsAtLocal ?? draft.StartsAtLocal.Date.At(new LocalTime(23, 59, 59));
        var startsAtUtc = ResolveRequiredStart(zone, draft.StartsAtLocal);
        var endsAtUtc = ResolveEnd(zone, endLocal);
        if (endsAtUtc < startsAtUtc) throw new ArgumentException("Tournament end cannot be before start.", nameof(draft));
        if (draft.Capacity is <= 0) throw new ArgumentOutOfRangeException(nameof(draft), "Capacity must be positive when present.");
        return new NormalizedDraft(title, slug, summary, bodyHtml, streetAddress, postalCode, city, country, zone, draft.StartsAtLocal, endLocal, startsAtUtc, endsAtUtc, draft.Capacity);
    }

    private static Instant ResolveRequiredStart(DateTimeZone zone, LocalDateTime local)
    {
        try
        {
            return zone.AtStrictly(local).ToInstant();
        }
        catch (AmbiguousTimeException)
        {
            return zone.AtLeniently(local).ToInstant();
        }
        catch (SkippedTimeException exception)
        {
            throw new ArgumentException("Tournament start time falls in a daylight-saving gap.", nameof(local), exception);
        }
    }

    private static Instant ResolveEnd(DateTimeZone zone, LocalDateTime local) => zone.AtLeniently(local).ToInstant();

    private static string ValidateRequired(string value, string parameterName, int maximumLength)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value, parameterName);
        var trimmed = value.Trim();
        if (trimmed.Length > maximumLength) throw new ArgumentException($"Value cannot exceed {maximumLength} characters.", parameterName);
        return trimmed;
    }

    private static string? ValidateOptional(string? value, string parameterName, int maximumLength)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var trimmed = value.Trim();
        if (trimmed.Length > maximumLength) throw new ArgumentException($"Value cannot exceed {maximumLength} characters.", parameterName);
        return trimmed;
    }

    private static string BuildSearchText(params string?[] values)
    {
        var text = string.Join(' ', values.Where(value => !string.IsNullOrWhiteSpace(value)).Select(value => value!.Trim()))
            .Normalize(NormalizationForm.FormKC)
            .ToUpperInvariant();
        return text.Length <= MaximumSearchTextLength ? text : text[..MaximumSearchTextLength];
    }

    private sealed record NormalizedDraft(
        string Title,
        string Slug,
        string? Summary,
        string? BodyHtml,
        string StreetAddress,
        string? PostalCode,
        string City,
        string Country,
        DateTimeZone TimeZone,
        LocalDateTime StartsAtLocal,
        LocalDateTime EndsAtLocal,
        Instant StartsAtUtc,
        Instant EndsAtUtc,
        int? Capacity);
}

public sealed class ScheduledTournamentFormat
{
    private ScheduledTournamentFormat() { }

    public Guid ScheduledTournamentId { get; private init; }
    public Guid TournamentFormatId { get; private init; }

    public static ScheduledTournamentFormat Create(Guid scheduledTournamentId, Guid tournamentFormatId)
    {
        if (scheduledTournamentId == Guid.Empty) throw new ArgumentException("Tournament ID cannot be empty.", nameof(scheduledTournamentId));
        if (tournamentFormatId == Guid.Empty) throw new ArgumentException("Format ID cannot be empty.", nameof(tournamentFormatId));
        return new ScheduledTournamentFormat
        {
            ScheduledTournamentId = scheduledTournamentId,
            TournamentFormatId = tournamentFormatId
        };
    }
}

public static class TournamentSlug
{
    public static string Normalize(string slug)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(slug);
        var normalized = slug.Trim().ToLowerInvariant();
        if (normalized.Length > ScheduledTournament.MaximumSlugLength)
        {
            throw new ArgumentException($"Slug cannot exceed {ScheduledTournament.MaximumSlugLength} characters.", nameof(slug));
        }

        if (normalized.Any(ch => !(char.IsAsciiLetterOrDigit(ch) || ch is '-')))
        {
            throw new ArgumentException("Slug may contain only lowercase letters, digits, and hyphens.", nameof(slug));
        }

        return normalized;
    }
}

public static class TournamentContentSanitizer
{
    private static readonly HashSet<string> AllowedElements = new(StringComparer.Ordinal)
    {
        "p", "br", "strong", "em", "ul", "ol", "li", "h2", "h3", "a"
    };

    public static string? Sanitize(string? html)
    {
        if (string.IsNullOrWhiteSpace(html)) return null;
        if (html.Length > ScheduledTournament.MaximumBodyHtmlLength) throw new ArgumentException($"Body HTML cannot exceed {ScheduledTournament.MaximumBodyHtmlLength} characters.", nameof(html));
        var settings = new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null
        };

        try
        {
            using var reader = XmlReader.Create(new StringReader($"<root>{html}</root>"), settings);
            var document = XDocument.Load(reader, LoadOptions.None);
            return string.Concat(document.Root!.Nodes().Select(RenderNode));
        }
        catch (XmlException exception)
        {
            throw new ArgumentException("Body HTML must be well-formed allowed markup.", nameof(html), exception);
        }
    }

    private static string RenderNode(XNode node) => node switch
    {
        XText text => SecurityElement.Escape(text.Value) ?? string.Empty,
        XElement element => RenderElement(element),
        _ => throw new ArgumentException("Body HTML contains unsupported markup.", nameof(node))
    };

    private static string RenderElement(XElement element)
    {
        var name = element.Name.LocalName.ToLowerInvariant();
        if (!string.IsNullOrEmpty(element.Name.NamespaceName) || !AllowedElements.Contains(name))
        {
            throw new ArgumentException("Body HTML contains unsupported markup.", nameof(element));
        }

        if (name == "br")
        {
            if (element.HasAttributes || element.Nodes().Any()) throw new ArgumentException("Body HTML contains unsupported markup.", nameof(element));
            return "<br>";
        }

        var attributes = string.Empty;
        if (name == "a")
        {
            var href = element.Attributes().SingleOrDefault(attribute => attribute.Name.LocalName == "href" && string.IsNullOrEmpty(attribute.Name.NamespaceName));
            if (href is null || element.Attributes().Count() != 1) throw new ArgumentException("Body HTML contains unsupported markup.", nameof(element));
            if (!Uri.TryCreate(href.Value, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps || string.IsNullOrWhiteSpace(uri.Host))
            {
                throw new ArgumentException("Body HTML links must use absolute HTTPS URLs.", nameof(element));
            }

            attributes = $" href=\"{SecurityElement.Escape(uri.AbsoluteUri)}\"";
        }
        else if (element.HasAttributes)
        {
            throw new ArgumentException("Body HTML contains unsupported markup.", nameof(element));
        }

        var content = string.Concat(element.Nodes().Select(RenderNode));
        return string.Create(CultureInfo.InvariantCulture, $"<{name}{attributes}>{content}</{name}>");
    }
}
