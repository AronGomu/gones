using System.Text.Json;

namespace Gones.Application.Migration;

public sealed record ManifestSourceInstance(string SourceInstanceId, string BundleChecksum, string Role)
{
    public const string AuthoritativeRole = "authoritative";
    public const string SecondaryRole = "secondary";
}

/// <summary>
/// Operator-authored inventory of every legacy source instance plus explicit reconciliation
/// decisions. Unknown duplicates or conflicts stay blocked until the operator resolves them here.
/// Resolution keys look like "league:&lt;id&gt;", "live:&lt;id&gt;" or "tournament:&lt;id&gt;";
/// values are either "skip" or "use:&lt;sourceInstanceId&gt;".
/// </summary>
public sealed record MigrationManifestFile(
    string FileName,
    IReadOnlyList<ManifestSourceInstance> SourceInstances,
    IReadOnlyDictionary<string, string> Resolutions,
    string ManifestHash);

public static class MigrationManifestReader
{
    public const string Kind = "gones.migration-manifest";
    public const int SupportedFormatVersion = 1;
    public const long MaximumManifestBytes = 1024 * 1024;

    public static MigrationManifestFile Read(string path)
    {
        if (!File.Exists(path)) throw new MigrationInputException("manifestFileMissing", path);
        var fileName = Path.GetFileName(path);
        if (new FileInfo(path).Length > MaximumManifestBytes)
            throw new MigrationInputException("manifestFileTooLarge", fileName);
        return Parse(File.ReadAllBytes(path), fileName);
    }

    public static MigrationManifestFile Parse(byte[] utf8Json, string fileName)
    {
        JsonElement root;
        try
        {
            using var document = JsonDocument.Parse(utf8Json, new JsonDocumentOptions { MaxDepth = 16 });
            root = document.RootElement.Clone();
        }
        catch (JsonException exception)
        {
            throw new MigrationInputException("manifestMalformedJson", $"{fileName}: {exception.Message}");
        }

        if (root.ValueKind != JsonValueKind.Object
            || !root.TryGetProperty("kind", out var kind) || kind.ValueKind != JsonValueKind.String || kind.GetString() != Kind)
        {
            throw new MigrationInputException("manifestSchemaInvalid", $"{fileName}: kind is not a migration manifest");
        }

        if (!root.TryGetProperty("manifestFormatVersion", out var version)
            || version.ValueKind != JsonValueKind.Number
            || !version.TryGetInt32(out var parsedVersion)
            || parsedVersion != SupportedFormatVersion)
        {
            throw new MigrationInputException("manifestUnsupportedVersion", fileName);
        }

        if (!root.TryGetProperty("sourceInstances", out var instances) || instances.ValueKind != JsonValueKind.Array)
            throw new MigrationInputException("manifestSchemaInvalid", $"{fileName}: sourceInstances must be an array");

        var sourceInstances = new List<ManifestSourceInstance>();
        foreach (var instance in instances.EnumerateArray())
        {
            var sourceInstanceId = RequiredString(instance, "sourceInstanceId", fileName);
            var bundleChecksum = RequiredString(instance, "bundleChecksum", fileName);
            var role = RequiredString(instance, "role", fileName);
            if (role is not (ManifestSourceInstance.AuthoritativeRole or ManifestSourceInstance.SecondaryRole))
                throw new MigrationInputException("manifestSchemaInvalid", $"{fileName}: role must be authoritative or secondary");
            sourceInstances.Add(new ManifestSourceInstance(sourceInstanceId, bundleChecksum, role));
        }

        if (sourceInstances.Select(instance => instance.SourceInstanceId).Distinct(StringComparer.Ordinal).Count() != sourceInstances.Count)
            throw new MigrationInputException("manifestSchemaInvalid", $"{fileName}: duplicate sourceInstanceId entries");
        if (sourceInstances.Count(instance => instance.Role == ManifestSourceInstance.AuthoritativeRole) != 1)
            throw new MigrationInputException("manifestSchemaInvalid", $"{fileName}: exactly one authoritative source instance is required");

        var resolutions = new Dictionary<string, string>(StringComparer.Ordinal);
        if (root.TryGetProperty("resolutions", out var resolutionsElement))
        {
            if (resolutionsElement.ValueKind != JsonValueKind.Object)
                throw new MigrationInputException("manifestSchemaInvalid", $"{fileName}: resolutions must be an object");
            foreach (var resolution in resolutionsElement.EnumerateObject())
            {
                if (resolution.Value.ValueKind != JsonValueKind.String)
                    throw new MigrationInputException("manifestSchemaInvalid", $"{fileName}: resolution '{resolution.Name}' must be a string");
                var value = resolution.Value.GetString()!;
                if (value != "skip" && !value.StartsWith("use:", StringComparison.Ordinal))
                    throw new MigrationInputException("manifestSchemaInvalid", $"{fileName}: resolution '{resolution.Name}' must be 'skip' or 'use:<sourceInstanceId>'");
                resolutions[resolution.Name] = value;
            }
        }

        return new MigrationManifestFile(fileName, sourceInstances, resolutions, CanonicalJson.Checksum(root));
    }

    private static string RequiredString(JsonElement element, string name, string fileName) =>
        element.ValueKind == JsonValueKind.Object
        && element.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.String
        && !string.IsNullOrWhiteSpace(value.GetString())
            ? value.GetString()!
            : throw new MigrationInputException("manifestSchemaInvalid", $"{fileName}: {name} is required");
}
