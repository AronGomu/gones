using System.Text.Json;
using System.Text.RegularExpressions;

namespace Gones.Application.Migration;

/// <summary>Thrown when a migration input file cannot be trusted; the import must not proceed.</summary>
public sealed class MigrationInputException(string code, string detail) : Exception($"{code}: {detail}")
{
    public string Code { get; } = code;
    public string Detail { get; } = detail;
}

public sealed record MigrationBundleCounts(int Leagues, int Tournaments, int CalendarEvents, int LiveTournaments, int DeckArchetypes);

/// <summary>One parsed private migration bundle (see src/app/domain/migration-bundle.ts).</summary>
public sealed record MigrationBundleFile(
    string FileName,
    string SourceInstanceId,
    string BundleChecksum,
    string ExportedAt,
    int GonesDataVersion,
    string GonesAppVersion,
    MigrationBundleCounts Counts,
    IReadOnlyList<string> StoreErrors,
    IReadOnlyList<JsonElement> Leagues,
    IReadOnlyList<JsonElement> CalendarEvents,
    IReadOnlyList<JsonElement> LiveTournaments,
    IReadOnlyList<string> DeckArchetypes);

public static partial class MigrationBundleReader
{
    public const string Kind = "gones.private-migration-bundle";
    public const int SupportedBundleFormatVersion = 1;
    public const int SupportedGonesDataVersion = 4;

    /// <summary>Mirrors EXPORT_LIMITS in src/app/domain/export-schemas.ts.</summary>
    public const long MaximumBundleBytes = 16 * 1024 * 1024;
    public const int MaximumLeagues = 1_000;
    public const int MaximumCalendarEvents = 500;
    public const int MaximumLiveTournaments = 200;
    public const int MaximumDeckArchetypes = 2_000;

    [GeneratedRegex("^[0-9a-f-]{36}$")]
    private static partial Regex SourceInstanceIdRegex();

    [GeneratedRegex("^sha256:[0-9a-f]{64}$")]
    private static partial Regex ChecksumRegex();

    public static MigrationBundleFile Read(string path, long maximumBytes = MaximumBundleBytes)
    {
        if (!File.Exists(path)) throw new MigrationInputException("bundleFileMissing", path);
        var fileName = Path.GetFileName(path);
        // Bounded read: never buffer more than the declared bundle cap plus one sentinel byte.
        using var stream = File.OpenRead(path);
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = stream.Read(chunk, 0, chunk.Length)) > 0)
        {
            if (buffer.Length + read > maximumBytes) throw new MigrationInputException("bundleFileTooLarge", $"{fileName} exceeds {maximumBytes} bytes");
            buffer.Write(chunk, 0, read);
        }

        return Parse(buffer.ToArray(), fileName);
    }

    public static MigrationBundleFile Parse(byte[] utf8Json, string fileName)
    {
        JsonElement root;
        try
        {
            using var document = JsonDocument.Parse(utf8Json, new JsonDocumentOptions { MaxDepth = 64 });
            root = document.RootElement.Clone();
        }
        catch (JsonException exception)
        {
            throw new MigrationInputException("bundleMalformedJson", $"{fileName}: {exception.Message}");
        }

        if (root.ValueKind != JsonValueKind.Object) throw Invalid(fileName, "root must be an object");
        if (StringProperty(root, "kind") != Kind) throw Invalid(fileName, "kind is not a private migration bundle");
        var bundleFormatVersion = IntProperty(root, "bundleFormatVersion", fileName);
        if (bundleFormatVersion != SupportedBundleFormatVersion)
            throw new MigrationInputException("bundleUnsupportedVersion", $"{fileName}: bundleFormatVersion {bundleFormatVersion} is unsupported");
        var gonesDataVersion = IntProperty(root, "gonesDataVersion", fileName);
        if (gonesDataVersion != SupportedGonesDataVersion)
            throw new MigrationInputException("bundleUnsupportedVersion", $"{fileName}: gonesDataVersion {gonesDataVersion} is unsupported");

        var gonesAppVersion = StringProperty(root, "gonesAppVersion") ?? throw Invalid(fileName, "gonesAppVersion missing");
        var exportedAt = StringProperty(root, "exportedAt") ?? throw Invalid(fileName, "exportedAt missing");
        var sourceInstanceId = StringProperty(root, "sourceInstanceId") ?? throw Invalid(fileName, "sourceInstanceId missing");
        if (!SourceInstanceIdRegex().IsMatch(sourceInstanceId)) throw Invalid(fileName, "sourceInstanceId is not a UUID");
        var declaredChecksum = StringProperty(root, "bundleChecksum") ?? throw Invalid(fileName, "bundleChecksum missing");
        if (!ChecksumRegex().IsMatch(declaredChecksum)) throw Invalid(fileName, "bundleChecksum is not sha256-prefixed hex");
        if (!root.TryGetProperty("storeHashes", out var storeHashes) || storeHashes.ValueKind != JsonValueKind.Object)
            throw Invalid(fileName, "storeHashes missing");

        var storeErrors = StringArrayProperty(root, "storeErrors", fileName);
        var leagues = ObjectArrayProperty(root, "leagues", fileName);
        var calendarEvents = ObjectArrayProperty(root, "calendarEvents", fileName);
        var liveTournaments = ObjectArrayProperty(root, "liveTournaments", fileName);
        var deckArchetypes = StringArrayProperty(root, "deckArchetypes", fileName);
        if (leagues.Count > MaximumLeagues) throw Invalid(fileName, "too many leagues");
        if (calendarEvents.Count > MaximumCalendarEvents) throw Invalid(fileName, "too many calendar events");
        if (liveTournaments.Count > MaximumLiveTournaments) throw Invalid(fileName, "too many live tournaments");
        if (deckArchetypes.Count > MaximumDeckArchetypes) throw Invalid(fileName, "too many deck archetypes");

        if (!root.TryGetProperty("counts", out var countsElement) || countsElement.ValueKind != JsonValueKind.Object)
            throw Invalid(fileName, "counts missing");
        var counts = new MigrationBundleCounts(
            IntProperty(countsElement, "leagues", fileName),
            IntProperty(countsElement, "tournaments", fileName),
            IntProperty(countsElement, "calendarEvents", fileName),
            IntProperty(countsElement, "liveTournaments", fileName),
            IntProperty(countsElement, "deckArchetypes", fileName));
        var tournamentTotal = leagues.Sum(league =>
            league.TryGetProperty("tournaments", out var tournaments) && tournaments.ValueKind == JsonValueKind.Array
                ? tournaments.GetArrayLength()
                : 0);
        if (counts.Leagues != leagues.Count
            || counts.Tournaments != tournamentTotal
            || counts.CalendarEvents != calendarEvents.Count
            || counts.LiveTournaments != liveTournaments.Count
            || counts.DeckArchetypes != deckArchetypes.Count)
        {
            throw Invalid(fileName, "counts do not match bundle contents");
        }

        var computedChecksum = CanonicalJson.Checksum(root, ["bundleChecksum"]);
        if (!string.Equals(computedChecksum, declaredChecksum, StringComparison.Ordinal))
            throw new MigrationInputException("bundleChecksumMismatch", $"{fileName}: declared {declaredChecksum} but computed {computedChecksum}");

        RequireUniqueIds(leagues, fileName, "league");
        RequireUniqueIds(calendarEvents, fileName, "calendarEvent");
        RequireUniqueIds(liveTournaments, fileName, "liveTournament");

        return new MigrationBundleFile(
            fileName, sourceInstanceId, declaredChecksum, exportedAt, gonesDataVersion, gonesAppVersion,
            counts, storeErrors, leagues, calendarEvents, liveTournaments, deckArchetypes);
    }

    internal static string? EntityId(JsonElement element) =>
        element.ValueKind == JsonValueKind.Object
        && element.TryGetProperty("id", out var id)
        && id.ValueKind == JsonValueKind.String
            ? id.GetString()
            : null;

    private static void RequireUniqueIds(IReadOnlyList<JsonElement> items, string fileName, string entityKind)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in items)
        {
            var id = EntityId(item) ?? throw Invalid(fileName, $"{entityKind} without string id");
            if (!seen.Add(id))
                throw new MigrationInputException("bundleDuplicateEntity", $"{fileName}: duplicate {entityKind} id '{id}'");
        }
    }

    private static MigrationInputException Invalid(string fileName, string detail) =>
        new("bundleSchemaInvalid", $"{fileName}: {detail}");

    private static string? StringProperty(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static int IntProperty(JsonElement element, string name, string fileName) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var parsed)
            ? parsed
            : throw Invalid(fileName, $"{name} must be an integer");

    private static IReadOnlyList<string> StringArrayProperty(JsonElement element, string name, string fileName)
    {
        if (!element.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Array)
            throw Invalid(fileName, $"{name} must be an array");
        var items = new List<string>();
        foreach (var item in value.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String) throw Invalid(fileName, $"{name} must contain only strings");
            items.Add(item.GetString()!);
        }

        return items;
    }

    private static IReadOnlyList<JsonElement> ObjectArrayProperty(JsonElement element, string name, string fileName)
    {
        if (!element.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Array)
            throw Invalid(fileName, $"{name} must be an array");
        var items = new List<JsonElement>();
        foreach (var item in value.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object) throw Invalid(fileName, $"{name} must contain only objects");
            items.Add(item);
        }

        return items;
    }
}
