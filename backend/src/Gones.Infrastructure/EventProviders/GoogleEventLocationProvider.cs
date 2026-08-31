using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Gones.Application.Events;

namespace Gones.Infrastructure.EventProviders;

public sealed class GoogleEventLocationProvider(HttpClient client, GoogleMapsOptions options) : IEventLocationProvider
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<IReadOnlyList<EventLocationSuggestion>> AutocompleteAsync(
        string input,
        string sessionToken,
        string language,
        CancellationToken cancellationToken)
    {
        if (!options.IsConfigured) throw new EventLocationProviderUnavailableException();
        using var request = CreateRequest(HttpMethod.Post, "https://places.googleapis.com/v1/places:autocomplete");
        request.Headers.Add("X-Goog-FieldMask", "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat");
        request.Content = JsonContent.Create(new AutocompleteRequest(input, sessionToken, language), options: JsonOptions);
        try
        {
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (!response.IsSuccessStatusCode) throw new EventLocationProviderUnavailableException();
            var body = await response.Content.ReadFromJsonAsync<AutocompleteResponse>(JsonOptions, cancellationToken);
            return body?.Suggestions?
                .Select(item => item.PlacePrediction)
                .Where(item => item is not null && !string.IsNullOrWhiteSpace(item.PlaceId))
                .Select(item => new EventLocationSuggestion(
                    item!.PlaceId!,
                    item.StructuredFormat?.MainText?.Text ?? string.Empty,
                    item.StructuredFormat?.SecondaryText?.Text ?? string.Empty))
                .ToArray() ?? [];
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new EventLocationProviderUnavailableException();
        }
        catch (HttpRequestException)
        {
            throw new EventLocationProviderUnavailableException();
        }
        catch (JsonException)
        {
            throw new EventLocationProviderUnavailableException();
        }
    }

    public async Task<ResolvedEventLocation> ResolveAsync(
        string placeId,
        string sessionToken,
        string language,
        CancellationToken cancellationToken)
    {
        if (!options.IsConfigured) throw new EventLocationProviderUnavailableException();
        try
        {
            var detailsUri = $"https://places.googleapis.com/v1/places/{Uri.EscapeDataString(placeId)}?languageCode={Uri.EscapeDataString(language)}&sessionToken={Uri.EscapeDataString(sessionToken)}";
            using var detailsRequest = CreateRequest(HttpMethod.Get, detailsUri);
            detailsRequest.Headers.Add("X-Goog-FieldMask", "id,formattedAddress,addressComponents,location");
            using var detailsResponse = await client.SendAsync(detailsRequest, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (!detailsResponse.IsSuccessStatusCode) throw new EventLocationProviderUnavailableException();
            var place = await detailsResponse.Content.ReadFromJsonAsync<PlaceDetailsResponse>(JsonOptions, cancellationToken)
                ?? throw new EventLocationProviderUnavailableException();
            var location = place.Location ?? throw new EventLocationProviderUnavailableException();

            var timeZoneUri = $"https://maps.googleapis.com/maps/api/timezone/json?location={location.Latitude.ToString(System.Globalization.CultureInfo.InvariantCulture)}%2C{location.Longitude.ToString(System.Globalization.CultureInfo.InvariantCulture)}&timestamp={DateTimeOffset.UtcNow.ToUnixTimeSeconds()}&language={Uri.EscapeDataString(language)}";
            using var timeZoneRequest = new HttpRequestMessage(HttpMethod.Get, timeZoneUri);
            using var timeZoneResponse = await client.SendAsync(timeZoneRequest, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (!timeZoneResponse.IsSuccessStatusCode) throw new EventLocationProviderUnavailableException();
            var timeZone = await timeZoneResponse.Content.ReadFromJsonAsync<TimeZoneResponse>(JsonOptions, cancellationToken);
            if (timeZone?.Status != "OK" || string.IsNullOrWhiteSpace(timeZone.TimeZoneId)) throw new EventLocationProviderUnavailableException();

            var components = place.AddressComponents ?? [];
            var streetNumber = Component(components, "street_number");
            var route = Component(components, "route");
            var streetAddress = string.Join(' ', new[] { streetNumber, route }.Where(value => !string.IsNullOrWhiteSpace(value)));
            return new ResolvedEventLocation(
                place.Id ?? placeId,
                streetAddress,
                Component(components, "postal_code"),
                Component(components, "locality", "postal_town"),
                Component(components, "country"),
                Component(components, "administrative_area_level_1"),
                location.Latitude,
                location.Longitude,
                timeZone.TimeZoneId);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new EventLocationProviderUnavailableException();
        }
        catch (HttpRequestException)
        {
            throw new EventLocationProviderUnavailableException();
        }
        catch (JsonException)
        {
            throw new EventLocationProviderUnavailableException();
        }
    }

    private HttpRequestMessage CreateRequest(HttpMethod method, string uri)
    {
        var request = new HttpRequestMessage(method, uri);
        request.Headers.Add("X-Goog-Api-Key", options.ApiKey);
        return request;
    }

    private static string Component(IReadOnlyList<AddressComponent> components, params string[] types) =>
        components.FirstOrDefault(component => component.Types?.Any(types.Contains) == true)?.LongText ?? string.Empty;

    private sealed record AutocompleteRequest(string Input, string SessionToken, string LanguageCode);
    private sealed record AutocompleteResponse(IReadOnlyList<AutocompleteSuggestion>? Suggestions);
    private sealed record AutocompleteSuggestion(PlacePrediction? PlacePrediction);
    private sealed record PlacePrediction(string? PlaceId, StructuredFormat? StructuredFormat);
    private sealed record StructuredFormat(TextValue? MainText, TextValue? SecondaryText);
    private sealed record TextValue(string? Text);
    private sealed record PlaceDetailsResponse(string? Id, string? FormattedAddress, IReadOnlyList<AddressComponent>? AddressComponents, PlaceLocation? Location);
    private sealed record AddressComponent(string? LongText, string? ShortText, IReadOnlyList<string>? Types);
    private sealed record PlaceLocation(decimal Latitude, decimal Longitude);
    private sealed record TimeZoneResponse(string? Status, string? TimeZoneId);
}

public sealed class GoogleTimeZoneApiKeyHandler(GoogleMapsOptions options) : DelegatingHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (request.RequestUri is { Host: "maps.googleapis.com", AbsolutePath: "/maps/api/timezone/json" } uri)
        {
            var separator = string.IsNullOrEmpty(uri.Query) ? "?" : "&";
            request.RequestUri = new Uri($"{uri}{separator}key={Uri.EscapeDataString(options.ApiKey!)}");
        }
        return base.SendAsync(request, cancellationToken);
    }
}

public sealed class UnavailableEventLocationProvider : IEventLocationProvider
{
    public Task<IReadOnlyList<EventLocationSuggestion>> AutocompleteAsync(string input, string sessionToken, string language, CancellationToken cancellationToken) =>
        Task.FromException<IReadOnlyList<EventLocationSuggestion>>(new EventLocationProviderUnavailableException());

    public Task<ResolvedEventLocation> ResolveAsync(string placeId, string sessionToken, string language, CancellationToken cancellationToken) =>
        Task.FromException<ResolvedEventLocation>(new EventLocationProviderUnavailableException());
}
