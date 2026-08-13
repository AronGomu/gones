using System.Text;
using Gones.Domain.Persistence;
using NodaTime;

namespace Gones.Domain.Identity;

public static class Username
{
    public const int MinimumLength = 3;
    public const int MaximumLength = 64;

    public static void Validate(string value)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value);
        if (!string.Equals(value, value.Trim(), StringComparison.Ordinal))
        {
            throw new ArgumentException("Username cannot start or end with whitespace.", nameof(value));
        }

        var length = value.EnumerateRunes().Count();
        if (length is < MinimumLength or > MaximumLength)
        {
            throw new ArgumentException($"Username must contain between {MinimumLength} and {MaximumLength} characters.", nameof(value));
        }
    }

    public static string Normalize(string value)
    {
        Validate(value);
        return value.Normalize(NormalizationForm.FormKC).ToUpperInvariant();
    }
}

public sealed class UserProfile : VersionedEntity
{
    private UserProfile() { }

    public Guid UserId { get; private init; }
    public string Username { get; private set; } = string.Empty;
    public string NormalizedUsername { get; private set; } = string.Empty;
    public string FirstName { get; private set; } = string.Empty;
    public string LastName { get; private set; } = string.Empty;
    public string? LocationCountry { get; private set; }
    public string? LocationRegion { get; private set; }
    public string? LocationCity { get; private set; }
    public LocalDate? BirthDate { get; private set; }
    public string PreferredLanguage { get; private set; } = "fr";
    public bool IsFirstNamePublic { get; private set; }
    public bool IsLastNamePublic { get; private set; }
    public bool IsLocationPublic { get; private set; }
    public bool IsBirthDatePublic { get; private set; }
    public bool IsPreferredLanguagePublic { get; private set; }
    public Instant CreatedAt { get; private init; }
    public Instant UpdatedAt { get; private set; }
    public Instant? ClosedAt { get; private set; }

    public bool IsClosed => ClosedAt is not null;

    public static UserProfile Create(Guid userId, string username, string firstName, string lastName, Instant now)
    {
        if (userId == Guid.Empty) throw new ArgumentException("User ID cannot be empty.", nameof(userId));
        var profile = new UserProfile
        {
            UserId = userId,
            Username = username,
            NormalizedUsername = global::Gones.Domain.Identity.Username.Normalize(username),
            FirstName = ValidateRequired(firstName, nameof(firstName), 100),
            LastName = ValidateRequired(lastName, nameof(lastName), 100),
            CreatedAt = now,
            UpdatedAt = now
        };
        return profile;
    }

    public void Update(
        string username,
        string firstName,
        string lastName,
        string? locationCountry,
        string? locationRegion,
        string? locationCity,
        LocalDate? birthDate,
        string preferredLanguage,
        bool isFirstNamePublic,
        bool isLastNamePublic,
        bool isLocationPublic,
        bool isBirthDatePublic,
        bool isPreferredLanguagePublic,
        LocalDate today,
        Instant now)
    {
        if (birthDate is { } value && (value.Year < 1900 || value > today))
        {
            throw new ArgumentOutOfRangeException(nameof(birthDate), $"Birth date must be between 1900-01-01 and {today:yyyy-MM-dd}.");
        }

        Username = username;
        NormalizedUsername = global::Gones.Domain.Identity.Username.Normalize(username);
        FirstName = ValidateRequired(firstName, nameof(firstName), 100);
        LastName = ValidateRequired(lastName, nameof(lastName), 100);
        LocationCountry = ValidateOptional(locationCountry, nameof(locationCountry), 100);
        LocationRegion = ValidateOptional(locationRegion, nameof(locationRegion), 100);
        LocationCity = ValidateOptional(locationCity, nameof(locationCity), 100);
        BirthDate = birthDate;
        PreferredLanguage = preferredLanguage is "fr" or "en"
            ? preferredLanguage
            : throw new ArgumentException("Preferred language must be fr or en.", nameof(preferredLanguage));
        IsFirstNamePublic = isFirstNamePublic;
        IsLastNamePublic = isLastNamePublic;
        IsLocationPublic = isLocationPublic;
        IsBirthDatePublic = isBirthDatePublic;
        IsPreferredLanguagePublic = isPreferredLanguagePublic;
        UpdatedAt = now;
    }

    public void CloseAndAnonymize(string opaqueUsername, Instant now)
    {
        if (ClosedAt is not null) return;
        Username = opaqueUsername;
        NormalizedUsername = global::Gones.Domain.Identity.Username.Normalize(opaqueUsername);
        FirstName = "Closed";
        LastName = "User";
        LocationCountry = null;
        LocationRegion = null;
        LocationCity = null;
        BirthDate = null;
        IsFirstNamePublic = false;
        IsLastNamePublic = false;
        IsLocationPublic = false;
        IsBirthDatePublic = false;
        IsPreferredLanguagePublic = false;
        ClosedAt = now;
        UpdatedAt = now;
    }

    private static string ValidateRequired(string value, string parameterName, int maximumLength)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value, parameterName);
        if (value.Length > maximumLength) throw new ArgumentException($"Value cannot exceed {maximumLength} characters.", parameterName);
        return value.Trim();
    }

    private static string? ValidateOptional(string? value, string parameterName, int maximumLength)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (value.Length > maximumLength) throw new ArgumentException($"Value cannot exceed {maximumLength} characters.", parameterName);
        return value.Trim();
    }
}
