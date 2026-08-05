using Gones.Domain.Catalog;
using NodaTime;

namespace Gones.UnitTests;

public sealed class DeckArchetypeTests
{
    private static readonly Instant Now = Instant.FromUtc(2026, 8, 5, 12, 0);

    [Fact]
    public void Create_trims_and_collapses_whitespace()
    {
        var archetype = DeckArchetype.Create("  Mono   Red  ", Now);
        Assert.Equal("Mono Red", archetype.Name);
        Assert.Equal("mono red", archetype.NormalizedName);
        Assert.True(archetype.IsActive);
    }

    [Theory]
    [InlineData("Mono Red", "mono red")]
    [InlineData("  MONO   RED ", "mono red")]
    [InlineData("Reanimator (Rakdos)", "reanimator (rakdos)")]
    public void Normalized_key_is_case_and_space_insensitive(string name, string expectedKey)
    {
        Assert.Equal(expectedKey, DeckArchetype.NormalizeKey(name));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Empty_names_are_rejected(string name)
    {
        Assert.ThrowsAny<ArgumentException>(() => DeckArchetype.Create(name, Now));
    }

    [Fact]
    public void Overlong_name_is_rejected()
    {
        Assert.ThrowsAny<ArgumentException>(() => DeckArchetype.Create(new string('x', DeckArchetype.MaximumNameLength + 1), Now));
    }

    [Fact]
    public void Soft_delete_prevents_rename_but_restore_reactivates()
    {
        var archetype = DeckArchetype.Create("Burn (Red)", Now);
        archetype.SoftDelete(Now + Duration.FromMinutes(1));
        Assert.False(archetype.IsActive);
        Assert.Equal("Burn (Red)", archetype.Name);
        Assert.Throws<InvalidOperationException>(() => archetype.Rename("Burn", Now + Duration.FromMinutes(2)));

        archetype.Restore(Now + Duration.FromMinutes(3));
        Assert.True(archetype.IsActive);
        archetype.Rename("Burn", Now + Duration.FromMinutes(4));
        Assert.Equal("Burn", archetype.Name);
        Assert.Equal("burn", archetype.NormalizedName);
    }

    [Fact]
    public void Bundled_legacy_presets_are_distinct_and_valid()
    {
        Assert.Equal(49, DeckArchetypePresets.LegacyNames.Count);
        var keys = DeckArchetypePresets.LegacyNames.Select(DeckArchetype.NormalizeKey).ToArray();
        Assert.Equal(keys.Length, keys.Distinct(StringComparer.Ordinal).Count());
        Assert.All(DeckArchetypePresets.LegacyNames, name => Assert.Equal(name, DeckArchetype.ValidateName(name)));
    }
}
