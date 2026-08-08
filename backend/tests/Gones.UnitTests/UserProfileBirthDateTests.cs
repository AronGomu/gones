using Gones.Domain.Identity;
using NodaTime;

namespace Gones.UnitTests;

public sealed class UserProfileBirthDateTests
{
    private static readonly LocalDate Today = new(2026, 8, 8);
    private static readonly Instant Now = Instant.FromUtc(2026, 8, 8, 12, 0);

    [Fact]
    public void Update_accepts_a_past_birth_date()
    {
        var profile = NewProfile();

        Update(profile, birthDate: new LocalDate(1990, 4, 17));

        Assert.Equal(new LocalDate(1990, 4, 17), profile.BirthDate);
    }

    [Theory]
    [InlineData(1900, 1, 1)]
    [InlineData(2026, 8, 8)]
    public void Update_accepts_the_birth_date_boundaries(int year, int month, int day)
    {
        var profile = NewProfile();

        Update(profile, birthDate: new LocalDate(year, month, day));

        Assert.Equal(new LocalDate(year, month, day), profile.BirthDate);
    }

    [Fact]
    public void Update_rejects_a_future_birth_date()
    {
        var profile = NewProfile();

        var exception = Assert.Throws<ArgumentOutOfRangeException>(() => Update(profile, birthDate: new LocalDate(2027, 1, 1)));

        Assert.Equal("birthDate", exception.ParamName);
    }

    [Fact]
    public void Update_rejects_a_birth_date_before_1900()
    {
        var profile = NewProfile();

        var exception = Assert.Throws<ArgumentOutOfRangeException>(() => Update(profile, birthDate: new LocalDate(1899, 12, 31)));

        Assert.Equal("birthDate", exception.ParamName);
    }

    [Fact]
    public void Update_stores_the_three_location_parts()
    {
        var profile = NewProfile();

        Update(profile, country: " France ", region: " Rhône ", city: " Lyon ");

        Assert.Equal("France", profile.LocationCountry);
        Assert.Equal("Rhône", profile.LocationRegion);
        Assert.Equal("Lyon", profile.LocationCity);
    }

    [Fact]
    public void Update_blanks_empty_location_parts_and_caps_them_at_100_characters()
    {
        var profile = NewProfile();

        Update(profile, country: "   ", region: null, city: string.Empty);

        Assert.Null(profile.LocationCountry);
        Assert.Null(profile.LocationRegion);
        Assert.Null(profile.LocationCity);

        var exception = Assert.Throws<ArgumentException>(() => Update(profile, city: new string('x', 101)));
        Assert.Equal("locationCity", exception.ParamName);
    }

    private static UserProfile NewProfile() =>
        UserProfile.Create(Guid.NewGuid(), "alice", "Alice", "Martin", Now);

    private static void Update(
        UserProfile profile,
        string? country = null,
        string? region = null,
        string? city = null,
        LocalDate? birthDate = null) =>
        profile.Update(
            "alice", "Alice", "Martin",
            country, region, city, birthDate,
            "fr", false, false, false, false, false,
            Today, Now);
}
