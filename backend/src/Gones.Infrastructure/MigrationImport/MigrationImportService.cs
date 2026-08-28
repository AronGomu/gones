using System.Data;
using System.Diagnostics;
using System.Globalization;
using System.Text.Json.Nodes;
using Gones.Application.Migration;
using Gones.Domain.Archive;
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

        // A bundle League is a flat record; the archive has three tiers and a Season needs a parent, so
        // each imported League becomes one ArchiveLeague holding one ArchiveLeagueSeason of the same
        // name. The Season keeps the bundle's League id, because that is the id the report, the manifest
        // resolutions and the verifier all key on. Its Tournaments become their own rows beneath it.
        foreach (var league in plan.LeaguesToCreate)
        {
            ArchiveTournamentDocument[] documents = [.. league.Tournaments.Select(tournament => ArchiveDocument(tournament, league.Id))];
            var season = ArchiveLeagueSeason.Create(league.Id, LeagueTierId(league.Id), league.Name, league.Status, now);
            database.ArchiveLeagues.Add(ArchiveLeague.Create(LeagueTierId(league.Id), league.Name, now));
            database.ArchiveLeagueSeasons.Add(season);
            foreach (var document in documents)
            {
                database.ArchiveTournaments.Add(ArchiveTournament.Create(document, now));
            }

            // The same counters a Tournament command would leave behind, from the same formula, inside
            // the import's own transaction. Nothing else would ever write them: the only other callers of
            // RefreshCatalogCounts are the two Tournament command paths, so a Season imported at zero
            // prints zero and expands to nothing until one of its Tournaments is edited through the API.
            season.RefreshCatalogCounts(ArchiveCatalogCounts.ForSeason(league.Id, documents));
        }

        // No League, no Season: the fixed placeholder row they used to merge into is retired.
        foreach (var tournament in plan.StandaloneTournaments)
        {
            database.ArchiveTournaments.Add(ArchiveTournament.Create(ArchiveDocument(tournament, null), now));
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
                ["tournamentsImported"] = plan.LeaguesToCreate.Sum(league => league.Tournaments.Count) + plan.StandaloneTournaments.Count,
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
        var storedSeasons = await database.ArchiveLeagueSeasons
            .AsNoTracking()
            .Where(season => leagueIds.Contains(season.DocumentId) && season.DeletedAt == null)
            .ToListAsync(cancellationToken);
        var storedTournaments = await database.ArchiveTournaments
            .AsNoTracking()
            .Where(tournament => tournament.DeletedAt == null)
            .ToListAsync(cancellationToken);
        if (storedSeasons.Count != plan.LeaguesToCreate.Count)
        {
            failures.Add($"expected {plan.LeaguesToCreate.Count} imported Leagues but found {storedSeasons.Count}");
        }

        var derivedSamples = 0;
        foreach (var league in plan.LeaguesToCreate)
        {
            var stored = storedSeasons.FirstOrDefault(season => season.DocumentId == league.Id);
            if (stored is null)
            {
                failures.Add($"league {league.Id} missing after import");
                continue;
            }

            // The League document is reassembled from its Season row plus the Tournament rows beneath
            // it, so the hash and the derived result still compare against exactly what the source said.
            var rebuilt = RebuildLeagueDocument(stored.DocumentId, stored.Name, stored.Status, storedTournaments);
            var storedHash = MigrationPlanner.CanonicalLeagueHash(rebuilt);
            if (report.EntityHashes.Leagues.TryGetValue(league.Id, out var expectedHash) && !string.Equals(storedHash, expectedHash, StringComparison.Ordinal))
            {
                failures.Add($"league {league.Id} canonical hash differs: expected {expectedHash} but stored {storedHash}");
            }

            if (derivedSamples < 3 && league.Tournaments.Count > 0)
            {
                derivedSamples++;
                var sourceResult = LeagueJson.ToNode(LeagueRules.CalculateLeagueResult(league));
                var storedResult = LeagueJson.ToNode(LeagueRules.CalculateLeagueResult(rebuilt));
                if (!JsonNode.DeepEquals(sourceResult, storedResult))
                {
                    failures.Add($"league {league.Id} derived result parity failed between source and stored documents");
                }
            }
        }

        var standaloneIds = storedTournaments
            .Where(tournament => tournament.SeasonId is null)
            .Select(tournament => tournament.DocumentId)
            .ToHashSet(StringComparer.Ordinal);
        foreach (var tournament in plan.StandaloneTournaments.Where(tournament => !standaloneIds.Contains(tournament.Id)))
        {
            failures.Add($"unassigned Tournament {tournament.Id} missing as a standalone Archive Tournament");
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
            storedSeasons.Count,
            storedScheduled,
            storedLiveCount,
            storedArchetypes,
            derivedSamples,
            failures);
    }

    /// <summary>The parent League minted for an imported bundle League. Deterministic, so a re-run collides instead of duplicating.</summary>
    private static string LeagueTierId(string seasonId) => $"{seasonId}-league";

    private static ArchiveTournamentDocument ArchiveDocument(TournamentDocument tournament, string? seasonId) =>
        new(tournament.Id, tournament.Name, seasonId, tournament.TournamentDate, tournament.Status, tournament.Rounds, tournament.PlayerArchetypes);

    /// <summary>The flat League document the bundle described, reassembled from the three tiers that now hold it.</summary>
    private static LeagueDocument RebuildLeagueDocument(string seasonId, string name, string status, IReadOnlyList<ArchiveTournament> stored) =>
        new(seasonId, name, status,
            [.. stored
                .Where(tournament => tournament.SeasonId == seasonId)
                .Select(tournament => tournament.ReadDocument())
                .Select(document => new TournamentDocument(document.Id, seasonId, document.Name, document.TournamentDate, document.Status, document.Rounds, document.PlayerArchetypes))
                .OrderBy(document => document.Id, StringComparer.Ordinal)]);

    private async Task<MigrationTargetState> LoadTargetStateAsync(MigrationMappingFile mapping, CancellationToken cancellationToken)
    {
        var connection = database.Database.GetDbConnection();
        var databaseIdentity = $"{connection.DataSource}/{connection.Database}";

        var leagueIds = await database.ArchiveLeagueSeasons
            .AsNoTracking()
            .Where(season => season.DeletedAt == null)
            .Select(season => season.DocumentId)
            .ToListAsync(cancellationToken);
        var standaloneTournamentIds = (await database.ArchiveTournaments
            .AsNoTracking()
            .Where(tournament => tournament.SeasonId == null && tournament.DeletedAt == null)
            .Select(tournament => tournament.DocumentId)
            .ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.Ordinal);
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
            standaloneTournamentIds,
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
