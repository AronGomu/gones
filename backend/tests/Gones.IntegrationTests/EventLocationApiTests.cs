using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Gones.Domain.Calendar;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using NodaTime;

namespace Gones.IntegrationTests;

public sealed class EventLocationApiTests
{
    [Fact]
    public async Task Time_zone_catalog_is_anonymous_sorted_unique_and_matches_TZDB()
    {
        await using var factory = CreateFactory();
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/api/event-locations/time-zones");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var ids = body.GetProperty("ids").EnumerateArray().Select(item => item.GetString()!).ToArray();
        var expected = DateTimeZoneProviders.Tzdb.Ids.Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(expected, ids);
    }

    [Fact]
    public async Task Autocomplete_and_resolve_routes_are_removed()
    {
        await using var factory = CreateFactory();
        using var client = factory.CreateClient();

        using var autocomplete = await client.GetAsync("/api/event-locations/autocomplete?input=Paris&sessionToken=640ec8a3-55f2-4a29-b8b6-b62c9fc3e46d&language=fr");
        using var resolve = await client.PostAsJsonAsync("/api/event-locations/resolve", new
        {
            placeId = "google-place",
            sessionToken = "640ec8a3-55f2-4a29-b8b6-b62c9fc3e46d",
            language = "en"
        });

        Assert.Equal(HttpStatusCode.NotFound, autocomplete.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, resolve.StatusCode);
    }

    [Fact]
    public void Event_domain_has_no_provider_identity_or_coordinates()
    {
        var propertyNames = typeof(Event).GetProperties().Select(property => property.Name).ToArray();

        Assert.DoesNotContain("ProviderPlaceId", propertyNames);
        Assert.DoesNotContain("Latitude", propertyNames);
        Assert.DoesNotContain("Longitude", propertyNames);
    }

    private static WebApplicationFactory<Program> CreateFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", string.Empty);
        });
}
