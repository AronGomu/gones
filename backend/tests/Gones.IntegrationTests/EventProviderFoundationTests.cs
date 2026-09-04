using System.Net;
using System.Text.Json;
using Amazon.S3;
using Gones.Api.Errors;
using Gones.Api.Health;
using Gones.Application.Events;
using Gones.Infrastructure.Configuration;
using Gones.Infrastructure.EventProviders;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Logging.Abstractions;

namespace Gones.IntegrationTests;

public sealed class EventProviderFoundationTests
{
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
    public async Task In_memory_event_image_store_is_deterministic_and_never_uses_network()
    {
        var objects = new InMemoryEventImageObjectStore();
        var bytes = new byte[] { 3, 1, 4, 1, 5 };
        await using var source = new MemoryStream(bytes);

        await objects.PutAsync("events/test/original", source, "image/webp", CancellationToken.None);
        await using var opened = await objects.OpenReadAsync("events/test/original", CancellationToken.None);
        using var copied = new MemoryStream();
        await opened.CopyToAsync(copied);

        Assert.Equal(bytes, copied.ToArray());
    }

    [Fact]
    public async Task Image_provider_failures_use_RFC_7807_service_unavailable_catalog()
    {
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
}
