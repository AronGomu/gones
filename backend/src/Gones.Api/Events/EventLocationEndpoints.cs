using System.Security.Claims;
using Gones.Api.Errors;
using Gones.Api.Organizations;
using Gones.Api.Security;
using Gones.Application.Events;
using NodaTime;

namespace Gones.Api.Events;

internal static class EventLocationEndpoints
{
    private const int MaximumAutocompleteInputLength = 200;
    private const int MaximumAutocompleteSuggestions = 5;
    private const int MaximumPlaceIdLength = 512;

    public static void MapEventLocationEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/event-locations")
            .RequireAuthorization(AuthorizationPolicies.User);

        group.MapGet("/autocomplete", AutocompleteAsync)
            .WithName("AutocompleteEventLocations")
            .Produces<EventLocationAutocompleteResponse>()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status503ServiceUnavailable);

        group.MapPost("/resolve", ResolveAsync)
            .WithName("ResolveEventLocation")
            .Produces<ResolvedEventLocationResponse>()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status503ServiceUnavailable);
    }

    private static async Task<IResult> AutocompleteAsync(
        string input,
        string sessionToken,
        string language,
        IEventLocationProvider provider,
        CancellationToken cancellationToken)
    {
        var normalizedInput = RequiredBounded(input, "input", MaximumAutocompleteInputLength);
        var normalizedSessionToken = SessionToken(sessionToken);
        var normalizedLanguage = Language(language);
        var suggestions = await provider.AutocompleteAsync(
            normalizedInput,
            normalizedSessionToken,
            normalizedLanguage,
            cancellationToken);
        return Results.Ok(new EventLocationAutocompleteResponse(
            suggestions.Take(MaximumAutocompleteSuggestions)
                .Select(item => new EventLocationSuggestionResponse(item.PlaceId, item.PrimaryText, item.SecondaryText))
                .ToArray()));
    }

    private static async Task<IResult> ResolveAsync(
        ResolveEventLocationRequest request,
        ClaimsPrincipal principal,
        IEventLocationProvider provider,
        IEventLocationTokenService tokens,
        CancellationToken cancellationToken)
    {
        var placeId = RequiredBounded(request.PlaceId, "placeId", MaximumPlaceIdLength);
        var sessionToken = SessionToken(request.SessionToken);
        var language = Language(request.Language);
        var location = await provider.ResolveAsync(placeId, sessionToken, language, cancellationToken);
        EnsureResolved(location);
        var now = SystemClock.Instance.GetCurrentInstant();
        return Results.Ok(new ResolvedEventLocationResponse(
            location.StreetAddress,
            location.PostalCode,
            location.City,
            location.Country,
            location.Region,
            location.Latitude,
            location.Longitude,
            location.TimeZoneId,
            tokens.Issue(OrganizationPrincipal.UserId(principal), location, now),
            (now + EventLocationTokenService.Lifetime).ToDateTimeOffset()));
    }

    private static string RequiredBounded(string? value, string field, int maximumLength)
    {
        var normalized = value?.Trim() ?? string.Empty;
        if (normalized.Length == 0 || normalized.Length > maximumLength)
        {
            throw Validation(field, $"{field} is required and cannot exceed {maximumLength} characters.");
        }
        return normalized;
    }

    private static string SessionToken(string? value)
    {
        if (!Guid.TryParse(value, out var token)) throw Validation("sessionToken", "sessionToken must be a UUID.");
        return token.ToString("D");
    }

    private static string Language(string? value)
    {
        var normalized = value?.Trim().ToLowerInvariant();
        if (normalized is not ("en" or "fr")) throw Validation("language", "language must be en or fr.");
        return normalized;
    }

    private static void EnsureResolved(ResolvedEventLocation location)
    {
        if (string.IsNullOrWhiteSpace(location.PlaceId)
            || string.IsNullOrWhiteSpace(location.StreetAddress)
            || string.IsNullOrWhiteSpace(location.PostalCode)
            || string.IsNullOrWhiteSpace(location.City)
            || string.IsNullOrWhiteSpace(location.Country)
            || string.IsNullOrWhiteSpace(location.Region)
            || location.Latitude is < -90 or > 90
            || location.Longitude is < -180 or > 180
            || DateTimeZoneProviders.Tzdb.GetZoneOrNull(location.TimeZoneId) is null)
        {
            throw new ApiValidationException(
                new Dictionary<string, string[]>
                {
                    ["location.locationToken"] = ["Choose a complete resolved location."]
                },
                "location_unresolved");
        }
    }

    private static ApiValidationException Validation(string field, string message) =>
        new(new Dictionary<string, string[]> { [field] = [message] });
}

internal sealed record EventLocationSuggestionResponse(string PlaceId, string PrimaryText, string SecondaryText);
internal sealed record EventLocationAutocompleteResponse(IReadOnlyList<EventLocationSuggestionResponse> Suggestions);
internal sealed record ResolveEventLocationRequest(string PlaceId, string SessionToken, string Language);
internal sealed record ResolvedEventLocationResponse(
    string StreetAddress,
    string PostalCode,
    string City,
    string Country,
    string Region,
    decimal Latitude,
    decimal Longitude,
    string TimeZoneId,
    string LocationToken,
    DateTimeOffset ExpiresAt);
