using System.Text.RegularExpressions;

namespace Gones.ArchitectureTests;

/// <summary>
/// The legacy League Archive aggregate, its endpoints and its table are retired (T19). This scan is
/// the standing proof: a re-introduced reference fails here rather than at the next migration.
///
/// The migration history is exempt because it is an append-only ledger — <c>InitialCreate</c> still
/// creates and seeds the table it was written to create, and <c>RetireLegacyLeagueArchive</c> names
/// it in order to drop it.
/// </summary>
public sealed class RetiredLeagueArchiveSurfaceTests
{
    private static readonly Regex DropLegacyArchiveTablePattern = new(
        @"migrationBuilder\.DropTable\(\s*name:\s*""league_archive_aggregates""",
        RegexOptions.Singleline | RegexOptions.Compiled);

    private static readonly string[] RetiredIdentifiers =
    [
        "LeagueArchiveAggregate", "LeagueArchiveAggregates", "league_archive_aggregates",
        "league_aggregates", "PlaceholderLeagueId", "PlaceholderLeagueName",
        "MapPublicLeagueEndpoints", "MapLeagueCommandEndpoints", "LeagueArchiveCatalogCountsBackfill",
        "api/leagues-archive"
    ];

    [Fact]
    public void No_source_file_outside_the_migration_history_names_a_retired_identifier()
    {
        var violations = new List<string>();
        var scanned = 0;

        foreach (var path in BackendSources())
        {
            scanned++;
            var source = File.ReadAllText(path);
            foreach (var identifier in RetiredIdentifiers)
            {
                if (source.Contains(identifier, StringComparison.Ordinal))
                {
                    violations.Add($"{Path.GetFileName(path)}: names the retired identifier '{identifier}'.");
                }
            }
        }

        // A scan that matched no files would pass for the wrong reason.
        Assert.True(scanned > 100, $"Only {scanned} backend sources found; this guard is scanning nothing.");
        Assert.Empty(violations);
    }

    [Fact]
    public void Exactly_one_migration_drops_the_legacy_archive_table()
    {
        var droppers = MigrationSources()
            .Where(path => DropLegacyArchiveTablePattern.IsMatch(UpBody(File.ReadAllText(path))))
            .Select(Path.GetFileName)
            .ToArray();

        Assert.Single(droppers);
        Assert.EndsWith("_RetireLegacyLeagueArchive.cs", droppers[0], StringComparison.Ordinal);
    }

    private static string UpBody(string source)
    {
        var start = source.IndexOf("void Up(MigrationBuilder", StringComparison.Ordinal);
        if (start < 0)
        {
            return string.Empty;
        }

        var end = source.IndexOf("void Down(MigrationBuilder", StringComparison.Ordinal);
        return end > start ? source[start..end] : source[start..];
    }

    private static IEnumerable<string> MigrationSources() =>
        Directory
            .EnumerateFiles(MigrationsRoot(), "*.cs", SearchOption.AllDirectories)
            .Where(path => !path.EndsWith(".Designer.cs", StringComparison.Ordinal))
            .Where(path => !Path.GetFileName(path).Contains("ModelSnapshot", StringComparison.Ordinal))
            .Order(StringComparer.Ordinal)
            .ToArray();

    private static IEnumerable<string> BackendSources()
    {
        var migrations = MigrationsRoot();
        return new[] { "src", "tests" }
            .SelectMany(folder => Directory.EnumerateFiles(Path.Combine(BackendRoot(), folder), "*.cs", SearchOption.AllDirectories))
            .Where(path => !path.StartsWith(migrations, StringComparison.Ordinal))
            // This file spells every retired identifier out in order to search for it.
            .Where(path => Path.GetFileName(path) != "RetiredLeagueArchiveSurfaceTests.cs")
            .Where(path => !path.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            .Where(path => !path.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            .Order(StringComparer.Ordinal)
            .ToArray();
    }

    private static string MigrationsRoot() =>
        Path.Combine(BackendRoot(), "src", "Gones.Infrastructure", "Persistence", "Migrations");

    private static string BackendRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "Gones.sln")))
        {
            directory = directory.Parent;
        }

        return directory?.FullName ?? throw new InvalidOperationException("Gones.sln not found above the test output directory.");
    }
}
