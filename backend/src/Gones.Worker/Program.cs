using Gones.Infrastructure.Calendar;
using Gones.Infrastructure.Configuration;
using Gones.Infrastructure.EventProviders;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Notifications;
using Gones.Infrastructure.Observability;
using Gones.Infrastructure.Persistence;
using Gones.Worker;

if (args.Contains("--help", StringComparer.Ordinal))
{
    Console.WriteLine("Gones.Worker\n\nUsage: dotnet Gones.Worker.dll [--help]");
    return;
}

var builder = Host.CreateApplicationBuilder(args);
builder.Configuration.AddGonesSecretFiles();
builder.Services.AddEventProviderFoundations(builder.Configuration);
builder.Services.Configure<HostOptions>(options => options.ShutdownTimeout = GonesHostRuntime.LoadShutdownTimeout(builder.Configuration));
builder.Logging.AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Warning);
GonesRuntimeConfiguration runtimeConfiguration;
try
{
    runtimeConfiguration = GonesRuntimeConfiguration.Load(builder.Configuration, builder.Environment.IsDevelopment());
}
catch (Exception exception)
{
    using var loggerFactory = LoggerFactory.Create(logging => logging.AddSimpleConsole(options => options.SingleLine = true));
    loggerFactory.CreateLogger("Gones.Worker.Startup").LogCritical("Worker runtime configuration invalid; ExceptionType={ExceptionType}", exception.GetType().Name);
    throw;
}
builder.Services.AddSingleton(runtimeConfiguration);
builder.Services.AddGonesObservability(builder.Logging, builder.Configuration, "Gones.Worker");
var connectionString = builder.Configuration[PersistenceServiceCollectionExtensions.ConnectionStringKey];
if (string.IsNullOrWhiteSpace(connectionString)) throw new InvalidOperationException("GONES_DB_CONNECTION is required.");
builder.Services.AddGonesPersistence(connectionString);
builder.Services.AddNotificationWorker(builder.Configuration);
builder.Services.AddTournamentScheduler(builder.Configuration);
builder.Services.AddScoped<WorkerHeartbeatStore>();
builder.Services.AddScoped<UserEmailHistoryRedactor>();
builder.Services.AddScoped<IdempotencyRecordSweeper>();
builder.Services.AddHostedService<Worker>();

var host = builder.Build();
await host.RunAsync();

public partial class Program;
