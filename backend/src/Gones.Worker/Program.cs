using Gones.Infrastructure.Configuration;
using Gones.Infrastructure.EventProviders;
using Gones.Infrastructure.Observability;
using Gones.Infrastructure.Persistence;
using Gones.Infrastructure.Workers;
using Gones.Worker;

if (args.Contains("--help", StringComparer.Ordinal))
{
    Console.WriteLine("Gones.Worker\n\nUsage: dotnet Gones.Worker.dll [--help|--wake]");
    return;
}

var builder = Host.CreateApplicationBuilder(args);
builder.Configuration.AddGonesSecretFiles();
if (args.SequenceEqual(["--wake"]))
{
    var wakeOptions = WorkerWakeOptions.TryLoad(builder.Configuration)
        ?? throw new InvalidOperationException("Worker wake is not configured.");
    using var loggerFactory = LoggerFactory.Create(logging => logging.AddSimpleConsole());
    var client = new WorkerWakeClient(wakeOptions, loggerFactory.CreateLogger<WorkerWakeClient>());
    Environment.ExitCode = await client.SendAsync(CancellationToken.None) ? 0 : 1;
    return;
}
builder.Services.AddSingleton(StagingAccessPolicy.Load(builder.Configuration, builder.Environment.EnvironmentName));
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
Worker.AddRuntimeServices(builder.Services, builder.Configuration);

var host = builder.Build();
await host.RunAsync();

public partial class Program;
