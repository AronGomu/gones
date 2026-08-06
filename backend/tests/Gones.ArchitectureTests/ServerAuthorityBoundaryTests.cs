namespace Gones.ArchitectureTests;

/// <summary>
/// C42 authority boundary, API side.
///
/// In server mode the API database is the single data authority. The legacy browser paths —
/// CalendarEvent documents and whole-document League/Live saves — must never reappear as HTTP
/// routes: every server mutation is an explicit intent command guarded by the document version.
/// </summary>
public sealed class ServerAuthorityBoundaryTests
{
    [Fact]
    public void Api_exposes_no_legacy_calendar_event_route()
    {
        Assert.Empty(ApiSourcesContaining("calendar-events"));
    }

    [Fact]
    public void Api_exposes_no_whole_document_league_or_live_save()
    {
        // A whole-document save is a PUT at the aggregate root; every legitimate write is a
        // named POST/PATCH/DELETE intent under it.
        Assert.Empty(ApiSourcesMatching(line =>
            line.Contains("MapPut(string.Empty", StringComparison.Ordinal)
            || line.Contains("MapPut(\"/{id}\"", StringComparison.Ordinal)
            || line.Contains("MapPut(\"/\"", StringComparison.Ordinal)));
    }

    [Fact]
    public void Api_never_references_a_browser_store()
    {
        Assert.Empty(ApiSourcesMatching(line =>
            line.Contains("localStorage", StringComparison.Ordinal)
            || line.Contains("gones.frontend.backend", StringComparison.Ordinal)
            || line.Contains("gones.live-tournaments.v1", StringComparison.Ordinal)));
    }

    private static IEnumerable<string> ApiSourcesContaining(string needle) =>
        ApiSourcesMatching(line => line.Contains(needle, StringComparison.Ordinal));

    private static IEnumerable<string> ApiSourcesMatching(Func<string, bool> predicate) =>
        Directory
            .EnumerateFiles(Path.Combine(BackendRoot(), "src", "Gones.Api"), "*.cs", SearchOption.AllDirectories)
            .Where(path => !path.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
                && !path.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            .Where(path => File.ReadLines(path).Any(predicate))
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
