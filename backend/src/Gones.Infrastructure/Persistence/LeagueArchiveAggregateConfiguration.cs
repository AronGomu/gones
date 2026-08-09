using Gones.Domain.Leagues;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Gones.Infrastructure.Persistence;

internal sealed class LeagueArchiveAggregateConfiguration : VersionedEntityConfiguration<LeagueArchiveAggregate>
{
    public override void Configure(EntityTypeBuilder<LeagueArchiveAggregate> builder)
    {
        base.Configure(builder);
        builder.ToTable("league_archive_aggregates");
        builder.Property(aggregate => aggregate.DocumentId).HasMaxLength(LeagueArchiveAggregate.MaximumDocumentIdLength);
        builder.Property(aggregate => aggregate.Name).HasMaxLength(LeagueArchiveAggregate.MaximumNameLength);
        builder.Property(aggregate => aggregate.Status).HasMaxLength(LeagueArchiveAggregate.MaximumStatusLength);
        builder.Property(aggregate => aggregate.CanonicalDocument).HasColumnType("jsonb");
        builder.HasIndex(aggregate => aggregate.DocumentId).IsUnique();
        builder.HasIndex(aggregate => aggregate.Name);
        builder.HasIndex(aggregate => aggregate.Status);
        builder.HasIndex(aggregate => aggregate.Version);
        builder.HasIndex(aggregate => new { aggregate.DeletedAt, aggregate.UpdatedAt, aggregate.Id })
            .IsDescending(false, true, false);
        builder.ToTable(table =>
        {
            table.HasCheckConstraint("ck_league_aggregate_status", "status IN ('active', 'completed')");
            table.HasCheckConstraint("ck_league_aggregate_document_object", "jsonb_typeof(canonical_document) = 'object'");
            table.HasCheckConstraint("ck_league_aggregate_document_size", $"octet_length(canonical_document::text) <= {LeagueArchiveAggregate.MaximumDocumentBytes}");
            table.HasCheckConstraint("ck_league_aggregate_document_metadata", "canonical_document ->> 'id' = document_id AND canonical_document ->> 'name' = name AND canonical_document ->> 'status' = status");
        });
    }
}
