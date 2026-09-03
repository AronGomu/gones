using System.Text.Json;
using System.Text.Json.Nodes;
using Gones.Api.Archive;
using Gones.Api.Leagues;
using Gones.Application.Migration;
using Gones.Domain.Archive;
using Gones.Domain.Catalog;
using Gones.Domain.Organizations;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.MigrationImport;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using NodaTime;

namespace Gones.IntegrationTests;

/// <summary>
/// End-to-end coverage of the dry-run-first migration CLI against a real database: dry runs never
/// write, a mid-import fault leaves zero partial rows, and reruns return the stored batch result.
/// </summary>
public sealed class MigrationImportServiceTests : IAsyncLifetime
{
    private readonly PostgreSqlTestContainer postgres = new();
    private static readonly Instant Now = Instant.FromUtc(2026, 8, 1, 12, 0);
    private const string SourceInstanceId = "11111111-1111-4111-8111-111111111111";

    public Task InitializeAsync() => postgres.StartAsync();

    public Task DisposeAsync() => postgres.DisposeAsync().AsTask();

    [Fact]
    public async Task Dry_run_produces_a_clean_report_and_writes_nothing()
    {
        await using var db = await CreateMigratedContextAsync();
        var seed = await SeedAsync(db);
        var inputs = WriteInputs(seed);
        var baseline = await CensusAsync();

        var outcome = await new MigrationImportService(db, new FixedClock(Now))
            .RunAsync(Options(inputs, dryRun: true));

        Assert.Equal(0, outcome.ExitCode);
        Assert.NotNull(outcome.Report);
        Assert.Empty(outcome.Report!.Errors);
        Assert.Equal("dry-run", outcome.Report.Mode);
        Assert.Equal(1, outcome.Report.PlannedCounts.LeaguesToCreate);
        Assert.Equal(1, outcome.Report.PlannedCounts.ScheduledTournaments);
        Assert.Equal(1, outcome.Report.PlannedCounts.LiveTournamentsToCreate);
        Assert.Equal(2, outcome.Report.PlannedCounts.DeckArchetypesToAdd);
        Assert.Null(outcome.ResultJson);
        await AssertNothingImportedAsync(baseline);
    }

    [Fact]
    public async Task Blocking_errors_and_stale_report_hashes_refuse_to_import()
    {
        await using var db = await CreateMigratedContextAsync();
        var seed = await SeedAsync(db);
        var baseline = await CensusAsync();

        // Unmapped Calendar event: every legacy event needs its own explicit mapping entry.
        var unmapped = WriteInputs(seed, mapEvents: false);
        var blocked = await new MigrationImportService(db, new FixedClock(Now))
            .RunAsync(Options(unmapped, dryRun: true));
        Assert.Equal(1, blocked.ExitCode);
        Assert.Contains(blocked.Report!.Errors, error => error.Code == "unmappedCalendarEvent");
        await AssertNothingImportedAsync(baseline);

        // Bad checksum: the bundle file was tampered with after export.
        var tampered = WriteInputs(seed, tamperBundle: true);
        var rejected = await new MigrationImportService(db, new FixedClock(Now))
            .RunAsync(Options(tampered, dryRun: true));
        Assert.Equal(2, rejected.ExitCode);
        Assert.Null(rejected.Report);
        Assert.Contains("bundleChecksumMismatch", rejected.FailureMessage);
        await AssertNothingImportedAsync(baseline);

        // Right inputs, wrong accepted report hash: the operator must review a fresh dry run.
        var inputs = WriteInputs(seed);
        var stale = await new MigrationImportService(db, new FixedClock(Now))
            .RunAsync(Options(inputs, dryRun: false, acceptReportHash: "sha256:" + new string('0', 64)));
        Assert.Equal(3, stale.ExitCode);
        Assert.Contains("--accept-report-hash", stale.FailureMessage);
        await AssertNothingImportedAsync(baseline);
    }

    [Fact]
    public async Task Accepted_dry_run_imports_every_store_and_verifies_the_result()
    {
        await using var db = await CreateMigratedContextAsync();
        var seed = await SeedAsync(db);
        var inputs = WriteInputs(seed);
        var dryRun = await new MigrationImportService(db, new FixedClock(Now)).RunAsync(Options(inputs, dryRun: true));

        await using var importContext = CreateContext();
        var outcome = await new MigrationImportService(importContext, new FixedClock(Now))
            .RunAsync(Options(inputs, dryRun: false, acceptReportHash: dryRun.Report!.ReportHash));

        Assert.True(outcome.ExitCode == 0, outcome.FailureMessage);
        Assert.False(outcome.AlreadyImported);
        Assert.NotNull(outcome.Verification);
        Assert.True(outcome.Verification!.Passed, string.Join("; ", outcome.Verification.Failures));
        Assert.Equal(1, outcome.Verification.LeaguesVerified);
        Assert.Equal(1, outcome.Verification.ScheduledTournamentsVerified);
        Assert.Equal(1, outcome.Verification.LiveTournamentsVerified);
        Assert.Equal(2, outcome.Verification.DeckArchetypesVerified);
        Assert.True(outcome.Verification.DerivedResultSamples > 0);

        await using var verify = CreateContext();
        Assert.Equal(1, await verify.ArchiveLeagueSeasons.CountAsync(season => season.DocumentId == "league-1"));
        Assert.Equal(1, await verify.LiveAggregates.CountAsync(aggregate => aggregate.DocumentId == "live-1"));
        var scheduled = await verify.Events.Include(item => item.Formats).SingleAsync(item => item.Slug == "summer-cup");
        Assert.Equal(seed.Organization.Id, scheduled.OrganizationId);
        Assert.Equal(seed.User.Id, scheduled.CreatedByUserId);
        Assert.Equal("Europe/Paris", scheduled.TimeZoneId);
        Assert.Equal(seed.Legacy.Id, Assert.Single(scheduled.Formats).TournamentFormatId);

        // Audit + idempotency record carry only a truncated batch hash, never the bundle contents.
        var audit = await verify.AuditRecords.SingleAsync(record => record.Action == "migration.import");
        Assert.Equal("migration_batch", audit.EntityType);
        Assert.Equal(12, audit.EntityId.Length);
        Assert.DoesNotContain("summer-cup", audit.RedactedDiff, StringComparison.Ordinal);
        var batch = await verify.IdempotencyRecords.SingleAsync(record => record.Scope == MigrationImportService.IdempotencyScope);
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(outcome.ResultJson!), JsonNode.Parse(batch.ResponseBody)));
    }

    [Fact]
    public async Task Verification_passes_when_bundle_tournaments_are_listed_in_descending_id_order()
    {
        await using var db = await CreateMigratedContextAsync();
        var seed = await SeedAsync(db);
        var inputs = WriteInputs(seed, tournamentsDescending: true);
        var dryRun = await new MigrationImportService(db, new FixedClock(Now)).RunAsync(Options(inputs, dryRun: true));

        await using var importContext = CreateContext();
        var outcome = await new MigrationImportService(importContext, new FixedClock(Now))
            .RunAsync(Options(inputs, dryRun: false, acceptReportHash: dryRun.Report!.ReportHash));

        Assert.Equal(0, outcome.ExitCode);
        Assert.NotNull(outcome.Verification);
        Assert.True(outcome.Verification!.Passed, string.Join("; ", outcome.Verification.Failures));
        Assert.Equal(1, outcome.Verification.LeaguesVerified);
    }

    [Fact]
    public async Task Rerunning_the_same_batch_returns_the_stored_result_without_duplicating_rows()
    {
        await using var db = await CreateMigratedContextAsync();
        var seed = await SeedAsync(db);
        var inputs = WriteInputs(seed);
        var dryRun = await new MigrationImportService(db, new FixedClock(Now)).RunAsync(Options(inputs, dryRun: true));

        await using var first = CreateContext();
        var imported = await new MigrationImportService(first, new FixedClock(Now))
            .RunAsync(Options(inputs, dryRun: false, acceptReportHash: dryRun.Report!.ReportHash));
        Assert.Equal(0, imported.ExitCode);

        await using var second = CreateContext();
        var rerun = await new MigrationImportService(second, new FixedClock(Now))
            .RunAsync(Options(inputs, dryRun: false, acceptReportHash: dryRun.Report.ReportHash));

        Assert.Equal(0, rerun.ExitCode);
        Assert.True(rerun.AlreadyImported);
        Assert.Equal(imported.ResultJson, rerun.ResultJson);

        await using var verify = CreateContext();
        Assert.Equal(1, await verify.ArchiveLeagueSeasons.CountAsync(season => season.DocumentId == "league-1"));
        Assert.Equal(1, await verify.LiveAggregates.CountAsync(aggregate => aggregate.DocumentId == "live-1"));
        Assert.Equal(1, await verify.Events.CountAsync(item => item.Slug == "summer-cup"));
        Assert.Equal(1, await verify.IdempotencyRecords.CountAsync(record => record.Scope == MigrationImportService.IdempotencyScope));
        Assert.Equal(1, await verify.AuditRecords.CountAsync(record => record.Action == "migration.import"));
    }

    /// <summary>
    /// An imported Season owns the same four denormalized counters a commanded one does, computed in the
    /// import's own transaction. Nothing else ever repairs them: the only callers of
    /// <c>RefreshCatalogCounts</c> are the two Tournament command paths, so a Season left at zero stays
    /// at zero until one of its Tournaments is written through the API. The two dates are the sharp end
    /// — the browser reads them to pick which cached year partitions may serve the Season expansion, and
    /// a null pair is an empty year set, which is an expansion that answers nothing without ever asking
    /// the server.
    /// </summary>
    [Fact]
    public async Task An_imported_Season_carries_the_counters_its_catalog_row_prints()
    {
        await using var db = await CreateMigratedContextAsync();
        var seed = await SeedAsync(db);
        var inputs = WriteInputs(seed);
        var dryRun = await new MigrationImportService(db, new FixedClock(Now)).RunAsync(Options(inputs, dryRun: true));

        await using var importContext = CreateContext();
        var outcome = await new MigrationImportService(importContext, new FixedClock(Now))
            .RunAsync(Options(inputs, dryRun: false, acceptReportHash: dryRun.Report!.ReportHash));
        Assert.Equal(0, outcome.ExitCode);

        await using var verify = CreateContext();
        var season = await verify.ArchiveLeagueSeasons.SingleAsync(item => item.DocumentId == "league-1");
        // One imported Tournament on 2026-01-10, one match between Alice and Bob: two standings rows.
        Assert.Equal(1, season.TournamentCount);
        Assert.Equal(2, season.PlayerCount);
        Assert.Equal(new LocalDate(2026, 1, 10), season.FirstTournamentDate);
        Assert.Equal(new LocalDate(2026, 1, 10), season.LastTournamentDate);
        Assert.Equal(ArchiveCatalogCounts.Version, season.CountsVersion);
    }

    [Fact]
    public async Task A_changed_bundle_invalidates_the_accepted_report_hash()
    {
        await using var db = await CreateMigratedContextAsync();
        var seed = await SeedAsync(db);
        var inputs = WriteInputs(seed);
        var dryRun = await new MigrationImportService(db, new FixedClock(Now)).RunAsync(Options(inputs, dryRun: true));
        var baseline = await CensusAsync();

        var changed = WriteInputs(seed, extraArchetype: "Ramp");
        await using var importContext = CreateContext();
        var outcome = await new MigrationImportService(importContext, new FixedClock(Now))
            .RunAsync(Options(changed, dryRun: false, acceptReportHash: dryRun.Report!.ReportHash));

        Assert.Equal(3, outcome.ExitCode);
        Assert.Contains("run a new dry run", outcome.FailureMessage);
        await AssertNothingImportedAsync(baseline);
    }

    [Theory]
    [InlineData(MigrationImportService.FaultAfterLeagues)]
    [InlineData(MigrationImportService.FaultAfterScheduled)]
    public async Task A_fault_mid_import_rolls_back_every_row(string fault)
    {
        await using var db = await CreateMigratedContextAsync();
        var seed = await SeedAsync(db);
        var inputs = WriteInputs(seed);
        var dryRun = await new MigrationImportService(db, new FixedClock(Now)).RunAsync(Options(inputs, dryRun: true));
        var baseline = await CensusAsync();

        await using var importContext = CreateContext();
        var outcome = await new MigrationImportService(importContext, new FixedClock(Now))
            .RunAsync(Options(inputs, dryRun: false, acceptReportHash: dryRun.Report!.ReportHash), fault);

        Assert.Equal(5, outcome.ExitCode);
        Assert.Contains("rolled back", outcome.FailureMessage);
        await AssertNothingImportedAsync(baseline);

        // The batch is not recorded, so a later clean run still imports it.
        await using var retry = CreateContext();
        var recovered = await new MigrationImportService(retry, new FixedClock(Now))
            .RunAsync(Options(inputs, dryRun: false, acceptReportHash: dryRun.Report.ReportHash));
        Assert.Equal(0, recovered.ExitCode);
        Assert.True(recovered.Verification!.Passed, string.Join("; ", recovered.Verification.Failures));
    }

    /// <summary>
    /// An import writes League archives, so the ADR 0040 read model it feeds has to move with them.
    /// <c>PlayerStatisticsRebuildService</c> lives in Gones.Api and this assembly cannot reference it, so
    /// the import clears the formula stamp inside its own transaction instead: the startup rebuild then
    /// sees a stale table and repairs it, and the migrator container this runs in always precedes an API
    /// start. Leaving the stamp in place would also keep the public rankings answering 304 over numbers
    /// the import moved.
    /// </summary>
    [Fact]
    public async Task An_import_invalidates_the_player_statistics_read_model()
    {
        await using var db = await CreateMigratedContextAsync();
        var seed = await SeedAsync(db);
        var inputs = WriteInputs(seed);
        var dryRun = await new MigrationImportService(db, new FixedClock(Now)).RunAsync(Options(inputs, dryRun: true));

        // A current stamp over an empty archive: what an instance looks like the moment before an import.
        await RebuildAsync();
        await using (var stamped = CreateContext()) Assert.True(await stamped.PlayerStatisticsMeta.AnyAsync());

        await using var importContext = CreateContext();
        var outcome = await new MigrationImportService(importContext, new FixedClock(Now))
            .RunAsync(Options(inputs, dryRun: false, acceptReportHash: dryRun.Report!.ReportHash));
        Assert.Equal(0, outcome.ExitCode);

        await using (var invalidated = CreateContext())
        {
            Assert.False(await invalidated.PlayerStatisticsMeta.AnyAsync());
            Assert.Equal("unbuilt", await ArchivePlayerStatisticsEndpoints.StampAsync(invalidated, CancellationToken.None));
        }

        // What the next API start does with that stale table: the imported Match is in the numbers.
        await RebuildAsync();
        await using var repaired = CreateContext();
        // One row per player per scope since T8; the imported Match lands in the global scope.
        var alice = await repaired.PlayerStatistics.AsNoTracking()
            .SingleAsync(row => row.ScopeKind == PlayerStatisticsScope.Global && row.PlayerName == "Alice");
        Assert.Equal(1, alice.PlayedMatchCount);
        Assert.Equal(1, alice.MatchWins);
        Assert.True(await repaired.PlayerStatisticsMeta.AnyAsync());
    }

    /// <summary>The startup repair, run by hand: one transaction, rebuild, save, commit.</summary>
    private async Task RebuildAsync()
    {
        await using var database = CreateContext();
        await using var transaction = await database.Database.BeginTransactionAsync();
        await new PlayerStatisticsRebuildService(NullLogger<PlayerStatisticsRebuildService>.Instance)
            .RebuildAsync(database, CancellationToken.None);
        await database.SaveChangesAsync();
        await transaction.CommitAsync();
    }

    /// <summary>Row census across every store the import writes, used to prove all-or-none behaviour.</summary>
    private sealed record RowCensus(int Leagues, int Live, int Scheduled, int Archetypes, int Audits, int Batches);

    private async Task<RowCensus> CensusAsync()
    {
        await using var db = CreateContext();
        return new RowCensus(
            await db.ArchiveLeagueSeasons.CountAsync(),
            await db.LiveAggregates.CountAsync(),
            await db.Events.CountAsync(),
            await db.DeckArchetypes.CountAsync(),
            await db.AuditRecords.CountAsync(record => record.Action == "migration.import"),
            await db.IdempotencyRecords.CountAsync(record => record.Scope == MigrationImportService.IdempotencyScope));
    }

    /// <summary>Asserts zero partial rows: the census is untouched and no planned entity landed.</summary>
    private async Task AssertNothingImportedAsync(RowCensus baseline)
    {
        Assert.Equal(baseline, await CensusAsync());
        await using var db = CreateContext();
        Assert.False(await db.ArchiveLeagueSeasons.AnyAsync(season => season.DocumentId == "league-1"));
        Assert.False(await db.LiveAggregates.AnyAsync(aggregate => aggregate.DocumentId == "live-1"));
        Assert.False(await db.Events.AnyAsync(item => item.Slug == "summer-cup"));
        Assert.False(await db.DeckArchetypes.AnyAsync(archetype => archetype.NormalizedName == "tempo"));
        Assert.Equal(0, baseline.Audits);
        Assert.Equal(0, baseline.Batches);
    }

    private static MigrationImportOptions Options(MigrationInputPaths paths, bool dryRun, string? acceptReportHash = null) =>
        new([paths.Bundle], paths.Manifest, paths.Mapping, dryRun, acceptReportHash, null);

    private sealed record MigrationInputPaths(string Bundle, string Manifest, string Mapping);

    private static MigrationInputPaths WriteInputs(
        SeedRows seed,
        bool mapEvents = true,
        bool tamperBundle = false,
        string? extraArchetype = null,
        bool tournamentsDescending = false)
    {
        var directory = Directory.CreateTempSubdirectory("gones-migration-").FullName;
        var archetypes = new JsonArray("Tempo", "Control");
        if (extraArchetype is not null) archetypes.Add(extraArchetype);

        var bundle = new JsonObject
        {
            ["kind"] = "gones.private-migration-bundle",
            ["bundleFormatVersion"] = 1,
            ["gonesDataVersion"] = 4,
            ["gonesAppVersion"] = "0.1.0",
            ["exportedAt"] = "2026-08-01T09:00:00.000Z",
            ["sourceInstanceId"] = SourceInstanceId,
            ["storeHashes"] = new JsonObject { ["gones.frontend.backend.v1"] = "sha256:" + new string('a', 64) },
            ["storeErrors"] = new JsonArray(),
            ["counts"] = new JsonObject
            {
                ["leagues"] = 1,
                ["tournaments"] = tournamentsDescending ? 2 : 1,
                ["calendarEvents"] = 1,
                ["liveTournaments"] = 1,
                ["deckArchetypes"] = archetypes.Count
            },
            ["leagues"] = new JsonArray(LeagueNode(tournamentsDescending)),
            ["calendarEvents"] = new JsonArray(CalendarEventNode()),
            ["liveTournaments"] = new JsonArray(new JsonObject
            {
                ["id"] = "live-1",
                ["name"] = "Legacy Live Draft",
                ["stage"] = "registration",
                ["tournamentDate"] = "2026-08-01"
            }),
            ["deckArchetypes"] = archetypes
        };
        using (var document = JsonDocument.Parse(bundle.ToJsonString()))
        {
            bundle["bundleChecksum"] = CanonicalJson.Checksum(document.RootElement);
        }

        var checksum = bundle["bundleChecksum"]!.GetValue<string>();
        var bundleJson = bundle.ToJsonString();
        // Tampering keeps the declared checksum but rewrites the payload, exactly like an edited file.
        if (tamperBundle) bundleJson = bundleJson.Replace("\"Legacy Live Draft\"", "\"Injected Live Draft\"", StringComparison.Ordinal);

        var manifest = new JsonObject
        {
            ["kind"] = "gones.migration-manifest",
            ["manifestFormatVersion"] = 1,
            ["sourceInstances"] = new JsonArray(new JsonObject
            {
                ["sourceInstanceId"] = SourceInstanceId,
                ["bundleChecksum"] = checksum,
                ["role"] = "authoritative"
            }),
            ["resolutions"] = new JsonObject()
        };

        var calendarEvents = new JsonObject();
        if (mapEvents)
        {
            calendarEvents["event-1"] = new JsonObject
            {
                ["timeZone"] = "Europe/Paris",
                ["address"] = "12 Rue de la Republique",
                ["city"] = "Lyon",
                ["country"] = "France",
                ["postalCode"] = "69002",
                ["region"] = "Auvergne-Rhône-Alpes",
                ["formatSlugs"] = new JsonArray(TournamentFormat.LegacySlug),
                ["status"] = "published",
                ["capacity"] = 32
            };
        }

        var mapping = new JsonObject
        {
            ["kind"] = "gones.migration-mapping",
            ["mappingFormatVersion"] = 1,
            ["organizationId"] = seed.Organization.Id.ToString("D"),
            ["ownerUserId"] = seed.User.Id.ToString("D"),
            ["calendarEvents"] = calendarEvents
        };

        var paths = new MigrationInputPaths(
            Path.Combine(directory, "bundle.private.json"),
            Path.Combine(directory, "manifest.json"),
            Path.Combine(directory, "mapping.json"));
        File.WriteAllText(paths.Bundle, bundleJson);
        File.WriteAllText(paths.Manifest, manifest.ToJsonString());
        File.WriteAllText(paths.Mapping, mapping.ToJsonString());
        return paths;
    }

    private static JsonObject LeagueNode(bool tournamentsDescending = false) => new()
    {
        ["id"] = "league-1",
        ["name"] = "Legacy League",
        ["status"] = "active",
        ["tournaments"] = tournamentsDescending
            ? new JsonArray(TournamentNode("tournament-2", "Round Two", "2026-01-17", "round-2", "entry-2"), TournamentNode("tournament-1", "Round One", "2026-01-10", "round-1", "entry-1"))
            : new JsonArray(TournamentNode("tournament-1", "Round One", "2026-01-10", "round-1", "entry-1"))
    };

    private static JsonObject TournamentNode(string id, string name, string tournamentDate, string roundId, string entryId) => new()
    {
        ["id"] = id,
        ["leagueId"] = "league-1",
        ["name"] = name,
        ["tournamentDate"] = tournamentDate,
        ["rounds"] = new JsonArray(new JsonObject
        {
            ["id"] = roundId,
            ["entries"] = new JsonArray(new JsonObject
            {
                ["kind"] = "match",
                ["id"] = entryId,
                ["table"] = "1",
                ["player1Name"] = "Alice",
                ["player2Name"] = "Bob",
                ["player1Score"] = 2,
                ["player2Score"] = 1,
                ["player1DeckArchetype"] = "Tempo",
                ["player2DeckArchetype"] = "Control"
            })
        }),
        ["playerArchetypes"] = new JsonArray(new JsonObject
        {
            ["playerName"] = "Alice",
            ["archetype"] = "Tempo"
        })
    };

    private static JsonObject CalendarEventNode() => new()
    {
        ["id"] = "event-1",
        ["slug"] = "summer-cup",
        ["title"] = "Summer Cup",
        ["eventDate"] = "2026-09-12",
        ["startTime"] = "10:00",
        ["endTime"] = "18:00",
        ["location"] = "Club",
        ["country"] = "France",
        ["city"] = "Lyon",
        ["address"] = "12 Rue de la Republique",
        ["description"] = "Friendly legacy cup",
        ["richDescriptionHtml"] = "<p>Welcome</p>",
        ["externalLink"] = ""
    };

    private async Task<GonesDbContext> CreateMigratedContextAsync()
    {
        var db = CreateContext();
        await db.Database.MigrateAsync();
        return db;
    }

    private static async Task<SeedRows> SeedAsync(GonesDbContext db)
    {
        var user = new ApplicationUser
        {
            Id = Guid.NewGuid(),
            UserName = $"owner-{Guid.NewGuid():N}@example.test",
            NormalizedUserName = $"OWNER-{Guid.NewGuid():N}@EXAMPLE.TEST",
            Email = $"owner-{Guid.NewGuid():N}@example.test",
            NormalizedEmail = $"OWNER-{Guid.NewGuid():N}@EXAMPLE.TEST",
            EmailConfirmed = true,
            SecurityStamp = Guid.NewGuid().ToString("N"),
            ConcurrencyStamp = Guid.NewGuid().ToString("N")
        };
        var organization = Organization.Create($"Club {Guid.NewGuid():N}", null, null, null, Now);
        var legacy = await db.TournamentFormats.SingleOrDefaultAsync(format => format.Slug == TournamentFormat.LegacySlug)
            ?? TournamentFormat.CreateLegacy(Now);
        db.Users.Add(user);
        db.Organizations.Add(organization);
        if (db.Entry(legacy).State == EntityState.Detached) db.TournamentFormats.Add(legacy);
        await db.SaveChangesAsync();
        db.OrganizationMembers.Add(OrganizationMember.Create(organization.Id, user.Id, OrganizationRoles.Organizer, Now));
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        return new SeedRows(user, organization, legacy);
    }

    private GonesDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<GonesDbContext>()
            .ConfigureGones(postgres.GetConnectionString())
            .Options;
        return new GonesDbContext(options);
    }

    private sealed record SeedRows(ApplicationUser User, Organization Organization, TournamentFormat Legacy);

    private sealed class FixedClock(Instant instant) : IClock
    {
        public Instant GetCurrentInstant() => instant;
    }
}
