using System.Globalization;
using System.Text;
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

public enum CalendarEventType
{
    Weekly,
    Monthly,
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

public sealed class EventLifecycleEntry
{
    private EventLifecycleEntry() { }

    public Guid Id { get; private init; } = Guid.NewGuid();
    public Guid EventId { get; private init; }
    public Guid ActorUserId { get; private init; }
    public TournamentLifecycleEventType EventType { get; private init; }
    public TournamentReminderPlanAction ReminderPlanAction { get; private init; }
    public Instant OccurredAt { get; private init; }
    public Instant? ReminderPlanProcessedAt { get; private set; }

    public void MarkReminderPlanProcessed(Instant now)
    {
        if (ReminderPlanProcessedAt is not null) return;
        if (now < OccurredAt) throw new ArgumentOutOfRangeException(nameof(now));
        ReminderPlanProcessedAt = now;
    }

    public static EventLifecycleEntry Create(
        Guid tournamentId,
        Guid actorUserId,
        TournamentLifecycleEventType eventType,
        TournamentReminderPlanAction reminderPlanAction,
        Instant occurredAt)
    {
        if (tournamentId == Guid.Empty) throw new ArgumentException("Tournament ID cannot be empty.", nameof(tournamentId));
        if (actorUserId == Guid.Empty) throw new ArgumentException("Actor user ID cannot be empty.", nameof(actorUserId));
        return new EventLifecycleEntry
        {
            EventId = tournamentId,
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
    string? BodyMarkdown,
    string StreetAddress,
    string? PostalCode,
    string City,
    string Country,
    string TimeZoneId,
    LocalDateTime StartsAtLocal,
    LocalDateTime? EndsAtLocal,
    int? Capacity,
    string? LiveTournamentUrl = null,
    string? ArchiveTournamentUrl = null,
    string? Region = null,
    CalendarEventType? EventType = null,
    string? ProviderPlaceId = null,
    decimal? Latitude = null,
    decimal? Longitude = null);

public sealed class Event : VersionedEntity
{
    public const int MaximumTitleLength = 160;
    public const int MaximumSlugLength = 120;
    public const int MaximumSummaryLength = 50;
    public const int MaximumBodyMarkdownLength = 20000;
    public const int MaximumAddressLength = 240;
    public const int MaximumPostalCodeLength = 32;
    public const int MaximumCityLength = 120;
    public const int MaximumCountryLength = 120;
    public const int MaximumRegionLength = 120;
    public const int MaximumTimeZoneLength = 100;
    public const int MaximumProviderPlaceIdLength = 512;
    public const int MaximumDeletedReasonLength = 300;
    public const int MaximumSearchTextLength = 600;
    public const int MaximumTournamentUrlLength = 2048;

    private Event() { }

    public Guid OrganizationId { get; private init; }
    public string Title { get; private set; } = string.Empty;
    public string Slug { get; private set; } = string.Empty;
    public string? Summary { get; private set; }
    public string? BodyMarkdown { get; private set; }
    public string? LiveTournamentUrl { get; private set; }
    public string? ArchiveTournamentUrl { get; private set; }
    public string StreetAddress { get; private set; } = string.Empty;
    public string PostalCode { get; private set; } = string.Empty;
    public string City { get; private set; } = string.Empty;
    public string Country { get; private set; } = string.Empty;
    public string Region { get; private set; } = string.Empty;
    public string ProviderPlaceId { get; private set; } = "legacy-unresolved";
    public decimal Latitude { get; private set; }
    public decimal Longitude { get; private set; }
    public CalendarEventType? EventType { get; private set; }
    public string TimeZoneId { get; private set; } = string.Empty;
    public LocalDate VenueStartDate { get; private set; }
    public LocalTime VenueStartTime { get; private set; }
    public LocalDate VenueEndDate { get; private set; }
    public LocalTime VenueEndTime { get; private set; }
    public Instant StartsAtUtc { get; private set; }
    public Instant EndsAtUtc { get; private set; }
    public int Capacity { get; private set; }
    public ScheduledTournamentStatus Status { get; private set; } = ScheduledTournamentStatus.Published;
    public Guid CreatedByUserId { get; private init; }
    public Instant CreatedAt { get; private init; }
    public Instant UpdatedAt { get; private set; }
    public Instant? DeletedAt { get; private set; }
    public Guid? DeletedByUserId { get; private set; }
    public string? DeletedReason { get; private set; }
    public string NormalizedSearchText { get; private set; } = string.Empty;
    public ICollection<EventFormat> Formats { get; private set; } = new List<EventFormat>();

    public bool IsDeleted => DeletedAt is not null;

    public static Event Create(
        Guid organizationId,
        Guid createdByUserId,
        ScheduledTournamentDraft draft,
        IReadOnlyCollection<TournamentFormat> selectedFormats,
        Instant now)
    {
        if (organizationId == Guid.Empty) throw new ArgumentException("Organization ID cannot be empty.", nameof(organizationId));
        if (createdByUserId == Guid.Empty) throw new ArgumentException("Creator user ID cannot be empty.", nameof(createdByUserId));
        TournamentFormatSelection.RequireExactlyOneActive(selectedFormats);
        var tournament = new Event
        {
            OrganizationId = organizationId,
            CreatedByUserId = createdByUserId,
            CreatedAt = now,
            UpdatedAt = now
        };
        tournament.ApplyDraft(draft, selectedFormats, now);
        return tournament;
    }

    public TournamentChangeSeverity ClassifyChange(
        ScheduledTournamentDraft draft,
        IReadOnlyCollection<TournamentFormat> selectedFormats,
        bool imagesChanged = false)
    {
        var normalized = NormalizeDraft(draft, selectedFormats);
        var major = StartsAtUtc != normalized.StartsAtUtc
            || TimeZoneId != normalized.TimeZone.Id
            || StreetAddress != normalized.StreetAddress
            || PostalCode != normalized.PostalCode
            || City != normalized.City
            || Country != normalized.Country
            || Region != normalized.Region
            || EventType != normalized.EventType
            || Capacity != normalized.Capacity
            || !Formats.Select(format => format.TournamentFormatId).OrderBy(id => id).SequenceEqual(selectedFormats.Select(format => format.Id).OrderBy(id => id));
        if (major) return TournamentChangeSeverity.Major;

        var minor = imagesChanged
            || Title != normalized.Title
            || Slug != normalized.Slug
            || Summary != normalized.Summary
            || BodyMarkdown != normalized.BodyMarkdown;
        return minor ? TournamentChangeSeverity.Minor : TournamentChangeSeverity.None;
    }

    public void UpdateDetails(ScheduledTournamentDraft draft, IReadOnlyCollection<TournamentFormat> selectedFormats, Instant now)
    {
        EnsureEditable(now);
        var liveTournamentUrl = LiveTournamentUrl;
        var archiveTournamentUrl = ArchiveTournamentUrl;
        ApplyDraft(draft, selectedFormats, now);
        LiveTournamentUrl = liveTournamentUrl;
        ArchiveTournamentUrl = archiveTournamentUrl;
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
        BodyMarkdown = normalized.BodyMarkdown;
        LiveTournamentUrl = normalized.LiveTournamentUrl;
        ArchiveTournamentUrl = normalized.ArchiveTournamentUrl;
        StreetAddress = normalized.StreetAddress;
        PostalCode = normalized.PostalCode;
        City = normalized.City;
        Country = normalized.Country;
        Region = normalized.Region;
        if (normalized.ProviderPlaceId is not null && normalized.Latitude is not null && normalized.Longitude is not null)
        {
            ProviderPlaceId = normalized.ProviderPlaceId;
            Latitude = normalized.Latitude.Value;
            Longitude = normalized.Longitude.Value;
        }
        EventType = normalized.EventType;
        TimeZoneId = normalized.TimeZone.Id;
        VenueStartDate = normalized.StartsAtLocal.Date;
        VenueStartTime = normalized.StartsAtLocal.TimeOfDay;
        VenueEndDate = normalized.EndsAtLocal.Date;
        VenueEndTime = normalized.EndsAtLocal.TimeOfDay;
        StartsAtUtc = normalized.StartsAtUtc;
        EndsAtUtc = normalized.EndsAtUtc;
        Capacity = normalized.Capacity;
        NormalizedSearchText = BuildSearchText(Title, Summary, City, Region, Country, EventType?.ToString());
        Formats.Clear();
        foreach (var format in selectedFormats.OrderBy(format => format.Slug, StringComparer.Ordinal))
        {
            Formats.Add(EventFormat.Create(Id, format.Id));
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
        TournamentFormatSelection.RequireExactlyOneActive(selectedFormats);
        var title = ValidateRequired(draft.Title, nameof(draft.Title), MaximumTitleLength);
        var slug = TournamentSlug.Normalize(draft.Slug);
        var summary = ValidateOptional(draft.Summary, nameof(draft.Summary), MaximumSummaryLength);
        var bodyMarkdown = ValidateMarkdown(draft.BodyMarkdown, nameof(draft.BodyMarkdown));
        var liveTournamentUrl = EventTournamentUrl.NormalizeOptional(draft.LiveTournamentUrl);
        var archiveTournamentUrl = EventTournamentUrl.NormalizeOptional(draft.ArchiveTournamentUrl);
        var streetAddress = ValidateRequired(draft.StreetAddress, nameof(draft.StreetAddress), MaximumAddressLength);
        var postalCode = ValidateOptional(draft.PostalCode, nameof(draft.PostalCode), MaximumPostalCodeLength) ?? "Unknown";
        var city = ValidateRequired(draft.City, nameof(draft.City), MaximumCityLength);
        var country = ValidateRequired(draft.Country, nameof(draft.Country), MaximumCountryLength);
        var region = ValidateOptional(draft.Region, nameof(draft.Region), MaximumRegionLength) ?? "Unknown";
        var providerPlaceId = draft.ProviderPlaceId is null
            ? null
            : ValidateRequired(draft.ProviderPlaceId, nameof(draft.ProviderPlaceId), MaximumProviderPlaceIdLength);
        if ((providerPlaceId is null) != (draft.Latitude is null || draft.Longitude is null))
        {
            throw new ArgumentException("Provider place ID and coordinates must be supplied together.", nameof(draft));
        }
        var zone = DateTimeZoneProviders.Tzdb.GetZoneOrNull(ValidateRequired(draft.TimeZoneId, nameof(draft.TimeZoneId), MaximumTimeZoneLength))
            ?? throw new ArgumentException("Time zone must be a valid IANA zone.", nameof(draft));
        var endLocal = draft.EndsAtLocal ?? draft.StartsAtLocal.Date.At(new LocalTime(23, 59, 59));
        var startsAtUtc = ResolveRequiredStart(zone, draft.StartsAtLocal);
        var endsAtUtc = ResolveEnd(zone, endLocal);
        if (endsAtUtc < startsAtUtc) throw new ArgumentException("Tournament end cannot be before start.", nameof(draft));
        if (draft.Capacity is <= 0) throw new ArgumentOutOfRangeException(nameof(draft), "Capacity must be positive when present.");
        var capacity = draft.Capacity ?? int.MaxValue;
        return new NormalizedDraft(title, slug, summary, bodyMarkdown, liveTournamentUrl, archiveTournamentUrl, streetAddress, postalCode, city, country, region, providerPlaceId, draft.Latitude, draft.Longitude, draft.EventType, zone, draft.StartsAtLocal, endLocal, startsAtUtc, endsAtUtc, capacity);
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

    private static string? ValidateMarkdown(string? value, string parameterName)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (value.Length > MaximumBodyMarkdownLength) throw new ArgumentException($"Value cannot exceed {MaximumBodyMarkdownLength} characters.", parameterName);
        return value;
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
        string? BodyMarkdown,
        string? LiveTournamentUrl,
        string? ArchiveTournamentUrl,
        string StreetAddress,
        string PostalCode,
        string City,
        string Country,
        string Region,
        string? ProviderPlaceId,
        decimal? Latitude,
        decimal? Longitude,
        CalendarEventType? EventType,
        DateTimeZone TimeZone,
        LocalDateTime StartsAtLocal,
        LocalDateTime EndsAtLocal,
        Instant StartsAtUtc,
        Instant EndsAtUtc,
        int Capacity);
}

public sealed class EventFormat
{
    private EventFormat() { }

    public Guid EventId { get; private init; }
    public Guid TournamentFormatId { get; private init; }

    public static EventFormat Create(Guid scheduledTournamentId, Guid tournamentFormatId)
    {
        if (scheduledTournamentId == Guid.Empty) throw new ArgumentException("Tournament ID cannot be empty.", nameof(scheduledTournamentId));
        if (tournamentFormatId == Guid.Empty) throw new ArgumentException("Format ID cannot be empty.", nameof(tournamentFormatId));
        return new EventFormat
        {
            EventId = scheduledTournamentId,
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
        if (normalized.Length > Event.MaximumSlugLength)
        {
            throw new ArgumentException($"Slug cannot exceed {Event.MaximumSlugLength} characters.", nameof(slug));
        }

        if (normalized.Any(ch => !(char.IsAsciiLetterOrDigit(ch) || ch is '-' or '_')))
        {
            throw new ArgumentException("Slug may contain only lowercase letters, digits, hyphens, and underscores.", nameof(slug));
        }

        return normalized;
    }
}

public static class EventTournamentUrl
{
    public static string? NormalizeOptional(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var trimmed = value.Trim();
        if (trimmed.Length > Event.MaximumTournamentUrlLength)
        {
            throw new ArgumentException($"Tournament URL cannot exceed {Event.MaximumTournamentUrlLength} characters.", nameof(value));
        }

        if (trimmed.Any(char.IsControl) || trimmed.Contains('\\'))
        {
            throw new ArgumentException("Tournament URL cannot contain control characters or backslashes.", nameof(value));
        }

        if (trimmed.StartsWith("//", StringComparison.Ordinal))
        {
            throw new ArgumentException("Protocol-relative Tournament URLs are not allowed.", nameof(value));
        }

        if (trimmed.StartsWith("/", StringComparison.Ordinal)) return trimmed;
        if (!Uri.TryCreate(trimmed, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            || string.IsNullOrWhiteSpace(uri.Host))
        {
            throw new ArgumentException("Tournament URL must be app-relative or use HTTP(S).", nameof(value));
        }

        return trimmed;
    }
}

public static class EventDisplayTitle
{
    public static string From(string title, string formatName) => $"{formatName} — {title}";
}
