using Gones.Application.Concurrency;

namespace Gones.UnitTests;

public sealed class StrongETagTests
{
    [Theory]
    [InlineData(1)]
    [InlineData(long.MaxValue)]
    public void Version_round_trips(long version)
    {
        var encoded = StrongETag.Encode(version);

        Assert.True(StrongETag.TryDecode(encoded, out var decoded));
        Assert.Equal(version, decoded);
        Assert.StartsWith("\"", encoded, StringComparison.Ordinal);
        Assert.EndsWith("\"", encoded, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("W/\"AAAAAAAAAAE=\"")]
    [InlineData("\"AAAAAAAAAAE= \"")]
    [InlineData("\"AAAAAAAAAAF=\"")]
    [InlineData("\"AAAAAAAAAAA=\"")]
    [InlineData("\"//////////8=\"")]
    [InlineData("not-base64")]
    public void Invalid_or_weak_values_are_rejected(string? value)
    {
        Assert.False(StrongETag.TryDecode(value, out _));
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(0)]
    public void Nonpositive_versions_cannot_be_encoded(long version)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => StrongETag.Encode(version));
    }
}
