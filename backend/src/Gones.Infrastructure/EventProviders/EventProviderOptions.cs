using Gones.Infrastructure.Configuration;
using Microsoft.Extensions.Configuration;

namespace Gones.Infrastructure.EventProviders;

public sealed class GoogleMapsOptions
{
    public const string ApiKeyKey = GonesSecretFiles.GoogleMapsApiKey;
    public const string ApiKeyFileKey = ApiKeyKey + GonesSecretFiles.FileSuffix;

    private GoogleMapsOptions(string? apiKey) => ApiKey = apiKey;

    public string? ApiKey { get; }
    public bool IsConfigured => !string.IsNullOrWhiteSpace(ApiKey);

    public static GoogleMapsOptions Load(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        var apiKey = configuration[ApiKeyKey];
        return new GoogleMapsOptions(string.IsNullOrWhiteSpace(apiKey) ? null : apiKey.Trim());
    }

    public override string ToString() => $"GoogleMapsOptions {{ IsConfigured = {IsConfigured}, ApiKey = [redacted] }}";
}

public sealed class EventImageStorageOptions
{
    public const string EndpointKey = "GONES_EVENT_IMAGES_S3_ENDPOINT";
    public const string BucketKey = "GONES_EVENT_IMAGES_S3_BUCKET";
    public const string RegionKey = "GONES_EVENT_IMAGES_S3_REGION";
    public const string AccessKeyFileKey = GonesSecretFiles.EventImagesS3AccessConfigName + GonesSecretFiles.FileSuffix;
    public const string SecretKeyFileKey = GonesSecretFiles.EventImagesS3PrivateConfigName + GonesSecretFiles.FileSuffix;

    private EventImageStorageOptions(Uri endpoint, string bucket, string region, string accessKey, string secretKey)
    {
        Endpoint = endpoint;
        Bucket = bucket;
        Region = region;
        AccessKey = accessKey;
        SecretKey = secretKey;
    }

    public Uri Endpoint { get; }
    public string Bucket { get; }
    public string Region { get; }
    internal string AccessKey { get; }
    internal string SecretKey { get; }

    public static EventImageStorageOptions? TryLoad(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        var endpointText = configuration[EndpointKey];
        var bucket = configuration[BucketKey];
        var region = configuration[RegionKey];
        var accessFile = configuration[AccessKeyFileKey];
        var secretFile = configuration[SecretKeyFileKey];
        if (new[] { endpointText, bucket, region, accessFile, secretFile }.All(string.IsNullOrWhiteSpace)) return null;

        if (!Uri.TryCreate(endpointText?.Trim(), UriKind.Absolute, out var endpoint)
            || !(string.Equals(endpoint.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase)
                || string.Equals(endpoint.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
            || !string.IsNullOrEmpty(endpoint.UserInfo)
            || !string.IsNullOrEmpty(endpoint.Query)
            || !string.IsNullOrEmpty(endpoint.Fragment))
        {
            throw new InvalidOperationException($"{EndpointKey} must be an absolute HTTP or HTTPS URI without user information, query, or fragment.");
        }
        bucket = Require(configuration, BucketKey);
        region = Require(configuration, RegionKey);
        _ = Require(configuration, AccessKeyFileKey);
        _ = Require(configuration, SecretKeyFileKey);
        var accessKey = Require(configuration, GonesSecretFiles.EventImagesS3AccessConfigName);
        var secretKey = Require(configuration, GonesSecretFiles.EventImagesS3PrivateConfigName);
        return new EventImageStorageOptions(endpoint, bucket, region, accessKey, secretKey);
    }

    public override string ToString() => $"EventImageStorageOptions {{ Endpoint = {Endpoint}, Bucket = {Bucket}, Region = {Region}, Credentials = [redacted] }}";

    private static string Require(IConfiguration configuration, string key) =>
        !string.IsNullOrWhiteSpace(configuration[key])
            ? configuration[key]!.Trim()
            : throw new InvalidOperationException($"{key} is required when event image storage is configured.");
}
