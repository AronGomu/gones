using Gones.Domain.Persistence;
using Gones.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Gones.Infrastructure.Persistence;

internal abstract class VersionedEntityConfiguration<TEntity> : IEntityTypeConfiguration<TEntity>
    where TEntity : VersionedEntity
{
    public virtual void Configure(EntityTypeBuilder<TEntity> builder)
    {
        builder.HasKey(entity => entity.Id);
        builder.Property(entity => entity.Version).IsConcurrencyToken();
        builder.ToTable(table => table.HasCheckConstraint("ck_version_positive", "version > 0"));
    }
}

internal sealed class SchemaVersionConfiguration : VersionedEntityConfiguration<SchemaVersion>
{
    public override void Configure(EntityTypeBuilder<SchemaVersion> builder)
    {
        base.Configure(builder);
        builder.Property(entity => entity.Name).HasMaxLength(200);
        builder.HasIndex(entity => entity.Name).IsUnique();
    }
}

internal sealed class IdempotencyRecordConfiguration : VersionedEntityConfiguration<IdempotencyRecord>
{
    public override void Configure(EntityTypeBuilder<IdempotencyRecord> builder)
    {
        base.Configure(builder);
        builder.Property(entity => entity.Scope).HasMaxLength(100);
        builder.Property(entity => entity.Key).HasMaxLength(200);
        builder.Property(entity => entity.ResponseBody).HasColumnType("jsonb");
        builder.HasIndex(entity => new { entity.Scope, entity.Key }).IsUnique();
        builder.HasIndex(entity => entity.ExpiresAt);
    }
}

internal sealed class AuditRecordConfiguration : VersionedEntityConfiguration<AuditRecord>
{
    public override void Configure(EntityTypeBuilder<AuditRecord> builder)
    {
        base.Configure(builder);
        builder.Property(entity => entity.Action).HasMaxLength(100);
        builder.Property(entity => entity.EntityType).HasMaxLength(100);
        builder.Property(entity => entity.EntityId).HasMaxLength(200);
        builder.Property(entity => entity.RedactedDiff).HasColumnType("jsonb");
        builder.HasIndex(entity => entity.OccurredAt);
        builder.HasIndex(entity => new { entity.EntityType, entity.EntityId });
        // Audit outlives the person: a hard account deletion drops the actor reference and keeps the
        // row. The account is still identifiable through entity_id.
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(entity => entity.ActorId).OnDelete(DeleteBehavior.SetNull);
    }
}

internal sealed class ConsumedTournamentPreviewTicketConfiguration : IEntityTypeConfiguration<ConsumedTournamentPreviewTicket>
{
    public void Configure(EntityTypeBuilder<ConsumedTournamentPreviewTicket> builder)
    {
        builder.HasKey(entity => entity.TicketHash);
        builder.Property(entity => entity.TicketHash).HasMaxLength(64);
        builder.HasIndex(entity => entity.ExpiresAt);
    }
}

internal sealed class OutboxRecordConfiguration : VersionedEntityConfiguration<OutboxRecord>
{
    public override void Configure(EntityTypeBuilder<OutboxRecord> builder)
    {
        base.Configure(builder);
        builder.Property(entity => entity.MessageType).HasMaxLength(200);
        builder.Property(entity => entity.Payload).HasColumnType("jsonb");
        builder.HasIndex(entity => new { entity.ProcessedAt, entity.OccurredAt });
    }
}

internal sealed class WorkerHeartbeatRecordConfiguration : IEntityTypeConfiguration<WorkerHeartbeatRecord>
{
    public void Configure(EntityTypeBuilder<WorkerHeartbeatRecord> builder)
    {
        builder.HasKey(entity => entity.WorkerId);
        builder.Property(entity => entity.WorkerId).HasMaxLength(100);
    }
}
