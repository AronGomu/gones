using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Gones.Api.Serialization;

public sealed class UtcDateTimeJsonConverter : JsonConverter<DateTime>
{
    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        var value = UtcTimestamp.Parse(reader.GetString());
        return value.UtcDateTime;
    }

    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options)
    {
        if (value.Kind == DateTimeKind.Unspecified) throw new JsonException("UTC offset is required.");
        writer.WriteStringValue(value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture));
    }
}

public sealed class UtcDateTimeOffsetJsonConverter : JsonConverter<DateTimeOffset>
{
    public override DateTimeOffset Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) => UtcTimestamp.Parse(reader.GetString());

    public override void Write(Utf8JsonWriter writer, DateTimeOffset value, JsonSerializerOptions options) =>
        writer.WriteStringValue(value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture));
}

internal static class UtcTimestamp
{
    public static DateTimeOffset Parse(string? text)
    {
        if (string.IsNullOrWhiteSpace(text) || !HasOffset(text)
            || !DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsed))
        {
            throw new JsonException("Timestamp must include UTC offset.");
        }
        return parsed.ToUniversalTime();
    }

    private static bool HasOffset(string text)
    {
        if (text.EndsWith('Z') || text.EndsWith('z')) return true;
        var timeSeparator = text.IndexOf('T');
        var offset = Math.Max(text.LastIndexOf('+'), text.LastIndexOf('-'));
        return timeSeparator >= 0 && offset > timeSeparator;
    }
}
