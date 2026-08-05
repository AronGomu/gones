using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Gones.Application.Migration;

namespace Gones.UnitTests;

public sealed class MigrationInputParsingTests
{
    public static JsonObject BundleTemplate(string sourceInstanceId = "11111111-1111-1111-1111-111111111111") => new()
    {
        ["kind"] = "gones.private-migration-bundle",
        ["bundleFormatVersion"] = 1,
        ["gonesDataVersion"] = 4,
        ["gonesAppVersion"] = "0.1.0",
        ["exportedAt"] = "2026-08-05T10:00:00.000Z",
        ["sourceInstanceId"] = sourceInstanceId,
        ["storeHashes"] = new JsonObject { ["gones.frontend.backend.v1"] = null },
        ["storeErrors"] = new JsonArray(),
        ["counts"] = new JsonObject
        {
            ["leagues"] = 0, ["tournaments"] = 0, ["calendarEvents"] = 0, ["liveTournaments"] = 0, ["deckArchetypes"] = 0
        },
        ["leagues"] = new JsonArray(),
        ["calendarEvents"] = new JsonArray(),
        ["liveTournaments"] = new JsonArray(),
        ["deckArchetypes"] = new JsonArray()
    };

    public static byte[] WithChecksum(JsonObject bundle)
    {
        using var document = JsonDocument.Parse(bundle.ToJsonString());
        bundle["bundleChecksum"] = CanonicalJson.Checksum(document.RootElement);
        return Encoding.UTF8.GetBytes(bundle.ToJsonString());
    }

    [Fact]
    public void Valid_bundle_parses_with_checksum_and_counts()
    {
        var bundle = BundleTemplate();
        bundle["leagues"] = new JsonArray(new JsonObject
        {
            ["id"] = "league-1", ["name"] = "League", ["status"] = "active",
            ["tournaments"] = new JsonArray()
        });
        ((JsonObject)bundle["counts"]!)["leagues"] = 1;

        var parsed = MigrationBundleReader.Parse(WithChecksum(bundle), "bundle.json");

        Assert.Equal("11111111-1111-1111-1111-111111111111", parsed.SourceInstanceId);
        Assert.Equal(1, parsed.Counts.Leagues);
        Assert.Single(parsed.Leagues);
    }

    [Fact]
    public void Tampered_bundle_fails_checksum_validation()
    {
        var bundle = BundleTemplate();
        var bytes = WithChecksum(bundle);
        var tampered = Encoding.UTF8.GetString(bytes).Replace("\"deckArchetypes\":[]", "\"deckArchetypes\":[\"Injected\"]");
        tampered = tampered.Replace("\"deckArchetypes\":0", "\"deckArchetypes\":1");

        var exception = Assert.Throws<MigrationInputException>(() => MigrationBundleReader.Parse(Encoding.UTF8.GetBytes(tampered), "bundle.json"));
        Assert.Equal("bundleChecksumMismatch", exception.Code);
    }

    [Theory]
    [InlineData("bundleFormatVersion", 2)]
    [InlineData("gonesDataVersion", 3)]
    [InlineData("gonesDataVersion", 5)]
    public void Unsupported_versions_are_rejected(string field, int value)
    {
        var bundle = BundleTemplate();
        bundle[field] = value;

        var exception = Assert.Throws<MigrationInputException>(() => MigrationBundleReader.Parse(WithChecksum(bundle), "bundle.json"));
        Assert.Equal("bundleUnsupportedVersion", exception.Code);
    }

    [Fact]
    public void Wrong_kind_missing_fields_and_bad_counts_are_schema_errors()
    {
        var wrongKind = BundleTemplate();
        wrongKind["kind"] = "gones.export";
        Assert.Equal("bundleSchemaInvalid", Assert.Throws<MigrationInputException>(() => MigrationBundleReader.Parse(WithChecksum(wrongKind), "bundle.json")).Code);

        var missingCounts = BundleTemplate();
        missingCounts.Remove("counts");
        Assert.Equal("bundleSchemaInvalid", Assert.Throws<MigrationInputException>(() => MigrationBundleReader.Parse(WithChecksum(missingCounts), "bundle.json")).Code);

        var badCounts = BundleTemplate();
        ((JsonObject)badCounts["counts"]!)["leagues"] = 7;
        Assert.Equal("bundleSchemaInvalid", Assert.Throws<MigrationInputException>(() => MigrationBundleReader.Parse(WithChecksum(badCounts), "bundle.json")).Code);

        Assert.Equal("bundleMalformedJson", Assert.Throws<MigrationInputException>(() => MigrationBundleReader.Parse(Encoding.UTF8.GetBytes("{\"kind\":"), "bundle.json")).Code);
    }

    [Fact]
    public void Duplicate_entity_ids_within_one_bundle_are_rejected()
    {
        var bundle = BundleTemplate();
        bundle["liveTournaments"] = new JsonArray(
            new JsonObject { ["id"] = "live-1" },
            new JsonObject { ["id"] = "live-1" });
        ((JsonObject)bundle["counts"]!)["liveTournaments"] = 2;

        var exception = Assert.Throws<MigrationInputException>(() => MigrationBundleReader.Parse(WithChecksum(bundle), "bundle.json"));
        Assert.Equal("bundleDuplicateEntity", exception.Code);
    }

    [Fact]
    public void Oversized_bundle_file_is_rejected_before_parsing()
    {
        var path = Path.Combine(Path.GetTempPath(), $"gones-oversize-{Guid.NewGuid():N}.json");
        File.WriteAllBytes(path, WithChecksum(BundleTemplate()));
        try
        {
            var exception = Assert.Throws<MigrationInputException>(() => MigrationBundleReader.Read(path, maximumBytes: 16));
            Assert.Equal("bundleFileTooLarge", exception.Code);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void Manifest_requires_exactly_one_authoritative_instance_and_valid_resolutions()
    {
        static byte[] Manifest(string rolesJson, string resolutionsJson = "{}") => Encoding.UTF8.GetBytes(
            $"{{\"kind\":\"gones.migration-manifest\",\"manifestFormatVersion\":1,\"sourceInstances\":{rolesJson},\"resolutions\":{resolutionsJson}}}");

        var valid = MigrationManifestReader.Parse(Manifest(
            "[{\"sourceInstanceId\":\"a\",\"bundleChecksum\":\"sha256:00\",\"role\":\"authoritative\"},{\"sourceInstanceId\":\"b\",\"bundleChecksum\":\"sha256:01\",\"role\":\"secondary\"}]",
            "{\"league:x\":\"use:a\",\"live:y\":\"skip\"}"), "manifest.json");
        Assert.Equal(2, valid.SourceInstances.Count);
        Assert.Equal("use:a", valid.Resolutions["league:x"]);

        Assert.Equal("manifestSchemaInvalid", Assert.Throws<MigrationInputException>(() => MigrationManifestReader.Parse(Manifest(
            "[{\"sourceInstanceId\":\"a\",\"bundleChecksum\":\"sha256:00\",\"role\":\"authoritative\"},{\"sourceInstanceId\":\"b\",\"bundleChecksum\":\"sha256:01\",\"role\":\"authoritative\"}]"), "manifest.json")).Code);
        Assert.Equal("manifestSchemaInvalid", Assert.Throws<MigrationInputException>(() => MigrationManifestReader.Parse(Manifest(
            "[{\"sourceInstanceId\":\"a\",\"bundleChecksum\":\"sha256:00\",\"role\":\"secondary\"}]"), "manifest.json")).Code);
        Assert.Equal("manifestSchemaInvalid", Assert.Throws<MigrationInputException>(() => MigrationManifestReader.Parse(Manifest(
            "[{\"sourceInstanceId\":\"a\",\"bundleChecksum\":\"sha256:00\",\"role\":\"authoritative\"}]",
            "{\"league:x\":\"pick-newest\"}"), "manifest.json")).Code);
        Assert.Equal("manifestUnsupportedVersion", Assert.Throws<MigrationInputException>(() => MigrationManifestReader.Parse(Encoding.UTF8.GetBytes(
            "{\"kind\":\"gones.migration-manifest\",\"manifestFormatVersion\":2,\"sourceInstances\":[]}"), "manifest.json")).Code);
    }

    [Fact]
    public void Mapping_requires_kind_version_and_owner_guids()
    {
        var valid = MigrationMappingReader.Parse(Encoding.UTF8.GetBytes(
            "{\"kind\":\"gones.migration-mapping\",\"mappingFormatVersion\":1,\"organizationId\":\"3e211bb5-8fbe-4f8a-97f4-2725eb1e3b7c\",\"ownerUserId\":\"9d1a3a8f-5aa3-4a83-bf8f-05b3a1b8f001\",\"calendarEvents\":{\"event-1\":{\"timeZone\":\"Europe/Paris\",\"formatSlugs\":[\"legacy\"],\"status\":\"published\"}}}"), "mapping.json");
        Assert.Equal("Europe/Paris", valid.CalendarEvents["event-1"].TimeZone);

        Assert.Equal("mappingSchemaInvalid", Assert.Throws<MigrationInputException>(() => MigrationMappingReader.Parse(Encoding.UTF8.GetBytes(
            "{\"kind\":\"gones.migration-mapping\",\"mappingFormatVersion\":1,\"organizationId\":\"not-a-guid\",\"ownerUserId\":\"9d1a3a8f-5aa3-4a83-bf8f-05b3a1b8f001\"}"), "mapping.json")).Code);
        Assert.Equal("mappingUnsupportedVersion", Assert.Throws<MigrationInputException>(() => MigrationMappingReader.Parse(Encoding.UTF8.GetBytes(
            "{\"kind\":\"gones.migration-mapping\",\"mappingFormatVersion\":9,\"organizationId\":\"3e211bb5-8fbe-4f8a-97f4-2725eb1e3b7c\",\"ownerUserId\":\"9d1a3a8f-5aa3-4a83-bf8f-05b3a1b8f001\"}"), "mapping.json")).Code);
    }

    [Fact]
    public void Cli_arguments_enforce_dry_run_first_workflow()
    {
        Assert.True(MigrationCliArguments.TryParse(
            ["--bundle", "a.json", "--manifest", "m.json", "--mapping", "map.json", "--dry-run"], out var dryRun, out _));
        Assert.True(dryRun!.DryRun);

        Assert.False(MigrationCliArguments.TryParse(
            ["--bundle", "a.json", "--manifest", "m.json", "--mapping", "map.json"], out _, out var error));
        Assert.Contains("--accept-report-hash", error);

        Assert.True(MigrationCliArguments.TryParse(
            ["--bundle", "a.json", "--bundle", "b.json", "--manifest", "m.json", "--mapping", "map.json", "--accept-report-hash", "sha256:ff", "--report", "out.json"],
            out var import, out _));
        Assert.Equal(2, import!.BundlePaths.Count);
        Assert.Equal("sha256:ff", import.AcceptReportHash);

        Assert.False(MigrationCliArguments.TryParse(["--manifest", "m.json", "--mapping", "map.json", "--dry-run"], out _, out var noBundle));
        Assert.Contains("--bundle", noBundle);
        Assert.False(MigrationCliArguments.TryParse(["--bundle", "a.json", "--mapping", "map.json", "--dry-run"], out _, out var noManifest));
        Assert.Contains("--manifest", noManifest);
        Assert.False(MigrationCliArguments.TryParse(["--bundle", "a.json", "--manifest", "m.json", "--dry-run"], out _, out var noMapping));
        Assert.Contains("--mapping", noMapping);
        Assert.False(MigrationCliArguments.TryParse(["--frobnicate"], out _, out var unknown));
        Assert.Contains("Unknown", unknown);
    }
}
