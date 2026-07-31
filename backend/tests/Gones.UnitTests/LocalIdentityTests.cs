using Gones.Domain.Identity;
using NodaTime;

namespace Gones.UnitTests;

public sealed class LocalIdentityTests
{
    [Fact]
    public void Username_normalization_is_unicode_compatible_and_case_insensitive()
    {
        var composed = Username.Normalize("Élodie");
        var decomposedUpper = Username.Normalize("E\u0301LODIE");
        var compatibility = Username.Normalize("Ａlice");

        Assert.Equal(composed, decomposedUpper);
        Assert.Equal("ALICE", compatibility);
    }

    [Theory]
    [InlineData("ab")]
    [InlineData("abcdefghijklmnopqrstuvwxyzabcde")]
    [InlineData(" alice")]
    [InlineData("alice ")]
    public void Username_rejects_invalid_display_values(string value)
    {
        Assert.Throws<ArgumentException>(() => Username.Validate(value));
    }

    [Fact]
    public void Profile_defaults_are_private_except_preserved_username()
    {
        var now = Instant.FromUtc(2026, 7, 31, 22, 0);
        var profile = UserProfile.Create(Guid.NewGuid(), "Élodie", "Élodie", "Martin", now);

        Assert.Equal("Élodie", profile.Username);
        Assert.Equal(Username.Normalize("Élodie"), profile.NormalizedUsername);
        Assert.Equal("fr", profile.PreferredLanguage);
        Assert.False(profile.IsFirstNamePublic);
        Assert.False(profile.IsLastNamePublic);
        Assert.False(profile.IsLocationPublic);
        Assert.False(profile.IsBirthYearPublic);
        Assert.False(profile.IsPreferredLanguagePublic);
        Assert.Null(profile.Location);
        Assert.Null(profile.BirthYear);
        Assert.Equal(now, profile.CreatedAt);
        Assert.Equal(now, profile.UpdatedAt);
    }

    [Theory]
    [InlineData(1899)]
    [InlineData(2027)]
    public void Birth_year_must_be_between_1900_and_current_utc_year(int birthYear)
    {
        var profile = UserProfile.Create(Guid.NewGuid(), "alice", "Alice", "Martin", Instant.FromUtc(2026, 1, 1, 0, 0));

        Assert.Throws<ArgumentOutOfRangeException>(() => profile.Update(
            "alice", "Alice", "Martin", null, birthYear, "fr",
            false, false, false, false, false,
            currentYear: 2026, Instant.FromUtc(2026, 2, 1, 0, 0)));
    }

    [Theory]
    [InlineData(1900)]
    [InlineData(2026)]
    public void Birth_year_accepts_range_boundaries(int birthYear)
    {
        var profile = UserProfile.Create(Guid.NewGuid(), "alice", "Alice", "Martin", Instant.FromUtc(2026, 1, 1, 0, 0));

        profile.Update(
            "alice", "Alice", "Martin", null, birthYear, "en",
            true, true, true, true, true,
            currentYear: 2026, Instant.FromUtc(2026, 2, 1, 0, 0));

        Assert.Equal(birthYear, profile.BirthYear);
        Assert.Equal("en", profile.PreferredLanguage);
    }
}
