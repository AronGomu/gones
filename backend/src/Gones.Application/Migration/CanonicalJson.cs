using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Gones.Application.Migration;

/// <summary>
/// JavaScript-parity canonical JSON: recursively sorted object keys (UTF-16 code-unit order),
/// JSON.stringify string escaping, and verbatim number tokens as produced by JSON.stringify.
/// Must stay byte-identical with canonicalJsonStringify in src/app/domain/export-schemas.ts,
/// because SHA-256 checksums cross the TypeScript/C# boundary.
/// </summary>
public static class CanonicalJson
{
    public const string ChecksumPrefix = "sha256:";

    public static string Stringify(JsonElement element) => Stringify(element, []);

    /// <summary>Canonical text of <paramref name="element"/>, skipping the given top-level property names.</summary>
    public static string Stringify(JsonElement element, IReadOnlyCollection<string> skipTopLevelProperties)
    {
        var builder = new StringBuilder();
        Write(builder, element, skipTopLevelProperties);
        return builder.ToString();
    }

    public static string Sha256Hex(string text) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(text)));

    public static string Checksum(JsonElement element, IReadOnlyCollection<string> skipTopLevelProperties) =>
        $"{ChecksumPrefix}{Sha256Hex(Stringify(element, skipTopLevelProperties))}";

    public static string Checksum(JsonElement element) => Checksum(element, []);

    private static void Write(StringBuilder builder, JsonElement element, IReadOnlyCollection<string> skipTopLevel)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                builder.Append('{');
                var first = true;
                foreach (var property in element.EnumerateObject()
                             .Where(property => !skipTopLevel.Contains(property.Name))
                             .OrderBy(property => property.Name, StringComparer.Ordinal))
                {
                    if (!first) builder.Append(',');
                    first = false;
                    WriteString(builder, property.Name);
                    builder.Append(':');
                    Write(builder, property.Value, []);
                }

                builder.Append('}');
                break;
            case JsonValueKind.Array:
                builder.Append('[');
                var firstItem = true;
                foreach (var item in element.EnumerateArray())
                {
                    if (!firstItem) builder.Append(',');
                    firstItem = false;
                    Write(builder, item, []);
                }

                builder.Append(']');
                break;
            case JsonValueKind.String:
                WriteString(builder, element.GetString()!);
                break;
            case JsonValueKind.Number:
                // Bundle files are produced by JSON.stringify, so the raw token already is JS-canonical.
                builder.Append(element.GetRawText());
                break;
            case JsonValueKind.True:
                builder.Append("true");
                break;
            case JsonValueKind.False:
                builder.Append("false");
                break;
            default:
                builder.Append("null");
                break;
        }
    }

    private static void WriteString(StringBuilder builder, string value)
    {
        builder.Append('"');
        for (var index = 0; index < value.Length; index++)
        {
            var character = value[index];
            switch (character)
            {
                case '"': builder.Append("\\\""); break;
                case '\\': builder.Append("\\\\"); break;
                case '\b': builder.Append("\\b"); break;
                case '\f': builder.Append("\\f"); break;
                case '\n': builder.Append("\\n"); break;
                case '\r': builder.Append("\\r"); break;
                case '\t': builder.Append("\\t"); break;
                default:
                    if (character < 0x20)
                    {
                        builder.Append("\\u").Append(((int)character).ToString("x4"));
                    }
                    else if (char.IsSurrogate(character))
                    {
                        if (char.IsHighSurrogate(character) && index + 1 < value.Length && char.IsLowSurrogate(value[index + 1]))
                        {
                            builder.Append(character).Append(value[index + 1]);
                            index++;
                        }
                        else
                        {
                            // Well-formed JSON.stringify escapes lone surrogates.
                            builder.Append("\\u").Append(((int)character).ToString("x4"));
                        }
                    }
                    else
                    {
                        builder.Append(character);
                    }

                    break;
            }
        }

        builder.Append('"');
    }
}
