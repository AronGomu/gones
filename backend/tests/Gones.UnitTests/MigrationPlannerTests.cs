using System.Text.Json;
using Gones.Application.Migration;
using Gones.Domain.Leagues;

namespace Gones.UnitTests;

public sealed class MigrationPlannerTests
{
    private static readonly Guid OrganizationId = Guid.Parse("3e211bb5-8fbe-4f8a-97f4-2725eb1e3b7c");
    private static readonly Guid OwnerUserId = Guid.Parse("9d1a3a8f-5aa3-4a83-bf8f-05b3a1b8f001");
    private static readonly Guid LegacyFormatId = Guid.Parse("77770000-0000-0000-0000-000000000001");

    private const string InstanceA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    private const string InstanceB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    [Fact]
    public void Complete_batch_plans_all_stores_without_errors()
    {
        var bundle = Bundle(InstanceA, "sha256:aa", leaguesJson: $"[{LeagueJsonText("league-1")}]",
            eventsJson: $"[{EventJsonText("event-1")}]",
            liveJson: "[{\"id\":\"live-1\",\"name\":\"Live Draft\",\"stage\":\"registration\",\"tournamentDate\":\"2026-08-01\"}]",
            archetypes: ["Tempo", "Control", "tempo"]);
        var evaluation = MigrationPlanner.Evaluate(
            [bundle],
            Manifest(("sha256:aa", InstanceA, "authoritative")),
            Mapping(("event-1", DefaultEventMapping())),
            Target(),
            "dry-run",
            "2026-08-05T10:00:00Z");

        Assert.Empty(evaluation.Report.Errors);
        Assert.Single(evaluation.Plan.LeaguesToCreate);
        Assert.Single(evaluation.Plan.ScheduledTournaments);
        Assert.Single(evaluation.Plan.LiveTournamentsToCreate);
        Assert.Equal(["Tempo", "Control"], evaluation.Plan.DeckArchetypesToAdd);
        Assert.Equal("summer-cup", evaluation.Plan.ScheduledTournaments[0].Draft.Slug);
        Assert.True(evaluation.Report.EntityHashes.Leagues.ContainsKey("league-1"));
        Assert.True(evaluation.Report.EntityHashes.LiveTournaments.ContainsKey("live-1"));
        Assert.StartsWith("sha256:", evaluation.Report.ReportHash);
        Assert.StartsWith("sha256:", evaluation.Plan.BatchHash);
        Assert.Single(evaluation.Report.CalendarEventMappings);
        Assert.Equal("db-host/gones-test", evaluation.Report.TargetDatabase);
    }

    [Fact]
    public void Missing_time_zone_address_org_and_format_mappings_each_block_the_import()
    {
        var eventJson = EventJsonText("event-1", startTime: "", address: "", location: "", country: "", city: "");
        var bundle = Bundle(InstanceA, "sha256:aa", eventsJson: $"[{eventJson},{EventJsonText("event-2", slug: "other-cup")}]");
        var mapping = Mapping(("event-1", new CalendarEventMapping(null, null, null, null, null, null, null, null, null, null, null)));
        var evaluation = MigrationPlanner.Evaluate(
            [bundle],
            Manifest(("sha256:aa", InstanceA, "authoritative")),
            mapping,
            Target(organizationExists: false),
            "dry-run",
            "2026-08-05T10:00:00Z");

        var codes = evaluation.Report.Errors.Select(error => error.Code).ToArray();
        Assert.Contains("unknownOrganization", codes);
        Assert.Contains("missingStartTime", codes);
        Assert.Contains("missingMappingField", codes); // timeZone, address, city, country
        Assert.Contains("missingFormatMapping", codes);
        Assert.Contains("missingStatusPolicy", codes);
        Assert.Contains("unmappedCalendarEvent", codes); // event-2 has no mapping entry at all
        Assert.Empty(evaluation.Plan.ScheduledTournaments);
    }

    [Fact]
    public void Unknown_zone_status_format_and_owner_are_rejected()
    {
        var bundle = Bundle(InstanceA, "sha256:aa", eventsJson: $"[{EventJsonText("event-1")}]");
        var mapping = Mapping(("event-1", DefaultEventMapping() with
        {
            TimeZone = "Mars/Olympus",
            FormatSlugs = ["modern"],
            Status = "archived"
        }));
        var evaluation = MigrationPlanner.Evaluate(
            [bundle],
            Manifest(("sha256:aa", InstanceA, "authoritative")),
            mapping,
            Target(ownerIsOwner: false),
            "dry-run",
            "2026-08-05T10:00:00Z");

        var codes = evaluation.Report.Errors.Select(error => error.Code).ToArray();
        Assert.Contains("ownerNotOrganizationOwner", codes);
        Assert.Contains("unknownTimeZone", codes);
        Assert.Contains("unknownFormatSlug", codes);
        Assert.Contains("formatMappingRequiresLegacy", codes);
        Assert.Contains("unknownStatusPolicy", codes);
    }

    [Fact]
    public void Conflicting_league_data_between_instances_requires_explicit_resolution()
    {
        var bundleA = Bundle(InstanceA, "sha256:aa", leaguesJson: $"[{LeagueJsonText("league-1", name: "From A")}]");
        var bundleB = Bundle(InstanceB, "sha256:bb", leaguesJson: $"[{LeagueJsonText("league-1", name: "From B")}]");
        var manifest = Manifest(("sha256:aa", InstanceA, "authoritative"), ("sha256:bb", InstanceB, "secondary"));

        var unresolved = MigrationPlanner.Evaluate([bundleA, bundleB], manifest, Mapping(), Target(), "dry-run", "now");
        Assert.Contains(unresolved.Report.Errors, error => error.Code == "unresolvedConflict");
        Assert.Contains(unresolved.Report.Conflicts, conflict => conflict.Code == "league:league-1");
        Assert.Empty(unresolved.Plan.LeaguesToCreate);

        var resolved = MigrationPlanner.Evaluate(
            [bundleA, bundleB],
            manifest with { Resolutions = new Dictionary<string, string> { ["league:league-1"] = $"use:{InstanceB}" } },
            Mapping(), Target(), "dry-run", "now");
        Assert.Empty(resolved.Report.Errors);
        Assert.Equal("From B", Assert.Single(resolved.Plan.LeaguesToCreate).Name);

        var skipped = MigrationPlanner.Evaluate(
            [bundleA, bundleB],
            manifest with { Resolutions = new Dictionary<string, string> { ["league:league-1"] = "skip" } },
            Mapping(), Target(), "dry-run", "now");
        Assert.Empty(skipped.Report.Errors);
        Assert.Empty(skipped.Plan.LeaguesToCreate);
        Assert.Contains(skipped.Report.Warnings, warning => warning.Code == "skippedEntity");

        var identical = MigrationPlanner.Evaluate(
            [bundleA, Bundle(InstanceB, "sha256:bb", leaguesJson: $"[{LeagueJsonText("league-1", name: "From A")}]")],
            manifest, Mapping(), Target(), "dry-run", "now");
        Assert.Empty(identical.Report.Errors);
        Assert.Single(identical.Plan.LeaguesToCreate);
        Assert.Contains("league:league-1", identical.Report.Deduplicates);
    }

    [Fact]
    public void Duplicate_and_undeclared_source_instances_are_blocked()
    {
        var manifest = Manifest(("sha256:aa", InstanceA, "authoritative"), ("sha256:bb", InstanceB, "secondary"));
        var duplicated = MigrationPlanner.Evaluate(
            [Bundle(InstanceA, "sha256:aa"), Bundle(InstanceA, "sha256:aa")],
            manifest, Mapping(), Target(), "dry-run", "now");
        Assert.Contains(duplicated.Report.Errors, error => error.Code == "duplicateSourceInstance");
        Assert.Contains(duplicated.Report.Errors, error => error.Code == "manifestBundleMissing");

        var undeclared = MigrationPlanner.Evaluate(
            [Bundle("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "sha256:cc")],
            Manifest(("sha256:aa", InstanceA, "authoritative")), Mapping(), Target(), "dry-run", "now");
        Assert.Contains(undeclared.Report.Errors, error => error.Code == "bundleNotInManifest");

        var wrongChecksum = MigrationPlanner.Evaluate(
            [Bundle(InstanceA, "sha256:different")],
            Manifest(("sha256:aa", InstanceA, "authoritative")), Mapping(), Target(), "dry-run", "now");
        Assert.Contains(wrongChecksum.Report.Errors, error => error.Code == "manifestChecksumMismatch");

        var unusedResolution = MigrationPlanner.Evaluate(
            [Bundle(InstanceA, "sha256:aa")],
            Manifest([("sha256:aa", InstanceA, "authoritative")], new Dictionary<string, string> { ["league:ghost"] = "skip" }),
            Mapping(), Target(), "dry-run", "now");
        Assert.Contains(unusedResolution.Report.Errors, error => error.Code == "unknownResolutionKey");
    }

    [Fact]
    public void Target_collisions_block_until_skipped_explicitly()
    {
        var bundle = Bundle(InstanceA, "sha256:aa",
            leaguesJson: $"[{LeagueJsonText("existing-league")}]",
            liveJson: "[{\"id\":\"existing-live\",\"name\":\"Live\",\"stage\":\"registration\",\"tournamentDate\":\"2026-08-01\"}]",
            eventsJson: $"[{EventJsonText("event-1", slug: "taken-slug")}]");
        var target = Target(existingLeagueIds: ["existing-league"], existingLiveIds: ["existing-live"], existingSlugs: ["taken-slug"]);

        var blocked = MigrationPlanner.Evaluate(
            [bundle], Manifest(("sha256:aa", InstanceA, "authoritative")),
            Mapping(("event-1", DefaultEventMapping())), target, "dry-run", "now");
        Assert.Equal(2, blocked.Report.Errors.Count(error => error.Code == "targetCollision"));
        Assert.Contains(blocked.Report.Errors, error => error.Code == "slugCollision");
        Assert.Equal(3, blocked.Report.Collisions.Count);

        var skipped = MigrationPlanner.Evaluate(
            [bundle],
            Manifest([("sha256:aa", InstanceA, "authoritative")], new Dictionary<string, string>
            {
                ["league:existing-league"] = "skip",
                ["live:existing-live"] = "skip"
            }),
            Mapping(("event-1", DefaultEventMapping() with { Slug = "fresh-slug" })), target, "dry-run", "now");
        Assert.Empty(skipped.Report.Errors);
        Assert.Empty(skipped.Plan.LeaguesToCreate);
        Assert.Empty(skipped.Plan.LiveTournamentsToCreate);
        Assert.Equal("fresh-slug", Assert.Single(skipped.Plan.ScheduledTournaments).Draft.Slug);
    }

    [Fact]
    public void Placeholder_league_tournaments_need_an_explicit_target()
    {
        var placeholderJson = $"{{\"id\":\"{LeagueNormalizer.PlaceholderLeagueId}\",\"name\":\"Unassigned Tournaments\",\"status\":\"active\",\"tournaments\":[{TournamentJsonText("orphan-1", LeagueNormalizer.PlaceholderLeagueId)}]}}";
        var bundle = Bundle(InstanceA, "sha256:aa", leaguesJson: $"[{placeholderJson},{LeagueJsonText("league-1")}]");
        var manifest = Manifest(("sha256:aa", InstanceA, "authoritative"));

        var unmapped = MigrationPlanner.Evaluate([bundle], manifest, Mapping(), Target(), "dry-run", "now");
        Assert.Contains(unmapped.Report.Errors, error => error.Code == "missingPlaceholderTarget");

        var toPlaceholder = MigrationPlanner.Evaluate(
            [bundle], manifest, Mapping(placeholderTarget: LeagueNormalizer.PlaceholderLeagueId), Target(), "dry-run", "now");
        Assert.Empty(toPlaceholder.Report.Errors);
        Assert.Equal("orphan-1", Assert.Single(toPlaceholder.Plan.TournamentsForPlaceholderTarget).Id);

        var toLeague = MigrationPlanner.Evaluate(
            [bundle], manifest, Mapping(placeholderTarget: "league-1"), Target(), "dry-run", "now");
        Assert.Empty(toLeague.Report.Errors);
        var hostLeague = Assert.Single(toLeague.Plan.LeaguesToCreate, league => league.Id == "league-1");
        var moved = Assert.Single(hostLeague.Tournaments, tournament => tournament.Id == "orphan-1");
        Assert.Equal("league-1", moved.LeagueId);

        var bogus = MigrationPlanner.Evaluate(
            [bundle], manifest, Mapping(placeholderTarget: "missing-league"), Target(), "dry-run", "now");
        Assert.Contains(bogus.Report.Errors, error => error.Code == "invalidPlaceholderTarget");

        var placeholderCollision = MigrationPlanner.Evaluate(
            [bundle], manifest, Mapping(placeholderTarget: LeagueNormalizer.PlaceholderLeagueId),
            Target(placeholderTournamentIds: ["orphan-1"]), "dry-run", "now");
        Assert.Contains(placeholderCollision.Report.Errors, error => error.Code == "targetCollision");
    }

    [Fact]
    public void Sanitation_changes_are_reported_for_html_links_summary_and_slug()
    {
        var eventJson = EventJsonText("event-1",
            slug: "Summer Cup 2026!",
            description: new string('d', 80),
            richDescription: "<p>Hello <img src=\\\"https://cdn.example/x.png\\\"> <script>alert(1)</script>world</p>",
            externalLink: "http://insecure.example/page");
        var httpsEventJson = EventJsonText("event-2", slug: "second-cup", externalLink: "https://example.org/info");
        var bundle = Bundle(InstanceA, "sha256:aa", eventsJson: $"[{eventJson},{httpsEventJson}]");
        var evaluation = MigrationPlanner.Evaluate(
            [bundle],
            Manifest(("sha256:aa", InstanceA, "authoritative")),
            Mapping(("event-1", DefaultEventMapping()), ("event-2", DefaultEventMapping())),
            Target(), "dry-run", "now");

        Assert.Empty(evaluation.Report.Errors);
        var changes = evaluation.Report.SanitationChanges;
        Assert.Contains(changes, change => change.EntityId == "event-1" && change.Change == "removedImage");
        Assert.Contains(changes, change => change.EntityId == "event-1" && change.Change == "strippedUnsafeHtml");
        Assert.Contains(changes, change => change.EntityId == "event-1" && change.Change == "truncatedSummary");
        Assert.Contains(changes, change => change.EntityId == "event-1" && change.Change == "slugNormalized");
        Assert.Contains(changes, change => change.EntityId == "event-1" && change.Change == "droppedExternalLink");
        Assert.Contains(changes, change => change.EntityId == "event-2" && change.Change == "convertedExternalLink");
        var sanitized = evaluation.Plan.ScheduledTournaments.Single(item => item.SourceEventId == "event-1");
        Assert.Equal("summer-cup-2026", sanitized.Draft.Slug);
        Assert.DoesNotContain("<img", sanitized.Draft.BodyHtml ?? string.Empty, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("script", sanitized.Draft.BodyHtml ?? string.Empty, StringComparison.OrdinalIgnoreCase);
        var converted = evaluation.Plan.ScheduledTournaments.Single(item => item.SourceEventId == "event-2");
        Assert.Contains("https://example.org/info", converted.Draft.BodyHtml);
    }

    [Fact]
    public void Report_hash_is_stable_for_unchanged_inputs_and_changes_with_the_bundle()
    {
        var bundle = Bundle(InstanceA, "sha256:aa", leaguesJson: $"[{LeagueJsonText("league-1")}]", archetypes: ["Tempo"]);
        var manifest = Manifest(("sha256:aa", InstanceA, "authoritative"));

        var first = MigrationPlanner.Evaluate([bundle], manifest, Mapping(), Target(), "dry-run", "2026-08-05T10:00:00Z");
        var second = MigrationPlanner.Evaluate([bundle], manifest, Mapping(), Target(), "import", "2026-08-06T22:11:00Z");
        Assert.Equal(first.Report.ReportHash, second.Report.ReportHash);
        Assert.Equal(first.Plan.BatchHash, second.Plan.BatchHash);

        var changedBundle = Bundle(InstanceA, "sha256:changed", leaguesJson: $"[{LeagueJsonText("league-1")}]", archetypes: ["Tempo", "Aggro"]);
        var changed = MigrationPlanner.Evaluate(
            [changedBundle], Manifest(("sha256:changed", InstanceA, "authoritative")), Mapping(), Target(), "dry-run", "2026-08-05T10:00:00Z");
        Assert.NotEqual(first.Report.ReportHash, changed.Report.ReportHash);
        Assert.NotEqual(first.Plan.BatchHash, changed.Plan.BatchHash);
    }

    [Fact]
    public void Store_errors_and_cancelled_status_policy_flow_into_the_report_and_plan()
    {
        var bundle = Bundle(InstanceA, "sha256:aa", eventsJson: $"[{EventJsonText("event-1")}]", storeErrors: ["gones.settings"]);
        var evaluation = MigrationPlanner.Evaluate(
            [bundle],
            Manifest(("sha256:aa", InstanceA, "authoritative")),
            Mapping(("event-1", DefaultEventMapping() with { Status = "cancelled" })),
            Target(), "dry-run", "now");

        Assert.Empty(evaluation.Report.Errors);
        Assert.Contains(evaluation.Report.Warnings, warning => warning.Code == "bundleStoreErrors");
        Assert.Equal("cancelled", Assert.Single(evaluation.Plan.ScheduledTournaments).StatusPolicy);
    }

    private static CalendarEventMapping DefaultEventMapping() => new(
        Slug: null,
        StartTime: null,
        EndTime: null,
        TimeZone: "Europe/Paris",
        Address: null,
        City: null,
        Country: null,
        PostalCode: null,
        FormatSlugs: ["legacy"],
        Status: "published",
        Capacity: null);

    private static string LeagueJsonText(string id, string name = "League One") =>
        $"{{\"id\":\"{id}\",\"name\":\"{name}\",\"status\":\"active\",\"tournaments\":[{TournamentJsonText($"{id}-t1", id)}]}}";

    private static string TournamentJsonText(string id, string leagueId) =>
        $"{{\"id\":\"{id}\",\"leagueId\":\"{leagueId}\",\"name\":\"Tournament\",\"tournamentDate\":\"2026-01-10\",\"rounds\":[{{\"id\":\"{id}-r1\",\"entries\":[{{\"kind\":\"match\",\"id\":\"{id}-e1\",\"table\":\"1\",\"player1Name\":\"Alice\",\"player2Name\":\"Bob\",\"player1Score\":2,\"player2Score\":1,\"player1DeckArchetype\":\"Tempo\",\"player2DeckArchetype\":\"Control\"}}]}}],\"playerArchetypes\":[{{\"playerName\":\"Alice\",\"archetype\":\"Tempo\"}}]}}";

    private static string EventJsonText(
        string id,
        string slug = "summer-cup",
        string startTime = "10:00",
        string address = "12 Rue de la République",
        string location = "Club",
        string country = "France",
        string city = "Lyon",
        string description = "Friendly legacy cup",
        string richDescription = "<p>Welcome</p>",
        string externalLink = "") =>
        $"{{\"id\":\"{id}\",\"slug\":\"{slug}\",\"title\":\"Summer Cup\",\"eventDate\":\"2026-09-12\",\"startTime\":\"{startTime}\",\"endTime\":\"18:00\",\"location\":\"{location}\",\"country\":\"{country}\",\"city\":\"{city}\",\"address\":\"{address}\",\"description\":\"{description}\",\"richDescriptionHtml\":\"{richDescription}\",\"externalLink\":\"{externalLink}\"}}";

    internal static MigrationBundleFile Bundle(
        string sourceInstanceId,
        string checksum,
        string leaguesJson = "[]",
        string eventsJson = "[]",
        string liveJson = "[]",
        string[]? archetypes = null,
        string[]? storeErrors = null)
    {
        var leagues = ParseArray(leaguesJson);
        var events = ParseArray(eventsJson);
        var live = ParseArray(liveJson);
        var counts = new MigrationBundleCounts(
            leagues.Count,
            leagues.Sum(league => league.GetProperty("tournaments").GetArrayLength()),
            events.Count,
            live.Count,
            archetypes?.Length ?? 0);
        return new MigrationBundleFile(
            $"bundle-{sourceInstanceId[..8]}.json", sourceInstanceId, checksum, "2026-08-05T10:00:00.000Z", 4, "0.1.0",
            counts, storeErrors ?? [], leagues, events, live, archetypes ?? []);
    }

    private static MigrationManifestFile Manifest(params (string Checksum, string InstanceId, string Role)[] instances) =>
        Manifest(instances, new Dictionary<string, string>());

    private static MigrationManifestFile Manifest(
        IReadOnlyList<(string Checksum, string InstanceId, string Role)> instances,
        Dictionary<string, string> resolutions) =>
        new("manifest.json",
            instances.Select(instance => new ManifestSourceInstance(instance.InstanceId, instance.Checksum, instance.Role)).ToArray(),
            resolutions,
            "sha256:manifest-hash");

    private static MigrationMappingFile Mapping(params (string EventId, CalendarEventMapping Mapping)[] events) =>
        Mapping(null, events);

    private static MigrationMappingFile Mapping(string? placeholderTarget, params (string EventId, CalendarEventMapping Mapping)[] events) =>
        new("mapping.json", OrganizationId, OwnerUserId, placeholderTarget,
            events.ToDictionary(entry => entry.EventId, entry => entry.Mapping, StringComparer.Ordinal),
            "sha256:mapping-hash");

    private static MigrationTargetState Target(
        string[]? existingLeagueIds = null,
        string[]? placeholderTournamentIds = null,
        string[]? existingLiveIds = null,
        string[]? existingSlugs = null,
        bool organizationExists = true,
        bool ownerIsOwner = true)
    {
        return new MigrationTargetState(
            "db-host/gones-test",
            (existingLeagueIds ?? []).Append(LeagueNormalizer.PlaceholderLeagueId).ToHashSet(StringComparer.Ordinal),
            (placeholderTournamentIds ?? []).ToHashSet(StringComparer.Ordinal),
            (existingLiveIds ?? []).ToHashSet(StringComparer.Ordinal),
            new HashSet<string>(StringComparer.Ordinal),
            (existingSlugs ?? []).ToHashSet(StringComparer.Ordinal),
            organizationExists,
            ownerIsOwner,
            new Dictionary<string, Guid>(StringComparer.Ordinal) { ["legacy"] = LegacyFormatId });
    }

    private static List<JsonElement> ParseArray(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.EnumerateArray().Select(element => element.Clone()).ToList();
    }
}
