using System.Buffers.Binary;

namespace Gones.Application.Concurrency;

public static class StrongETag
{
    public static string Encode(long version)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(version, 1);
        Span<byte> bytes = stackalloc byte[sizeof(long)];
        BinaryPrimitives.WriteInt64BigEndian(bytes, version);
        return $"\"{Convert.ToBase64String(bytes)}\"";
    }

    public static bool TryDecode(string? etag, out long version)
    {
        version = 0;
        if (etag is null || etag.Length < 3 || etag[0] != '"' || etag[^1] != '"' || etag.StartsWith("W/", StringComparison.Ordinal))
        {
            return false;
        }

        var payload = etag[1..^1];
        if (payload.Any(char.IsWhiteSpace)) return false;

        Span<byte> bytes = stackalloc byte[sizeof(long)];
        if (!Convert.TryFromBase64String(payload, bytes, out var bytesWritten) || bytesWritten != sizeof(long)) return false;
        if (!string.Equals(Convert.ToBase64String(bytes), payload, StringComparison.Ordinal)) return false;

        version = BinaryPrimitives.ReadInt64BigEndian(bytes);
        return version > 0;
    }
}
