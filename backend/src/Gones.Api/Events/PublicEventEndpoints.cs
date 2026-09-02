using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Gones.Api.Errors;
using Gones.Domain.Calendar;
using Gones.Domain.Catalog;
using Gones.Domain.Identity;
using Gones.Domain.Organizations;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Net.Http.Headers;
using NodaTime;
using NodaTime.Text;

namespace Gones.Api.Events;

internal static partial class PublicEventEndpoints
{
    public const int DefaultPageSize = 20;
    public const int MaximumPageSize = 100;
    public const int MaximumCatalogSize = 5000;
    private const string PublicCacheControl = "public, max-age=60";
    private const string CatalogCacheControl = "public, max-age=3600";

    public static void MapPublicEventEndpoints(this WebApplication app)
    {
        app.MapGet("/api/events", ListAsync)
            .AllowAnonymous()
            .Produces<PublicEventListResponse>()
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status400BadRequest);

        app.MapGet("/api/events/all", ListAllAsync)
            .AllowAnonymous()
            .Produces<PublicEventCatalogResponse>()
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status400BadRequest);

        app.MapGet("/api/events/{slug}", GetAsync)
            .AllowAnonymous()
            .Produces<PublicEventDetailResponse>()
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status404NotFound);

        app.MapGet("/api/events/{slug}/participants", ListParticipantsAsync)
            .AllowAnonymous()
            .Produces<PublicEventParticipantListResponse>()
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status404NotFound);

        app.MapGet("/api/events/{slug}.ics", GetIcsAsync)
            .AllowAnonymous()
            .Produces(StatusCodes.Status200OK, contentType: "text/calendar")
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status404NotFound);
    }

    private static async Task<IResult> ListAsync(
        string? from,
        string? to,
        string? city,
        string? country,
        string? region,
        [AllowedValues("weekly", "monthly", "major")] string? eventType,
        string? organization,
        string? format,
        string? status,
        string? search,
        bool? past,
        bool? includePast,
        int? page,
        int? pageSize,
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        IClock clock,
        CancellationToken cancellationToken)
    {
        var pageNumber = page is null or < 1 ? 1 : page.Value;
        var size = pageSize is null or < 1 ? DefaultPageSize : Math.Min(pageSize.Value, MaximumPageSize);
        var fromDate = ParseDateQuery(from, nameof(from));
        var toDate = ParseDateQuery(to, nameof(to));
        var organizationId = ParseOrganization(organization);
        var statuses = ParseStatuses(status);
        var parsedEventType = ParseEventType(eventType);
        var showPast = past == true || includePast == true;
        var query = VisibleEvents(database);

        if (fromDate is not null) query = query.Where(item => item.Tournament.VenueStartDate >= fromDate);
        if (toDate is not null) query = query.Where(item => item.Tournament.VenueStartDate <= toDate);
        if (fromDate is null && !showPast) query = query.Where(item => item.Tournament.EndsAtUtc >= clock.GetCurrentInstant());
        if (!string.IsNullOrWhiteSpace(city))
        {
            var term = city.Trim();
            query = query.Where(item => item.Tournament.City == term);
        }
        if (!string.IsNullOrWhiteSpace(country))
        {
            var term = country.Trim();
            query = query.Where(item => item.Tournament.Country == term);
        }
        if (!string.IsNullOrWhiteSpace(region))
        {
            var term = region.Trim();
            if (term.Length > Event.MaximumRegionLength) throw Validation("region", $"Region cannot exceed {Event.MaximumRegionLength} characters.");
            query = query.Where(item => item.Tournament.Region == term);
        }
        if (parsedEventType is not null) query = query.Where(item => item.Tournament.EventType == parsedEventType);
        if (organizationId is not null) query = query.Where(item => item.Tournament.OrganizationId == organizationId);
        if (!string.IsNullOrWhiteSpace(format))
        {
            var formatSlug = TournamentFormat.ValidateSlug(format);
            query = query.Where(item => database.EventFormats.Any(join =>
                join.EventId == item.Tournament.Id
                && database.TournamentFormats.Any(fmt => fmt.Id == join.TournamentFormatId && fmt.DeletedAt == null && fmt.Slug == formatSlug)));
        }
        if (statuses.Count > 0) query = query.Where(item => statuses.Contains(item.Tournament.Status));
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().Normalize(NormalizationForm.FormKC).ToUpperInvariant();
            query = query.Where(item => item.Tournament.NormalizedSearchText.Contains(term) || item.Organization.NormalizedName.Contains(term));
        }

        var total = await query.CountAsync(cancellationToken);
        var pageRows = await query
            .OrderBy(item => item.Tournament.StartsAtUtc)
            .ThenBy(item => item.Tournament.Id)
            .Skip((pageNumber - 1) * size)
            .Take(size)
            .Select(item => new EventRow(
                item.Tournament.Id,
                item.Tournament.Title,
                item.Tournament.Slug,
                item.Tournament.Summary,
                item.Tournament.StreetAddress,
                item.Tournament.PostalCode,
                item.Tournament.City,
                item.Tournament.Country,
                item.Tournament.Region,
                item.Tournament.EventType,
                item.Tournament.TimeZoneId,
                item.Tournament.VenueStartDate,
                item.Tournament.VenueStartTime,
                item.Tournament.VenueEndDate,
                item.Tournament.VenueEndTime,
                item.Tournament.StartsAtUtc,
                item.Tournament.EndsAtUtc,
                item.Tournament.Capacity,
                item.Tournament.Status,
                item.Tournament.UpdatedAt,
                item.Tournament.Version,
                item.Organization.Id,
                item.Organization.Name,
                item.Organization.Description,
                item.Organization.Website,
                item.Organization.ContactEmail))
            .ToListAsync(cancellationToken);

        var formatsByEvent = await LoadFormatsAsync(database, pageRows.Select(item => item.Id).ToArray(), cancellationToken);
        var items = pageRows.Select(row => ToSummary(row, formatsByEvent)).ToArray();
        var etag = HashETag($"{total}:{pageNumber}:{size}:{string.Join('|', pageRows.Select(row => $"{row.Id:N}:{row.Version}:{row.UpdatedAt.ToUnixTimeTicks()}"))}");
        SetPublicCache(response, etag);
        if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);
        return Results.Ok(new PublicEventListResponse(items, pageNumber, size, total));
    }

    private static async Task<IResult> ListAllAsync(
        string? from,
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        IClock clock,
        IConfiguration configuration,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var ceiling = configuration.GetValue("Gones:Calendar:MaximumCatalogSize", MaximumCatalogSize);
        var fromDate = ParseDateQuery(from, nameof(from));
        var query = VisibleEvents(database);
        query = fromDate is not null
            ? query.Where(item => item.Tournament.VenueStartDate >= fromDate)
            : query.Where(item => item.Tournament.EndsAtUtc >= clock.GetCurrentInstant());

        var stamp = await query
            .Select(item => new { item.Tournament.UpdatedAt, item.Tournament.Id })
            .OrderByDescending(x => x.UpdatedAt)
            .FirstOrDefaultAsync(cancellationToken);
        var total = await query.CountAsync(cancellationToken);
        var etag = "\"" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{total}:{stamp?.UpdatedAt}:{stamp?.Id}"))).ToLowerInvariant()[..32] + "\"";

        if (IsNotModified(request, etag))
        {
            response.Headers.ETag = etag;
            response.Headers.CacheControl = CatalogCacheControl;
            return Results.StatusCode(StatusCodes.Status304NotModified);
        }

        var pageRows = await query
            .OrderBy(item => item.Tournament.StartsAtUtc)
            .ThenBy(item => item.Tournament.Id)
            .Take(ceiling)
            .Select(item => new EventRow(
                item.Tournament.Id,
                item.Tournament.Title,
                item.Tournament.Slug,
                item.Tournament.Summary,
                item.Tournament.StreetAddress,
                item.Tournament.PostalCode,
                item.Tournament.City,
                item.Tournament.Country,
                item.Tournament.Region,
                item.Tournament.EventType,
                item.Tournament.TimeZoneId,
                item.Tournament.VenueStartDate,
                item.Tournament.VenueStartTime,
                item.Tournament.VenueEndDate,
                item.Tournament.VenueEndTime,
                item.Tournament.StartsAtUtc,
                item.Tournament.EndsAtUtc,
                item.Tournament.Capacity,
                item.Tournament.Status,
                item.Tournament.UpdatedAt,
                item.Tournament.Version,
                item.Organization.Id,
                item.Organization.Name,
                item.Organization.Description,
                item.Organization.Website,
                item.Organization.ContactEmail))
            .ToListAsync(cancellationToken);

        var formatsByEvent = await LoadFormatsAsync(database, pageRows.Select(row => row.Id).ToArray(), cancellationToken);
        var items = pageRows.Select(row => ToSummary(row, formatsByEvent)).ToArray();
        var truncated = total > ceiling;
        if (truncated)
        {
            loggerFactory.CreateLogger("Gones.Api.Events")
                .LogWarning("Public tournament catalog truncated: total={Total} ceiling={Ceiling}", total, ceiling);
        }

        response.Headers.ETag = etag;
        response.Headers.CacheControl = CatalogCacheControl;
        return Results.Ok(new PublicEventCatalogResponse(items, clock.GetCurrentInstant(), items.Length, truncated));
    }

    private static IQueryable<EventQueryItem> VisibleEvents(GonesDbContext database) =>
        from tournament in database.Events.AsNoTracking()
        join org in database.Organizations.AsNoTracking() on tournament.OrganizationId equals org.Id
        where tournament.DeletedAt == null && org.DeletedAt == null
        select new EventQueryItem { Tournament = tournament, Organization = org };

    private static async Task<IResult> GetAsync(
        string slug,
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var row = await LoadDetailAsync(database, slug, cancellationToken);
        var formatsByEvent = await LoadFormatsAsync(database, [row.Id], cancellationToken);
        var organizers = await database.OrganizationMembers.AsNoTracking()
            .Where(member => member.OrganizationId == row.OrganizationId)
            .Join(database.UserProfiles.AsNoTracking(), member => member.UserId, user => user.UserId, (member, user) => user.Username)
            .ToListAsync(cancellationToken);
        organizers.Sort(StringComparer.OrdinalIgnoreCase);
        var etag = HashETag($"{row.Id:N}:{row.Version}:{row.UpdatedAt.ToUnixTimeTicks()}");
        SetPublicCache(response, etag);
        if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);
        return Results.Ok(ToDetail(row, formatsByEvent, organizers));
    }

    private static async Task<IResult> ListParticipantsAsync(
        string slug,
        int? page,
        int? pageSize,
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var pageNumber = page is null or < 1 ? 1 : page.Value;
        var size = pageSize is null or < 1 ? DefaultPageSize : Math.Min(pageSize.Value, MaximumPageSize);
        var tournament = await LoadParticipantScopeAsync(database, slug, cancellationToken);
        var query =
            from attempt in database.EventRegistrationAttempts.AsNoTracking()
            join profile in database.UserProfiles.AsNoTracking() on attempt.UserId equals profile.UserId
            where attempt.EventId == tournament.Id
                && attempt.Status == TournamentRegistrationStatus.Confirmed
                && profile.ClosedAt == null
            orderby profile.NormalizedUsername, profile.UserId
            select profile;
        var total = await query.CountAsync(cancellationToken);
        var profiles = await query
            .Skip((pageNumber - 1) * size)
            .Take(size)
            .ToListAsync(cancellationToken);
        var participantIdentities = profiles
            .SelectMany(profile => new[] { profile.UserId.ToString(), profile.Username })
            .ToList();
        var playerNames = await database.PlayerStatistics.AsNoTracking()
            .Where(row => row.ScopeKind == PlayerStatisticsScope.Global
                && row.ScopeId == PlayerStatisticsScope.GlobalScopeId
                && participantIdentities.Contains(row.PlayerName))
            .Select(row => row.PlayerName)
            .ToListAsync(cancellationToken);
        var playerNameSet = playerNames.ToHashSet(StringComparer.Ordinal);
        var etag = HashETag($"participants:{tournament.Id:N}:{tournament.Version}:{total}:{pageNumber}:{size}:{string.Join('|', profiles.Select(profile => $"{profile.UserId:N}:{profile.UpdatedAt.ToUnixTimeTicks()}"))}:{string.Join('|', playerNames.Order(StringComparer.Ordinal))}");
        SetPublicCache(response, etag);
        if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);
        var participants = profiles
            .Select(profile => new PublicEventParticipantResponse(
                profile.UserId,
                profile.Username,
                playerNameSet.Contains(profile.UserId.ToString()) ? profile.UserId.ToString()
                    : playerNameSet.Contains(profile.Username) ? profile.Username : null,
                profile.IsFirstNamePublic ? profile.FirstName : null,
                profile.IsLastNamePublic ? profile.LastName : null,
                profile.IsLocationPublic ? JoinLocation(profile) : null,
                profile.IsBirthDatePublic ? profile.BirthDate?.Year : null,
                profile.IsPreferredLanguagePublic ? profile.PreferredLanguage : null))
            .ToList();
        return Results.Ok(new PublicEventParticipantListResponse(participants, pageNumber, size, total));
    }

    private static string? JoinLocation(UserProfile profile)
    {
        var parts = new[] { profile.LocationCity, profile.LocationRegion, profile.LocationCountry }
            .Where(part => !string.IsNullOrWhiteSpace(part))
            .ToArray();
        return parts.Length == 0 ? null : string.Join(", ", parts);
    }

    private static async Task<IResult> GetIcsAsync(
        string slug,
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var row = await LoadDetailAsync(database, slug, cancellationToken);
        var etag = HashETag($"ics:{row.Id:N}:{row.Version}:{row.UpdatedAt.ToUnixTimeTicks()}");
        SetPublicCache(response, etag);
        if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);
        response.Headers.ContentDisposition = new ContentDispositionHeaderValue("inline") { FileNameStar = $"{row.Slug}.ics" }.ToString();
        return Results.Text(BuildIcs(row), "text/calendar; charset=utf-8", Encoding.UTF8);
    }

    private static async Task<EventParticipantScope> LoadParticipantScopeAsync(GonesDbContext database, string slug, CancellationToken cancellationToken)
    {
        var normalizedSlug = TournamentSlug.Normalize(slug);
        return await (
            from item in VisibleEvents(database)
            where item.Tournament.Slug == normalizedSlug
            select new EventParticipantScope(item.Tournament.Id, item.Tournament.Version))
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new ResourceNotFoundException();
    }

    private static async Task<EventRow> LoadDetailAsync(GonesDbContext database, string slug, CancellationToken cancellationToken)
    {
        var normalizedSlug = TournamentSlug.Normalize(slug);
        return await (
            from tournament in database.Events.AsNoTracking()
            join organization in database.Organizations.AsNoTracking() on tournament.OrganizationId equals organization.Id
            where tournament.DeletedAt == null && organization.DeletedAt == null && tournament.Slug == normalizedSlug
            select new EventRow(
                tournament.Id,
                tournament.Title,
                tournament.Slug,
                tournament.Summary,
                tournament.StreetAddress,
                tournament.PostalCode,
                tournament.City,
                tournament.Country,
                tournament.Region,
                tournament.EventType,
                tournament.TimeZoneId,
                tournament.VenueStartDate,
                tournament.VenueStartTime,
                tournament.VenueEndDate,
                tournament.VenueEndTime,
                tournament.StartsAtUtc,
                tournament.EndsAtUtc,
                tournament.Capacity,
                tournament.Status,
                tournament.UpdatedAt,
                tournament.Version,
                organization.Id,
                organization.Name,
                organization.Description,
                organization.Website,
                organization.ContactEmail,
                tournament.BodyHtml,
                tournament.LiveTournamentUrl,
                tournament.ArchiveTournamentUrl))
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new ResourceNotFoundException();
    }

    private static async Task<IReadOnlyDictionary<Guid, IReadOnlyList<PublicTournamentFormatResponse>>> LoadFormatsAsync(
        GonesDbContext database,
        IReadOnlyCollection<Guid> eventIds,
        CancellationToken cancellationToken)
    {
        if (eventIds.Count == 0) return new Dictionary<Guid, IReadOnlyList<PublicTournamentFormatResponse>>();
        var rows = await (
            from link in database.EventFormats.AsNoTracking()
            join format in database.TournamentFormats.AsNoTracking() on link.TournamentFormatId equals format.Id
            where eventIds.Contains(link.EventId) && format.DeletedAt == null
            orderby format.SortOrder, format.Name, format.Id
            select new { link.EventId, format.Id, format.Name, format.Slug, format.SortOrder }
        ).ToListAsync(cancellationToken);
        return rows
            .GroupBy(item => item.EventId)
            .ToDictionary(
                group => group.Key,
                group => (IReadOnlyList<PublicTournamentFormatResponse>)group.Select(item => new PublicTournamentFormatResponse(item.Id, item.Name, item.Slug, item.SortOrder)).ToArray());
    }

    private static PublicEventSummaryResponse ToSummary(EventRow row, IReadOnlyDictionary<Guid, IReadOnlyList<PublicTournamentFormatResponse>> formatsByEvent)
    {
        var formats = formatsByEvent.TryGetValue(row.Id, out var loadedFormats) ? loadedFormats : [];
        return new PublicEventSummaryResponse(
        row.Id,
        row.Title,
        EventDisplayTitle.From(row.Title, formats.Single().Name),
        row.Slug,
        row.Summary,
        new PublicEventVenueResponse(row.StreetAddress, row.PostalCode, row.City, row.Country, row.Region),
        row.TimeZoneId,
        FormatDate(row.VenueStartDate),
        FormatTime(row.VenueStartTime),
        FormatDate(row.VenueEndDate),
        FormatTime(row.VenueEndTime),
        row.StartsAtUtc,
        row.EndsAtUtc,
        row.Capacity,
        row.Status.ToString(),
        EventPublicationService.EventTypeWire(row.EventType),
        new PublicEventOrganizationResponse(row.OrganizationId, row.OrganizationName, row.OrganizationDescription, row.OrganizationWebsite, row.OrganizationContactEmail, []),
        formats);
    }

    private static PublicEventDetailResponse ToDetail(EventRow row, IReadOnlyDictionary<Guid, IReadOnlyList<PublicTournamentFormatResponse>> formatsByEvent, IReadOnlyList<string> organizers)
    {
        var summary = ToSummary(row, formatsByEvent);
        var organization = summary.Organization with { Organizers = organizers };
        return new PublicEventDetailResponse(
            summary.Id,
            summary.Title,
            summary.DisplayTitle,
            summary.Slug,
            summary.Summary,
            row.BodyHtml,
            row.LiveTournamentUrl,
            row.ArchiveTournamentUrl,
            summary.Venue,
            summary.TimeZoneId,
            summary.VenueStartDate,
            summary.VenueStartTime,
            summary.VenueEndDate,
            summary.VenueEndTime,
            summary.StartsAtUtc,
            summary.EndsAtUtc,
            summary.Capacity,
            summary.Status,
            summary.EventType,
            organization,
            summary.Formats);
    }

    private static string BuildIcs(EventRow row)
    {
        var builder = new StringBuilder();
        builder.AppendLine("BEGIN:VCALENDAR");
        builder.AppendLine("VERSION:2.0");
        builder.AppendLine("PRODID:-//Gones//Calendar V1//EN");
        builder.AppendLine("BEGIN:VEVENT");
        builder.AppendLine($"UID:{row.Id:D}@gones");
        builder.AppendLine($"DTSTAMP:{FormatIcsInstant(row.UpdatedAt)}");
        builder.AppendLine($"DTSTART:{FormatIcsInstant(row.StartsAtUtc)}");
        builder.AppendLine($"DTEND:{FormatIcsInstant(row.EndsAtUtc)}");
        builder.AppendLine($"SUMMARY:{EscapeIcsText(row.Title)}");
        if (!string.IsNullOrWhiteSpace(row.Summary)) builder.AppendLine($"DESCRIPTION:{EscapeIcsText(row.Summary)}");
        builder.AppendLine($"LOCATION:{EscapeIcsText(string.Join(", ", new[] { row.StreetAddress, row.PostalCode, row.City, row.Region, row.Country }.Where(value => !string.IsNullOrWhiteSpace(value))))}");
        builder.AppendLine($"X-GONES-TIMEZONE:{EscapeIcsText(row.TimeZoneId)}");
        builder.AppendLine($"STATUS:{(row.Status == ScheduledTournamentStatus.Cancelled ? "CANCELLED" : "CONFIRMED")}");
        builder.AppendLine("END:VEVENT");
        builder.AppendLine("END:VCALENDAR");
        return builder.ToString();
    }

    private static LocalDate? ParseDateQuery(string? value, string field)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var parse = LocalDatePattern.Iso.Parse(value.Trim());
        if (parse.Success) return parse.Value;
        throw Validation(field, "Value must be an ISO-8601 local date.");
    }

    private static Guid? ParseOrganization(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (Guid.TryParse(value.Trim(), out var organizationId) && organizationId != Guid.Empty) return organizationId;
        throw Validation("organization", "Organization must be a UUID.");
    }

    private static CalendarEventType? ParseEventType(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        return value.Trim().ToLowerInvariant() switch
        {
            "weekly" => CalendarEventType.Weekly,
            "monthly" => CalendarEventType.Monthly,
            "major" => CalendarEventType.Major,
            _ => throw Validation("eventType", "Event Type must be weekly, monthly, or major.")
        };
    }

    private static IReadOnlyList<ScheduledTournamentStatus> ParseStatuses(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return [];
        var statuses = new List<ScheduledTournamentStatus>();
        foreach (var part in value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (Enum.TryParse<ScheduledTournamentStatus>(part, ignoreCase: true, out var parsed)) statuses.Add(parsed);
            else throw Validation("status", "Status is invalid.");
        }
        return statuses;
    }

    private static void SetPublicCache(HttpResponse response, string etag)
    {
        response.Headers.ETag = etag;
        response.Headers.CacheControl = PublicCacheControl;
    }

    private static bool IsNotModified(HttpRequest request, string etag) =>
        request.Headers.IfNoneMatch.Any(value => string.Equals(value, etag, StringComparison.Ordinal));

    private static string HashETag(string value) =>
        $"\"{Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant()}\"";

    private static string FormatDate(LocalDate date) => LocalDatePattern.Iso.Format(date);

    private static string FormatTime(LocalTime time) => LocalTimePattern.CreateWithInvariantCulture("HH:mm:ss").Format(time);

    private static string FormatIcsInstant(Instant instant) =>
        instant.ToDateTimeUtc().ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture);

    private static string EscapeIcsText(string value) =>
        IcsLineBreaks().Replace(value, " ")
            .Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace(";", "\\;", StringComparison.Ordinal)
            .Replace(",", "\\,", StringComparison.Ordinal);

    private static ApiValidationException Validation(string field, string message) =>
        new(new Dictionary<string, string[]> { [field] = [message] });

    [GeneratedRegex("\\r\\n|\\n|\\r")]
    private static partial Regex IcsLineBreaks();

    private sealed record EventRow(
        Guid Id,
        string Title,
        string Slug,
        string? Summary,
        string StreetAddress,
        string? PostalCode,
        string City,
        string Country,
        string? Region,
        CalendarEventType? EventType,
        string TimeZoneId,
        LocalDate VenueStartDate,
        LocalTime VenueStartTime,
        LocalDate VenueEndDate,
        LocalTime VenueEndTime,
        Instant StartsAtUtc,
        Instant EndsAtUtc,
        int? Capacity,
        ScheduledTournamentStatus Status,
        Instant UpdatedAt,
        long Version,
        Guid OrganizationId,
        string OrganizationName,
        string? OrganizationDescription,
        string? OrganizationWebsite,
        string? OrganizationContactEmail,
        string? BodyHtml = null,
        string? LiveTournamentUrl = null,
        string? ArchiveTournamentUrl = null);

    private sealed record EventParticipantScope(Guid Id, long Version);

    private sealed class EventQueryItem
    {
        public required Event Tournament { get; init; }
        public required Organization Organization { get; init; }
    }
}

internal sealed record PublicEventCatalogResponse(
    IReadOnlyList<PublicEventSummaryResponse> Items,
    Instant GeneratedAt,
    int Count,
    bool Truncated);

internal sealed record PublicEventListResponse(
    IReadOnlyList<PublicEventSummaryResponse> Items,
    int Page,
    int PageSize,
    int TotalCount);

internal sealed record PublicEventSummaryResponse(
    Guid Id,
    string Title,
    string DisplayTitle,
    string Slug,
    string? Summary,
    PublicEventVenueResponse Venue,
    string TimeZoneId,
    string VenueStartDate,
    string VenueStartTime,
    string VenueEndDate,
    string VenueEndTime,
    Instant StartsAtUtc,
    Instant EndsAtUtc,
    int? Capacity,
    string Status,
    PublicCalendarEventType? EventType,
    PublicEventOrganizationResponse Organization,
    IReadOnlyList<PublicTournamentFormatResponse> Formats);

internal sealed record PublicEventDetailResponse(
    Guid Id,
    string Title,
    string DisplayTitle,
    string Slug,
    string? Summary,
    string? BodyHtml,
    string? LiveTournamentUrl,
    string? ArchiveTournamentUrl,
    PublicEventVenueResponse Venue,
    string TimeZoneId,
    string VenueStartDate,
    string VenueStartTime,
    string VenueEndDate,
    string VenueEndTime,
    Instant StartsAtUtc,
    Instant EndsAtUtc,
    int? Capacity,
    string Status,
    PublicCalendarEventType? EventType,
    PublicEventOrganizationResponse Organization,
    IReadOnlyList<PublicTournamentFormatResponse> Formats);

internal sealed record PublicEventVenueResponse(
    string StreetAddress,
    string? PostalCode,
    string City,
    string Country,
    string? Region = null);

internal sealed record PublicEventOrganizationResponse(
    Guid Id,
    string Name,
    string? Description,
    string? Website,
    string? ContactEmail,
    IReadOnlyList<string> Organizers);

internal sealed record PublicTournamentFormatResponse(
    Guid Id,
    string Name,
    string Slug,
    int SortOrder);

internal sealed record PublicEventParticipantListResponse(
    IReadOnlyList<PublicEventParticipantResponse> Items,
    int Page,
    int PageSize,
    int TotalCount);

internal sealed record PublicEventParticipantResponse(
    Guid UserId,
    string Username,
    string? PlayerName,
    string? FirstName,
    string? LastName,
    string? Location,
    int? BirthYear,
    string? PreferredLanguage);
