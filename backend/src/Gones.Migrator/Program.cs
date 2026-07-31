using Gones.Application.Notifications;
using Gones.Infrastructure.Notifications;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

if (args.Contains("--help", StringComparer.Ordinal))
{
    Console.WriteLine("Gones.Migrator\n\nUsage: dotnet Gones.Migrator.dll database update\n       dotnet Gones.Migrator.dll database seed\n       dotnet Gones.Migrator.dll notifications enqueue-test\n       dotnet Gones.Migrator.dll [--help]");
    return;
}

var databaseCommand = args.Length == 2 && args[0] == "database" && args[1] is "update" or "seed" ? args[1] : null;
var notificationCommand = args.Length == 2 && args[0] == "notifications" && args[1] == "enqueue-test" ? args[1] : null;
if (databaseCommand is null && notificationCommand is null)
{
    Console.Error.WriteLine("No migration command supplied. Use --help for usage.");
    Environment.ExitCode = 2;
    return;
}

var builder = Host.CreateApplicationBuilder(args);
if (notificationCommand is not null && !builder.Configuration.GetValue<bool>("GONES_ALLOW_TEST_NOTIFICATION"))
{
    throw new InvalidOperationException("GONES_ALLOW_TEST_NOTIFICATION=true is required for the test notification command.");
}
var connectionString = builder.Configuration[PersistenceServiceCollectionExtensions.ConnectionStringKey];
if (string.IsNullOrWhiteSpace(connectionString)) throw new InvalidOperationException("GONES_DB_CONNECTION is required.");
builder.Services.AddGonesPersistence(connectionString);
builder.Services.AddNotificationOutbox();
using var host = builder.Build();
using var scope = host.Services.CreateScope();
var database = scope.ServiceProvider.GetRequiredService<GonesDbContext>();
await database.Database.MigrateAsync();

if (databaseCommand == "seed")
{
    await database.Database.ExecuteSqlRawAsync("""
        INSERT INTO audit_records (id, version, action, entity_type, entity_id, redacted_diff, occurred_at)
        VALUES ('00000000-0000-0000-0000-000000000005', 1, 'local_seed', 'system', 'local', '{{}}', '2026-01-01T00:00:00Z')
        ON CONFLICT (id) DO NOTHING;
        """);
    Console.WriteLine("Gones deterministic local seed complete.");
}
else if (notificationCommand == "enqueue-test")
{
    const string dedupeKey = "c06-local-notification-smoke";
    var existing = await database.NotificationOutboxRecords.SingleOrDefaultAsync(item => item.DedupeKey == dedupeKey);
    if (existing is null)
    {
        var outbox = scope.ServiceProvider.GetRequiredService<INotificationOutbox>();
        var id = outbox.Enqueue(new NotificationRequest(
            "local-recipient@example.test",
            "fr",
            dedupeKey,
            new VerifyEmailTemplateModel("Local Tester", new Uri("https://app.example/verify?token=local-test-token"))));
        await database.SaveChangesAsync();
        Console.WriteLine($"Notification test message enqueued: {id:D}");
    }
    else
    {
        Console.WriteLine($"Notification test message already exists: {existing.Id:D}");
    }
}
else
{
    Console.WriteLine("Gones database migrations complete.");
}

public partial class Program;
