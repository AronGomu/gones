using Gones.Infrastructure.Persistence;
using Microsoft.Extensions.Diagnostics.HealthChecks;

var builder = WebApplication.CreateBuilder(args);
var healthChecks = builder.Services.AddHealthChecks();
var connectionString = builder.Configuration[PersistenceServiceCollectionExtensions.ConnectionStringKey];
if (string.IsNullOrWhiteSpace(connectionString))
{
    healthChecks.AddCheck("database", () => HealthCheckResult.Unhealthy("Database connection is not configured."));
}
else
{
    builder.Services.AddGonesPersistence(connectionString);
    healthChecks.AddDbContextCheck<GonesDbContext>("database");
}

var app = builder.Build();

app.MapGet("/health/live", () => Results.Ok(new { status = "live" })).AllowAnonymous();
app.MapHealthChecks("/health/ready").AllowAnonymous();

app.Run();

public partial class Program;
