namespace Gones.Application.Migration;

public sealed record MigrationImportOptions(
    IReadOnlyList<string> BundlePaths,
    string ManifestPath,
    string MappingPath,
    bool DryRun,
    string? AcceptReportHash,
    string? ReportPath);

/// <summary>Parses `import --bundle <file>... --mapping <file> --manifest <file> [--dry-run] [--accept-report-hash <hash>] [--report <file>]`.</summary>
public static class MigrationCliArguments
{
    public static bool TryParse(IReadOnlyList<string> args, out MigrationImportOptions? options, out string? error)
    {
        options = null;
        error = null;
        var bundles = new List<string>();
        string? manifest = null;
        string? mapping = null;
        string? acceptReportHash = null;
        string? reportPath = null;
        var dryRun = false;

        for (var index = 0; index < args.Count; index++)
        {
            switch (args[index])
            {
                case "--bundle":
                    if (!TryTakeValue(args, ref index, out var bundle)) { error = "--bundle requires a file path."; return false; }
                    bundles.Add(bundle);
                    break;
                case "--manifest":
                    if (!TryTakeValue(args, ref index, out manifest)) { error = "--manifest requires a file path."; return false; }
                    break;
                case "--mapping":
                    if (!TryTakeValue(args, ref index, out mapping)) { error = "--mapping requires a file path."; return false; }
                    break;
                case "--accept-report-hash":
                    if (!TryTakeValue(args, ref index, out acceptReportHash)) { error = "--accept-report-hash requires a value."; return false; }
                    break;
                case "--report":
                    if (!TryTakeValue(args, ref index, out reportPath)) { error = "--report requires a file path."; return false; }
                    break;
                case "--dry-run":
                    dryRun = true;
                    break;
                default:
                    error = $"Unknown import argument: {args[index]}";
                    return false;
            }
        }

        if (bundles.Count == 0) { error = "import requires at least one --bundle <file>."; return false; }
        if (manifest is null) { error = "import requires --manifest <file>."; return false; }
        if (mapping is null) { error = "import requires --mapping <file>."; return false; }
        if (!dryRun && string.IsNullOrWhiteSpace(acceptReportHash))
        {
            error = "import is dry-run-first: run --dry-run, review the report, then rerun with --accept-report-hash <reportHash>.";
            return false;
        }

        options = new MigrationImportOptions(bundles, manifest, mapping, dryRun, acceptReportHash, reportPath);
        return true;
    }

    private static bool TryTakeValue(IReadOnlyList<string> args, ref int index, out string value)
    {
        value = string.Empty;
        if (index + 1 >= args.Count) return false;
        value = args[++index];
        return !string.IsNullOrWhiteSpace(value);
    }
}
