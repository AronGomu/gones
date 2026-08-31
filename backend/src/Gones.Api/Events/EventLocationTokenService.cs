using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Gones.Api.Errors;
using Gones.Application.Events;
using Microsoft.AspNetCore.WebUtilities;
using NodaTime;

namespace Gones.Api.Events;

internal sealed class EventLocationTokenService : IEventLocationTokenService
{
    public static readonly Duration Lifetime = Duration.FromMinutes(30);
    private const int NonceLength = 12;
    private const int TagLength = 16;
    private readonly byte[] key;

    public EventLocationTokenService(IConfiguration configuration)
    {
        var signingKey = configuration["GONES_AUTH_SIGNING_KEY"];
        if (string.IsNullOrWhiteSpace(signingKey) || signingKey.Length < 32)
        {
            throw new InvalidOperationException("GONES_AUTH_SIGNING_KEY must contain at least 32 characters for Event location tokens.");
        }

        key = SHA256.HashData(Encoding.UTF8.GetBytes($"gones:event-location:v1\0{signingKey}"));
    }

    public string Issue(Guid userId, ResolvedEventLocation location, Instant now)
    {
        var expiresAt = now + Lifetime;
        var plaintext = JsonSerializer.SerializeToUtf8Bytes(new LocationClaims(
            userId,
            location.PlaceId,
            location.StreetAddress,
            location.PostalCode,
            location.City,
            location.Country,
            location.Region,
            location.Latitude,
            location.Longitude,
            location.TimeZoneId,
            now.ToUnixTimeTicks(),
            expiresAt.ToUnixTimeTicks()));
        var nonce = RandomNumberGenerator.GetBytes(NonceLength);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[TagLength];
        using (var aes = new AesGcm(key, TagLength))
        {
            aes.Encrypt(nonce, plaintext, ciphertext, tag);
        }

        var packed = new byte[nonce.Length + tag.Length + ciphertext.Length];
        nonce.CopyTo(packed, 0);
        tag.CopyTo(packed, nonce.Length);
        ciphertext.CopyTo(packed, nonce.Length + tag.Length);
        return WebEncoders.Base64UrlEncode(packed);
    }

    public ValidatedEventLocation Validate(Guid userId, EventLocationInput input, Instant now)
    {
        try
        {
            var claims = Decrypt(input.LocationToken);
            var issuedAt = Instant.FromUnixTimeTicks(claims.IssuedAtUnixTicks);
            var expiresAt = Instant.FromUnixTimeTicks(claims.ExpiresAtUnixTicks);
            if (claims.UserId != userId
                || expiresAt - issuedAt != Lifetime
                || !FieldsMatch(claims, input))
            {
                throw new LocationTokenInvalidException();
            }
            if (now >= expiresAt) throw new LocationTokenExpiredException();

            return new ValidatedEventLocation(
                claims.PlaceId,
                claims.StreetAddress,
                claims.PostalCode,
                claims.City,
                claims.Country,
                claims.Region,
                claims.Latitude,
                claims.Longitude,
                claims.TimeZoneId,
                expiresAt);
        }
        catch (LocationTokenInvalidException)
        {
            throw;
        }
        catch (LocationTokenExpiredException)
        {
            throw;
        }
        catch (Exception exception) when (exception is FormatException or JsonException or CryptographicException or ArgumentException or OverflowException)
        {
            throw new LocationTokenInvalidException();
        }
    }

    private LocationClaims Decrypt(string token)
    {
        if (string.IsNullOrWhiteSpace(token)) throw new LocationTokenInvalidException();
        var packed = WebEncoders.Base64UrlDecode(token);
        if (packed.Length <= NonceLength + TagLength) throw new CryptographicException();
        var nonce = packed.AsSpan(0, NonceLength);
        var tag = packed.AsSpan(NonceLength, TagLength);
        var ciphertext = packed.AsSpan(NonceLength + TagLength);
        var plaintext = new byte[ciphertext.Length];
        using (var aes = new AesGcm(key, TagLength))
        {
            aes.Decrypt(nonce, ciphertext, tag, plaintext);
        }
        return JsonSerializer.Deserialize<LocationClaims>(plaintext) ?? throw new CryptographicException();
    }

    private static bool FieldsMatch(LocationClaims claims, EventLocationInput input) =>
        CryptographicOperations.FixedTimeEquals(
            FieldHash(claims.StreetAddress, claims.PostalCode, claims.City, claims.Country, claims.Region),
            FieldHash(input.StreetAddress, input.PostalCode, input.City, input.Country, input.Region));

    private static byte[] FieldHash(string streetAddress, string postalCode, string city, string country, string region) =>
        SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new[] { streetAddress, postalCode, city, country, region }));

    private sealed record LocationClaims(
        Guid UserId,
        string PlaceId,
        string StreetAddress,
        string PostalCode,
        string City,
        string Country,
        string Region,
        decimal Latitude,
        decimal Longitude,
        string TimeZoneId,
        long IssuedAtUnixTicks,
        long ExpiresAtUnixTicks);
}
