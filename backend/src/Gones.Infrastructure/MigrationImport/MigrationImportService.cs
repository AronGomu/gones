using System.Data;
using System.Diagnostics;
using System.Globalization;
using System.Text.Json.Nodes;
using Gones.Application.Migration;
using Gones.Domain.Calendar;
using Gones.Domain.Catalog;
using Gones.Domain.Leagues;
using Gones.Domain.Live;
using Gones.Domain.Organizations;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.Infrastructure.MigrationImport;

public sealed record MigrationVerification(
    bool Passed,
    int LeaguesVerified,
    int ScheduledTournamentsVerified,
    int LiveTournamentsVerified,
    int DeckArchetypesVerified,
    int DerivedResultSamples,
    IReadOnlyList<string> Failures);

public sealed record MigrationImportOutcome(
    int ExitCode,
    MigrationReport? Report,
    string? ResultJson,
    bool AlreadyImported,
    MigrationVerification? Verification,
    string? FailureMessage);

/// <summary>
/// Executes the dry-run-first migration import: evaluation is pure, the import itself is one
/// serializable transaction, and a batch idempotency record makes reruns return the stored result.
/// </summary>
public sealed class MigrationImportService(GonesDbContext database, IClock clock)
{
    public const string IdempotencyScope = "migration-import";
    public const string FaultAfterLeagues = "after-leagues";
    public const string FaultAfterScheduled = "after-scheduled";

    public async Task<MigrationImportOutcome> RunAsync(
        MigrationImportOptions options,
        string? faultInjection = null,
        CancellationToken cancellationToken = default)
    {
        var stopwatch = Stopwatch.StartNew();
        List<MigrationBundleFile> bundles = [];
        MigrationManifestFile manifest;
        MigrationMappingFile mapping;
        try
        {
            foreach (var path in options.BundlePaths) bundles.Add(MigrationBundleReader.Read(path));
            manifest = MigrationManifestReader.Read(options.ManifestPath);
            mapping = MigrationMappingReader.Read(options.MappingPath);
        }
        catch (MigrationInputException exception)
        {
            LogMetrics("rejected-input", stopwatch, null, null);
            return new MigrationImportOutcome(2, null, null, false, null, exception.Message);
        }

        var now = clock.GetCurrentInstant();
        var target = await LoadTargetStateAsync(mapping, cancellationToken);
        var evaluation = MigrationPlanner.Evaluate(
            bundles, manifest, mapping, target,
            options.DryRun ? "dry-run" : "import",
            now.ToDateTimeUtc().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture));
        var report = evaluation.Report;
        var plan = evaluation.Plan;

        var existing = await database.IdempotencyRecords
            .AsNoTracking()
            .SingleOrDefaultAsync(record => record.Scope == IdempotencyScope && record.Key == plan.BatchHash, cancellationToken);
        if (existing is not null)
        {
            LogMetrics("already-imported", stopwatch, report, plan);
            // Canonicalized so the rerun output is byte-identical to the first import, even though
            // Postgres stores the batch result as jsonb and returns its own key order.
            return new MigrationImportOutcome(0, report, Canonical(existing.ResponseBody), true, null, null);
        }

        if (options.DryRun)
        {
            LogMetrics(report.HasErrors ? "dry-run-blocked" : "dry-run-ok", stopwatch, report, plan);
            return new MigrationImportOutcome(report.HasErrors ? 1 : 0, report, null, false, null, null);
        }

        if (report.HasErrors)
        {
            LogMetrics("blocked-errors", stopwatch, report, plan);
            return new MigrationImportOutcome(2, report, null, false, null, "Errors block the import; fix the inputs and run a new dry run.");
        }

        if (!string.Equals(options.AcceptReportHash, report.ReportHash, StringComparison.Ordinal))
        {
            LogMetrics("blocked-report-hash", stopwatch, report, plan);
            return new MigrationImportOutcome(3, report, null, false, null,
                $"--accept-report-hash does not match the current evaluation ({report.ReportHash}). The inputs or target changed: run a new dry run and review it.");
        }

        string resultJson;
        try
        {
            resultJson = await ImportAsync(plan, mapping, report, faultInjection, now, cancellationToken);
        }
        catch (Exception exception)
        {
            LogMetrics("failed", stopwatch, report, plan);
            return new MigrationImportOutcome(5, report, null, false, null, $"Import failed and was rolled back: {exception.Message}");
        }

        var verification = await VerifyAsync(plan, report, cancellationToken);
        LogMetrics(verification.Passed ? "imported" : "imported-verification-failed", stopwatch, report, plan);
        return new MigrationImportOutcome(verification.Passed ? 0 : 4, report, resultJson, false, verification, null);
    }

    private async Task<string> ImportAsync(
        MigrationPlan plan,
        MigrationMappingFile mapping,
        MigrationReport report,
        string? faultInjection,
        Instant now,
        CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);

        foreach (var league in plan.LeaguesToCreate)
        {
            database.LeagueArchiveAggregates.Add(LeagueArchiveAggregate.Create(league, now));
        }

        if (plan.PlaceholderLeagueTarget == LeagueNormalizer.PlaceholderLeagueId && plan.TournamentsForPlaceholderTarget.Count > 0)
        {
            var placeholder = await database.LeagueArchiveAggregates
                .SingleAsync(aggregate => aggregate.DocumentId == LeagueNormalizer.PlaceholderLeagueId && aggregate.DeletedAt == null, cancellationToken);
            var document = placeholder.ReadDocument();
            placeholder.Apply(document with { Tournaments = [.. document.Tournaments, .. plan.TournamentsForPlaceholderTarget] }, now);
        }

        await database.SaveChangesAsync(cancellationToken);
        if (faultInjection == FaultAfterLeagues)
        {
            throw new InvalidOperationException("Injected fault after League import (test hook).");
        }

        if (plan.ScheduledTournaments.Count > 0)
        {
            var slugs = plan.ScheduledTournaments.SelectMany(item => item.FormatSlugs).Distinct(StringComparer.Ordinal).ToArray();
            var formats = await database.TournamentFormats
                .Where(format => slugs.Contains(format.Slug) && format.DeletedAt == null)
                .ToListAsync(cancellationToken);
            foreach (var planned in plan.ScheduledTournaments)
            {
                var selectedFormats = formats.Where(format => planned.FormatSlugs.Contains(format.Slug, StringComparer.Ordinal)).ToArray();
                var tournament = Event.Create(mapping.OrganizationId, mapping.OwnerUserId, planned.Draft, selectedFormats, now);
                if (planned.StatusPolicy == "cancelled")
                {
                    tournament.Cancel(now);
                }
                else
                {
                    // Published policy: past events advance to their natural lifecycle state.
                    tournament.AdvanceLifecycle(now);
                    tournament.AdvanceLifecycle(now);
                }

                database.Events.Add(tournament);
            }
        }

        await database.SaveChangesAsync(cancellationToken);
        if (faultInjection == FaultAfterScheduled)
        {
            throw new InvalidOperationException("Injected fault after Scheduled Tournament import (test hook).");
        }

        foreach (var live in plan.LiveTournamentsToCreate)
        {
            database.LiveAggregates.Add(LiveAggregate.Create(live, now));
        }

        foreach (var archetype in plan.DeckArchetypesToAdd)
        {
            database.DeckArchetypes.Add(DeckArchetype.Create(archetype, now));
        }

        var truncatedBatchHash = TruncateHash(plan.BatchHash);
        var resultNode = new JsonObject
        {
            ["batchHash"] = plan.BatchHash,
            ["reportHash"] = report.ReportHash,
            ["importedAt"] = now.ToDateTimeUtc().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture),
            ["counts"] = new JsonObject
            {
                ["leaguesCreated"] = plan.LeaguesToCreate.Count,
                ["tournamentsImported"] = plan.LeaguesToCreate.Sum(league => league.Tournaments.Count) + plan.TournamentsForPlaceholderTarget.Count,
                ["scheduledTournamentsCreated"] = plan.ScheduledTournaments.Count,
                ["liveTournamentsCreated"] = plan.LiveTournamentsToCreate.Count,
                ["deckArchetypesCreated"] = plan.DeckArchetypesToAdd.Count
            }
        };
        var resultJson = Canonical(resultNode.ToJsonString());

        database.AuditRecords.Add(new AuditRecord
        {
            Action = "migration.import",
            EntityType = "migration_batch",
            EntityId = truncatedBatchHash,
            RedactedDiff = resultJson,
            OccurredAt = now
        });
        database.IdempotencyRecords.Add(new IdempotencyRecord
        {
            Scope = IdempotencyScope,
            Key = plan.BatchHash,
            ResponseStatusCode = 200,
            ResponseBody = resultJson,
            CreatedAt = now,
            ExpiresAt = now.Plus(Duration.FromDays(36500))
        });

        // Imported Tournaments normalise to completed, so they belong in player_statistics (ADR 0040).
        // The rebuild itself lives in Gones.Api, which this assembly cannot reference, so the import
        // invalidates the read model instead of recomputing it: clearing the stamp is what makes
        // PlayerStatisticsStartupRebuild treat the table as stale, and the API always starts after the
        // migrator container this runs in. Until it does, the missing stamp also moves the public
        // rankings ETag, so no conditional request is answered 304 over numbers that changed. Same
        // trick as scripts/seed-dev-environment.mjs after its bulk load.
        await database.Database.ExecuteSqlRawAsync("DELETE FROM player_statistics_meta", cancellationToken);

        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return resultJson;
    }

    /// <summary>Post-import verifier: source/target counts, canonical hashes, sampled derived result parity.</summary>
    private async Task<MigrationVerification> VerifyAsync(MigrationPlan plan, MigrationReport report, CancellationToken cancellationToken)
    {
        var failures = new List<string>();
        database.ChangeTracker.Clear();

        var leagueIds = plan.LeaguesToCreate.Select(league => league.Id).ToArray();
        var storedLeagues = await database.LeagueArchiveAggregates
            .AsNoTracking()
            .Where(aggregate => leagueIds.Contains(aggregate.DocumentId) && aggregate.DeletedAt == null)
            .ToListAsync(cancellationToken);
        if (storedLeagues.Count != plan.LeaguesToCreate.Count)
        {
            failures.Add($"expected {plan.LeaguesToCreate.Count} imported Leagues but found {storedLeagues.Count}");
        }

        var derivedSamples = 0;
        foreach (var league in plan.LeaguesToCreate)
        {
            var stored = storedLeagues.FirstOrDefault(aggregate => aggregate.DocumentId == league.Id);
            if (stored is null)
            {
                failures.Add($"league {league.Id} missing after import");
                continue;
            }

            var storedHash = MigrationPlanner.DocumentHash(stored.CanonicalDocument);
            if (report.EntityHashes.Leagues.TryGetValue(league.Id, out var expectedHash) && !string.Equals(storedHash, expectedHash, StringComparison.Ordinal))
            {
                failures.Add($"league {league.Id} canonical hash differs: expected {expectedHash} but stored {storedHash}");
            }

            if (derivedSamples < 3 && league.Tournaments.Count > 0)
            {
                derivedSamples++;
                var sourceResult = LeagueJson.ToNode(LeagueRules.CalculateLeagueResult(league));
                var storedResult = LeagueJson.ToNode(LeagueRules.CalculateLeagueResult(stored.ReadDocument()));
                if (!JsonNode.DeepEquals(sourceResult, storedResult))
                {
                    failures.Add($"league {league.Id} derived result parity failed between source and stored documents");
                }
            }
        }

        if (plan.PlaceholderLeagueTarget == LeagueNormalizer.PlaceholderLeagueId && plan.TournamentsForPlaceholderTarget.Count > 0)
        {
            var placeholder = await database.LeagueArchiveAggregates
                .AsNoTracking()
                .SingleAsync(aggregate => aggregate.DocumentId == LeagueNormalizer.PlaceholderLeagueId && aggregate.DeletedAt == null, cancellationToken);
            var placeholderTournamentIds = placeholder.ReadDocument().Tournaments.Select(tournament => tournament.Id).ToHashSet(StringComparer.Ordinal);
            foreach (var tournament in plan.TournamentsForPlaceholderTarget.Where(tournament => !placeholderTournamentIds.Contains(tournament.Id)))
            {
                failures.Add($"unassigned Tournament {tournament.Id} missing from the target placeholder League");
            }
        }

        var storedLiveCount = 0;
        foreach (var live in plan.LiveTournamentsToCreate)
        {
            var stored = await database.LiveAggregates
                .AsNoTracking()
                .SingleOrDefaultAsync(aggregate => aggregate.DocumentId == live.Id && aggregate.DeletedAt == null, cancellationToken);
            if (stored is null)
            {
                failures.Add($"live tournament {live.Id} missing after import");
                continue;
            }

            storedLiveCount++;
            var storedHash = MigrationPlanner.DocumentHash(stored.CanonicalDocument);
            if (report.EntityHashes.LiveTournaments.TryGetValue(live.Id, out var expectedHash) && !string.Equals(storedHash, expectedHash, StringComparison.Ordinal))
            {
                failures.Add($"live tournament {live.Id} canonical hash differs: expected {expectedHash} but stored {storedHash}");
            }
        }

        var archetypeKeys = plan.DeckArchetypesToAdd.Select(DeckArchetype.NormalizeKey).ToArray();
        var storedArchetypes = await database.DeckArchetypes
            .AsNoTracking()
            .CountAsync(archetype => archetypeKeys.Contains(archetype.NormalizedName) && archetype.DeletedAt == null, cancellationToken);
        if (storedArchetypes != plan.DeckArchetypesToAdd.Count)
        {
            failures.Add($"expected {plan.DeckArchetypesToAdd.Count} imported Deck Archetypes but found {storedArchetypes}");
        }

        var scheduledSourceIds = plan.ScheduledTournaments.Select(item => item.Draft.Slug).ToArray();
        var storedScheduled = await database.Events
            .AsNoTracking()
            .CountAsync(tournament => scheduledSourceIds.Contains(tournament.Slug) && tournament.DeletedAt == null, cancellationToken);
        if (storedScheduled != plan.ScheduledTournaments.Count)
        {
            failures.Add($"expected {plan.ScheduledTournaments.Count} imported Scheduled Tournaments but found {storedScheduled}");
        }

        return new MigrationVerification(
            failures.Count == 0,
            storedLeagues.Count,
            storedScheduled,
            storedLiveCount,
            storedArchetypes,
            derivedSamples,
            failures);
    }

    private async Task<MigrationTargetState> LoadTargetStateAsync(MigrationMappingFile mapping, CancellationToken cancellationToken)
    {
        var connection = database.Database.GetDbConnection();
        var databaseIdentity = $"{connection.DataSource}/{connection.Database}";

        var leagueIds = await database.LeagueArchiveAggregates
            .AsNoTracking()
            .Where(aggregate => aggregate.DeletedAt == null)
            .Select(aggregate => aggregate.DocumentId)
            .ToListAsync(cancellationToken);
        var placeholder = await database.LeagueArchiveAggregates
            .AsNoTracking()
            .SingleOrDefaultAsync(aggregate => aggregate.DocumentId == LeagueNormalizer.PlaceholderLeagueId && aggregate.DeletedAt == null, cancellationToken);
        var placeholderTournamentIds = placeholder is null
            ? []
            : placeholder.ReadDocument().Tournaments.Select(tournament => tournament.Id).ToHashSet(StringComparer.Ordinal);
        var liveIds = await database.LiveAggregates
            .AsNoTracking()
            .Where(aggregate => aggregate.DeletedAt == null)
            .Select(aggregate => aggregate.DocumentId)
            .ToListAsync(cancellationToken);
        var archetypeKeys = await database.DeckArchetypes
            .AsNoTracking()
            .Where(archetype => archetype.DeletedAt == null)
            .Select(archetype => archetype.NormalizedName)
            .ToListAsync(cancellationToken);
        var slugs = await database.Events
            .AsNoTracking()
            .Select(tournament => tournament.Slug)
            .ToListAsync(cancellationToken);
        var formats = await database.TournamentFormats
            .AsNoTracking()
            .Where(format => format.DeletedAt == null)
            .Select(format => new { format.Slug, format.Id })
            .ToListAsync(cancellationToken);
        var organizationExists = await database.Organizations
            .AsNoTracking()
            .AnyAsync(organization => organization.Id == mapping.OrganizationId && organization.DeletedAt == null, cancellationToken);
        // A bundle predates ADR 0041, so the Owner role it names maps to the only role left,
        // Organizer: the mapping's owner just has to be a member of the target organization.
        var ownerIsOwner = await database.OrganizationMembers
            .AsNoTracking()
            .AnyAsync(member => member.OrganizationId == mapping.OrganizationId
                                && member.UserId == mapping.OwnerUserId
                                && member.Role == OrganizationRoles.Organizer, cancellationToken);

        return new MigrationTargetState(
            databaseIdentity,
            leagueIds.ToHashSet(StringComparer.Ordinal),
            placeholderTournamentIds,
            liveIds.ToHashSet(StringComparer.Ordinal),
            archetypeKeys.ToHashSet(StringComparer.Ordinal),
            slugs.ToHashSet(StringComparer.Ordinal),
            organizationExists,
            ownerIsOwner,
            formats.ToDictionary(format => format.Slug, format => format.Id, StringComparer.Ordinal));
    }

    private static void LogMetrics(string result, Stopwatch stopwatch, MigrationReport? report, MigrationPlan? plan)
    {
        // Structured metrics line; the bundle/batch hash is truncated so logs never carry full content hashes.
        var metrics = new JsonObject
        {
            ["metric"] = "gones.migration.import",
            ["result"] = result,
            ["durationMs"] = stopwatch.ElapsedMilliseconds,
            ["batchHash"] = plan is null ? null : TruncateHash(plan.BatchHash),
            ["errors"] = report?.Errors.Count,
            ["warnings"] = report?.Warnings.Count,
            ["plannedLeagues"] = plan?.LeaguesToCreate.Count,
            ["plannedScheduledTournaments"] = plan?.ScheduledTournaments.Count,
            ["plannedLiveTournaments"] = plan?.LiveTournamentsToCreate.Count,
            ["plannedDeckArchetypes"] = plan?.DeckArchetypesToAdd.Count
        };
        Console.WriteLine(metrics.ToJsonString());
    }

    private static string Canonical(string json)
    {
        using var document = System.Text.Json.JsonDocument.Parse(json);
        return CanonicalJson.Stringify(document.RootElement);
    }

    private static string TruncateHash(string hash)
    {
        var value = hash.StartsWith(CanonicalJson.ChecksumPrefix, StringComparison.Ordinal)
            ? hash[CanonicalJson.ChecksumPrefix.Length..]
            : hash;
        return value.Length <= 12 ? value : value[..12];
    }
}
