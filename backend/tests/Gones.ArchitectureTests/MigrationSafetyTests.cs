using System.Text.RegularExpressions;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Gones.ArchitectureTests;

/// <summary>
/// Migration safety, source side.
///
/// Every integration class calls <c>MigrateAsync()</c> against a container that starts empty and no
/// <c>Down</c> is ever executed, so a migration that destroys existing rows is indistinguishable from
/// one that preserves them: on an empty database both leave the same schema and nothing to lose. The
/// hand-correction that made the point — EF scaffolds a <c>DropTable</c> + <c>CreateTable</c> pair for
/// an entity-type rename, and applying that scaffold would silently drop every archived League — was
/// encoded nowhere but in a comment. The T1 squash folded that migration, and every other, into the
/// single <c>InitialCreate</c>, so no committed migration renames a table today; rules (a) and (b)
/// below stay armed for the next one that does.
///
/// Two source rules close the named failure without building a data-preservation harness:
///
/// (a) no <c>Up</c> may both drop and create a table. That pair *is* EF's scaffold for a rename, and
///     re-scaffolding a rename from the model diff is the natural move for the next agent to touch an
///     entity name. Scoping the rule to <c>Up</c> matters: every migration drops in <c>Down</c>, which
///     is the ordinary undo and is never destructive of anything the migration did not itself create.
///     Checking for a surviving <c>RenameTable</c> instead would not do — a full re-scaffold removes
///     it, and the check would go quiet exactly when it was needed.
/// (b) a migration that does rename a table must not also drop or create that table, for the partial
///     re-scaffold where <c>RenameTable</c> survives alongside a destructive op.
///
/// Plus <see cref="Committed_migrations_fully_describe_the_model"/>: a drifted snapshot is what made
/// EF mis-read the rename as a drop-and-create in the first place, so catching drift at test time
/// stops the same trap being re-set.
/// </summary>
public sealed class MigrationSafetyTests
{
    private static readonly Regex RenameTablePattern = new(
        @"migrationBuilder\.RenameTable\(\s*name:\s*""(?<old>[^""]+)""\s*,\s*newName:\s*""(?<new>[^""]+)""",
        RegexOptions.Singleline | RegexOptions.Compiled);

    private static readonly Regex DestructivePattern = new(
        @"migrationBuilder\.(?<op>DropTable|CreateTable)\(\s*name:\s*""(?<table>[^""]+)""",
        RegexOptions.Singleline | RegexOptions.Compiled);

    [Fact]
    public void No_migration_renames_a_table_by_dropping_and_recreating_it()
    {
        var violations = new List<string>();
        var scanned = 0;

        foreach (var path in MigrationSources())
        {
            scanned++;
            var up = UpBody(File.ReadAllText(path));
            var dropped = DestructivePattern
                .Matches(up)
                .Where(match => match.Groups["op"].Value == "DropTable")
                .Select(match => match.Groups["table"].Value)
                .ToArray();
            var created = DestructivePattern
                .Matches(up)
                .Where(match => match.Groups["op"].Value == "CreateTable")
                .Select(match => match.Groups["table"].Value)
                .ToArray();

            if (dropped.Length > 0 && created.Length > 0)
            {
                violations.Add(
                    $"{Path.GetFileName(path)}: Up drops [{string.Join(", ", dropped)}] and creates "
                    + $"[{string.Join(", ", created)}]. That pair is EF's scaffold for a table or entity rename and "
                    + "destroys every existing row. Hand-correct it to RenameTable / RenameIndex, or split the "
                    + "removal and the addition into two migrations.");
            }
        }

        // A scan that matched no files would pass for the wrong reason.
        Assert.True(scanned > 0, "No migration sources found; this guard is scanning nothing.");
        Assert.Empty(violations);
    }

    [Fact]
    public void Rename_migrations_never_drop_or_recreate_the_table_they_rename()
    {
        var violations = new List<string>();
        var renameMigrations = 0;
        var scanned = 0;

        foreach (var path in MigrationSources())
        {
            scanned++;
            var source = File.ReadAllText(path);
            var renamed = RenameTablePattern
                .Matches(source)
                .SelectMany(match => new[] { match.Groups["old"].Value, match.Groups["new"].Value })
                .ToHashSet(StringComparer.Ordinal);
            if (renamed.Count == 0)
            {
                continue;
            }

            renameMigrations++;
            foreach (Match match in DestructivePattern.Matches(source))
            {
                var table = match.Groups["table"].Value;
                if (renamed.Contains(table))
                {
                    violations.Add(
                        $"{Path.GetFileName(path)}: {match.Groups["op"].Value} on '{table}', a table this migration "
                        + "renames. A rename must move the table, not replace it.");
                }
            }
        }

        // T1 squashed the history into a single InitialCreate, so no committed migration renames a table
        // any more and `renameMigrations` is legitimately 0. The scan-count sentinel keeps the guard from
        // passing because it read no files, which is the failure the old sentinel was really guarding.
        Assert.True(scanned > 0, "No migration sources found; this guard is scanning nothing.");
        Assert.Empty(violations);
    }

    [Fact]
    public void Committed_migrations_fully_describe_the_model()
    {
        // No connection is opened: HasPendingModelChanges compares the current model against the
        // committed snapshot, both of which are compiled into Gones.Infrastructure.
        using var context = new GonesDbContext(new DbContextOptionsBuilder<GonesDbContext>()
            .ConfigureGones("Host=localhost;Port=5432;Database=gones;Username=gones;Password=unused")
            .Options);

        Assert.False(
            context.Database.HasPendingModelChanges(),
            "The model has changes no migration carries. Run `dotnet ef migrations add <Name>` — and if the change "
            + "renames an entity or a table, hand-correct the scaffold to a rename instead of a drop-and-create.");
    }

    [Fact]
    public void The_migration_history_is_a_single_initial_create()
    {
        var migrations = MigrationSources().Select(Path.GetFileNameWithoutExtension).ToArray();

        var single = Assert.Single(migrations);
        Assert.Matches(@"^\d{14}_InitialCreate$", single);
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
            .EnumerateFiles(
                Path.Combine(BackendRoot(), "src", "Gones.Infrastructure", "Persistence", "Migrations"),
                "*.cs",
                SearchOption.AllDirectories)
            .Where(path => !path.EndsWith(".Designer.cs", StringComparison.Ordinal))
            .Where(path => !Path.GetFileName(path).Contains("ModelSnapshot", StringComparison.Ordinal))
            .Order(StringComparer.Ordinal)
            .ToArray();

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
