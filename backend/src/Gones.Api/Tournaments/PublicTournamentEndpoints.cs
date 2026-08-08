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

namespace Gones.Api.Tournaments;

internal static partial class PublicTournamentEndpoints
{
    public const int DefaultPageSize = 20;
    public const int MaximumPageSize = 100;
    public const int MaximumCatalogSize = 5000;
    private const string PublicCacheControl = "public, max-age=60";
    private const string CatalogCacheControl = "public, max-age=3600";

    public static void MapPublicTournamentEndpoints(this WebApplication app)
    {
        app.MapGet("/api/tournaments", ListAsync)
            .AllowAnonymous()
            .Produces<PublicTournamentListResponse>()
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status400BadRequest);

        app.MapGet("/api/tournaments/all", ListAllAsync)
            .AllowAnonymous()
            .Produces<PublicTournamentCatalogResponse>()
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status400BadRequest);

        app.MapGet("/api/tournaments/{slug}", GetAsync)
            .AllowAnonymous()
            .Produces<PublicTournamentDetailResponse>()
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status404NotFound);

        app.MapGet("/api/tournaments/{slug}/participants", ListParticipantsAsync)
            .AllowAnonymous()
            .Produces<PublicTournamentParticipantListResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound);

        app.MapGet("/api/tournaments/{slug}.ics", GetIcsAsync)
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
        var showPast = past == true || includePast == true;
        var query = VisibleTournaments(database);

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
        if (organizationId is not null) query = query.Where(item => item.Tournament.OrganizationId == organizationId);
        if (!string.IsNullOrWhiteSpace(format))
        {
            var formatSlug = TournamentFormat.ValidateSlug(format);
            query = query.Where(item => database.ScheduledTournamentFormats.Any(join =>
                join.ScheduledTournamentId == item.Tournament.Id
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
            .Select(item => new TournamentRow(
                item.Tournament.Id,
                item.Tournament.Title,
                item.Tournament.Slug,
                item.Tournament.Summary,
                item.Tournament.StreetAddress,
                item.Tournament.PostalCode,
                item.Tournament.City,
                item.Tournament.Country,
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

        var formatsByTournament = await LoadFormatsAsync(database, pageRows.Select(item => item.Id).ToArray(), cancellationToken);
        var items = pageRows.Select(row => ToSummary(row, formatsByTournament)).ToArray();
        var etag = HashETag($"{total}:{pageNumber}:{size}:{string.Join('|', pageRows.Select(row => $"{row.Id:N}:{row.Version}:{row.UpdatedAt.ToUnixTimeTicks()}"))}");
        SetPublicCache(response, etag);
        if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);
        return Results.Ok(new PublicTournamentListResponse(items, pageNumber, size, total));
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
        var query = VisibleTournaments(database);
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
            .Select(item => new TournamentRow(
                item.Tournament.Id,
                item.Tournament.Title,
                item.Tournament.Slug,
                item.Tournament.Summary,
                item.Tournament.StreetAddress,
                item.Tournament.PostalCode,
                item.Tournament.City,
                item.Tournament.Country,
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

        var formatsByTournament = await LoadFormatsAsync(database, pageRows.Select(row => row.Id).ToArray(), cancellationToken);
        var items = pageRows.Select(row => ToSummary(row, formatsByTournament)).ToArray();
        var truncated = total > ceiling;
        if (truncated)
        {
            loggerFactory.CreateLogger("Gones.Api.Tournaments")
                .LogWarning("Public tournament catalog truncated: total={Total} ceiling={Ceiling}", total, ceiling);
        }

        response.Headers.ETag = etag;
        response.Headers.CacheControl = CatalogCacheControl;
        return Results.Ok(new PublicTournamentCatalogResponse(items, clock.GetCurrentInstant(), items.Length, truncated));
    }

    private static IQueryable<TournamentQueryItem> VisibleTournaments(GonesDbContext database) =>
        from tournament in database.ScheduledTournaments.AsNoTracking()
        join org in database.Organizations.AsNoTracking() on tournament.OrganizationId equals org.Id
        where tournament.DeletedAt == null && org.DeletedAt == null
        select new TournamentQueryItem { Tournament = tournament, Organization = org };

    private static async Task<IResult> GetAsync(
        string slug,
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var row = await LoadDetailAsync(database, slug, cancellationToken);
        var formatsByTournament = await LoadFormatsAsync(database, [row.Id], cancellationToken);
        var etag = HashETag($"{row.Id:N}:{row.Version}:{row.UpdatedAt.ToUnixTimeTicks()}");
        SetPublicCache(response, etag);
        if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);
        return Results.Ok(ToDetail(row, formatsByTournament));
    }

    private static async Task<IResult> ListParticipantsAsync(
        string slug,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var tournament = await LoadDetailAsync(database, slug, cancellationToken);
        var profiles = await (
            from attempt in database.TournamentRegistrationAttempts.AsNoTracking()
            join profile in database.UserProfiles.AsNoTracking() on attempt.UserId equals profile.UserId
            where attempt.TournamentId == tournament.Id
                && attempt.Status == TournamentRegistrationStatus.Confirmed
                && profile.ClosedAt == null
            orderby profile.NormalizedUsername, profile.UserId
            select profile
        ).ToListAsync(cancellationToken);
        var participants = profiles
            .Select(profile => new PublicTournamentParticipantResponse(
                profile.UserId,
                profile.Username,
                profile.IsFirstNamePublic ? profile.FirstName : null,
                profile.IsLastNamePublic ? profile.LastName : null,
                profile.IsLocationPublic ? JoinLocation(profile) : null,
                profile.IsBirthDatePublic ? profile.BirthDate?.Year : null,
                profile.IsPreferredLanguagePublic ? profile.PreferredLanguage : null))
            .ToList();
        return Results.Ok(new PublicTournamentParticipantListResponse(participants));
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
        response.Headers.ContentDisposition = new ContentDispositionHeaderValue("attachment") { FileNameStar = $"{row.Slug}.ics" }.ToString();
        return Results.Text(BuildIcs(row), "text/calendar; charset=utf-8", Encoding.UTF8);
    }

    private static async Task<TournamentRow> LoadDetailAsync(GonesDbContext database, string slug, CancellationToken cancellationToken)
    {
        var normalizedSlug = TournamentSlug.Normalize(slug);
        return await (
            from tournament in database.ScheduledTournaments.AsNoTracking()
            join organization in database.Organizations.AsNoTracking() on tournament.OrganizationId equals organization.Id
            where tournament.DeletedAt == null && organization.DeletedAt == null && tournament.Slug == normalizedSlug
            select new TournamentRow(
                tournament.Id,
                tournament.Title,
                tournament.Slug,
                tournament.Summary,
                tournament.StreetAddress,
                tournament.PostalCode,
                tournament.City,
                tournament.Country,
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
                tournament.BodyHtml))
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new ResourceNotFoundException();
    }

    private static async Task<IReadOnlyDictionary<Guid, IReadOnlyList<PublicTournamentFormatResponse>>> LoadFormatsAsync(
        GonesDbContext database,
        IReadOnlyCollection<Guid> tournamentIds,
        CancellationToken cancellationToken)
    {
        if (tournamentIds.Count == 0) return new Dictionary<Guid, IReadOnlyList<PublicTournamentFormatResponse>>();
        var rows = await (
            from link in database.ScheduledTournamentFormats.AsNoTracking()
            join format in database.TournamentFormats.AsNoTracking() on link.TournamentFormatId equals format.Id
            where tournamentIds.Contains(link.ScheduledTournamentId) && format.DeletedAt == null
            orderby format.SortOrder, format.Name, format.Id
            select new { link.ScheduledTournamentId, format.Id, format.Name, format.Slug, format.SortOrder }
        ).ToListAsync(cancellationToken);
        return rows
            .GroupBy(item => item.ScheduledTournamentId)
            .ToDictionary(
                group => group.Key,
                group => (IReadOnlyList<PublicTournamentFormatResponse>)group.Select(item => new PublicTournamentFormatResponse(item.Id, item.Name, item.Slug, item.SortOrder)).ToArray());
    }

    private static PublicTournamentSummaryResponse ToSummary(TournamentRow row, IReadOnlyDictionary<Guid, IReadOnlyList<PublicTournamentFormatResponse>> formatsByTournament) => new(
        row.Id,
        row.Title,
        row.Slug,
        row.Summary,
        new PublicTournamentVenueResponse(row.StreetAddress, row.PostalCode, row.City, row.Country),
        row.TimeZoneId,
        FormatDate(row.VenueStartDate),
        FormatTime(row.VenueStartTime),
        FormatDate(row.VenueEndDate),
        FormatTime(row.VenueEndTime),
        row.StartsAtUtc,
        row.EndsAtUtc,
        row.Capacity,
        row.Status.ToString(),
        new PublicTournamentOrganizationResponse(row.OrganizationId, row.OrganizationName, row.OrganizationDescription, row.OrganizationWebsite, row.OrganizationContactEmail),
        formatsByTournament.TryGetValue(row.Id, out var formats) ? formats : []);

    private static PublicTournamentDetailResponse ToDetail(TournamentRow row, IReadOnlyDictionary<Guid, IReadOnlyList<PublicTournamentFormatResponse>> formatsByTournament)
    {
        var summary = ToSummary(row, formatsByTournament);
        return new PublicTournamentDetailResponse(
            summary.Id,
            summary.Title,
            summary.Slug,
            summary.Summary,
            row.BodyHtml,
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
            summary.Organization,
            summary.Formats);
    }

    private static string BuildIcs(TournamentRow row)
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
        builder.AppendLine($"LOCATION:{EscapeIcsText(string.Join(", ", new[] { row.StreetAddress, row.PostalCode, row.City, row.Country }.Where(value => !string.IsNullOrWhiteSpace(value))))}");
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

    private sealed record TournamentRow(
        Guid Id,
        string Title,
        string Slug,
        string? Summary,
        string StreetAddress,
        string? PostalCode,
        string City,
        string Country,
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
        string? BodyHtml = null);

    private sealed class TournamentQueryItem
    {
        public required ScheduledTournament Tournament { get; init; }
        public required Organization Organization { get; init; }
    }
}

internal sealed record PublicTournamentCatalogResponse(
    IReadOnlyList<PublicTournamentSummaryResponse> Items,
    Instant GeneratedAt,
    int Count,
    bool Truncated);

internal sealed record PublicTournamentListResponse(
    IReadOnlyList<PublicTournamentSummaryResponse> Items,
    int Page,
    int PageSize,
    int TotalCount);

internal sealed record PublicTournamentSummaryResponse(
    Guid Id,
    string Title,
    string Slug,
    string? Summary,
    PublicTournamentVenueResponse Venue,
    string TimeZoneId,
    string VenueStartDate,
    string VenueStartTime,
    string VenueEndDate,
    string VenueEndTime,
    Instant StartsAtUtc,
    Instant EndsAtUtc,
    int? Capacity,
    string Status,
    PublicTournamentOrganizationResponse Organization,
    IReadOnlyList<PublicTournamentFormatResponse> Formats);

internal sealed record PublicTournamentDetailResponse(
    Guid Id,
    string Title,
    string Slug,
    string? Summary,
    string? BodyHtml,
    PublicTournamentVenueResponse Venue,
    string TimeZoneId,
    string VenueStartDate,
    string VenueStartTime,
    string VenueEndDate,
    string VenueEndTime,
    Instant StartsAtUtc,
    Instant EndsAtUtc,
    int? Capacity,
    string Status,
    PublicTournamentOrganizationResponse Organization,
    IReadOnlyList<PublicTournamentFormatResponse> Formats);

internal sealed record PublicTournamentVenueResponse(
    string StreetAddress,
    string? PostalCode,
    string City,
    string Country);

internal sealed record PublicTournamentOrganizationResponse(
    Guid Id,
    string Name,
    string? Description,
    string? Website,
    string? ContactEmail);

internal sealed record PublicTournamentFormatResponse(
    Guid Id,
    string Name,
    string Slug,
    int SortOrder);

internal sealed record PublicTournamentParticipantListResponse(IReadOnlyList<PublicTournamentParticipantResponse> Items);

internal sealed record PublicTournamentParticipantResponse(
    Guid UserId,
    string Username,
    string? FirstName,
    string? LastName,
    string? Location,
    int? BirthYear,
    string? PreferredLanguage);
