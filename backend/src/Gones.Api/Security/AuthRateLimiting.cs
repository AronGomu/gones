using System.Text;
using Gones.Api.Errors;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Observability;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.RateLimiting;
using NodaTime;
using System.Threading.RateLimiting;

namespace Gones.Api.Security;

internal interface IAuthRateLimitRequest
{
    string RateLimitAccount { get; }
}

public static class AuthRateLimiting
{
    public const string IpPolicy = "auth-ip";
    public const int PermitLimit = 5;
    public static readonly TimeSpan Window = TimeSpan.FromMinutes(15);

    public static IServiceCollection AddGonesAuthRateLimiting(this IServiceCollection services, int permitLimit = PermitLimit)
    {
        if (permitLimit <= 0) throw new ArgumentOutOfRangeException(nameof(permitLimit));
        services.AddSingleton(new AuthAccountRateLimiter(permitLimit));
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.OnRejected = async (context, cancellationToken) =>
            {
                var operation = context.HttpContext.Request.Path.Value?.EndsWith("/register", StringComparison.Ordinal) == true
                    ? "register"
                    : "login";
                context.HttpContext.RequestServices.GetRequiredService<OperationalMetrics>().RecordAuthRejection(operation);
                await WriteRateLimitAuditAsync(context.HttpContext.RequestServices, operation, cancellationToken);
                if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
                {
                    context.HttpContext.Response.Headers.RetryAfter = Math.Ceiling(retryAfter.TotalSeconds).ToString(System.Globalization.CultureInfo.InvariantCulture);
                }
            };
            options.AddPolicy(IpPolicy, context => RateLimitPartition.GetFixedWindowLimiter(
                TelemetryRedaction.HashRateLimitKey($"{context.Request.Path}:{context.Connection.RemoteIpAddress?.ToString() ?? "unknown"}"),
                _ => NewWindowOptions(permitLimit)));
        });
        return services;
    }

    internal static FixedWindowRateLimiterOptions NewWindowOptions(int permitLimit) => new()
    {
        AutoReplenishment = true,
        PermitLimit = permitLimit,
        QueueLimit = 0,
        Window = Window
    };

    internal static async Task WriteRateLimitAuditAsync(IServiceProvider services, string operation, CancellationToken cancellationToken)
    {
        var database = services.GetRequiredService<GonesDbContext>();
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
        var operation = context.HttpContext.Request.Path.Value?.EndsWith("/register", StringComparison.Ordinal) == true
            ? "register"
            : "login";
        if (!await limiter.TryAcquireAsync(operation, request.RateLimitAccount, context.HttpContext.RequestAborted))
        {
            metrics.RecordAuthRejection(operation);
            await AuthRateLimiting.WriteRateLimitAuditAsync(context.HttpContext.RequestServices, operation, context.HttpContext.RequestAborted);
            throw new RateLimitExceededException();
        }
        return await next(context);
    }
}
