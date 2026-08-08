using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Gones.Api.Errors;
using Gones.Api.Organizations;
using Gones.Api.Security;
using Gones.Api.Validation;
using Gones.Application.Concurrency;
using Gones.Domain.Calendar;
using Gones.Domain.Catalog;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using NodaTime.Text;
using Npgsql;

namespace Gones.Api.Tournaments;

internal static class TournamentPublicationEndpoints
{
    public static void MapTournamentPublicationEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/tournaments")
            .RequireAuthorization(AuthorizationPolicies.Organizer);

        group.MapPost("/preview", PreviewAsync)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces<TournamentPreviewResponse>()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound);

        group.MapPost("/", PublishAsync)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces<TournamentPublishResponse>(StatusCodes.Status201Created)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
    }

    private static async Task<IResult> PreviewAsync(
        TournamentPayloadRequest request,
        ClaimsPrincipal principal,
        TournamentPublicationService publication,
        CancellationToken cancellationToken)
    {
        var preview = await publication.PreviewAsync(
            OrganizationPrincipal.UserId(principal),
            OrganizationPrincipal.IsAdmin(principal),
            request,
            cancellationToken);
        return Results.Ok(preview);
    }

    private static async Task<IResult> PublishAsync(
        PublishTournamentRequest request,
        [FromHeader(Name = "Idempotency-Key")] string idempotencyKey,
        HttpResponse httpResponse,
        ClaimsPrincipal principal,
        TournamentPublicationService publication,
        CancellationToken cancellationToken)
    {
        idempotencyKey = idempotencyKey.Trim();
        if (string.IsNullOrWhiteSpace(idempotencyKey) || idempotencyKey.Length > 200)
        {
            throw Validation("Idempotency-Key", "Idempotency-Key header is required and cannot exceed 200 characters.");
        }

        var outcome = await publication.PublishAsync(
            OrganizationPrincipal.UserId(principal),
            OrganizationPrincipal.IsAdmin(principal),
            idempotencyKey,
            request,
            cancellationToken);
        httpResponse.Headers.Location = outcome.Location;
        httpResponse.Headers.ETag = outcome.ETag;
        return Results.Json(outcome.Response, statusCode: StatusCodes.Status201Created);
    }

    private static ApiValidationException Validation(string field, string message) =>
        new(new Dictionary<string, string[]> { [field] = [message] });
}

internal sealed class TournamentPublicationService(
    GonesDbContext database,
    OrganizationAccessService access,
    TournamentPreviewTicketService tickets,
    IClock clock)
{
    private const int MaximumPublishAttempts = 3;
    private static readonly JsonSerializerOptions StoredJsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<TournamentPreviewResponse> PreviewAsync(
        Guid userId,
        bool isAdmin,
        TournamentPayloadRequest request,
        CancellationToken cancellationToken)
    {
        var normalized = await NormalizeAsync(userId, isAdmin, request, cancellationToken);
        var ticket = tickets.Issue(userId, request.OrganizationId, normalized.PayloadHash);
        return new TournamentPreviewResponse(normalized.Render, ticket.Value, ticket.ExpiresAt);
    }

    /// <summary>
    /// The HTTP publish path: a preview ticket is mandatory here, then the work is handed to
    /// <see cref="PublishTournamentAsync"/>.
    /// </summary>
    public Task<TournamentPublishOutcome> PublishAsync(
        Guid userId,
        bool isAdmin,
        string idempotencyKey,
        PublishTournamentRequest request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.PreviewTicket) || request.PreviewTicket.Length > 2048)
        {
            throw Validation("previewTicket", "Preview ticket is required and cannot exceed 2048 characters.");
        }
        if (request.Payload is null) throw Validation("payload", "Payload is required.");
        return PublishTournamentAsync(request.Payload, userId, isAdmin, idempotencyKey, request.PreviewTicket, cancellationToken);
    }

    /// <summary>
    /// Publishes a normalized payload without going through HTTP. <paramref name="previewTicket"/> is
    /// null when the caller never issued one — approving a stored tournament proposal (T17) is the
    /// case: the payload was already validated at submission, so there is no preview to consume.
    ///
    /// <paramref name="requireMembership"/> is false only on that approval path, where the acting user
    /// is the proposal's submitter — a plain account that is by definition not a member of the target
    /// organization. <see cref="PublishAsync"/> keeps the default, so direct organizer publishing
    /// still goes through the membership check.
    /// </summary>
    internal async Task<TournamentPublishOutcome> PublishTournamentAsync(
        TournamentPayloadRequest request,
        Guid actingUserId,
        bool isAdmin,
        string idempotencyKey,
        string? previewTicket,
        CancellationToken cancellationToken,
        bool requireMembership = true)
    {
        var normalized = await NormalizeAsync(actingUserId, isAdmin, request, cancellationToken, requireMembership);
        var ticketHash = previewTicket is null ? string.Empty : TournamentPreviewTicketService.Hash(previewTicket);
        var scope = $"tournament-publish:{actingUserId:D}";

        for (var attempt = 1; attempt <= MaximumPublishAttempts; attempt++)
        {
            await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
            try
            {
                var existing = await database.IdempotencyRecords.AsNoTracking()
                    .SingleOrDefaultAsync(item => item.Scope == scope && item.Key == idempotencyKey, cancellationToken);
                if (existing is not null)
                {
                    var stored = JsonSerializer.Deserialize<StoredPublishResult>(existing.ResponseBody, StoredJsonOptions)
                        ?? throw new InvalidOperationException("Stored tournament publication result is invalid.");
                    if (!FixedTimeEquals(stored.TicketHash, ticketHash)
                        || !FixedTimeEquals(stored.PayloadHash, normalized.PayloadHash))
                    {
                        throw new IdempotencyConflictException();
                    }

                    await transaction.CommitAsync(cancellationToken);
                    return Outcome(stored.Response);
                }

                Instant? expiresAt = null;
                if (previewTicket is not null)
                {
                    expiresAt = tickets.Validate(
                        previewTicket,
                        actingUserId,
                        request.OrganizationId,
                        normalized.PayloadHash);
                    if (await database.ConsumedTournamentPreviewTickets.AsNoTracking()
                        .AnyAsync(item => item.TicketHash == ticketHash, cancellationToken))
                    {
                        throw new TournamentPreviewReplayException();
                    }
                }

                await database.Database.ExecuteSqlInterpolatedAsync(
                    $"SELECT pg_advisory_xact_lock(hashtext({normalized.BaseSlug}))",
                    cancellationToken);
                var slug = await NextSlugAsync(normalized.BaseSlug, cancellationToken);
                var now = clock.GetCurrentInstant();
                var tournament = ScheduledTournament.Create(
                    request.OrganizationId,
                    actingUserId,
                    ToDraft(request, slug),
                    normalized.Formats,
                    now);
                database.ScheduledTournaments.Add(tournament);
                var response = new TournamentPublishResponse(tournament.Id, tournament.Slug, tournament.Status.ToString());
                var storedResult = new StoredPublishResult(ticketHash, normalized.PayloadHash, response);
                if (expiresAt is { } ticketExpiresAt)
                {
                    database.ConsumedTournamentPreviewTickets.Add(new ConsumedTournamentPreviewTicket
                    {
                        TicketHash = ticketHash,
                        ExpiresAt = ticketExpiresAt
                    });
                }
                database.AuditRecords.Add(new AuditRecord
                {
                    ActorId = actingUserId,
                    Action = "tournament.published",
                    EntityType = "scheduled_tournament",
                    EntityId = tournament.Id.ToString("D"),
                    RedactedDiff = "{\"fields\":[\"organizationId\",\"title\",\"schedule\",\"venue\",\"capacity\",\"formats\"]}",
                    OccurredAt = now
                });
                database.IdempotencyRecords.Add(new IdempotencyRecord
                {
                    Scope = scope,
                    Key = idempotencyKey,
                    ResponseStatusCode = StatusCodes.Status201Created,
                    ResponseBody = JsonSerializer.Serialize(storedResult, StoredJsonOptions),
                    CreatedAt = now,
                    ExpiresAt = now + Duration.FromHours(24)
                });
                await database.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return Outcome(response);
            }
            catch (DbUpdateException exception) when (
                exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
            {
                await transaction.RollbackAsync(cancellationToken);
                database.ChangeTracker.Clear();
                if (attempt == MaximumPublishAttempts) throw new ResourceConflictException();
            }
        }

        throw new ResourceConflictException();
    }

    /// <summary>
    /// Runs every check <c>POST /api/tournaments/preview</c> runs except the organizer-membership one,
    /// which a proposal submitter cannot satisfy by definition. A stored proposal therefore can never
    /// carry a payload that publishing would later reject.
    /// </summary>
    public async Task ValidateProposalPayloadAsync(
        Guid submitterUserId,
        TournamentPayloadRequest request,
        CancellationToken cancellationToken)
    {
        _ = await NormalizeAsync(submitterUserId, isAdmin: false, request, cancellationToken, requireMembership: false);
    }

    private async Task<NormalizedTournamentPayload> NormalizeAsync(
        Guid userId,
        bool isAdmin,
        TournamentPayloadRequest request,
        CancellationToken cancellationToken,
        bool requireMembership = true)
    {
        if (request.OrganizationId == Guid.Empty) throw Validation("organizationId", "Organization ID is required.");
        var organization = requireMembership
            ? (await access.RequireMemberAsync(request.OrganizationId, userId, isAdmin, cancellationToken)).Organization
            : (await access.LoadAsync(request.OrganizationId, userId, isAdmin, includeDeletedForAdmin: false, cancellationToken)).Organization;
        if (organization.DeletedAt is not null) throw new ResourceNotFoundException();
        var formatIds = request.FormatIds?.Distinct().Order().ToArray() ?? [];
        if (formatIds.Length == 0 || formatIds.Length != request.FormatIds!.Count)
        {
            throw Validation("formatIds", "At least one unique format is required.");
        }

        var formats = await database.TournamentFormats.AsNoTracking()
            .Where(format => formatIds.Contains(format.Id) && format.DeletedAt == null)
            .OrderBy(format => format.Slug)
            .ToListAsync(cancellationToken);
        if (formats.Count != formatIds.Length) throw Validation("formatIds", "One or more formats are invalid.");

        try
        {
            var baseSlug = TournamentSlugGenerator.FromTitle(request.Title);
            var tournament = ScheduledTournament.Create(
                request.OrganizationId,
                userId,
                ToDraft(request, baseSlug),
                formats,
                clock.GetCurrentInstant());
            var render = new TournamentPreviewRenderResponse(
                tournament.Title,
                tournament.Slug,
                tournament.Summary,
                tournament.BodyHtml,
                new PublicTournamentVenueResponse(tournament.StreetAddress, tournament.PostalCode, tournament.City, tournament.Country),
                tournament.TimeZoneId,
                LocalDatePattern.Iso.Format(tournament.VenueStartDate),
                LocalTimePattern.CreateWithInvariantCulture("HH:mm:ss").Format(tournament.VenueStartTime),
                LocalDatePattern.Iso.Format(tournament.VenueEndDate),
                LocalTimePattern.CreateWithInvariantCulture("HH:mm:ss").Format(tournament.VenueEndTime),
                tournament.StartsAtUtc,
                tournament.EndsAtUtc,
                tournament.Capacity,
                tournament.Status.ToString(),
                new PublicTournamentOrganizationResponse(organization.Id, organization.Name, organization.Description, organization.Website, organization.ContactEmail),
                formats.Select(format => new PublicTournamentFormatResponse(format.Id, format.Name, format.Slug, format.SortOrder)).ToArray());
            var canonical = new CanonicalTournamentPayload(
                request.OrganizationId,
                tournament.Title,
                tournament.Slug,
                tournament.Summary,
                tournament.BodyHtml,
                tournament.StreetAddress,
                tournament.PostalCode,
                tournament.City,
                tournament.Country,
                tournament.TimeZoneId,
                tournament.StartsAtUtc.ToUnixTimeTicks(),
                tournament.EndsAtUtc.ToUnixTimeTicks(),
                tournament.Capacity,
                formatIds);
            var payloadHash = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(canonical, StoredJsonOptions))).ToLowerInvariant();
            return new NormalizedTournamentPayload(baseSlug, payloadHash, formats, render);
        }
        catch (ApiException)
        {
            throw;
        }
        catch (ArgumentException exception)
        {
            throw Validation("payload", exception.Message);
        }
    }

    private static ScheduledTournamentDraft ToDraft(TournamentPayloadRequest request, string slug) => new(
        request.Title,
        slug,
        request.Summary,
        request.BodyHtml,
        request.StreetAddress,
        request.PostalCode,
        request.City,
        request.Country,
        request.TimeZoneId,
        ParseLocal(request.StartsAtLocal, "startsAtLocal"),
        string.IsNullOrWhiteSpace(request.EndsAtLocal) ? null : ParseLocal(request.EndsAtLocal, "endsAtLocal"),
        request.Capacity);

    private static LocalDateTime ParseLocal(string value, string field)
    {
        if (string.IsNullOrWhiteSpace(value)) throw Validation(field, "Local date and time is required.");
        var parsed = LocalDateTimePattern.ExtendedIso.Parse(value.Trim());
        if (!parsed.Success) throw Validation(field, "Value must be an ISO-8601 local date and time.");
        return parsed.Value;
    }

    private async Task<string> NextSlugAsync(string baseSlug, CancellationToken cancellationToken)
    {
        var existing = await database.ScheduledTournaments.AsNoTracking()
            .Where(item => item.Slug == baseSlug || EF.Functions.Like(item.Slug, baseSlug + "-%"))
            .Select(item => item.Slug)
            .ToListAsync(cancellationToken);
        if (!existing.Contains(baseSlug, StringComparer.Ordinal)) return baseSlug;
        for (var suffix = 2; suffix < int.MaxValue; suffix++)
        {
            var suffixText = $"-{suffix.ToString(CultureInfo.InvariantCulture)}";
            var prefix = baseSlug[..Math.Min(baseSlug.Length, ScheduledTournament.MaximumSlugLength - suffixText.Length)].TrimEnd('-');
            var candidate = prefix + suffixText;
            if (!existing.Contains(candidate, StringComparer.Ordinal)) return candidate;
        }

        throw new ResourceConflictException();
    }

    private static TournamentPublishOutcome Outcome(TournamentPublishResponse response) =>
        new(response, $"/api/tournaments/{response.Slug}", StrongETag.Encode(1));

    private static bool FixedTimeEquals(string left, string right)
    {
        var leftBytes = Encoding.UTF8.GetBytes(left);
        var rightBytes = Encoding.UTF8.GetBytes(right);
        return leftBytes.Length == rightBytes.Length
            && CryptographicOperations.FixedTimeEquals(leftBytes, rightBytes);
    }

    private static ApiValidationException Validation(string field, string message) =>
        new(new Dictionary<string, string[]> { [field] = [message] });

    private sealed record NormalizedTournamentPayload(
        string BaseSlug,
        string PayloadHash,
        IReadOnlyList<TournamentFormat> Formats,
        TournamentPreviewRenderResponse Render);

    private sealed record CanonicalTournamentPayload(
        Guid OrganizationId,
        string Title,
        string Slug,
        string? Summary,
        string? BodyHtml,
        string StreetAddress,
        string? PostalCode,
        string City,
        string Country,
        string TimeZoneId,
        long StartsAtUtcTicks,
        long EndsAtUtcTicks,
        int? Capacity,
        IReadOnlyList<Guid> FormatIds);

    private sealed record StoredPublishResult(string TicketHash, string PayloadHash, TournamentPublishResponse Response);
}

internal static class TournamentSlugGenerator
{
    public static string FromTitle(string title)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(title);
        var builder = new StringBuilder();
        var previousHyphen = false;
        foreach (var character in title.Trim().Normalize(NormalizationForm.FormD))
        {
            var category = CharUnicodeInfo.GetUnicodeCategory(character);
            if (category == UnicodeCategory.NonSpacingMark) continue;
            if (char.IsAsciiLetterOrDigit(character))
            {
                builder.Append(char.ToLowerInvariant(character));
                previousHyphen = false;
            }
            else if (!previousHyphen && builder.Length > 0)
            {
                builder.Append('-');
                previousHyphen = true;
            }
        }

        var slug = builder.ToString().Trim('-');
        if (slug.Length == 0) slug = "tournament";
        if (slug.Length > ScheduledTournament.MaximumSlugLength) slug = slug[..ScheduledTournament.MaximumSlugLength].TrimEnd('-');
        return TournamentSlug.Normalize(slug);
    }
}

internal sealed record TournamentPayloadRequest(
    Guid OrganizationId,
    [property: Required, MaxLength(ScheduledTournament.MaximumTitleLength)] string Title,
    [property: MaxLength(ScheduledTournament.MaximumSummaryLength)] string? Summary,
    [property: MaxLength(ScheduledTournament.MaximumBodyHtmlLength)] string? BodyHtml,
    [property: Required, MaxLength(ScheduledTournament.MaximumAddressLength)] string StreetAddress,
    [property: MaxLength(ScheduledTournament.MaximumPostalCodeLength)] string? PostalCode,
    [property: Required, MaxLength(ScheduledTournament.MaximumCityLength)] string City,
    [property: Required, MaxLength(ScheduledTournament.MaximumCountryLength)] string Country,
    [property: Required, MaxLength(ScheduledTournament.MaximumTimeZoneLength)] string TimeZoneId,
    [property: Required] string StartsAtLocal,
    string? EndsAtLocal,
    int? Capacity,
    [property: Required, MinLength(1)] IReadOnlyList<Guid> FormatIds);

internal sealed record PublishTournamentRequest(
    [property: Required] string PreviewTicket,
    [property: Required] TournamentPayloadRequest Payload);

internal sealed record TournamentPreviewResponse(
    TournamentPreviewRenderResponse Render,
    string PreviewTicket,
    Instant ExpiresAt);

internal sealed record TournamentPreviewRenderResponse(
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

internal sealed record TournamentPublishResponse(Guid Id, string Slug, string Status);
internal sealed record TournamentPublishOutcome(TournamentPublishResponse Response, string Location, string ETag);
