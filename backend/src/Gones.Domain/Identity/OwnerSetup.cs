using System.Security.Cryptography;
using System.Text;
using NodaTime;

namespace Gones.Domain.Identity;

/// <summary>Authorization predates the account; no user FK, so completion survives hard deletion.</summary>
public sealed class OwnerSetup
{
    public const string SingletonKey = "owner-setup";
    public string Key { get; init; } = SingletonKey;
    public bool Enabled { get; private set; }
    public string? OwnerEmail { get; private set; }
    public string? Environment { get; private set; }
    public string? PublicOrigin { get; private set; }
    public Guid? UserId { get; private set; }
    public string? TokenHash { get; private set; }
    public Instant? IssuedAt { get; private set; }
    public Instant? ExpiresAt { get; private set; }
    public Instant? CompletedAt { get; private set; }

    public bool Matches(string email, string environment, string origin) =>
        OwnerEmail == email && Environment == environment && PublicOrigin == origin;

    public void Bind(string email, string environment, string origin)
    {
        if (!Enabled || OwnerEmail is not null) throw new InvalidOperationException("owner_setup_unavailable");
        OwnerEmail = email;
        Environment = environment;
        PublicOrigin = origin;
        UserId = Guid.NewGuid();
    }

    public void Issue(string plaintext, Instant now)
    {
        if (!Enabled || UserId is null || CompletedAt is not null) throw new InvalidOperationException("owner_setup_unavailable");
        TokenHash = Hash(plaintext);
        IssuedAt = now;
        ExpiresAt = now + AccountActionToken.VerificationLifetime;
    }

    public bool CanComplete(string? plaintext, Instant now) =>
        Enabled && CompletedAt is null && plaintext is { Length: 43 } && TokenHash is not null
        && ExpiresAt > now && CryptographicOperations.FixedTimeEquals(
            Encoding.ASCII.GetBytes(TokenHash), Encoding.ASCII.GetBytes(Hash(plaintext)));

    public void Complete(Instant now)
    {
        CompletedAt = now;
        TokenHash = null;
    }

    public void Disable() => Enabled = false;

    private string Hash(string plaintext) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(
        $"owner-setup\n{Environment}\n{PublicOrigin}\n{OwnerEmail}\n{UserId:D}\n{plaintext}")));
}
