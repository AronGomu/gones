using Gones.Application.Migration;
using Gones.Application.Notifications;
using Gones.Domain.Catalog;
using Gones.Domain.Identity;
using Gones.Domain.Leagues;
using Gones.Domain.Live;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Configuration;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.MigrationImport;
using Gones.Infrastructure.Notifications;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using NodaTime;

if (args.Contains("--help", StringComparer.Ordinal))
{
    Console.WriteLine("""
        Gones.Migrator

        Usage: dotnet Gones.Migrator.dll database update
               dotnet Gones.Migrator.dll database seed
               dotnet Gones.Migrator.dll admin bootstrap --email <email>
               dotnet Gones.Migrator.dll notifications enqueue-test
               dotnet Gones.Migrator.dll import --bundle <file> [--bundle <file>...]
                   --manifest <file> --mapping <file>
                   [--dry-run] [--accept-report-hash <sha256:...>] [--report <file>]
               dotnet Gones.Migrator.dll [--help]

        import is dry-run-first: run --dry-run, review the human/JSON report, then rerun
        with --accept-report-hash <reportHash> from an unchanged dry run to execute the
        single-transaction migration.
        """);
    return;
}

var databaseCommand = args.Length == 2 && args[0] == "database" && args[1] is "update" or "seed" ? args[1] : null;
var notificationCommand = args.Length == 2 && args[0] == "notifications" && args[1] == "enqueue-test" ? args[1] : null;
MigrationImportOptions? importOptions = null;
if (args.Length >= 1 && args[0] == "import")
{
    if (!MigrationCliArguments.TryParse(args.Skip(1).ToArray(), out importOptions, out var importError))
    {
        Console.Error.WriteLine(importError);
        Environment.ExitCode = 2;
        return;
    }
}
string? bootstrapEmail = null;
if (args.Length >= 2 && args[0] == "admin" && args[1] == "bootstrap")
{
    for (var index = 2; index < args.Length; index++)
    {
        if (args[index] == "--email")
        {
            if (index + 1 >= args.Length)
            {
                Console.Error.WriteLine("admin bootstrap requires --email <value>.");
                Environment.ExitCode = 2;
                return;
            }

            bootstrapEmail = args[++index];
        }
        else
        {
            Console.Error.WriteLine($"Unknown admin bootstrap argument: {args[index]}");
            Environment.ExitCode = 2;
            return;
        }
    }

    if (string.IsNullOrWhiteSpace(bootstrapEmail))
    {
        Console.Error.WriteLine("admin bootstrap requires --email <value>.");
        Environment.ExitCode = 2;
        return;
    }
}

if (databaseCommand is null && notificationCommand is null && bootstrapEmail is null && importOptions is null)
{
    Console.Error.WriteLine("No migration command supplied. Use --help for usage.");
    Environment.ExitCode = 2;
    return;
}

var builder = Host.CreateApplicationBuilder(args);
builder.Configuration.AddGonesSecretFiles();
if (notificationCommand is not null && !builder.Configuration.GetValue<bool>("GONES_ALLOW_TEST_NOTIFICATION"))
{
    throw new InvalidOperationException("GONES_ALLOW_TEST_NOTIFICATION=true is required for the test notification command.");
}
var connectionString = builder.Configuration[PersistenceServiceCollectionExtensions.ConnectionStringKey];
if (string.IsNullOrWhiteSpace(connectionString)) throw new InvalidOperationException("GONES_DB_CONNECTION is required.");
builder.Services.AddGonesPersistence(connectionString);
builder.Services.AddNotificationOutbox();
builder.Services.AddScoped<AdminBootstrapService>();
builder.Services.AddScoped<MigrationImportService>();
using var host = builder.Build();
using var scope = host.Services.CreateScope();
var database = scope.ServiceProvider.GetRequiredService<GonesDbContext>();
await database.Database.MigrateAsync();

if (databaseCommand == "seed")
{
    await SeedReferenceDataAsync(database);
    await SeedLocalLiveTournamentAsync(database);
    await database.Database.ExecuteSqlRawAsync("""
        INSERT INTO audit_records (id, version, action, entity_type, entity_id, redacted_diff, occurred_at)
        VALUES ('00000000-0000-0000-0000-000000000005', 1, 'local_seed', 'system', 'local', '{{}}', '2026-01-01T00:00:00Z')
        ON CONFLICT (id) DO NOTHING;
        """);
    Console.WriteLine("Gones deterministic local seed complete.");
}
else if (bootstrapEmail is not null)
{
    var bootstrap = scope.ServiceProvider.GetRequiredService<AdminBootstrapService>();
    try
    {
        var decision = await bootstrap.BootstrapAsync(
            bootstrapEmail,
            builder.Configuration[AdminBootstrapPolicy.BootstrapEmailKey]);
        Console.WriteLine(decision.Message);
        Environment.ExitCode = decision.ExitCode;
    }
    catch (Exception exception) when (exception is InvalidOperationException or ArgumentException)
    {
        Console.Error.WriteLine(exception.Message);
        Environment.ExitCode = 1;
    }
}
else if (importOptions is not null)
{
    var importService = scope.ServiceProvider.GetRequiredService<MigrationImportService>();
    var faultInjection = builder.Configuration.GetValue<bool>("GONES_ALLOW_FAULT_INJECTION")
        ? builder.Configuration["GONES_MIGRATION_FAULT"]
        : null;
    var outcome = await importService.RunAsync(importOptions, faultInjection);
    if (outcome.Report is not null)
    {
        Console.WriteLine(outcome.Report.ToHumanSummary());
        var reportJson = System.Text.Json.Nodes.JsonNode.Parse(outcome.Report.ToJson())!
            .ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
        if (!string.IsNullOrWhiteSpace(importOptions.ReportPath))
        {
            await File.WriteAllTextAsync(importOptions.ReportPath, reportJson);
            Console.WriteLine($"JSON report written to {importOptions.ReportPath}");
        }
        else
        {
            Console.WriteLine("=== JSON report ===");
            Console.WriteLine(reportJson);
        }
    }

    if (outcome.AlreadyImported)
    {
        Console.WriteLine("Migration batch already imported; returning the stored result:");
        Console.WriteLine(outcome.ResultJson);
    }
    else if (outcome.ResultJson is not null)
    {
        Console.WriteLine("Migration import result:");
        Console.WriteLine(outcome.ResultJson);
    }

    if (outcome.Verification is not null)
    {
        Console.WriteLine(outcome.Verification.Passed
            ? $"Post-import verification passed: {outcome.Verification.LeaguesVerified} Leagues, {outcome.Verification.ScheduledTournamentsVerified} Scheduled Tournaments, {outcome.Verification.LiveTournamentsVerified} Live drafts, {outcome.Verification.DeckArchetypesVerified} Deck Archetypes, {outcome.Verification.DerivedResultSamples} derived-result samples."
            : $"Post-import verification FAILED: {string.Join("; ", outcome.Verification.Failures)}");
    }

    if (outcome.FailureMessage is not null) Console.Error.WriteLine(outcome.FailureMessage);
    Environment.ExitCode = outcome.ExitCode;
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
    await SeedReferenceDataAsync(database);
    Console.WriteLine("Gones database migrations complete.");
}

static async Task SeedLocalLiveTournamentAsync(GonesDbContext database)
{
    const string documentId = "local-live-demo";
    if (await database.LiveAggregates.AnyAsync(aggregate => aggregate.DocumentId == documentId)) return;
    var document = new LiveTournamentDocument(
        documentId,
        "Local Live Demo",
        "placeholder-league",
        "2026-08-05",
        "swiss",
        1,
        false,
        true,
        424242,
        ["local-live-player-1", "local-live-player-2"],
        "standings",
        1,
        [
            new LiveTournamentPlayerDocument("local-live-player-1", "Alice", true, false, 0, 0, 0, "Tempo"),
            new LiveTournamentPlayerDocument("local-live-player-2", "Bob", true, false, 0, 0, 0, "Control")
        ],
        [new LiveTournamentRoundDocument("local-live-round-1", 1, [
            new LiveTournamentRoundEntryDocument(new MatchRoundEntry("local-live-match-1", "1", "Alice", "Bob", 2, 1, "", ""), true)
        ], true)],
        [new LiveTournamentCheckpointDocument("local-live-checkpoint-1", "Pairing 1", "2026-08-05T10:00:00.000Z", "round", 1, 1, true,
            [
                new LiveTournamentPlayerDocument("local-live-player-1", "Alice", true, false, 0, 0, 0, "Tempo"),
                new LiveTournamentPlayerDocument("local-live-player-2", "Bob", true, false, 0, 0, 0, "Control")
            ],
            [new LiveTournamentRoundDocument("local-live-round-1", 1, [
                new LiveTournamentRoundEntryDocument(new MatchRoundEntry("local-live-match-1", "1", "Alice", "Bob", 0, 0, "", ""), false)
            ], false)])],
        null,
        1,
        "2026-08-05T09:00:00.000Z",
        "2026-08-05T10:00:00.000Z");
    database.LiveAggregates.Add(LiveAggregate.Create(document, Instant.FromUtc(2026, 8, 5, 10, 0)));
    database.AuditRecords.Add(new AuditRecord
    {
        Action = "live.local_seed",
        EntityType = "live_aggregate",
        EntityId = documentId,
        RedactedDiff = """{"id":"local-live-demo"}""",
        OccurredAt = SystemClock.Instance.GetCurrentInstant()
    });
    await database.SaveChangesAsync();
}

static async Task SeedReferenceDataAsync(GonesDbContext database)
{
    var clock = SystemClock.Instance;
    var now = clock.GetCurrentInstant();
    if (!await database.TournamentFormats.AnyAsync(format => format.Slug == TournamentFormat.LegacySlug))
    {
        database.TournamentFormats.Add(TournamentFormat.CreateLegacy(now));
        database.AuditRecords.Add(new AuditRecord
        {
            Action = "catalog.format.seeded",
            EntityType = "tournament_format",
            EntityId = TournamentFormat.LegacySlug,
            RedactedDiff = """{"slug":"legacy","name":"Legacy"}""",
            OccurredAt = now
        });
        await database.SaveChangesAsync();
    }

    var knownArchetypeKeys = await database.DeckArchetypes.Select(archetype => archetype.NormalizedName).ToListAsync();
    var missingPresets = DeckArchetypePresets.LegacyNames
        .Where(name => !knownArchetypeKeys.Contains(DeckArchetype.NormalizeKey(name), StringComparer.Ordinal))
        .ToArray();
    if (missingPresets.Length > 0)
    {
        foreach (var name in missingPresets) database.DeckArchetypes.Add(DeckArchetype.Create(name, now));
        database.AuditRecords.Add(new AuditRecord
        {
            Action = "catalog.deck_archetype.seeded",
            EntityType = "deck_archetype",
            EntityId = "legacy-presets",
            RedactedDiff = $$"""{"seeded":{{missingPresets.Length}}}""",
            OccurredAt = now
        });
        await database.SaveChangesAsync();
    }
}

public partial class Program;
