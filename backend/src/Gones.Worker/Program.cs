using Gones.Infrastructure.Configuration;
using Gones.Worker;

if (args.Contains("--help", StringComparer.Ordinal))
{
    Console.WriteLine("Gones.Worker\n\nUsage: dotnet Gones.Worker.dll [--help]");
    return;
}

var builder = Host.CreateApplicationBuilder(args);
GonesRuntimeConfiguration runtimeConfiguration;
try
{
    runtimeConfiguration = GonesRuntimeConfiguration.Load(builder.Configuration, builder.Environment.IsDevelopment());
}
catch (Exception exception)
{
    using var loggerFactory = LoggerFactory.Create(logging => logging.AddSimpleConsole(options => options.SingleLine = true));
    loggerFactory.CreateLogger("Gones.Worker.Startup").LogCritical(exception, "Worker runtime configuration invalid");
    throw;
}
builder.Services.AddSingleton(runtimeConfiguration);
builder.Services.AddHostedService<Worker>();

var host = builder.Build();
await host.RunAsync();

public partial class Program;
