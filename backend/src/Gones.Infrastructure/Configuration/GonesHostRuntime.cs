using System.Globalization;
using Microsoft.Extensions.Configuration;

namespace Gones.Infrastructure.Configuration;

/// <summary>
/// Vendor-neutral file-based secret injection.
///
/// Every generic container host (Compose, Kubernetes, Nomad, systemd-nspawn, a plain VM) can mount a
/// file; only some can inject an environment variable without it leaking into <c>/proc</c> and crash
/// dumps. Each supported key therefore accepts <c>&lt;KEY&gt;</c> or <c>&lt;KEY&gt;_FILE</c>, never both.
///
/// The list is deliberately closed: a generic "any key from any file" resolver would turn an
/// attacker-controlled environment variable into an arbitrary file read.
/// </summary>
public static class GonesSecretFiles
{
    public const string FileSuffix = "_FILE";

    public const string GoogleMapsApiKey = "GONES_GOOGLE_MAPS_API_KEY";
    public const string EventImagesS3AccessConfigName = "GONES_EVENT_IMAGES_S3_ACCESS_KEY";
    public const string EventImagesS3PrivateConfigName = "GONES_EVENT_IMAGES_S3_SECRET_KEY";

    /// <summary>
    /// Secrets whose only reader is the generic loader. Keys with bespoke <c>_FILE</c> handling
    /// (OAuth client secrets, the Brevo API key, the Brevo webhook token) stay with their owner.
    /// Google Maps deliberately differs from the older exclusive pairs: its file value wins over a
    /// direct environment value so a mounted production secret cannot be shadowed by stale process config.
    /// </summary>
    public static readonly IReadOnlyList<string> SupportedKeys =
    [
        "GONES_DB_CONNECTION",
        "GONES_AUTH_SIGNING_KEY",
        GoogleMapsApiKey,
        EventImagesS3AccessConfigName,
        EventImagesS3PrivateConfigName
    ];

    private static readonly IReadOnlySet<string> FilePrecedenceKeys = new HashSet<string>(StringComparer.Ordinal)
    {
        GoogleMapsApiKey,
        EventImagesS3AccessConfigName,
        EventImagesS3PrivateConfigName
    };

    private static readonly IReadOnlySet<string> AbsolutePathKeys = new HashSet<string>(FilePrecedenceKeys, StringComparer.Ordinal);

    /// <summary>Reads every configured secret file. Throws before startup completes on any ambiguity.</summary>
    public static Dictionary<string, string?> Resolve(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        var resolved = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        foreach (var key in SupportedKeys)
        {
            var fileKey = key + FileSuffix;
            var path = configuration[fileKey];
            if (string.IsNullOrWhiteSpace(path)) continue;
            path = path.Trim();
            if (AbsolutePathKeys.Contains(key) && !Path.IsPathRooted(path))
            {
                throw new InvalidOperationException($"{fileKey} must be an absolute path.");
            }
            if (!FilePrecedenceKeys.Contains(key) && !string.IsNullOrWhiteSpace(configuration[key]))
            {
                throw new InvalidOperationException($"Configure only one of {key} or {fileKey}.");
            }

            string secret;
            try
            {
                secret = File.ReadAllText(path).Trim();
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
            {
                throw new InvalidOperationException($"{fileKey} could not be read.", exception);
            }

            if (secret.Length == 0) throw new InvalidOperationException($"{fileKey} points to an empty secret file.");
            resolved[key] = secret;
        }

        return resolved;
    }

    /// <summary>Layers the resolved secrets over the host's own configuration sources.</summary>
    public static IConfigurationManager AddGonesSecretFiles(this IConfigurationManager configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        var resolved = Resolve(configuration);
        if (resolved.Count > 0) configuration.AddInMemoryCollection(resolved);
        return configuration;
    }
}

/// <summary>Process-level runtime knobs every Gones container honours, whoever the host is.</summary>
public static class GonesHostRuntime
{
    public const string ShutdownTimeoutKey = "GONES_SHUTDOWN_TIMEOUT_SECONDS";

    /// <summary>
    /// How long the host drains in-flight work after SIGTERM. Must stay below the orchestrator's own
    /// kill grace period, so the ceiling is deliberately low.
    /// </summary>
    public static TimeSpan LoadShutdownTimeout(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        var raw = configuration[ShutdownTimeoutKey];
        if (string.IsNullOrWhiteSpace(raw)) return TimeSpan.FromSeconds(25);
        if (!int.TryParse(raw, NumberStyles.None, CultureInfo.InvariantCulture, out var seconds) || seconds is < 1 or > 300)
        {
            throw new InvalidOperationException($"{ShutdownTimeoutKey} must be an integer between 1 and 300.");
        }
        return TimeSpan.FromSeconds(seconds);
    }
}
