using System.Diagnostics;
using Gones.Api.Errors;
using Gones.Application.Events;
using Gones.Infrastructure.Observability;

namespace Gones.Api.Security;

public sealed class ApiBoundaryMiddleware(RequestDelegate next, ILogger<ApiBoundaryMiddleware> logger, OperationalMetrics metrics)
{
    public const long MaxApiRequestBodySize = 1_048_576;

    public async Task InvokeAsync(HttpContext context)
    {
        var correlationId = context.Request.Headers.TryGetValue("X-Correlation-ID", out var supplied)
            && Guid.TryParse(supplied.ToString(), out var parsed)
                ? parsed.ToString("D")
                : Guid.NewGuid().ToString("D");
        context.TraceIdentifier = correlationId;
        Activity.Current?.SetBaggage("gones.correlation_id", correlationId);
        Activity.Current?.SetTag("gones.correlation_id", correlationId);
        context.Response.OnStarting(() =>
        {
            context.Response.Headers["X-Correlation-ID"] = correlationId;
            context.Response.Headers["X-Content-Type-Options"] = "nosniff";
            context.Response.Headers["X-Frame-Options"] = "DENY";
            context.Response.Headers["Referrer-Policy"] = "no-referrer";
            context.Response.Headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
            context.Response.Headers["Permissions-Policy"] = SecurityHeaders.PermissionsPolicy;
            context.Response.Headers["Cross-Origin-Opener-Policy"] = "same-origin";
            context.Response.Headers["Cross-Origin-Resource-Policy"] = "same-site";
            // HSTS is only meaningful (and only legal to emit) over TLS; the deployment edge terminates TLS.
            if (context.Request.IsHttps) context.Response.Headers["Strict-Transport-Security"] = SecurityHeaders.StrictTransportSecurity;
            if (context.Request.Path.StartsWithSegments("/api") && string.IsNullOrWhiteSpace(context.Response.Headers.CacheControl)) context.Response.Headers.CacheControl = "no-store";
            return Task.CompletedTask;
        });

        using var scope = logger.BeginScope(new Dictionary<string, object> { ["CorrelationId"] = correlationId });
        var stopwatch = Stopwatch.StartNew();
        try
        {
            await next(context);
        }
        finally
        {
            var route = context.GetEndpoint() is RouteEndpoint endpoint ? endpoint.RoutePattern.RawText ?? "(unnamed)" : "(unmatched)";
            if (context.Response.StatusCode >= 500) Activity.Current?.SetStatus(ActivityStatusCode.Error);
            metrics.RecordRequest(stopwatch.Elapsed.TotalSeconds, context.Response.StatusCode, context.Request.Method, route);
            logger.LogInformation(
                ApiLogEvents.RequestCompleted,
                "API boundary completed; Event={Event}; Method={Method}; Route={Route}; StatusCode={StatusCode}; ElapsedMs={ElapsedMs}",
                "api.request.completed",
                context.Request.Method,
                route,
                context.Response.StatusCode,
                stopwatch.Elapsed.TotalMilliseconds);
        }
    }
}

public sealed class ApiRequestSizeMiddleware(RequestDelegate next)
{
    private const long EventImageMultipartOverheadBytes = 64 * 1024;

    public Task InvokeAsync(HttpContext context)
    {
        if (!context.Request.Path.StartsWithSegments("/api")) return next(context);
        var limit = HttpMethods.IsPost(context.Request.Method)
            && context.Request.Path.Equals("/api/event-images", StringComparison.Ordinal)
                ? EventImageUploadLimits.MaximumBytes + EventImageMultipartOverheadBytes
                : ApiBoundaryMiddleware.MaxApiRequestBodySize;
        if (context.Request.ContentLength > limit) throw new RequestBodyTooLargeException();
        context.Request.Body = new LimitedReadStream(context.Request.Body, limit);
        return next(context);
    }

    private sealed class LimitedReadStream(Stream inner, long limit) : Stream
    {
        private long read;
        public override bool CanRead => inner.CanRead;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => read; set => throw new NotSupportedException(); }
        public override void Flush() => inner.Flush();
        public override int Read(byte[] buffer, int offset, int count) => Count(inner.Read(buffer, offset, count));
        public override int Read(Span<byte> buffer) => Count(inner.Read(buffer));
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) => Count(await inner.ReadAsync(buffer, cancellationToken));
        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) => ReadLegacyAsync(buffer, offset, count, cancellationToken);
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        private async Task<int> ReadLegacyAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
            Count(await inner.ReadAsync(buffer.AsMemory(offset, count), cancellationToken));

        private int Count(int count)
        {
            read += count;
            if (read > limit) throw new RequestBodyTooLargeException();
            return count;
        }
    }
}

/// <summary>Single source for the response security headers asserted by <c>ApiBoundaryTests</c> and by the nginx front-end config.</summary>
public static class SecurityHeaders
{
    /// <summary>Denies every powerful browser feature the API and SPA do not use.</summary>
    public const string PermissionsPolicy =
        "accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), screen-wake-lock=(), usb=(), xr-spatial-tracking=()";

    /// <summary>Two years, subdomains included, preload-eligible.</summary>
    public const string StrictTransportSecurity = "max-age=63072000; includeSubDomains; preload";
}

public static class ApiLogEvents
{
    public static readonly EventId RequestCompleted = new(5001, "ApiRequestCompleted");
    public static readonly EventId RequestRejected = new(5002, "ApiRequestRejected");
    public static readonly EventId UnhandledException = new(5003, "ApiUnhandledException");
}

public static class ApiBoundaryConfiguration
{
    public const string CorsPolicy = "gones-exact-origins";
    public const string AllowedOriginsKey = "GONES_ALLOWED_ORIGINS";

    public static IServiceCollection AddExactOriginCors(this IServiceCollection services, IConfiguration configuration)
    {
        var raw = configuration[AllowedOriginsKey];
        var origins = string.IsNullOrWhiteSpace(raw)
            ? []
            : raw.Split([',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (origins.Any(origin => !IsExactHttpOrigin(origin)))
        {
            throw new InvalidOperationException($"{AllowedOriginsKey} must contain exact HTTP(S) origins; wildcard, path, query, fragment, and userinfo are forbidden.");
        }

        services.AddCors(options => options.AddPolicy(CorsPolicy, policy =>
        {
            if (origins.Length > 0) policy.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod().AllowCredentials().WithExposedHeaders("Content-Disposition", "ETag");
        }));
        return services;
    }

    private static bool IsExactHttpOrigin(string origin)
    {
        if (origin == "*" || !Uri.TryCreate(origin, UriKind.Absolute, out var uri)) return false;
        return (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps)
            && string.Equals(origin, uri.GetLeftPart(UriPartial.Authority), StringComparison.Ordinal)
            && string.IsNullOrEmpty(uri.UserInfo)
            && string.IsNullOrEmpty(uri.Query)
            && string.IsNullOrEmpty(uri.Fragment);
    }
}
