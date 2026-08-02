using Gones.Domain.Notifications;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Gones.Infrastructure.Persistence;

internal sealed class NotificationOutboxRecordConfiguration : VersionedEntityConfiguration<NotificationOutboxRecord>
{
    public override void Configure(EntityTypeBuilder<NotificationOutboxRecord> builder)
    {
        base.Configure(builder);
        builder.ToTable("notification_outbox", table =>
        {
            table.HasCheckConstraint("ck_notification_outbox_attempt_count", "attempt_count >= 0");
            table.HasCheckConstraint("ck_notification_outbox_state", """
                (status = 'Pending' AND lease_token IS NULL AND lease_expires_at IS NULL AND sent_at IS NULL AND dead_lettered_at IS NULL AND scrubbed_at IS NULL AND recipient IS NOT NULL AND template_model_json IS NOT NULL)
                OR (status = 'Sending' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND sent_at IS NULL AND dead_lettered_at IS NULL AND scrubbed_at IS NULL AND recipient IS NOT NULL AND template_model_json IS NOT NULL)
                OR (status = 'Sent' AND lease_token IS NULL AND lease_expires_at IS NULL AND sent_at IS NOT NULL AND dead_lettered_at IS NULL AND scrubbed_at IS NOT NULL AND recipient IS NULL AND template_model_json IS NULL)
                OR (status = 'Reconciliation' AND lease_token IS NULL AND lease_expires_at IS NULL AND sent_at IS NULL AND dead_lettered_at IS NULL AND scrubbed_at IS NULL AND recipient IS NOT NULL AND template_model_json IS NOT NULL)
                OR (status = 'DeadLetter' AND lease_token IS NULL AND lease_expires_at IS NULL AND sent_at IS NULL AND dead_lettered_at IS NOT NULL AND scrubbed_at IS NOT NULL AND recipient IS NULL AND template_model_json IS NULL)
                """);
        });
        builder.Property(entity => entity.DedupeKey).HasMaxLength(200);
        builder.Property(entity => entity.TemplateKey).HasMaxLength(100);
        builder.Property(entity => entity.Locale).HasMaxLength(10);
        builder.Property(entity => entity.Recipient).HasMaxLength(320);
        builder.Property(entity => entity.TemplateModelJson).HasColumnType("jsonb");
        builder.Property(entity => entity.Status).HasConversion<string>().HasMaxLength(20);
        builder.Property(entity => entity.LastErrorCode).HasMaxLength(100);
        builder.Property(entity => entity.ProviderMessageId).HasMaxLength(NotificationDeliveryEvent.MaximumProviderMessageIdLength);
        builder.Property(entity => entity.DeliveryStatus).HasConversion<string>().HasMaxLength(30);
        builder.Ignore(entity => entity.ProviderCorrelationId);
        builder.Ignore(entity => entity.RecoveredFromExpiredLease);
        builder.Property(entity => entity.TraceParent).HasMaxLength(55);
        builder.Property(entity => entity.CorrelationId).HasMaxLength(36);
        builder.HasIndex(entity => entity.DedupeKey).IsUnique();
        builder.HasIndex(entity => new { entity.Status, entity.AvailableAt, entity.CreatedAt });
        builder.HasIndex(entity => new { entity.Status, entity.LeaseExpiresAt });
        builder.HasIndex(entity => new { entity.Status, entity.CreatedAt });
        builder.HasIndex(entity => entity.CreatedAt);
        builder.HasIndex(entity => entity.UserId);
        builder.HasIndex(entity => entity.TournamentId);
        builder.HasIndex(entity => entity.ProviderMessageId);
        builder.HasIndex(entity => new { entity.Status, entity.LastProviderEventAt });
        builder.HasIndex(entity => entity.LastProviderEventAt);
    }
}

internal sealed class NotificationDeliveryEventConfiguration : IEntityTypeConfiguration<NotificationDeliveryEvent>
{
    public void Configure(EntityTypeBuilder<NotificationDeliveryEvent> builder)
    {
        builder.ToTable("notification_delivery_events");
        builder.HasKey(entity => entity.Id);
        builder.Property(entity => entity.ReplayKey).HasMaxLength(NotificationDeliveryEvent.MaximumReplayKeyLength);
        builder.Property(entity => entity.ProviderMessageId).HasMaxLength(NotificationDeliveryEvent.MaximumProviderMessageIdLength);
        builder.Property(entity => entity.Status).HasConversion<string>().HasMaxLength(30);
        builder.HasIndex(entity => entity.ReplayKey).IsUnique();
        builder.HasIndex(entity => entity.OutboxId);
        builder.HasOne<NotificationOutboxRecord>().WithMany().HasForeignKey(entity => entity.OutboxId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(entity => entity.ReceivedAt);
    }
}
