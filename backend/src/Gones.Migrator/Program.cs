using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

if (args.Contains("--help", StringComparer.Ordinal))
{
    Console.WriteLine("Gones.Migrator\n\nUsage: dotnet Gones.Migrator.dll database update\n       dotnet Gones.Migrator.dll database seed\n       dotnet Gones.Migrator.dll [--help]");
    return;
}

var command = args.Length == 2 && args[0] == "database" ? args[1] : null;
if (command is not ("update" or "seed"))
{
    Console.Error.WriteLine("No migration command supplied. Use --help for usage.");
    Environment.ExitCode = 2;
    return;
}

var builder = Host.CreateApplicationBuilder(args);
var connectionString = builder.Configuration[PersistenceServiceCollectionExtensions.ConnectionStringKey];
if (string.IsNullOrWhiteSpace(connectionString)) throw new InvalidOperationException("GONES_DB_CONNECTION is required.");
builder.Services.AddGonesPersistence(connectionString);
using var host = builder.Build();
using var scope = host.Services.CreateScope();
var database = scope.ServiceProvider.GetRequiredService<GonesDbContext>();
await database.Database.MigrateAsync();

if (command == "seed")
{
    await database.Database.ExecuteSqlRawAsync("""
        INSERT INTO audit_records (id, version, action, entity_type, entity_id, redacted_diff, occurred_at)
        VALUES ('00000000-0000-0000-0000-000000000005', 1, 'local_seed', 'system', 'local', '{{}}', '2026-01-01T00:00:00Z')
        ON CONFLICT (id) DO NOTHING;
        """);
    Console.WriteLine("Gones deterministic local seed complete.");
}
else
{
    Console.WriteLine("Gones database migrations complete.");
}

public partial class Program;
