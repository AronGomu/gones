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
        Assert.False(profile.IsBirthDatePublic);
        Assert.False(profile.IsPreferredLanguagePublic);
        Assert.Null(profile.LocationCountry);
        Assert.Null(profile.LocationRegion);
        Assert.Null(profile.LocationCity);
        Assert.Null(profile.BirthDate);
        Assert.Equal(now, profile.CreatedAt);
        Assert.Equal(now, profile.UpdatedAt);
    }
}
