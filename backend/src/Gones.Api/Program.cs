using Gones.Api.Errors;
using Gones.Api.Health;
using Gones.Api.Security;
using Gones.Api.Serialization;
using Gones.Api.Testing;
using Gones.Infrastructure.Configuration;
using Gones.Infrastructure.Notifications;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using NodaTime;
using NodaTime.Serialization.SystemTextJson;

var builder = WebApplication.CreateBuilder(args);
var runtimeConfiguration = GonesRuntimeConfiguration.Load(builder.Configuration, builder.Environment.IsDevelopment());
builder.Services.AddSingleton(runtimeConfiguration);
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
builder.Services.AddGonesAuthorization();
builder.Services.AddExactOriginCors(builder.Configuration);

var healthChecks = builder.Services.AddHealthChecks();
var connectionString = builder.Configuration[PersistenceServiceCollectionExtensions.ConnectionStringKey];
if (string.IsNullOrWhiteSpace(connectionString))
{
    healthChecks.AddCheck("database", () => HealthCheckResult.Unhealthy("Database connection is not configured."));
}
else
{
    builder.Services.AddGonesPersistence(connectionString);
    var notificationHealthOptions = NotificationHealthOptions.Load(builder.Configuration);
    builder.Services.AddSingleton(notificationHealthOptions);
    healthChecks.AddDbContextCheck<GonesDbContext>("database");
    healthChecks.AddCheck<NotificationOutboxHealthCheck>("notificationOutbox");
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
app.UseAuthorization();

app.MapGet("/health/live", () => new HealthStatusResponse("live")).Produces<HealthStatusResponse>().AllowAnonymous();
app.MapHealthChecks("/health/ready", new HealthCheckOptions { ResponseWriter = ReadinessResponseWriter.WriteAsync }).AllowAnonymous();
if (app.Environment.IsDevelopment()) app.MapOpenApi().AllowAnonymous();
else if (builder.Configuration.GetValue<bool>("GONES_OPENAPI_ENABLED")) app.MapOpenApi().RequireAuthorization(AuthorizationPolicies.Admin);
app.MapContractTestEndpoints();

app.Run();

public sealed record HealthStatusResponse(string Status);

public partial class Program;
