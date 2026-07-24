using Gones.Worker;

if (args.Contains("--help", StringComparer.Ordinal))
{
    Console.WriteLine("Gones.Worker\n\nUsage: dotnet Gones.Worker.dll [--help]");
    return;
}

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddHostedService<Worker>();

var host = builder.Build();
await host.RunAsync();

public partial class Program;
