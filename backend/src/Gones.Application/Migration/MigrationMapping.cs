using System.Text.Json;

namespace Gones.Application.Migration;

public sealed record CalendarEventMapping(
    string? Slug,
    string? StartTime,
    string? EndTime,
    string? TimeZone,
    string? Address,
    string? City,
    string? Country,
    string? PostalCode,
    string? Region,
    IReadOnlyList<string>? FormatSlugs,
    string? Status,
    int? Capacity);

/// <summary>
/// Operator-authored mapping for the server-side fields legacy Calendar events never carried.
/// Every legacy event needs its own entry: there is deliberately no global default.
/// </summary>
public sealed record MigrationMappingFile(
    string FileName,
    Guid OrganizationId,
    Guid OwnerUserId,
    IReadOnlyDictionary<string, CalendarEventMapping> CalendarEvents,
    string MappingHash);

public static class MigrationMappingReader
{
    public const string Kind = "gones.migration-mapping";
    public const int SupportedFormatVersion = 1;
    public const long MaximumMappingBytes = 4 * 1024 * 1024;

    public static readonly string[] StatusPolicies = ["published", "cancelled"];

    public static MigrationMappingFile Read(string path)
    {
        if (!File.Exists(path)) throw new MigrationInputException("mappingFileMissing", path);
        var fileName = Path.GetFileName(path);
        if (new FileInfo(path).Length > MaximumMappingBytes)
            throw new MigrationInputException("mappingFileTooLarge", fileName);
        return Parse(File.ReadAllBytes(path), fileName);
    }

    public static MigrationMappingFile Parse(byte[] utf8Json, string fileName)
    {
        JsonElement root;
        try
        {
            using var document = JsonDocument.Parse(utf8Json, new JsonDocumentOptions { MaxDepth = 16 });
            root = document.RootElement.Clone();
        }
        catch (JsonException exception)
        {
            throw new MigrationInputException("mappingMalformedJson", $"{fileName}: {exception.Message}");
        }

        if (root.ValueKind != JsonValueKind.Object
            || !root.TryGetProperty("kind", out var kind) || kind.ValueKind != JsonValueKind.String || kind.GetString() != Kind)
        {
            throw new MigrationInputException("mappingSchemaInvalid", $"{fileName}: kind is not a migration mapping");
        }

        if (!root.TryGetProperty("mappingFormatVersion", out var version)
            || version.ValueKind != JsonValueKind.Number
            || !version.TryGetInt32(out var parsedVersion)
            || parsedVersion != SupportedFormatVersion)
        {
            throw new MigrationInputException("mappingUnsupportedVersion", fileName);
        }

        var organizationId = RequiredGuid(root, "organizationId", fileName);
        var ownerUserId = RequiredGuid(root, "ownerUserId", fileName);

        var calendarEvents = new Dictionary<string, CalendarEventMapping>(StringComparer.Ordinal);
        if (root.TryGetProperty("calendarEvents", out var eventsElement))
        {
            if (eventsElement.ValueKind != JsonValueKind.Object)
                throw new MigrationInputException("mappingSchemaInvalid", $"{fileName}: calendarEvents must be an object");
            foreach (var entry in eventsElement.EnumerateObject())
            {
                if (entry.Value.ValueKind != JsonValueKind.Object)
                    throw new MigrationInputException("mappingSchemaInvalid", $"{fileName}: calendarEvents['{entry.Name}'] must be an object");
                calendarEvents[entry.Name] = ParseEventMapping(entry.Value, entry.Name, fileName);
            }
        }

        return new MigrationMappingFile(fileName, organizationId, ownerUserId, calendarEvents, CanonicalJson.Checksum(root));
    }

    private static CalendarEventMapping ParseEventMapping(JsonElement element, string eventId, string fileName)
    {
        IReadOnlyList<string>? formatSlugs = null;
        if (element.TryGetProperty("formatSlugs", out var formats))
        {
            if (formats.ValueKind != JsonValueKind.Array
                || formats.EnumerateArray().Any(item => item.ValueKind != JsonValueKind.String))
            {
                throw new MigrationInputException("mappingSchemaInvalid", $"{fileName}: calendarEvents['{eventId}'].formatSlugs must be a string array");
            }

            formatSlugs = formats.EnumerateArray().Select(item => item.GetString()!).ToArray();
        }

        int? capacity = null;
        if (element.TryGetProperty("capacity", out var capacityElement) && capacityElement.ValueKind != JsonValueKind.Null)
        {
            if (capacityElement.ValueKind != JsonValueKind.Number || !capacityElement.TryGetInt32(out var parsedCapacity))
                throw new MigrationInputException("mappingSchemaInvalid", $"{fileName}: calendarEvents['{eventId}'].capacity must be an integer");
            capacity = parsedCapacity;
        }

        return new CalendarEventMapping(
            OptionalString(element, "slug"),
            OptionalString(element, "startTime"),
            OptionalString(element, "endTime"),
            OptionalString(element, "timeZone"),
            OptionalString(element, "address"),
            OptionalString(element, "city"),
            OptionalString(element, "country"),
            OptionalString(element, "postalCode"),
            OptionalString(element, "region"),
            formatSlugs,
            OptionalString(element, "status"),
            capacity);
    }

    private static Guid RequiredGuid(JsonElement element, string name, string fileName) =>
        element.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.String
        && Guid.TryParse(value.GetString(), out var parsed)
        && parsed != Guid.Empty
            ? parsed
            : throw new MigrationInputException("mappingSchemaInvalid", $"{fileName}: {name} must be a non-empty GUID");

    private static string? OptionalString(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}
