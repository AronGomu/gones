using Gones.Domain.Catalog;
using NodaTime;

namespace Gones.UnitTests;

public sealed class TournamentFormatTests
{
    private static readonly Instant Now = Instant.FromUtc(2026, 8, 1, 12, 0);

    [Fact]
    public void Create_normalizes_slug_and_trims_name()
    {
        var format = TournamentFormat.Create("  Modern  ", " Modern ", sortOrder: 3, Now);
        Assert.Equal("Modern", format.Name);
        Assert.Equal("modern", format.Slug);
        Assert.Equal(3, format.SortOrder);
        Assert.True(format.IsActive);
    }

    [Theory]
    [InlineData("Modern!")]
    [InlineData("has space")]
    [InlineData("")]
    public void Invalid_slug_is_rejected(string slug)
    {
        Assert.ThrowsAny<ArgumentException>(() => TournamentFormat.Create("Modern", slug, 1, Now));
    }

    [Fact]
    public void Soft_delete_hides_format_and_blocks_legacy_delete()
    {
        var modern = TournamentFormat.Create("Modern", "modern", 1, Now);
        modern.SoftDelete(Now + Duration.FromMinutes(1));
        Assert.False(modern.IsActive);
        Assert.NotNull(modern.DeletedAt);

        var legacy = TournamentFormat.CreateLegacy(Now);
        Assert.Throws<InvalidOperationException>(() => legacy.SoftDelete(Now));
    }

    [Fact]
    public void Soft_deleted_format_cannot_update()
    {
        var format = TournamentFormat.Create("Pauper", "pauper", 2, Now);
        format.SoftDelete(Now);
        Assert.Throws<InvalidOperationException>(() => format.Update("Pauper X", "pauper", 2, Now));
    }

    [Fact]
    public void V1_selection_requires_active_legacy()
    {
        var legacy = TournamentFormat.CreateLegacy(Now);
        var modern = TournamentFormat.Create("Modern", "modern", 1, Now);
        TournamentFormatSelection.RequireLegacyForV1([legacy, modern]);

        Assert.Throws<ArgumentException>(() => TournamentFormatSelection.RequireLegacyForV1([modern]));
        modern.SoftDelete(Now);
        Assert.Throws<ArgumentException>(() => TournamentFormatSelection.RequireLegacyForV1([legacy, modern]));
    }

    [Fact]
    public void Sort_order_cannot_be_negative()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => TournamentFormat.Create("Vintage", "vintage", -1, Now));
    }
}
