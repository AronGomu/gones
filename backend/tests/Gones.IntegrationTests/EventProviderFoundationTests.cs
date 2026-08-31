using System.Net;
using System.Text;
using System.Text.Json;
using Amazon.S3;
using Gones.Api.Errors;
using Gones.Api.Health;
using Gones.Application.Events;
using Gones.Infrastructure.Configuration;
using Gones.Infrastructure.EventProviders;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Logging.Abstractions;

namespace Gones.IntegrationTests;

public sealed class EventProviderFoundationTests
{
    [Fact]
    public void Google_secret_file_wins_over_environment_without_leaking_diagnostics()
    {
        var secretFile = Path.GetTempFileName();
        try
        {
            File.WriteAllText(secretFile, "file-owned-google-key\n");
            var configuration = Build(new()
            {
                [GoogleMapsOptions.ApiKeyKey] = "environment-google-key",
                [GoogleMapsOptions.ApiKeyFileKey] = secretFile
            });

            configuration.AddGonesSecretFiles();
            var options = GoogleMapsOptions.Load(configuration);

            Assert.Equal("file-owned-google-key", options.ApiKey);
            Assert.DoesNotContain("file-owned-google-key", options.ToString(), StringComparison.Ordinal);
            Assert.DoesNotContain("environment-google-key", options.ToString(), StringComparison.Ordinal);
        }
        finally
        {
            File.Delete(secretFile);
        }
    }

    [Fact]
    public async Task Missing_Google_key_keeps_API_live_and_provider_operation_is_unavailable()
    {
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting(GoogleMapsOptions.ApiKeyKey, string.Empty);
            builder.UseSetting(GoogleMapsOptions.ApiKeyFileKey, string.Empty);
            builder.UseSetting(EventImageStorageOptions.EndpointKey, string.Empty);
        });
        using var client = factory.CreateClient();

        using var live = await client.GetAsync("/health/live");
        var provider = factory.Services.GetRequiredService<IEventLocationProvider>();
        var exception = await Assert.ThrowsAsync<EventLocationProviderUnavailableException>(() =>
            provider.AutocompleteAsync("Lyon", "session", "fr", CancellationToken.None));

        Assert.Equal(HttpStatusCode.OK, live.StatusCode);
        await AssertProblemAsync(exception, "location_provider_unavailable");
    }

    [Fact]
    public async Task Configured_unreachable_S3_is_unhealthy_without_secret_output()
    {
        var accessFile = Path.GetTempFileName();
        var secretFile = Path.GetTempFileName();
        try
        {
            File.WriteAllText(accessFile, "local-access-key\n");
            File.WriteAllText(secretFile, "local-secret-key\n");
            var configuration = Build(new()
            {
                [EventImageStorageOptions.EndpointKey] = "http://127.0.0.1:1",
                [EventImageStorageOptions.BucketKey] = "gones-event-images",
                [EventImageStorageOptions.RegionKey] = "us-east-1",
                [EventImageStorageOptions.AccessKeyFileKey] = accessFile,
                [EventImageStorageOptions.SecretKeyFileKey] = secretFile
            });
            configuration.AddGonesSecretFiles();
            var services = new ServiceCollection();
            services.AddLogging();
            var registrations = services.AddEventProviderFoundations(configuration);
            await using var provider = services.BuildServiceProvider();
            var check = new EventImageStorageHealthCheck(
                provider.GetRequiredService<IAmazonS3>(),
                Assert.IsType<EventImageStorageOptions>(registrations.ImageStorage));

            var result = await check.CheckHealthAsync(new HealthCheckContext(), CancellationToken.None);
            var diagnostic = JsonSerializer.Serialize(new { result.Status, result.Description, result.Data, registrations.ImageStorage });

            Assert.Equal(HealthStatus.Unhealthy, result.Status);
            Assert.Equal("image_storage_unavailable", result.Data["code"]);
            Assert.DoesNotContain("local-access-key", diagnostic, StringComparison.Ordinal);
            Assert.DoesNotContain("local-secret-key", diagnostic, StringComparison.Ordinal);
        }
        finally
        {
            File.Delete(accessFile);
            File.Delete(secretFile);
        }
    }

    [Fact]
    public async Task Fake_providers_are_deterministic_and_never_use_network()
    {
        var locations = new FakeEventLocationProvider();
        var first = await locations.AutocompleteAsync("Lyon", "session-one", "fr", CancellationToken.None);
        var second = await locations.AutocompleteAsync("Lyon", "session-two", "en", CancellationToken.None);
        var resolved = await locations.ResolveAsync(first.Single().PlaceId, "session-three", "fr", CancellationToken.None);
        var objects = new InMemoryEventImageObjectStore();
        var bytes = new byte[] { 3, 1, 4, 1, 5 };
        await using var source = new MemoryStream(bytes);

        await objects.PutAsync("events/test/original", source, "image/webp", CancellationToken.None);
        await using var opened = await objects.OpenReadAsync("events/test/original", CancellationToken.None);
        using var copied = new MemoryStream();
        await opened.CopyToAsync(copied);

        Assert.Equal(first, second);
        Assert.Equal(first.Single().PlaceId, resolved.PlaceId);
        Assert.Equal("Europe/Paris", resolved.TimeZoneId);
        Assert.Equal(bytes, copied.ToArray());
    }

    [Fact]
    public async Task Google_adapter_uses_header_for_Places_and_late_query_auth_for_Time_Zone()
    {
        var configuration = Build(new() { [GoogleMapsOptions.ApiKeyKey] = "test-google-key" });
        var options = GoogleMapsOptions.Load(configuration);
        var transport = new ProviderResponseHandler(
            """
            {"suggestions":[{"placePrediction":{"placeId":"google-place","structuredFormat":{"mainText":{"text":"10 Rue de la République"},"secondaryText":{"text":"69001 Lyon, France"}}}}]}
            """,
            """
            {"id":"google-place","formattedAddress":"10 Rue de la République, 69001 Lyon, France","addressComponents":[{"longText":"10","types":["street_number"]},{"longText":"Rue de la République","types":["route"]},{"longText":"69001","types":["postal_code"]},{"longText":"Lyon","types":["locality"]},{"longText":"France","types":["country"]},{"longText":"Auvergne-Rhône-Alpes","types":["administrative_area_level_1"]}],"location":{"latitude":45.7640,"longitude":4.8357}}
            """,
            """
            {"status":"OK","timeZoneId":"Europe/Paris"}
            """);
        using var apiKeyHandler = new GoogleTimeZoneApiKeyHandler(options) { InnerHandler = transport };
        using var client = new HttpClient(apiKeyHandler);
        var provider = new GoogleEventLocationProvider(client, options);

        var suggestions = await provider.AutocompleteAsync("Lyon", "session", "fr", CancellationToken.None);
        var resolved = await provider.ResolveAsync("google-place", "session", "fr", CancellationToken.None);

        Assert.Equal("google-place", suggestions.Single().PlaceId);
        Assert.Equal("10 Rue de la République", resolved.StreetAddress);
        Assert.Equal("69001", resolved.PostalCode);
        Assert.Equal("Europe/Paris", resolved.TimeZoneId);
        Assert.Equal(3, transport.Requests.Count);
        Assert.All(transport.Requests.Take(2), request =>
        {
            Assert.Equal("test-google-key", request.ApiKey);
            Assert.DoesNotContain("test-google-key", request.Uri, StringComparison.Ordinal);
        });
        Assert.Equal("test-google-key", transport.Requests[2].ApiKey);
        Assert.Contains("key=test-google-key", transport.Requests[2].Uri, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Provider_failures_share_RFC_7807_service_unavailable_catalog()
    {
        await AssertProblemAsync(new EventLocationProviderUnavailableException(), "location_provider_unavailable");
        await AssertProblemAsync(new EventImageStorageUnavailableException(), "image_storage_unavailable");
    }

    private static async Task AssertProblemAsync(Exception exception, string expectedCode)
    {
        var context = new DefaultHttpContext();
        context.Response.Body = new MemoryStream();
        var handler = new ApiExceptionHandler(NullLogger<ApiExceptionHandler>.Instance);

        Assert.True(await handler.TryHandleAsync(context, exception, CancellationToken.None));
        context.Response.Body.Position = 0;
        using var problem = await JsonDocument.ParseAsync(context.Response.Body);

        Assert.Equal(StatusCodes.Status503ServiceUnavailable, context.Response.StatusCode);
        Assert.Equal($"urn:gones:problem:{expectedCode}", problem.RootElement.GetProperty("type").GetString());
        Assert.Equal(expectedCode, problem.RootElement.GetProperty("code").GetString());
    }

    private static ConfigurationManager Build(Dictionary<string, string?> values)
    {
        var configuration = new ConfigurationManager();
        configuration.AddInMemoryCollection(values);
        return configuration;
    }

    private sealed class ProviderResponseHandler(params string[] responses) : HttpMessageHandler
    {
        private int index;
        public List<ObservedRequest> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var uri = request.RequestUri!.ToString();
            var apiKey = request.Headers.TryGetValues("X-Goog-Api-Key", out var values)
                ? values.Single()
                : Uri.UnescapeDataString(uri[(uri.IndexOf("key=", StringComparison.Ordinal) + 4)..].Split('&')[0]);
            Requests.Add(new ObservedRequest(uri, apiKey));
            var response = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(responses[index++], Encoding.UTF8, "application/json")
            };
            return Task.FromResult(response);
        }
    }

    private sealed record ObservedRequest(string Uri, string ApiKey);
}
