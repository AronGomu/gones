using System.Text.Json;
using Gones.Domain.Leagues;

namespace Gones.Application.Migration;

public sealed record MigrationReportBundle(
    string FileName,
    string SourceInstanceId,
    string BundleChecksum,
    string Role,
    MigrationBundleCounts Counts,
    IReadOnlyList<string> StoreErrors);

public sealed record MigrationReportIssue(string Code, string Detail);

public sealed record MigrationSanitationChange(string EntityId, string Change, string Detail);

public sealed record MigrationReportCounts(
    int Leagues,
    int Tournaments,
    int CalendarEvents,
    int LiveTournaments,
    int DeckArchetypes);

public sealed record MigrationPlannedCounts(
    int LeaguesToCreate,
    int TournamentsToImport,
    int TournamentsMergedIntoPlaceholderTarget,
    int ScheduledTournaments,
    int LiveTournamentsToCreate,
    int DeckArchetypesToAdd,
    int DeckArchetypesAlreadyPresent,
    int SkippedEntities);

public sealed record MigrationCalendarMappingSummary(
    string EventId,
    string Title,
    string Slug,
    string StartsAtLocal,
    string TimeZone,
    string City,
    string Country,
    IReadOnlyList<string> FormatSlugs,
    string StatusPolicy);

public sealed record MigrationEntityHashes(
    IReadOnlyDictionary<string, string> Leagues,
    IReadOnlyDictionary<string, string> LiveTournaments);

/// <summary>
/// Review report produced by every evaluation. The report hash covers everything except the
/// volatile envelope (mode/generatedAt/reportHash), so an unchanged dry run and the final
/// import produce the same hash for --accept-report-hash.
/// </summary>
public sealed record MigrationReport(
    string Kind,
    int ReportFormatVersion,
    string Mode,
    string GeneratedAt,
    string TargetDatabase,
    IReadOnlyList<MigrationReportBundle> Bundles,
    string ManifestHash,
    string MappingHash,
    string BatchHash,
    MigrationReportCounts InputCounts,
    MigrationPlannedCounts PlannedCounts,
    string OrganizationId,
    string OwnerUserId,
    string? PlaceholderLeagueTarget,
    IReadOnlyList<MigrationCalendarMappingSummary> CalendarEventMappings,
    IReadOnlyList<string> Deduplicates,
    IReadOnlyList<MigrationReportIssue> Conflicts,
    IReadOnlyList<string> Collisions,
    IReadOnlyList<MigrationSanitationChange> SanitationChanges,
    MigrationEntityHashes EntityHashes,
    IReadOnlyList<MigrationReportIssue> Warnings,
    IReadOnlyList<MigrationReportIssue> Errors,
    string ReportHash)
{
    public const string ReportKind = "gones.migration-report";
    public const int FormatVersion = 1;

    private static readonly string[] VolatileFields = ["mode", "generatedAt", "reportHash"];

    public bool HasErrors => Errors.Count > 0;
    public bool HasWarnings => Warnings.Count > 0;

    /// <summary>Machine-readable report, camelCased through the shared options so it matches the frontend style.</summary>
    public string ToJson() => LeagueJson.Serialize(this);

    /// <summary>Recomputes and stamps the stable hash over the non-volatile report content.</summary>
    public MigrationReport WithComputedHash()
    {
        using var document = JsonDocument.Parse(LeagueJson.Serialize(this with { ReportHash = string.Empty }));
        return this with { ReportHash = CanonicalJson.Checksum(document.RootElement, VolatileFields) };
    }

    public string ToHumanSummary()
    {
        var lines = new List<string>
        {
            $"Gones migration review ({Mode})",
            $"  Target database: {TargetDatabase}",
            $"  Batch hash:      {BatchHash}",
            $"  Report hash:     {ReportHash}",
            $"  Bundles ({Bundles.Count}):"
        };
        foreach (var bundle in Bundles)
        {
            lines.Add($"    - {bundle.FileName} [{bundle.Role}] source={bundle.SourceInstanceId} leagues={bundle.Counts.Leagues} tournaments={bundle.Counts.Tournaments} events={bundle.Counts.CalendarEvents} live={bundle.Counts.LiveTournaments} archetypes={bundle.Counts.DeckArchetypes}");
        }

        lines.Add($"  Planned: {PlannedCounts.LeaguesToCreate} Leagues, {PlannedCounts.TournamentsToImport} Tournaments (+{PlannedCounts.TournamentsMergedIntoPlaceholderTarget} into '{PlaceholderLeagueTarget ?? "-"}'), {PlannedCounts.ScheduledTournaments} Scheduled Tournaments, {PlannedCounts.LiveTournamentsToCreate} Live drafts, {PlannedCounts.DeckArchetypesToAdd} new Deck Archetypes ({PlannedCounts.DeckArchetypesAlreadyPresent} already present), {PlannedCounts.SkippedEntities} skipped.");
        if (Deduplicates.Count > 0) lines.Add($"  Deduplicated identical entities: {string.Join(", ", Deduplicates)}");
        foreach (var conflict in Conflicts) lines.Add($"  Conflict {conflict.Code}: {conflict.Detail}");
        foreach (var collision in Collisions) lines.Add($"  Collision: {collision}");
        foreach (var change in SanitationChanges) lines.Add($"  Sanitation [{change.EntityId}] {change.Change}: {change.Detail}");
        lines.Add($"  Warnings: {Warnings.Count}");
        foreach (var warning in Warnings) lines.Add($"    ! {warning.Code}: {warning.Detail}");
        lines.Add($"  Errors: {Errors.Count}");
        foreach (var error in Errors) lines.Add($"    X {error.Code}: {error.Detail}");
        return string.Join(Environment.NewLine, lines);
    }
}
