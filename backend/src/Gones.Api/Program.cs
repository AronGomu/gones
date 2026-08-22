using System.IO.Compression;
using Gones.Api.Admin;
using Gones.Api.Archive;
using Gones.Api.Errors;
using Gones.Api.Events;
using Gones.Api.Health;
using Gones.Api.Identity;
using Gones.Api.Leagues;
using Gones.Api.Live;
using Gones.Api.Observability;
using Gones.Api.Organizations;
using Gones.Api.Notifications;
using Gones.Api.Security;
using Gones.Api.Serialization;
using Gones.Api.Testing;
using Gones.Infrastructure.Configuration;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Notifications;
using Gones.Infrastructure.Observability;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Net.Http.Headers;
using NodaTime;
using NodaTime.Serialization.SystemTextJson;
using OpenTelemetry.Metrics;
using OpenTelemetry.Trace;

var builder = WebApplication.CreateBuilder(args);
// Mounted-file secrets are layered in first so every later reader sees one uniform configuration.
builder.Configuration.AddGonesSecretFiles();
builder.Services.Configure<HostOptions>(options => options.ShutdownTimeout = GonesHostRuntime.LoadShutdownTimeout(builder.Configuration));
var forwardedProxies = ForwardedProxySettings.Load(builder.Configuration);
if (forwardedProxies.Enabled) builder.Services.Configure<ForwardedHeadersOptions>(forwardedProxies.Apply);
var runtimeConfiguration = GonesRuntimeConfiguration.Load(
    builder.Configuration,
    builder.Environment.IsDevelopment() || builder.Environment.IsEnvironment("Testing"));
builder.Services.AddSingleton(runtimeConfiguration);
builder.Services.AddGonesObservability(builder.Logging, builder.Configuration, "Gones.Api");
builder.Services.AddOpenTelemetry()
    .WithTracing(tracing => tracing.AddAspNetCoreInstrumentation(options =>
        options.Filter = context => !context.Request.Path.StartsWithSegments("/health/live")))
    .WithMetrics(metrics => metrics.AddAspNetCoreInstrumentation());
builder.Logging.AddFilter("Microsoft.AspNetCore.Hosting.Diagnostics", LogLevel.Warning);
builder.Logging.AddFilter("Microsoft.AspNetCore.HttpLogging", LogLevel.Warning);
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.MaxDepth = 32;
    options.SerializerOptions.Converters.Add(new UtcDateTimeJsonConverter());
    options.SerializerOptions.Converters.Add(new UtcDateTimeOffsetJsonConverter());
    options.SerializerOptions.ConfigureForNodaTime(DateTimeZoneProviders.Tzdb);
});
builder.Services.AddOpenApi();
builder.Services.AddProblemDetails();
// The public catalogs are the payloads that need this (ADR 0042), but compression is cheap for every
// anonymous read, so it is registered app-wide and narrowed at the middleware below.
//
// Measured against the 100x stress dataset (freshly built image, curl, brotli first in negotiation):
//   route                              raw         br-Fast   br-Optimal  br-Smallest  gz-Fast   gz-Optimal
//   /api/leagues-archive/all         34 115       3 612      1 504       1 256       2 873      1 657
//   /api/leagues-archive/all/docs 1 442 929     348 868    123 021      82 610     198 768    109 404
//   /api/events/all                 842 128     289 319     97 026      71 010     215 757    134 475
//
//   Latency added on /all/docs (5-run median over baseline ~34 ms):
//   br-Fastest ~2 ms, br-Optimal ~45 ms ✓, br-Smallest ~1 600 ms ✗ (disqualified)
//
// Brotli Optimal wins negotiation for real browsers (Accept-Encoding: gzip, deflate, br) and
// produces 123 021 bytes on /all/docs — 38 % smaller than the gzip-Fastest ceiling (198 768)
// and 65 % smaller than brotli-Fastest (348 868), which T12 originally shipped. SmallestSize
// is far slower without a meaningful extra benefit; Gzip stays Fastest as the fallback.
builder.Services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
    options.Providers.Add<BrotliCompressionProvider>();
    options.Providers.Add<GzipCompressionProvider>();
    options.MimeTypes = ResponseCompressionDefaults.MimeTypes.Concat(["application/problem+json"]);
});
builder.Services.Configure<BrotliCompressionProviderOptions>(options => options.Level = CompressionLevel.Optimal);
builder.Services.Configure<GzipCompressionProviderOptions>(options => options.Level = CompressionLevel.Fastest);
builder.Services.AddExceptionHandler<ApiExceptionHandler>();
builder.Services.AddGonesAuthorization(runtimeConfiguration, builder.Configuration);
builder.Services.AddExactOriginCors(builder.Configuration);
// Registered unconditionally: the auth endpoints are mapped on the feature flag alone, so the cookie
// helper must resolve even in the configurations that skip the persistence-backed identity services.
builder.Services.Configure<RefreshCookieOptions>(builder.Configuration.GetSection("Gones:Auth:RefreshCookie"));
builder.Services.AddSingleton<RefreshCookie>();
// Locked V1 endpoint rate policies are always installed: the global limiter must cover public reads
// and authenticated writes even when the auth feature flag is off.
builder.Services.AddGonesAuthRateLimiting(RateLimitSettings.Load(
    builder.Configuration,
    builder.Environment.IsDevelopment() || builder.Environment.IsEnvironment("Testing")));
var brevoWebhookOptions = BrevoWebhookOptions.TryLoad(builder.Configuration);

var healthChecks = builder.Services.AddHealthChecks();
var connectionString = builder.Configuration[PersistenceServiceCollectionExtensions.ConnectionStringKey];
if (string.IsNullOrWhiteSpace(connectionString))
{
    healthChecks.AddCheck("database", () => HealthCheckResult.Unhealthy("Database connection is not configured."));
}
else
{
    builder.Services.AddGonesPersistence(connectionString);
    builder.Services.AddNotificationOutbox();
    builder.Services.AddSingleton<NotificationMetrics>();
    if (brevoWebhookOptions is not null)
    {
        builder.Services.AddSingleton(brevoWebhookOptions);
        builder.Services.AddSingleton<BrevoWebhookRateGate>();
        builder.Services.AddScoped<BrevoWebhookService>();
    }
    builder.Services.AddScoped<OrganizationAccessService>();
    builder.Services.AddScoped<EventPublicationService>();
    builder.Services.AddScoped<EventProposalService>();
    builder.Services.AddScoped<EventLifecycleService>();
    builder.Services.AddScoped<EventRegistrationService>();
    builder.Services.AddScoped<EventRegistrationNotificationService>();
    builder.Services.AddScoped<OrganizerParticipantService>();
    builder.Services.AddScoped<LeagueCommandService>();
    builder.Services.AddScoped<ArchiveCommandService>();
    builder.Services.AddScoped<ArchiveTournamentCommandService>();
    builder.Services.AddScoped<PlayerNameMaintenanceService>();
    builder.Services.AddSingleton<PlayerStatisticsRebuildService>();
    // Both startup repairs are inserted first on purpose: the web host registers its own hosted service
    // while the builder is constructed, so appending would start Kestrel before they had run. ADR 0040
    // wants the read model filled before the API serves traffic, and /api/leagues-archive/all now reads
    // the denormalized catalog counts, so a request served before that repair would ship zeroed counts
    // (ADR 0042). Written back to front because each insert goes in front of the previous one.
    builder.Services.Insert(0, ServiceDescriptor.Singleton<IHostedService, LeagueArchiveCatalogCountsBackfill>());
    builder.Services.Insert(0, ServiceDescriptor.Singleton<IHostedService, PlayerStatisticsStartupRebuild>());
    builder.Services.AddScoped<LiveCommandService>();
    builder.Services.AddSingleton(EventRegistrationOptions.Load(builder.Configuration));
    builder.Services.AddScoped<IOrganizationDeleteDependency, EventOrganizationDeleteDependency>();
    builder.Services.AddScoped<IOrganizationDeleteDependency, RegistrationOrganizationDeleteDependency>();
    builder.Services.AddSingleton<EventPreviewTicketService>();
    if (runtimeConfiguration.Features.AuthV1)
    {
        builder.Services.AddGonesLocalIdentity();
        builder.Services.AddSingleton(AccountLifecycleOptions.Load(builder.Configuration));
        builder.Services.AddSingleton(ExternalOAuthOptions.Load(builder.Configuration, runtimeConfiguration));
        builder.Services.AddSingleton<FakeOAuthCodeStore>();
        builder.Services.AddHttpClient(nameof(ExternalOAuthClient));
        builder.Services.AddScoped<IExternalOAuthClient, ExternalOAuthClient>();
        builder.Services.AddScoped<ExternalOAuthService>();
        builder.Services.AddScoped<AccountLifecycleService>();
        builder.Services.AddScoped<AccessTokenIssuer>();
        builder.Services.AddScoped<RefreshSessionService>();
        if (runtimeConfiguration.Features.AdminV1)
        {
            builder.Services.AddScoped<AdminRoleService>();
            builder.Services.AddScoped<OrganizationMembershipRoleService>();
            builder.Services.AddScoped<AdminCatalogService>();
            builder.Services.AddScoped<AdminAccountService>();
            builder.Services.AddScoped<OrganizationService>();
        }
    }
    var notificationHealthOptions = NotificationHealthOptions.Load(builder.Configuration);
    var workerHealthOptions = WorkerHealthOptions.Load(builder.Configuration);
    builder.Services.AddSingleton(notificationHealthOptions);
    builder.Services.AddSingleton(workerHealthOptions);
    healthChecks.AddDbContextCheck<GonesDbContext>("database");
    healthChecks.AddCheck<WorkerHeartbeatHealthCheck>("workerHeartbeat");
    healthChecks.AddCheck<NotificationOutboxHealthCheck>("notificationOutbox");
    healthChecks.AddCheck<NotificationDeliveryHealthCheck>("notificationDelivery");
}

var app = builder.Build();
// BREACH: compressing a response that carries a session secret next to attacker-influenced input leaks
// the secret through the compressed length. Credentialed requests are answered uncompressed; every
// public read — the League catalog, the Event catalog, the rankings — is anonymous and is compressed
// (ADR 0042). Outermost so it wraps every endpoint and every error body; it reads no forwarded value,
// because EnableForHttps makes the request scheme irrelevant to the decision.
//
// /api/auth is excluded by path, not by credential, because the credential test cannot see it: a first
// login hits GET /api/auth/oauth/{provider}/callback carrying neither an Authorization header nor the
// refresh cookie, and that route answers OAuthFlowResponse — an access token or a completion ticket.
// Excluding the whole group keeps the invariant "a body holding a session secret is never compressed"
// true by construction rather than by the current shape of one handler.
app.UseWhen(
    context => HttpMethods.IsGet(context.Request.Method)
        && !context.Request.Headers.ContainsKey(HeaderNames.Authorization)
        && !context.Request.Cookies.ContainsKey(RefreshCookie.Name)
        && !context.Request.Path.StartsWithSegments("/api/auth"),
    branch => branch.UseResponseCompression());
// Must precede every consumer of the client IP and scheme: correlation logging, HSTS, rate limits.
if (forwardedProxies.Enabled) app.UseForwardedHeaders();
app.UseMiddleware<ApiBoundaryMiddleware>();
app.UseCors(ApiBoundaryConfiguration.CorsPolicy);
app.UseExceptionHandler();
app.UseStatusCodePages(async statusContext =>
{
    var response = statusContext.HttpContext.Response;
    var code = response.StatusCode switch
    {
        StatusCodes.Status400BadRequest => "malformed_request",
        StatusCodes.Status413PayloadTooLarge => "request_too_large",
        StatusCodes.Status401Unauthorized => "unauthorized",
        StatusCodes.Status403Forbidden => "forbidden",
        StatusCodes.Status404NotFound => "not_found",
        StatusCodes.Status429TooManyRequests => "rate_limited",
        _ => "request_failed"
    };
    var problem = new ProblemDetails
    {
        Type = $"urn:gones:problem:{code}",
        Status = response.StatusCode,
        Title = code,
        Detail = "Request could not be completed.",
        Instance = statusContext.HttpContext.Request.Path
    };
    problem.Extensions["code"] = code;
    problem.Extensions["message"] = problem.Detail;
    problem.Extensions["traceId"] = statusContext.HttpContext.TraceIdentifier;
    await response.WriteAsJsonAsync(problem, options: null, contentType: "application/problem+json");
});
app.UseMiddleware<ApiRequestSizeMiddleware>();
app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();

app.MapGet("/health/live", () => new HealthStatusResponse("live")).Produces<HealthStatusResponse>().AllowAnonymous();
app.MapHealthChecks("/health/ready", new HealthCheckOptions { ResponseWriter = ReadinessResponseWriter.WriteAsync }).AllowAnonymous();
if (app.Environment.IsDevelopment()) app.MapOpenApi().AllowAnonymous();
else if (builder.Configuration.GetValue<bool>("GONES_OPENAPI_ENABLED")) app.MapOpenApi().RequireAuthorization(AuthorizationPolicies.Admin);
app.MapContractTestEndpoints();
app.MapOperationalProbeEndpoints();
if (runtimeConfiguration.Features.AuthV1)
{
    app.MapLocalIdentityEndpoints();
    app.MapExternalOAuthEndpoints();
    if (runtimeConfiguration.AuthProvider == GonesAuthProvider.Fake
        && (app.Environment.IsDevelopment() || app.Environment.IsEnvironment("Testing")))
    {
        app.MapFakeOAuthProviderEndpoints();
    }
}
if (!string.IsNullOrWhiteSpace(connectionString))
{
    app.MapPublicCatalogEndpoints();
    app.MapPublicLeagueEndpoints();
    app.MapLeagueCommandEndpoints();
    app.MapArchiveCommandEndpoints();
    app.MapArchiveTournamentCommandEndpoints();
    app.MapPlayerNameMaintenanceEndpoints();
    app.MapPlayerEndpoints();
    app.MapPublicLiveEndpoints();
    app.MapLiveCommandEndpoints();
    app.MapPublicEventEndpoints();
    app.MapEventPublicationEndpoints();
    app.MapEventProposalEndpoints();
    app.MapEventLifecycleEndpoints();
    app.MapEventRegistrationEndpoints();
    app.MapOrganizerParticipantEndpoints();
    if (brevoWebhookOptions is not null) app.MapBrevoWebhook(brevoWebhookOptions);
}
if (runtimeConfiguration.Features.AdminV1)
{
    app.MapAdminEndpoints();
    app.MapNotificationAdminEndpoints();
    app.MapOrganizationEndpoints();
    app.MapAdminOrganizationEndpoints();
}

app.Run();

public sealed record HealthStatusResponse(string Status);

public partial class Program;
