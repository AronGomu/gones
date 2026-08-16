using System.Text.Json;
using Gones.Domain.Leagues;

namespace Gones.UnitTests;

/// <summary>
/// The Archive Tournament completion flag, normalised from stored or imported JSON. The default is the
/// opposite of the League one on purpose: an archive document that predates the field is history, and
/// history is complete — the same rule the backfill migration applies to stored documents.
/// </summary>
public sealed class LeagueNormalizerTests
{
    [Fact]
    public void Defaults_a_missing_status_to_completed()
    {
        var league = Normalize("""{"id":"l","name":"L","status":"active","tournaments":[{"id":"t","name":"T"}]}""");
        Assert.Equal("completed", Assert.Single(league.Tournaments).Status);
    }

    [Fact]
    public void Keeps_an_explicit_active()
    {
        var league = Normalize("""{"id":"l","name":"L","status":"active","tournaments":[{"id":"t","name":"T","status":"active"}]}""");
        Assert.Equal("active", Assert.Single(league.Tournaments).Status);
    }

    [Theory]
    [InlineData("\"weird\"")]
    [InlineData("\"finished\"")]
    [InlineData("\"\"")]
    [InlineData("null")]
    [InlineData("7")]
    public void Maps_an_unknown_value_to_completed(string status)
    {
        var league = Normalize($$"""{"id":"l","name":"L","status":"active","tournaments":[{"id":"t","name":"T","status":{{status}}}]}""");
        Assert.Equal("completed", Assert.Single(league.Tournaments).Status);
    }

    [Fact]
    public void Never_cascades_from_the_league()
    {
        var league = Normalize("""{"id":"l","name":"L","status":"completed","tournaments":[{"id":"t","name":"T","status":"active"}]}""");
        Assert.Equal("completed", league.Status);
        Assert.Equal("active", Assert.Single(league.Tournaments).Status);
    }

    private static LeagueDocument Normalize(string json) =>
        LeagueNormalizer.Normalize(JsonDocument.Parse(json).RootElement, () => "generated");
}
