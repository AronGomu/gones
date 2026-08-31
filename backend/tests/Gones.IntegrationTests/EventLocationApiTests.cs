using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Gones.Api.Errors;
using Gones.Api.Events;
using Gones.Application.Events;
using Gones.Infrastructure.EventProviders;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging.Abstractions;
using NodaTime;

namespace Gones.IntegrationTests;

public sealed class EventLocationApiTests : IDisposable
{
    private static readonly Guid UserId = Guid.Parse("ae7b531c-348f-49eb-96c7-61ff4a215e7d");
    private static readonly Guid OtherUserId = Guid.Parse("dc85b574-d4d3-48f8-a179-55857627a035");
    private static readonly Instant Now = Instant.FromUtc(2030, 1, 1, 12, 0);
    private readonly StubEventLocationProvider provider = new();
    private readonly WebApplicationFactory<Program> factory;
    private readonly HttpClient client;

    public EventLocationApiTests()
    {
        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", string.Empty);
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "event-location-test-signing-key-with-more-than-32-characters");
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IEventLocationProvider>();
                services.AddSingleton<IEventLocationProvider>(provider);
            });
        });
        client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
    }

    public void Dispose()
    {
        client.Dispose();
        factory.Dispose();
    }

    [Fact]
    public async Task Autocomplete_requires_auth_validates_input_and_caps_suggestions_at_five()
    {
        using var anonymous = await client.GetAsync("/api/event-locations/autocomplete?input=Paris&sessionToken=640ec8a3-55f2-4a29-b8b6-b62c9fc3e46d&language=fr");
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

        using var blank = await GetAsync("/api/event-locations/autocomplete?input=%20%20&sessionToken=640ec8a3-55f2-4a29-b8b6-b62c9fc3e46d&language=fr");
        Assert.Equal(HttpStatusCode.BadRequest, blank.StatusCode);
        Assert.True((await blank.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors").TryGetProperty("input", out _));

        using var oversized = await GetAsync($"/api/event-locations/autocomplete?input={new string('x', 201)}&sessionToken=640ec8a3-55f2-4a29-b8b6-b62c9fc3e46d&language=fr");
        Assert.Equal(HttpStatusCode.BadRequest, oversized.StatusCode);
        Assert.True((await oversized.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors").TryGetProperty("input", out _));

        using var malformedSession = await GetAsync("/api/event-locations/autocomplete?input=Paris&sessionToken=not-a-uuid&language=de");
        Assert.Equal(HttpStatusCode.BadRequest, malformedSession.StatusCode);
        Assert.True((await malformedSession.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors").TryGetProperty("sessionToken", out _));

        provider.Suggestions = Enumerable.Range(1, 7)
            .Select(index => new EventLocationSuggestion($"place-{index}", $"Primary {index}", $"Secondary {index}"))
            .ToArray();
        using var response = await GetAsync("/api/event-locations/autocomplete?input=Paris&sessionToken=640ec8a3-55f2-4a29-b8b6-b62c9fc3e46d&language=fr");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(5, body.GetProperty("suggestions").GetArrayLength());
        Assert.Equal(("Paris", "640ec8a3-55f2-4a29-b8b6-b62c9fc3e46d", "fr"), provider.LastAutocomplete);
    }

    [Fact]
    public async Task Resolve_returns_canonical_location_and_thirty_minute_user_bound_token()
    {
        using var response = await PostAsync("/api/event-locations/resolve", new
        {
            placeId = "google-place",
            sessionToken = "640ec8a3-55f2-4a29-b8b6-b62c9fc3e46d",
            language = "en"
        });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("10 Rue de la République", body.GetProperty("streetAddress").GetString());
        Assert.Equal("69001", body.GetProperty("postalCode").GetString());
        Assert.Equal("Lyon", body.GetProperty("city").GetString());
        Assert.Equal("France", body.GetProperty("country").GetString());
        Assert.Equal("Auvergne-Rhône-Alpes", body.GetProperty("region").GetString());
        Assert.Equal("Europe/Paris", body.GetProperty("timeZoneId").GetString());
        Assert.False(string.IsNullOrWhiteSpace(body.GetProperty("locationToken").GetString()));
        Assert.Equal(("google-place", "640ec8a3-55f2-4a29-b8b6-b62c9fc3e46d", "en"), provider.LastResolve);

        var issuedAt = SystemClock.Instance.GetCurrentInstant();
        var expiresAt = Instant.FromDateTimeOffset(DateTimeOffset.Parse(
            body.GetProperty("expiresAt").GetString()!,
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind));
        Assert.InRange(expiresAt - issuedAt, Duration.FromMinutes(29), Duration.FromMinutes(30) + Duration.FromSeconds(1));
    }

    [Fact]
    public async Task Resolve_rejects_incomplete_provider_result_as_location_unresolved()
    {
        provider.Resolved = provider.Resolved with { PostalCode = string.Empty };

        using var response = await PostAsync("/api/event-locations/resolve", new
        {
            placeId = "incomplete-place",
            sessionToken = "640ec8a3-55f2-4a29-b8b6-b62c9fc3e46d",
            language = "fr"
        });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("location_unresolved", body.GetProperty("code").GetString());
        Assert.True(body.GetProperty("errors").TryGetProperty("location.locationToken", out _));
    }

    [Fact]
    public async Task Provider_outage_maps_to_retryable_service_unavailable()
    {
        provider.Unavailable = true;

        using var response = await GetAsync("/api/event-locations/autocomplete?input=Paris&sessionToken=640ec8a3-55f2-4a29-b8b6-b62c9fc3e46d&language=fr");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("location_provider_unavailable", body.GetProperty("code").GetString());
    }

    [Fact]
    public void Token_round_trip_returns_exact_claims_and_rejects_expiry_user_or_field_mismatch()
    {
        var service = new EventLocationTokenService(Configuration());
        var resolved = provider.Resolved;
        var token = service.Issue(UserId, resolved, Now);
        var input = new EventLocationInput(
            resolved.StreetAddress,
            resolved.PostalCode,
            resolved.City,
            resolved.Country,
            resolved.Region,
            token);

        var validated = service.Validate(UserId, input, Now + Duration.FromMinutes(29));

        Assert.Equal(resolved.PlaceId, validated.PlaceId);
        Assert.Equal(resolved.StreetAddress, validated.StreetAddress);
        Assert.Equal(resolved.PostalCode, validated.PostalCode);
        Assert.Equal(resolved.City, validated.City);
        Assert.Equal(resolved.Country, validated.Country);
        Assert.Equal(resolved.Region, validated.Region);
        Assert.Equal(resolved.Latitude, validated.Latitude);
        Assert.Equal(resolved.Longitude, validated.Longitude);
        Assert.Equal(resolved.TimeZoneId, validated.TimeZoneId);
        Assert.Equal(Now + Duration.FromMinutes(30), validated.ExpiresAt);
        Assert.Throws<LocationTokenExpiredException>(() => service.Validate(UserId, input, Now + Duration.FromMinutes(30) + Duration.FromNanoseconds(1)));
        Assert.Throws<LocationTokenInvalidException>(() => service.Validate(OtherUserId, input, Now));
        Assert.Throws<LocationTokenInvalidException>(() => service.Validate(UserId, input with { Region = "Île-de-France" }, Now));
        var replacement = token[^1] == 'A' ? 'B' : 'A';
        Assert.Throws<LocationTokenInvalidException>(() => service.Validate(UserId, input with { LocationToken = token[..^1] + replacement }, Now));
    }

    [Fact]
    public async Task Token_errors_target_the_location_token_field()
    {
        foreach (var exception in new ApiException[] { new LocationTokenInvalidException(), new LocationTokenExpiredException() })
        {
            var context = new DefaultHttpContext();
            context.Response.Body = new MemoryStream();
            var handler = new ApiExceptionHandler(NullLogger<ApiExceptionHandler>.Instance);

            Assert.True(await handler.TryHandleAsync(context, exception, CancellationToken.None));
            context.Response.Body.Position = 0;
            using var body = await JsonDocument.ParseAsync(context.Response.Body);

            Assert.Equal(exception.Code, body.RootElement.GetProperty("code").GetString());
            Assert.True(body.RootElement.GetProperty("errors").TryGetProperty("location.locationToken", out _));
        }
    }

    [Theory]
    [InlineData("locality", "Lyon")]
    [InlineData("postal_town", "Londres")]
    public async Task Google_mapping_uses_long_names_and_postal_town_fallback(string cityType, string city)
    {
        var options = GoogleMapsOptions.Load(Configuration(new Dictionary<string, string?>
        {
            [GoogleMapsOptions.ApiKeyKey] = "test-google-key"
        }));
        var details = JsonSerializer.Serialize(new
        {
            id = "google-place",
            addressComponents = new object[]
            {
                new { longText = "10", shortText = "10", types = new[] { "street_number" } },
                new { longText = "Rue de la République", shortText = "R. République", types = new[] { "route" } },
                new { longText = "69001", shortText = "69001", types = new[] { "postal_code" } },
                new { longText = city, shortText = city, types = new[] { cityType } },
                new { longText = "France", shortText = "FR", types = new[] { "country" } },
                new { longText = "Auvergne-Rhône-Alpes", shortText = "ARA", types = new[] { "administrative_area_level_1" } }
            },
            location = new { latitude = 45.7640m, longitude = 4.8357m }
        });
        var transport = new GoogleLocationResponseHandler(details, """{"status":"OK","timeZoneId":"Europe/Paris"}""");
        using var apiKeyHandler = new GoogleTimeZoneApiKeyHandler(options) { InnerHandler = transport };
        using var http = new HttpClient(apiKeyHandler);
        var google = new GoogleEventLocationProvider(http, options);

        var resolved = await google.ResolveAsync("google-place", "session", "fr", CancellationToken.None);

        Assert.Equal("10 Rue de la République", resolved.StreetAddress);
        Assert.Equal(city, resolved.City);
        Assert.Equal("France", resolved.Country);
        Assert.Equal("Auvergne-Rhône-Alpes", resolved.Region);
    }

    private Task<HttpResponseMessage> GetAsync(string url)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Add("X-Test-User", UserId.ToString("D"));
        request.Headers.Add("X-Test-Roles", "User");
        return client.SendAsync(request);
    }

    private Task<HttpResponseMessage> PostAsync(string url, object body)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(body) };
        request.Headers.Add("X-Test-User", UserId.ToString("D"));
        request.Headers.Add("X-Test-Roles", "User");
        return client.SendAsync(request);
    }

    private static ConfigurationManager Configuration(Dictionary<string, string?>? values = null)
    {
        var configuration = new ConfigurationManager();
        configuration.AddInMemoryCollection(values ?? new Dictionary<string, string?>
        {
            ["GONES_AUTH_SIGNING_KEY"] = "event-location-test-signing-key-with-more-than-32-characters"
        });
        return configuration;
    }

    private sealed class StubEventLocationProvider : IEventLocationProvider
    {
        public IReadOnlyList<EventLocationSuggestion> Suggestions { get; set; } =
        [
            new("google-place", "10 Rue de la République", "69001 Lyon, France")
        ];
        public ResolvedEventLocation Resolved { get; set; } = new(
            "google-place",
            "10 Rue de la République",
            "69001",
            "Lyon",
            "France",
            "Auvergne-Rhône-Alpes",
            45.7640m,
            4.8357m,
            "Europe/Paris");
        public bool Unavailable { get; set; }
        public (string Input, string SessionToken, string Language) LastAutocomplete { get; private set; }
        public (string PlaceId, string SessionToken, string Language) LastResolve { get; private set; }

        public Task<IReadOnlyList<EventLocationSuggestion>> AutocompleteAsync(string input, string sessionToken, string language, CancellationToken cancellationToken)
        {
            if (Unavailable) throw new EventLocationProviderUnavailableException();
            LastAutocomplete = (input, sessionToken, language);
            return Task.FromResult(Suggestions);
        }

        public Task<ResolvedEventLocation> ResolveAsync(string placeId, string sessionToken, string language, CancellationToken cancellationToken)
        {
            if (Unavailable) throw new EventLocationProviderUnavailableException();
            LastResolve = (placeId, sessionToken, language);
            return Task.FromResult(Resolved with { PlaceId = placeId });
        }
    }

    private sealed class GoogleLocationResponseHandler(string details, string timeZone) : HttpMessageHandler
    {
        private int index;

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = index++ == 0 ? details : timeZone;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json")
            });
        }
    }
}
