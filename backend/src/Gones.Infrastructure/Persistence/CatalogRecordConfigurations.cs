using Gones.Domain.Catalog;
using Gones.Domain.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Gones.Infrastructure.Persistence;

internal sealed class TournamentFormatConfiguration : VersionedEntityConfiguration<TournamentFormat>
{
    public override void Configure(EntityTypeBuilder<TournamentFormat> builder)
    {
        base.Configure(builder);
        builder.ToTable("tournament_formats");
        builder.Property(format => format.Name).HasMaxLength(TournamentFormat.MaximumNameLength);
        builder.Property(format => format.Slug).HasMaxLength(TournamentFormat.MaximumSlugLength);
        builder.HasIndex(format => format.Slug).IsUnique();
        builder.HasIndex(format => new { format.DeletedAt, format.SortOrder, format.Name });
        builder.ToTable(table =>
        {
            table.HasCheckConstraint("ck_tournament_format_sort_order", "sort_order >= 0");
        });
    }
}

internal sealed class SystemMarkerConfiguration : VersionedEntityConfiguration<SystemMarker>
{
    public override void Configure(EntityTypeBuilder<SystemMarker> builder)
    {
        base.Configure(builder);
        builder.ToTable("system_markers");
        builder.Property(marker => marker.Key).HasMaxLength(100);
        builder.HasIndex(marker => marker.Key).IsUnique();
    }
}
