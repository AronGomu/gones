using Gones.Domain.Leagues;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Gones.Infrastructure.Persistence;

internal sealed class LeagueAggregateConfiguration : VersionedEntityConfiguration<LeagueAggregate>
{
    public override void Configure(EntityTypeBuilder<LeagueAggregate> builder)
    {
        base.Configure(builder);
        builder.ToTable("league_aggregates");
        builder.Property(aggregate => aggregate.DocumentId).HasMaxLength(LeagueAggregate.MaximumDocumentIdLength);
        builder.Property(aggregate => aggregate.Name).HasMaxLength(LeagueAggregate.MaximumNameLength);
        builder.Property(aggregate => aggregate.Status).HasMaxLength(LeagueAggregate.MaximumStatusLength);
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
            table.HasCheckConstraint("ck_league_aggregate_document_size", $"octet_length(canonical_document::text) <= {LeagueAggregate.MaximumDocumentBytes}");
            table.HasCheckConstraint("ck_league_aggregate_document_metadata", "canonical_document ->> 'id' = document_id AND canonical_document ->> 'name' = name AND canonical_document ->> 'status' = status");
        });
    }
}
