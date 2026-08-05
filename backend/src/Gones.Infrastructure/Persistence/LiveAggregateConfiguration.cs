using Gones.Domain.Live;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Gones.Infrastructure.Persistence;

internal sealed class LiveAggregateConfiguration : VersionedEntityConfiguration<LiveAggregate>
{
    public override void Configure(EntityTypeBuilder<LiveAggregate> builder)
    {
        base.Configure(builder);
        builder.ToTable("live_aggregates");
        builder.Property(aggregate => aggregate.DocumentId).HasMaxLength(LiveAggregate.MaximumDocumentIdLength);
        builder.Property(aggregate => aggregate.Name).HasMaxLength(LiveAggregate.MaximumNameLength);
        builder.Property(aggregate => aggregate.TournamentDate).HasMaxLength(LiveAggregate.MaximumTournamentDateLength);
        builder.Property(aggregate => aggregate.Stage).HasMaxLength(LiveAggregate.MaximumStageLength);
        builder.Property(aggregate => aggregate.CanonicalDocument).HasColumnType("jsonb");
        builder.HasIndex(aggregate => aggregate.DocumentId).IsUnique();
        builder.HasIndex(aggregate => aggregate.Name);
        builder.HasIndex(aggregate => aggregate.TournamentDate);
        builder.HasIndex(aggregate => aggregate.Stage);
        builder.HasIndex(aggregate => aggregate.Version);
        builder.HasIndex(aggregate => new { aggregate.DeletedAt, aggregate.UpdatedAt, aggregate.Id })
            .IsDescending(false, true, false);
        builder.ToTable(table =>
        {
            table.HasCheckConstraint("ck_live_aggregate_stage", "stage IN ('registration', 'round', 'standings', 'completed')");
            table.HasCheckConstraint("ck_live_aggregate_document_object", "jsonb_typeof(canonical_document) = 'object'");
            table.HasCheckConstraint("ck_live_aggregate_document_size", $"octet_length(canonical_document::text) <= {LiveAggregate.MaximumDocumentBytes}");
            table.HasCheckConstraint("ck_live_aggregate_checkpoint_bound", $"jsonb_array_length(canonical_document -> 'checkpoints') <= {LiveAggregate.MaximumCheckpoints}");
            table.HasCheckConstraint("ck_live_aggregate_document_metadata", "canonical_document ->> 'id' = document_id AND canonical_document ->> 'name' = name AND canonical_document ->> 'tournamentDate' = tournament_date AND canonical_document ->> 'stage' = stage");
        });
    }
}
