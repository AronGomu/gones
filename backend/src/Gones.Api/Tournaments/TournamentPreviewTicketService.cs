using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Gones.Api.Errors;
using Microsoft.AspNetCore.WebUtilities;
using NodaTime;

namespace Gones.Api.Tournaments;

internal sealed class TournamentPreviewTicketService
{
    public static readonly Duration Lifetime = Duration.FromMinutes(10);
    private const int NonceLength = 12;
    private const int TagLength = 16;
    private readonly byte[] key;
    private readonly IClock clock;

    public TournamentPreviewTicketService(IConfiguration configuration, IClock clock)
    {
        var signingKey = configuration["GONES_AUTH_SIGNING_KEY"];
        if (string.IsNullOrWhiteSpace(signingKey) || signingKey.Length < 32)
        {
            throw new InvalidOperationException("GONES_AUTH_SIGNING_KEY must contain at least 32 characters for tournament preview tickets.");
        }

        key = SHA256.HashData(Encoding.UTF8.GetBytes($"gones:tournament-preview:v1\0{signingKey}"));
        this.clock = clock;
    }

    public TournamentPreviewTicket Issue(Guid userId, Guid organizationId, string payloadHash)
    {
        var expiresAt = clock.GetCurrentInstant() + Lifetime;
        var plaintext = JsonSerializer.SerializeToUtf8Bytes(new TicketClaims(
            userId,
            organizationId,
            payloadHash,
            expiresAt.ToUnixTimeSeconds()));
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
        return new TournamentPreviewTicket(WebEncoders.Base64UrlEncode(packed), expiresAt);
    }

    public Instant Validate(string ticket, Guid userId, Guid organizationId, string payloadHash)
    {
        try
        {
            var packed = WebEncoders.Base64UrlDecode(ticket);
            if (packed.Length <= NonceLength + TagLength) throw new CryptographicException();
            var nonce = packed.AsSpan(0, NonceLength);
            var tag = packed.AsSpan(NonceLength, TagLength);
            var ciphertext = packed.AsSpan(NonceLength + TagLength);
            var plaintext = new byte[ciphertext.Length];
            using (var aes = new AesGcm(key, TagLength))
            {
                aes.Decrypt(nonce, ciphertext, tag, plaintext);
            }

            var claims = JsonSerializer.Deserialize<TicketClaims>(plaintext)
                ?? throw new CryptographicException();
            var expiresAt = Instant.FromUnixTimeSeconds(claims.ExpiresAtUnixSeconds);
            if (claims.UserId != userId
                || claims.OrganizationId != organizationId
                || !FixedTimeEquals(claims.PayloadHash, payloadHash)
                || clock.GetCurrentInstant() >= expiresAt)
            {
                throw new InvalidTournamentPreviewTicketException();
            }

            return expiresAt;
        }
        catch (InvalidTournamentPreviewTicketException)
        {
            throw;
        }
        catch (Exception exception) when (exception is FormatException or JsonException or CryptographicException or ArgumentException)
        {
            throw new InvalidTournamentPreviewTicketException();
        }
    }

    public static string Hash(string ticket) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(ticket))).ToLowerInvariant();

    private static bool FixedTimeEquals(string left, string right)
    {
        var leftBytes = Encoding.UTF8.GetBytes(left);
        var rightBytes = Encoding.UTF8.GetBytes(right);
        return leftBytes.Length == rightBytes.Length
            && CryptographicOperations.FixedTimeEquals(leftBytes, rightBytes);
    }

    private sealed record TicketClaims(Guid UserId, Guid OrganizationId, string PayloadHash, long ExpiresAtUnixSeconds);
}

internal sealed record TournamentPreviewTicket(string Value, Instant ExpiresAt);
