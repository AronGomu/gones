using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Gones.Infrastructure.EventProviders;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace Gones.Api.Health;

public sealed class EventImageStorageHealthCheck(IAmazonS3 client, EventImageStorageOptions options) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            _ = await client.ListObjectsV2Async(new ListObjectsV2Request
            {
                BucketName = options.Bucket,
                MaxKeys = 1
            }, cancellationToken);
            return HealthCheckResult.Healthy("Event image storage is ready.", new Dictionary<string, object>
            {
                ["bucket"] = options.Bucket
            });
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return Unavailable();
        }
        catch (AmazonServiceException)
        {
            return Unavailable();
        }
        catch (AmazonClientException)
        {
            return Unavailable();
        }
        catch (HttpRequestException)
        {
            return Unavailable();
        }
    }

    private static HealthCheckResult Unavailable() => HealthCheckResult.Unhealthy(
        "Event image storage is unavailable.",
        data: new Dictionary<string, object> { ["code"] = "image_storage_unavailable" });
}
