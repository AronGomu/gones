using Gones.Api.Admin;
using Gones.Api.Errors;
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
using Gones.Api.Tournaments;
using Gones.Infrastructure.Configuration;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Notifications;
using Gones.Infrastructure.Observability;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using NodaTime;
using NodaTime.Serialization.SystemTextJson;
using OpenTelemetry.Metrics;
using OpenTelemetry.Trace;

var builder = WebApplication.CreateBuilder(args);
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
builder.Services.AddExceptionHandler<ApiExceptionHandler>();
builder.Services.AddGonesAuthorization(runtimeConfiguration, builder.Configuration);
builder.Services.AddExactOriginCors(builder.Configuration);
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
    builder.Services.AddScoped<TournamentPublicationService>();
    builder.Services.AddScoped<TournamentLifecycleService>();
    builder.Services.AddScoped<TournamentRegistrationService>();
    builder.Services.AddScoped<TournamentRegistrationNotificationService>();
    builder.Services.AddScoped<OrganizerParticipantService>();
    builder.Services.AddScoped<LeagueCommandService>();
    builder.Services.AddSingleton(TournamentRegistrationOptions.Load(builder.Configuration));
    builder.Services.AddScoped<IOrganizationDeleteDependency, TournamentOrganizationDeleteDependency>();
    builder.Services.AddScoped<IOrganizationDeleteDependency, RegistrationOrganizationDeleteDependency>();
    builder.Services.AddSingleton<TournamentPreviewTicketService>();
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
            builder.Services.AddScoped<AdminCatalogService>();
            builder.Services.AddScoped<AdminAccountService>();
            builder.Services.AddScoped<OrganizationService>();
        }
        var configuredAuthRateLimit = builder.Configuration["GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT"];
        var authRateLimit = int.TryParse(configuredAuthRateLimit, out var parsedAuthRateLimit) && parsedAuthRateLimit > 0
            ? parsedAuthRateLimit
            : AuthRateLimiting.PermitLimit;
        builder.Services.AddGonesAuthRateLimiting(authRateLimit);
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
if (runtimeConfiguration.Features.AuthV1) app.UseRateLimiter();
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
    app.MapPublicLiveEndpoints();
    app.MapPublicTournamentEndpoints();
    app.MapTournamentPublicationEndpoints();
    app.MapTournamentLifecycleEndpoints();
    app.MapTournamentRegistrationEndpoints();
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
