using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Gones.Api.Errors;
using Gones.Api.Organizations;
using Gones.Api.Security;
using Gones.Api.Validation;
using Gones.Application.Concurrency;
using Gones.Application.Events;
using Gones.Domain.Calendar;
using Gones.Domain.Catalog;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using NodaTime.Text;
using Npgsql;

namespace Gones.Api.Events;

[JsonConverter(typeof(PublicCalendarEventTypeJsonConverter))]
internal enum PublicCalendarEventType
{
    [JsonStringEnumMemberName("weekly")] Weekly,
    [JsonStringEnumMemberName("monthly")] Monthly,
    [JsonStringEnumMemberName("major")] Major
}

internal sealed class PublicCalendarEventTypeJsonConverter : JsonConverter<PublicCalendarEventType>
{
    public override PublicCalendarEventType Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType != JsonTokenType.String) throw new JsonException("Event Type must be a string.");
        return reader.GetString() switch
        {
            "weekly" => PublicCalendarEventType.Weekly,
            "monthly" => PublicCalendarEventType.Monthly,
            "major" => PublicCalendarEventType.Major,
            _ => throw new JsonException("Event Type must be weekly, monthly, or major.")
        };
    }

    public override void Write(Utf8JsonWriter writer, PublicCalendarEventType value, JsonSerializerOptions options) =>
        writer.WriteStringValue(value switch
        {
            PublicCalendarEventType.Weekly => "weekly",
            PublicCalendarEventType.Monthly => "monthly",
            PublicCalendarEventType.Major => "major",
            _ => throw new JsonException("Event Type is invalid.")
        });
}

internal static class EventPublicationEndpoints
{
    public static void MapEventPublicationEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/events")
            .RequireAuthorization(AuthorizationPolicies.Organizer);

        group.MapPost("/", PublishAsync)
            .Produces<EventPublishResponse>(StatusCodes.Status201Created)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status503ServiceUnavailable);
    }

    private static async Task<IResult> PublishAsync(
        EventPayloadRequest request,
        [FromHeader(Name = "Idempotency-Key")] string idempotencyKey,
        HttpResponse httpResponse,
        ClaimsPrincipal principal,
        EventPublicationService publication,
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

internal sealed class EventPublicationService(
    GonesDbContext database,
    OrganizationAccessService access,
    IEventLocationTokenService locationTokens,
    IClock clock)
{
    private const int MaximumPublishAttempts = 3;
    private static readonly JsonSerializerOptions StoredJsonOptions = new(JsonSerializerDefaults.Web);

    public Task<EventPublishOutcome> PublishAsync(
        Guid userId,
        bool isAdmin,
        string idempotencyKey,
        EventPayloadRequest request,
        CancellationToken cancellationToken) =>
        PublishEventAsync(request, userId, isAdmin, idempotencyKey, null, cancellationToken);

    /// <summary>
    /// Publishes direct HTTP requests or a proposal-owned, submission-time validated location.
    /// Proposal approval joins its caller's transaction; direct publication owns its transaction.
    /// </summary>
    internal async Task<EventPublishOutcome> PublishEventAsync(
        EventPayloadRequest request,
        Guid actingUserId,
        bool isAdmin,
        string idempotencyKey,
        ValidatedEventLocation? proposalLocation,
        CancellationToken cancellationToken,
        bool requireMembership = true)
    {
        ValidatePayloadShape(request);
        var payloadHash = PayloadHash(request);
        var scope = $"tournament-publish:{actingUserId:D}";
        var ambient = database.Database.CurrentTransaction;

        for (var attempt = 1; attempt <= MaximumPublishAttempts; attempt++)
        {
            var transaction = ambient ?? await database.Database.BeginTransactionAsync(cancellationToken);
            var savepoint = ambient is null ? null : $"tournament_publish_attempt_{attempt}";
            if (savepoint is not null) await transaction.CreateSavepointAsync(savepoint, cancellationToken);
            try
            {
                var existing = await database.IdempotencyRecords.AsNoTracking()
                    .SingleOrDefaultAsync(item => item.Scope == scope && item.Key == idempotencyKey, cancellationToken);
                if (existing is not null && existing.ExpiresAt <= clock.GetCurrentInstant())
                {
                    await database.IdempotencyRecords.Where(item => item.Id == existing.Id).ExecuteDeleteAsync(cancellationToken);
                    existing = null;
                }
                if (existing is not null)
                {
                    var stored = JsonSerializer.Deserialize<StoredPublishResult>(existing.ResponseBody, StoredJsonOptions)
                        ?? throw new InvalidOperationException("Stored tournament publication result is invalid.");
                    if (!FixedTimeEquals(stored.PayloadHash, payloadHash)) throw new IdempotencyConflictException();
                    if (ambient is null) await transaction.CommitAsync(cancellationToken);
                    return Outcome(stored.Response);
                }

                var normalized = await NormalizeAsync(
                    actingUserId,
                    isAdmin,
                    request,
                    proposalLocation,
                    cancellationToken,
                    requireMembership);
                if (!await database.OrganizationMembers
                        .AnyAsync(member => member.OrganizationId == request.OrganizationId, cancellationToken))
                {
                    throw new OrganizationIsDraftException();
                }

                var lockedFormat = await database.TournamentFormats
                    .FromSqlInterpolated($"SELECT * FROM tournament_formats WHERE id = {normalized.Formats.Single().Id} AND deleted_at IS NULL FOR KEY SHARE")
                    .AsNoTracking()
                    .SingleOrDefaultAsync(cancellationToken)
                    ?? throw Validation("formatIds", "The selected format is no longer active.");
                await database.Database.ExecuteSqlInterpolatedAsync(
                    $"SELECT pg_advisory_xact_lock(hashtext({normalized.BaseSlug}))",
                    cancellationToken);
                var slug = await NextSlugAsync(normalized.BaseSlug, cancellationToken);
                var now = clock.GetCurrentInstant();
                var tournament = Event.Create(
                    request.OrganizationId,
                    actingUserId,
                    ToDraft(request, slug, normalized.Location),
                    [lockedFormat],
                    now);
                database.Events.Add(tournament);
                await AttachImagesAsync(tournament.Id, actingUserId, request.Images, now, cancellationToken);

                var response = new EventPublishResponse(tournament.Id, tournament.Slug, tournament.Status.ToString());
                database.AuditRecords.Add(new AuditRecord
                {
                    ActorId = actingUserId,
                    Action = "tournament.published",
                    EntityType = "scheduled_tournament",
                    EntityId = tournament.Id.ToString("D"),
                    RedactedDiff = "{\"fields\":[\"organizationId\",\"title\",\"schedule\",\"venue\",\"capacity\",\"formats\",\"images\"]}",
                    OccurredAt = now
                });
                database.IdempotencyRecords.Add(new IdempotencyRecord
                {
                    Scope = scope,
                    Key = idempotencyKey,
                    ResponseStatusCode = StatusCodes.Status201Created,
                    ResponseBody = JsonSerializer.Serialize(new StoredPublishResult(payloadHash, response), StoredJsonOptions),
                    CreatedAt = now,
                    ExpiresAt = now + Duration.FromHours(24)
                });
                await database.SaveChangesAsync(cancellationToken);
                if (ambient is null) await transaction.CommitAsync(cancellationToken);
                return Outcome(response);
            }
            catch (DbUpdateException exception) when (
                exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
            {
                if (savepoint is null) await transaction.RollbackAsync(cancellationToken);
                else await transaction.RollbackToSavepointAsync(savepoint, cancellationToken);
                database.ChangeTracker.Clear();
                if (attempt == MaximumPublishAttempts) throw new ResourceConflictException();
            }
            finally
            {
                if (ambient is null) await transaction.DisposeAsync();
            }
        }

        throw new ResourceConflictException();
    }

    public async Task<ValidatedEventLocation> ValidateProposalPayloadAsync(
        Guid submitterUserId,
        EventPayloadRequest request,
        CancellationToken cancellationToken)
    {
        if (request.Images.Count != 0)
        {
            throw Validation("event.images", "Proposal images are unavailable until image proposal ownership is supported.");
        }
        return (await NormalizeAsync(
            submitterUserId,
            isAdmin: false,
            request,
            proposalLocation: null,
            cancellationToken,
            requireMembership: false)).Location;
    }

    private async Task<NormalizedEventPayload> NormalizeAsync(
        Guid userId,
        bool isAdmin,
        EventPayloadRequest request,
        ValidatedEventLocation? proposalLocation,
        CancellationToken cancellationToken,
        bool requireMembership = true)
    {
        ValidatePayloadShape(request);
        if (request.OrganizationId == Guid.Empty) throw Validation("organizationId", "Organization ID is required.");
        _ = requireMembership
            ? (await access.RequireMemberAsync(request.OrganizationId, userId, isAdmin, cancellationToken)).Organization
            : (await access.LoadAsync(request.OrganizationId, userId, isAdmin, includeDeletedForAdmin: false, cancellationToken)).Organization;
        var formatIds = request.FormatIds.Distinct().ToArray();
        if (request.FormatIds.Count != 1 || formatIds.Length != 1)
        {
            throw Validation("formatIds", "Exactly one format is required.");
        }

        var formats = await database.TournamentFormats.AsNoTracking()
            .Where(format => formatIds.Contains(format.Id) && format.DeletedAt == null)
            .OrderBy(format => format.Slug)
            .ToListAsync(cancellationToken);
        if (formats.Count != formatIds.Length) throw Validation("formatIds", "One or more formats are invalid.");

        var location = proposalLocation ?? locationTokens.Validate(userId, request.Location, clock.GetCurrentInstant());
        if (!LocationMatches(request.Location, location)) throw new LocationTokenInvalidException();
        try
        {
            var baseSlug = EventSlugGenerator.FromTitleAndFormat(request.Title, formats.Single().Slug);
            _ = Event.Create(
                request.OrganizationId,
                userId,
                ToDraft(request, baseSlug, location),
                formats,
                clock.GetCurrentInstant());
            return new NormalizedEventPayload(baseSlug, formats, location);
        }
        catch (ApiException)
        {
            throw;
        }
        catch (ArgumentException exception) when (
            exception.Message.Contains("start time", StringComparison.OrdinalIgnoreCase))
        {
            throw Validation("startsAtLocal", exception.Message);
        }
        catch (ArgumentException exception)
        {
            throw Validation("payload", exception.Message);
        }
    }

    private static ScheduledTournamentDraft ToDraft(
        EventPayloadRequest request,
        string slug,
        ValidatedEventLocation location) => new(
        request.Title,
        slug,
        request.Summary,
        request.BodyMarkdown,
        location.StreetAddress,
        location.PostalCode,
        location.City,
        location.Country,
        location.TimeZoneId,
        ParseLocal(request.StartsAtLocal, "startsAtLocal"),
        null,
        request.Capacity,
        Region: location.Region,
        EventType: ToDomainEventType(request.EventType),
        ProviderPlaceId: location.PlaceId,
        Latitude: location.Latitude,
        Longitude: location.Longitude);

    internal static CalendarEventType? ToDomainEventType(PublicCalendarEventType? value) => value switch
    {
        PublicCalendarEventType.Weekly => CalendarEventType.Weekly,
        PublicCalendarEventType.Monthly => CalendarEventType.Monthly,
        PublicCalendarEventType.Major => CalendarEventType.Major,
        null => null,
        _ => throw Validation("eventType", "Event Type must be weekly, monthly, or major.")
    };

    internal static PublicCalendarEventType? EventTypeWire(CalendarEventType? value) => value switch
    {
        CalendarEventType.Weekly => PublicCalendarEventType.Weekly,
        CalendarEventType.Monthly => PublicCalendarEventType.Monthly,
        CalendarEventType.Major => PublicCalendarEventType.Major,
        _ => null
    };

    private static LocalDateTime ParseLocal(string value, string field)
    {
        if (string.IsNullOrWhiteSpace(value)) throw Validation(field, "Local date and time is required.");
        var parsed = LocalDateTimePattern.CreateWithInvariantCulture("uuuu-MM-dd'T'HH:mm").Parse(value.Trim());
        if (!parsed.Success) throw Validation(field, "Value must be an ISO-8601 local date and time in YYYY-MM-DDTHH:mm form.");
        return parsed.Value;
    }

    private async Task AttachImagesAsync(
        Guid eventId,
        Guid userId,
        IReadOnlyList<EventImageInput> inputs,
        Instant now,
        CancellationToken cancellationToken)
    {
        if (inputs.Count > 5) throw Validation("images", "At most five images are allowed.");
        if (inputs.Select(input => input.ImageId).Distinct().Count() != inputs.Count)
        {
            throw new ResourceConflictException("image_state_conflict");
        }
        for (var index = 0; index < inputs.Count; index++)
        {
            var input = inputs[index];
            if (input.ImageId == Guid.Empty) throw Validation($"images[{index}].imageId", "Image ID is required.");
            if (input.AltText?.Length > EventImage.MaximumAltTextLength)
            {
                throw Validation($"images[{index}].altText", $"Alt text cannot exceed {EventImage.MaximumAltTextLength} characters.");
            }
            var image = await database.EventImages
                .FromSqlInterpolated($"SELECT * FROM event_images WHERE id = {input.ImageId} FOR UPDATE")
                .SingleOrDefaultAsync(cancellationToken)
                ?? throw new ResourceNotFoundException();
            try
            {
                image.AttachToEvent(eventId, userId, index, input.AltText, now);
            }
            catch (InvalidOperationException)
            {
                throw new ResourceConflictException("image_state_conflict");
            }
        }
    }

    internal static bool LocationMatches(EventLocationInput input, ValidatedEventLocation location) =>
        string.Equals(input.StreetAddress, location.StreetAddress, StringComparison.Ordinal)
        && string.Equals(input.PostalCode, location.PostalCode, StringComparison.Ordinal)
        && string.Equals(input.City, location.City, StringComparison.Ordinal)
        && string.Equals(input.Country, location.Country, StringComparison.Ordinal)
        && string.Equals(input.Region, location.Region, StringComparison.Ordinal);

    internal static string PayloadHash(EventPayloadRequest request)
    {
        var canonical = new CanonicalReplayPayload(
            request.OrganizationId,
            request.Title.Trim(),
            string.IsNullOrWhiteSpace(request.Summary) ? null : request.Summary.Trim(),
            string.IsNullOrWhiteSpace(request.BodyMarkdown) ? null : request.BodyMarkdown,
            new EventLocationInput(
                request.Location.StreetAddress.Trim(),
                request.Location.PostalCode.Trim(),
                request.Location.City.Trim(),
                request.Location.Country.Trim(),
                request.Location.Region.Trim(),
                request.Location.LocationToken),
            request.EventType,
            request.StartsAtLocal.Trim(),
            request.Capacity,
            request.FormatIds,
            request.Images.Select(image => new EventImageInput(
                image.ImageId,
                string.IsNullOrWhiteSpace(image.AltText) ? null : image.AltText.Trim())).ToArray());
        return Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(canonical, StoredJsonOptions))).ToLowerInvariant();
    }

    private async Task<string> NextSlugAsync(string baseSlug, CancellationToken cancellationToken)
    {
        var existing = await database.Events.AsNoTracking()
            .Where(item => item.Slug == baseSlug || EF.Functions.Like(item.Slug, baseSlug + "-%"))
            .Select(item => item.Slug)
            .ToListAsync(cancellationToken);
        if (!existing.Contains(baseSlug, StringComparer.Ordinal)) return baseSlug;
        for (var suffix = 2; suffix < int.MaxValue; suffix++)
        {
            var suffixText = $"-{suffix.ToString(CultureInfo.InvariantCulture)}";
            var prefix = baseSlug[..Math.Min(baseSlug.Length, Event.MaximumSlugLength - suffixText.Length)].TrimEnd('-');
            var candidate = prefix + suffixText;
            if (!existing.Contains(candidate, StringComparer.Ordinal)) return candidate;
        }

        throw new ResourceConflictException();
    }

    private static EventPublishOutcome Outcome(EventPublishResponse response) =>
        new(response, $"/api/events/{response.Slug}", StrongETag.Encode(1));

    internal static bool FixedTimePayloadHash(string left, string right) => FixedTimeEquals(left, right);

    private static bool FixedTimeEquals(string left, string right)
    {
        var leftBytes = Encoding.UTF8.GetBytes(left);
        var rightBytes = Encoding.UTF8.GetBytes(right);
        return leftBytes.Length == rightBytes.Length
            && CryptographicOperations.FixedTimeEquals(leftBytes, rightBytes);
    }

    internal static void ValidatePayloadShape(EventPayloadRequest? payload, string prefix = "")
    {
        if (payload is null) throw Validation("payload", "Payload is required.");
        var failures = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        ValidateObject(payload, prefix, failures);
        if (payload.Location is null)
        {
            AddFailure(failures, prefix + "location", "Location is required.");
        }
        else
        {
            ValidateObject(payload.Location, prefix + "location.", failures);
        }
        if (payload.FormatIds is null) AddFailure(failures, prefix + "formatIds", "Format IDs are required.");
        if (payload.Images is null) AddFailure(failures, prefix + "images", "Images are required.");
        else
        {
            for (var index = 0; index < payload.Images.Count; index++)
            {
                var image = payload.Images[index];
                if (image is null)
                {
                    AddFailure(failures, $"{prefix}images[{index}]", "Image is required.");
                    continue;
                }
                ValidateObject(image, $"{prefix}images[{index}].", failures);
                if (image.ImageId == Guid.Empty)
                {
                    AddFailure(failures, $"{prefix}images[{index}].imageId", "Image ID is required.");
                }
            }
        }
        if (failures.Count == 0) return;
        throw new ApiValidationException(failures.ToDictionary(
            pair => pair.Key,
            pair => pair.Value.Distinct(StringComparer.Ordinal).ToArray(),
            StringComparer.Ordinal));
    }

    private static void ValidateObject(object value, string prefix, Dictionary<string, List<string>> failures)
    {
        var results = new List<ValidationResult>();
        Validator.TryValidateObject(value, new ValidationContext(value), results, validateAllProperties: true);
        foreach (var result in results)
        {
            foreach (var member in result.MemberNames.DefaultIfEmpty("payload"))
            {
                AddFailure(
                    failures,
                    prefix + JsonNamingPolicy.CamelCase.ConvertName(member),
                    result.ErrorMessage ?? "Invalid value.");
            }
        }
    }

    private static void AddFailure(Dictionary<string, List<string>> failures, string field, string message)
    {
        if (!failures.TryGetValue(field, out var messages)) failures[field] = messages = [];
        messages.Add(message);
    }

    private static ApiValidationException Validation(string field, string message) =>
        new(new Dictionary<string, string[]> { [field] = [message] });

    private sealed record NormalizedEventPayload(
        string BaseSlug,
        IReadOnlyList<TournamentFormat> Formats,
        ValidatedEventLocation Location);

    private sealed record CanonicalReplayPayload(
        Guid OrganizationId,
        string Title,
        string? Summary,
        string? BodyMarkdown,
        EventLocationInput Location,
        PublicCalendarEventType? EventType,
        string StartsAtLocal,
        int Capacity,
        IReadOnlyList<Guid> FormatIds,
        IReadOnlyList<EventImageInput> Images);

    private sealed record StoredPublishResult(string PayloadHash, EventPublishResponse Response);
}

internal static class EventSlugGenerator
{
    public static string FromTitleAndFormat(string title, string formatSlug)
    {
        var titleSlug = FromTitle(title);
        var normalizedFormatSlug = TournamentFormat.ValidateSlug(formatSlug);
        var maximumTitleLength = Event.MaximumSlugLength - normalizedFormatSlug.Length - 1;
        var titlePrefix = titleSlug[..Math.Min(titleSlug.Length, maximumTitleLength)].TrimEnd('-');
        return TournamentSlug.Normalize($"{titlePrefix}-{normalizedFormatSlug}");
    }

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
        if (slug.Length == 0) slug = "event";
        if (slug.Length > Event.MaximumSlugLength) slug = slug[..Event.MaximumSlugLength].TrimEnd('-');
        return TournamentSlug.Normalize(slug);
    }
}

internal sealed record EventPayloadRequest(
    Guid OrganizationId,
    [property: Required, MaxLength(Event.MaximumTitleLength)] string Title,
    [property: Required] EventLocationInput Location,
    [property: Required] PublicCalendarEventType? EventType,
    [property: Required] string StartsAtLocal,
    [property: Range(1, int.MaxValue)] int Capacity,
    [property: Required, MinLength(1), MaxLength(1)] IReadOnlyList<Guid> FormatIds,
    [property: Required, MaxLength(5)] IReadOnlyList<EventImageInput> Images,
    [property: MaxLength(Event.MaximumSummaryLength)] string? Summary = null,
    [property: MaxLength(Event.MaximumBodyMarkdownLength)] string? BodyMarkdown = null);

internal sealed record EventImageInput(
    Guid ImageId,
    [property: MaxLength(EventImage.MaximumAltTextLength)] string? AltText);

internal sealed record EventPublishResponse(Guid Id, string Slug, string Status);
internal sealed record EventPublishOutcome(EventPublishResponse Response, string Location, string ETag);
