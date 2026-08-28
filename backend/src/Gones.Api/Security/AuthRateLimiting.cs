using System.Text;
using Gones.Api.Errors;
using Gones.Api.Identity;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Observability;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.DependencyInjection;
using NodaTime;
using System.Threading.RateLimiting;

namespace Gones.Api.Security;

internal interface IAuthRateLimitRequest
{
    string RateLimitAccount { get; }
}

/// <summary>
/// Locked V1 endpoint rate policies. Every limit below is enforced in-process by ASP.NET.
/// Deployment-edge (ingress / CDN / global) limiters are a deferred requirement documented in
/// <c>docs/adr/0017-application-rate-limits-with-deferred-edge-limiter.md</c>; no vendor configuration ships in V1.
/// </summary>
public sealed record RateLimitSettings(
    int AuthPermitLimit,
    int RefreshPermitLimit,
    int PublicReadPermitLimit,
    int WritePermitLimit,
    int AuthenticatedReadPermitLimit,
    int RegistrationPermitLimit,
    int ExportPermitLimit,
    int AdminPermitLimit)
{
    public const string AuthKey = "GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT";
    public const string RefreshKey = "GONES_RATE_LIMIT_REFRESH_PERMIT_LIMIT";
    public const string PublicReadKey = "GONES_RATE_LIMIT_PUBLIC_READ_PERMIT_LIMIT";
    public const string WriteKey = "GONES_RATE_LIMIT_WRITE_PERMIT_LIMIT";
    public const string AuthenticatedReadKey = "GONES_RATE_LIMIT_AUTHENTICATED_READ_PERMIT_LIMIT";
    public const string RegistrationKey = "GONES_RATE_LIMIT_REGISTRATION_PERMIT_LIMIT";
    public const string ExportKey = "GONES_RATE_LIMIT_EXPORT_PERMIT_LIMIT";
    public const string AdminKey = "GONES_RATE_LIMIT_ADMIN_PERMIT_LIMIT";

    public static RateLimitSettings Defaults { get; } = new(
        AuthRateLimiting.PermitLimit,
        AuthRateLimiting.RefreshPermitLimit,
        AuthRateLimiting.PublicReadPermitLimit,
        AuthRateLimiting.WritePermitLimit,
        AuthRateLimiting.AuthenticatedReadPermitLimit,
        AuthRateLimiting.RegistrationPermitLimit,
        AuthRateLimiting.ExportPermitLimit,
        AuthRateLimiting.AdminPermitLimit);

    /// <summary>Volume-shaped buckets are relaxed for Development/Testing so local suites are not throttled; explicit configuration still wins.</summary>
    public const int RelaxedPermitLimit = 1_000_000;

    public static RateLimitSettings Load(IConfiguration configuration, bool relaxedDefaults = false)
    {
        var fallback = relaxedDefaults
            ? Defaults with
            {
                RefreshPermitLimit = RelaxedPermitLimit,
                PublicReadPermitLimit = RelaxedPermitLimit,
                WritePermitLimit = RelaxedPermitLimit,
                AuthenticatedReadPermitLimit = RelaxedPermitLimit,
                AdminPermitLimit = RelaxedPermitLimit
            }
            : Defaults;
        return new RateLimitSettings(
            Read(configuration, AuthKey, fallback.AuthPermitLimit),
            Read(configuration, RefreshKey, fallback.RefreshPermitLimit),
            Read(configuration, PublicReadKey, fallback.PublicReadPermitLimit),
            Read(configuration, WriteKey, fallback.WritePermitLimit),
            Read(configuration, AuthenticatedReadKey, fallback.AuthenticatedReadPermitLimit),
            Read(configuration, RegistrationKey, fallback.RegistrationPermitLimit),
            Read(configuration, ExportKey, fallback.ExportPermitLimit),
            Read(configuration, AdminKey, fallback.AdminPermitLimit));
    }

    private static int Read(IConfiguration configuration, string key, int fallback) =>
        int.TryParse(configuration[key], out var parsed) && parsed > 0 ? parsed : fallback;
}

public static class AuthRateLimiting
{
    public const string IpPolicy = "auth-ip";
    public const string RefreshPolicy = "refresh-session";
    public const string PublicReadPolicy = "public-read-ip";
    public const string WritePolicy = "write-user";
    public const string RegistrationPolicy = "registration-user";
    public const string ExportPolicy = "export-user-ip";
    public const string AdminPolicy = "admin-user";

    /// <summary>auth register/login/resend/reset: 5 per 15 minutes, per IP and per account.</summary>
    public const int PermitLimit = 5;
    /// <summary>refresh: 30 per 15 minutes, per refresh session.</summary>
    public const int RefreshPermitLimit = 30;
    /// <summary>public reads: 120 per minute, per IP.</summary>
    public const int PublicReadPermitLimit = 120;
    /// <summary>authenticated writes: 30 per minute, per user.</summary>
    public const int WritePermitLimit = 30;
    /// <summary>authenticated reads: 120 per minute, per user.</summary>
    public const int AuthenticatedReadPermitLimit = 120;
    /// <summary>tournament registration writes: 10 per minute, per user.</summary>
    public const int RegistrationPermitLimit = 10;
    /// <summary>exports: 10 per hour, per user and IP.</summary>
    public const int ExportPermitLimit = 10;
    /// <summary>admin surface: 60 per minute, per user.</summary>
    public const int AdminPermitLimit = 60;

    public static readonly TimeSpan Window = TimeSpan.FromMinutes(15);
    public static readonly TimeSpan RefreshWindow = TimeSpan.FromMinutes(15);
    public static readonly TimeSpan PublicReadWindow = TimeSpan.FromMinutes(1);
    public static readonly TimeSpan WriteWindow = TimeSpan.FromMinutes(1);
    public static readonly TimeSpan AuthenticatedReadWindow = TimeSpan.FromMinutes(1);
    public static readonly TimeSpan RegistrationWindow = TimeSpan.FromMinutes(1);
    public static readonly TimeSpan ExportWindow = TimeSpan.FromHours(1);
    public static readonly TimeSpan AdminWindow = TimeSpan.FromMinutes(1);

    public static IServiceCollection AddGonesAuthRateLimiting(this IServiceCollection services, int permitLimit = PermitLimit) =>
        services.AddGonesAuthRateLimiting(RateLimitSettings.Defaults with { AuthPermitLimit = permitLimit });

    public static IServiceCollection AddGonesAuthRateLimiting(this IServiceCollection services, RateLimitSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        if (settings.AuthPermitLimit <= 0) throw new ArgumentOutOfRangeException(nameof(settings));
        services.AddSingleton(settings);
        services.AddSingleton(new AuthAccountRateLimiter(settings.AuthPermitLimit));
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.OnRejected = async (context, cancellationToken) =>
            {
                var operation = Operation(RouteKey(context.HttpContext));
                context.HttpContext.RequestServices.GetRequiredService<OperationalMetrics>().RecordAuthRejection(operation);
                if (ShouldAuditRejection(context.HttpContext.Request.Path))
                {
                    await WriteRateLimitAuditAsync(context.HttpContext.RequestServices, operation, cancellationToken);
                }

                context.HttpContext.Response.Headers.RetryAfter = context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter)
                    ? Math.Max(1, Math.Ceiling(retryAfter.TotalSeconds)).ToString(System.Globalization.CultureInfo.InvariantCulture)
                    : ((int)Window.TotalSeconds).ToString(System.Globalization.CultureInfo.InvariantCulture);
            };

            // Global limiter: covers every /api surface without per-endpoint opt-in, so a new route
            // cannot silently ship unlimited. Endpoint policies below stack on top of it.
            options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
            {
                if (!context.Request.Path.StartsWithSegments("/api")) return RateLimitPartition.GetNoLimiter("unlimited");
                var isRead = HttpMethods.IsGet(context.Request.Method) || HttpMethods.IsHead(context.Request.Method);
                var user = UserKey(context);
                if (context.Request.Path.StartsWithSegments("/api/admin") && user is not null)
                {
                    return RateLimitPartition.GetFixedWindowLimiter(
                        TelemetryRedaction.HashRateLimitKey($"admin:{user}"),
                        _ => NewWindowOptions(settings.AdminPermitLimit, AdminWindow));
                }

                if (isRead && user is null)
                {
                    return RateLimitPartition.GetFixedWindowLimiter(
                        TelemetryRedaction.HashRateLimitKey($"public-read:{ClientKey(context)}"),
                        _ => NewWindowOptions(settings.PublicReadPermitLimit, PublicReadWindow));
                }

                if (isRead && user is not null)
                {
                    return RateLimitPartition.GetFixedWindowLimiter(
                        TelemetryRedaction.HashRateLimitKey($"authenticated-read:{user}"),
                        _ => NewWindowOptions(settings.AuthenticatedReadPermitLimit, AuthenticatedReadWindow));
                }

                if (!isRead && user is not null)
                {
                    return RateLimitPartition.GetFixedWindowLimiter(
                        TelemetryRedaction.HashRateLimitKey($"write:{user}"),
                        _ => NewWindowOptions(settings.WritePermitLimit, WriteWindow));
                }

                return RateLimitPartition.GetNoLimiter("unlimited");
            });

            options.AddPolicy(IpPolicy, context => RateLimitPartition.GetFixedWindowLimiter(
                TelemetryRedaction.HashRateLimitKey($"{RouteKey(context)}:{ClientKey(context)}"),
                _ => NewWindowOptions(settings.AuthPermitLimit, Window)));
            options.AddPolicy(RefreshPolicy, context => RateLimitPartition.GetFixedWindowLimiter(
                TelemetryRedaction.HashRateLimitKey($"refresh:{context.Request.Cookies[RefreshCookie.Name] ?? ClientKey(context)}"),
                _ => NewWindowOptions(settings.RefreshPermitLimit, RefreshWindow)));
            options.AddPolicy(PublicReadPolicy, context => RateLimitPartition.GetFixedWindowLimiter(
                TelemetryRedaction.HashRateLimitKey($"public-read:{ClientKey(context)}"),
                _ => NewWindowOptions(settings.PublicReadPermitLimit, PublicReadWindow)));
            options.AddPolicy(WritePolicy, context => RateLimitPartition.GetFixedWindowLimiter(
                TelemetryRedaction.HashRateLimitKey($"write:{UserKey(context) ?? ClientKey(context)}"),
                _ => NewWindowOptions(settings.WritePermitLimit, WriteWindow)));
            options.AddPolicy(RegistrationPolicy, context => RateLimitPartition.GetFixedWindowLimiter(
                TelemetryRedaction.HashRateLimitKey($"registration:{UserKey(context) ?? "unknown"}"),
                _ => NewWindowOptions(settings.RegistrationPermitLimit, RegistrationWindow)));
            options.AddPolicy(ExportPolicy, context => RateLimitPartition.GetFixedWindowLimiter(
                TelemetryRedaction.HashRateLimitKey($"export:{UserKey(context) ?? "unknown"}:{ClientKey(context)}"),
                _ => NewWindowOptions(settings.ExportPermitLimit, ExportWindow)));
            options.AddPolicy(AdminPolicy, context => RateLimitPartition.GetFixedWindowLimiter(
                TelemetryRedaction.HashRateLimitKey($"admin:{UserKey(context) ?? ClientKey(context)}"),
                _ => NewWindowOptions(settings.AdminPermitLimit, AdminWindow)));
        });
        return services;
    }

    internal static string ClientKey(HttpContext context) => context.Connection.RemoteIpAddress?.ToString() ?? "unknown";

    internal static string? UserKey(HttpContext context) =>
        context.User.FindFirst("sub")?.Value
        ?? context.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;

    /// <summary>
    /// The matched route <em>pattern</em>, falling back to the raw path when routing has not run.
    ///
    /// Every route this file buckets by path used to be a constant, so the two were the same string.
    /// T17's review link is not: its token sits in the path. Keyed by the raw path, each guessed token
    /// would get a private bucket and the limiter would never fire — and the token would end up in a
    /// metric label and a rate-limit audit row. The pattern (<c>…/by-token/{token}</c>) is stable and
    /// carries no secret, so it is what buckets and labels use.
    /// </summary>
    internal static string RouteKey(HttpContext context) =>
        (context.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText
        ?? context.Request.Path.Value
        ?? "/";

    internal static string Operation(PathString path) => Operation(path.Value);

    internal static string Operation(string? route) =>
        route?.Split('/', StringSplitOptions.RemoveEmptyEntries).LastOrDefault()?.Replace("-", "_", StringComparison.Ordinal)
        ?? "auth";

    internal static FixedWindowRateLimiterOptions NewWindowOptions(int permitLimit) => NewWindowOptions(permitLimit, Window);

    internal static FixedWindowRateLimiterOptions NewWindowOptions(int permitLimit, TimeSpan window) => new()
    {
        AutoReplenishment = true,
        PermitLimit = permitLimit,
        QueueLimit = 0,
        Window = window
    };

    /// <summary>Only the auth surface earns a durable rejection audit row (ADR 0017: best-effort, auth-value partitions only).</summary>
    internal static bool ShouldAuditRejection(PathString path) => path.StartsWithSegments("/api/auth");

    internal static async Task WriteRateLimitAuditAsync(IServiceProvider services, string operation, CancellationToken cancellationToken)
    {
        // Best-effort per ADR 0017: a rejection must return 429 even when persistence is down or absent.
        var database = services.GetService<GonesDbContext>();
        if (database is null) return;
        try
        {
            var clock = services.GetRequiredService<IClock>();
            database.AuditRecords.Add(new AuditRecord
            {
                Action = $"auth.{operation}.rate_limited",
                EntityType = "user",
                EntityId = "unknown",
                RedactedDiff = "{\"outcome\":\"rate_limited\"}",
                OccurredAt = clock.GetCurrentInstant()
            });
            await database.SaveChangesAsync(cancellationToken);
        }
        catch (Exception exception)
        {
            services.GetService<ILoggerFactory>()
                ?.CreateLogger("Gones.Api.Security.AuthRateLimiting")
                .LogWarning(exception, "Rate-limit audit write failed for operation {Operation}; rejection still returned", operation);
        }
    }
}

public sealed class AuthAccountRateLimiter : IDisposable
{
    private readonly PartitionedRateLimiter<string> limiter;

    public AuthAccountRateLimiter(int permitLimit)
    {
        limiter = PartitionedRateLimiter.Create<string, string>(accountHash =>
            RateLimitPartition.GetFixedWindowLimiter(accountHash, _ => AuthRateLimiting.NewWindowOptions(permitLimit)));
    }

    public async ValueTask<bool> TryAcquireAsync(string operation, string account, CancellationToken cancellationToken)
    {
        var normalizedAccount = account.Trim().Normalize(NormalizationForm.FormKC).ToUpperInvariant();
        var accountHash = TelemetryRedaction.HashRateLimitKey($"{operation}:{normalizedAccount}");
        using var lease = await limiter.AcquireAsync(accountHash, 1, cancellationToken);
        return lease.IsAcquired;
    }

    public void Dispose() => limiter.Dispose();
}

public sealed class AuthAccountRateLimitFilter(AuthAccountRateLimiter limiter, OperationalMetrics metrics) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var request = context.Arguments.OfType<IAuthRateLimitRequest>().Single();
        var operation = AuthRateLimiting.Operation(context.HttpContext.Request.Path);
        if (!await limiter.TryAcquireAsync(operation, request.RateLimitAccount, context.HttpContext.RequestAborted))
        {
            metrics.RecordAuthRejection(operation);
            await AuthRateLimiting.WriteRateLimitAuditAsync(context.HttpContext.RequestServices, operation, context.HttpContext.RequestAborted);
            context.HttpContext.Response.Headers.RetryAfter = ((int)AuthRateLimiting.Window.TotalSeconds).ToString(System.Globalization.CultureInfo.InvariantCulture);
            throw new RateLimitExceededException();
        }
        return await next(context);
    }
}
