using Gones.Domain.Calendar;
using Gones.Domain.Catalog;
using Gones.Domain.Notifications;
using Gones.Domain.Organizations;
using Gones.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Gones.Infrastructure.Persistence;

internal sealed class EventConfiguration : VersionedEntityConfiguration<Event>
{
    public override void Configure(EntityTypeBuilder<Event> builder)
    {
        base.Configure(builder);
        builder.ToTable("events");
        builder.Property(tournament => tournament.Title).HasMaxLength(Event.MaximumTitleLength);
        builder.Property(tournament => tournament.Slug).HasMaxLength(Event.MaximumSlugLength);
        builder.Property(tournament => tournament.Summary).HasMaxLength(Event.MaximumSummaryLength);
        builder.Property(tournament => tournament.BodyHtml).HasMaxLength(Event.MaximumBodyHtmlLength);
        builder.Property(tournament => tournament.LiveTournamentUrl).HasMaxLength(Event.MaximumTournamentUrlLength);
        builder.Property(tournament => tournament.ArchiveTournamentUrl).HasMaxLength(Event.MaximumTournamentUrlLength);
        builder.Property(tournament => tournament.StreetAddress).HasMaxLength(Event.MaximumAddressLength);
        builder.Property(tournament => tournament.PostalCode).HasMaxLength(Event.MaximumPostalCodeLength);
        builder.Property(tournament => tournament.City).HasMaxLength(Event.MaximumCityLength);
        builder.Property(tournament => tournament.Country).HasMaxLength(Event.MaximumCountryLength);
        builder.Property(tournament => tournament.Region).HasMaxLength(Event.MaximumRegionLength);
        builder.Property(tournament => tournament.EventType).HasConversion<string>().HasMaxLength(20).HasColumnName("event_type");
        builder.Property(tournament => tournament.TimeZoneId).HasMaxLength(Event.MaximumTimeZoneLength);
        builder.Property(tournament => tournament.Status).HasConversion<string>().HasMaxLength(20);
        builder.Property(tournament => tournament.DeletedReason).HasMaxLength(Event.MaximumDeletedReasonLength);
        builder.Property(tournament => tournament.NormalizedSearchText).HasMaxLength(Event.MaximumSearchTextLength);
        builder.HasIndex(tournament => tournament.Slug).IsUnique();
        builder.HasIndex(tournament => new { tournament.OrganizationId, tournament.Slug });
        builder.HasIndex(tournament => new { tournament.VenueStartDate, tournament.VenueStartTime, tournament.Id });
        builder.HasIndex(tournament => tournament.StartsAtUtc);
        builder.HasIndex(tournament => tournament.Status);
        builder.HasIndex(tournament => new { tournament.Status, tournament.StartsAtUtc });
        builder.HasIndex(tournament => new { tournament.Status, tournament.EndsAtUtc });
        builder.HasIndex(tournament => new { tournament.City, tournament.Country });
        builder.HasIndex(tournament => new { tournament.Country, tournament.Region, tournament.City });
        builder.HasIndex(tournament => tournament.Region);
        builder.HasIndex(tournament => tournament.EventType);
        builder.HasIndex(tournament => tournament.OrganizationId);
        builder.HasIndex(tournament => tournament.NormalizedSearchText);
        builder.HasOne<Organization>().WithMany().HasForeignKey(tournament => tournament.OrganizationId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(tournament => tournament.CreatedByUserId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(tournament => tournament.DeletedByUserId).OnDelete(DeleteBehavior.Restrict);
        builder.HasMany(tournament => tournament.Formats).WithOne().HasForeignKey(format => format.EventId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(tournament => tournament.Formats).AutoInclude(false);
        builder.ToTable(table =>
        {
            table.HasCheckConstraint("ck_scheduled_tournament_capacity", "capacity IS NULL OR capacity > 0");
            table.HasCheckConstraint("ck_scheduled_tournament_time_order", "ends_at_utc >= starts_at_utc");
            table.HasCheckConstraint("ck_scheduled_tournament_status", "status IN ('Published', 'InProgress', 'Completed', 'Cancelled')");
            table.HasCheckConstraint("ck_event_type", "event_type IS NULL OR event_type IN ('Weekly', 'Monthly', 'Major')");
            table.HasCheckConstraint("ck_scheduled_tournament_deleted_metadata", "(deleted_at IS NULL AND deleted_by_user_id IS NULL) OR (deleted_at IS NOT NULL AND deleted_by_user_id IS NOT NULL)");
        });
    }
}

internal sealed class EventRegistrationAttemptConfiguration : VersionedEntityConfiguration<EventRegistrationAttempt>
{
    public override void Configure(EntityTypeBuilder<EventRegistrationAttempt> builder)
    {
        base.Configure(builder);
        builder.ToTable("event_registration_attempts");
        builder.Property(attempt => attempt.Status).HasConversion<string>().HasMaxLength(40);
        builder.HasIndex(attempt => new { attempt.EventId, attempt.UserId })
            .IsUnique()
            .HasFilter("status = 'Confirmed'")
            .HasDatabaseName("ix_event_registration_attempts_active");
        builder.HasIndex(attempt => new { attempt.UserId, attempt.RegisteredAt, attempt.Id });
        builder.HasIndex(attempt => new { attempt.EventId, attempt.Status });
        builder.HasOne<Event>().WithMany().HasForeignKey(attempt => attempt.EventId).OnDelete(DeleteBehavior.Restrict);
        // A registration belongs to the participant: a hard account deletion takes it with the account.
        // The acting-user columns below stay restricting — they can point at a different account.
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(attempt => attempt.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(attempt => attempt.RegisteredByUserId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(attempt => attempt.StatusChangedByUserId).OnDelete(DeleteBehavior.Restrict);
        builder.ToTable(table =>
        {
            table.HasCheckConstraint(
                "ck_tournament_registration_status",
                "status IN ('Confirmed', 'CancelledByUser', 'CancelledByTournament', 'RemovedByOrganizer')");
            table.HasCheckConstraint(
                "ck_tournament_registration_status_history",
                "(status = 'Confirmed' AND status_changed_by_user_id IS NULL AND status_changed_at IS NULL) OR (status <> 'Confirmed' AND status_changed_by_user_id IS NOT NULL AND status_changed_at IS NOT NULL)");
        });
    }
}

internal sealed class EventFormatConfiguration : IEntityTypeConfiguration<EventFormat>
{
    public void Configure(EntityTypeBuilder<EventFormat> builder)
    {
        builder.ToTable("event_formats");
        builder.HasKey(format => new { format.EventId, format.TournamentFormatId });
        builder.HasIndex(format => format.EventId).IsUnique();
        builder.HasIndex(format => format.TournamentFormatId);
        builder.HasOne<TournamentFormat>().WithMany().HasForeignKey(format => format.TournamentFormatId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class EventLifecycleEntryConfiguration : IEntityTypeConfiguration<EventLifecycleEntry>
{
    public void Configure(EntityTypeBuilder<EventLifecycleEntry> builder)
    {
        builder.ToTable("event_lifecycle_entries");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.EventType).HasConversion<string>().HasMaxLength(40);
        builder.Property(item => item.ReminderPlanAction).HasConversion<string>().HasMaxLength(40);
        builder.HasIndex(item => new { item.EventId, item.OccurredAt });
        builder.HasIndex(item => new { item.ReminderPlanAction, item.ReminderPlanProcessedAt, item.OccurredAt });
        builder.HasOne<Event>().WithMany().HasForeignKey(item => item.EventId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(item => item.ActorUserId).OnDelete(DeleteBehavior.Restrict);
        builder.ToTable(table =>
        {
            table.HasCheckConstraint("ck_tournament_lifecycle_event_type", "event_type IN ('MajorDetailsUpdated', 'Cancelled', 'Deleted', 'Restored')");
            table.HasCheckConstraint("ck_tournament_lifecycle_reminder_action", "reminder_plan_action IN ('None', 'RecalculateFuture', 'CancelFuture')");
        });
    }
}

internal sealed class ScheduledNotificationConfiguration : IEntityTypeConfiguration<ScheduledNotification>
{
    public void Configure(EntityTypeBuilder<ScheduledNotification> builder)
    {
        builder.ToTable("scheduled_notifications");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.Type).HasConversion<string>().HasMaxLength(20);
        builder.Property(item => item.Status).HasConversion<string>().HasMaxLength(20);
        builder.Property(item => item.DedupeKey).HasMaxLength(ScheduledNotification.MaximumDedupeKeyLength);
        builder.HasIndex(item => item.DedupeKey).IsUnique();
        builder.HasIndex(item => new { item.Status, item.ScheduledAtUtc, item.Id });
        builder.HasIndex(item => new { item.EventId, item.RegistrationAttemptId, item.Status });
        builder.HasOne<Event>().WithMany().HasForeignKey(item => item.EventId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<EventRegistrationAttempt>().WithMany().HasForeignKey(item => item.RegistrationAttemptId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<NotificationOutboxRecord>().WithMany().HasForeignKey(item => item.OutboxId).OnDelete(DeleteBehavior.Restrict);
        builder.ToTable(table =>
        {
            table.HasCheckConstraint("ck_scheduled_notification_status", "status IN ('Planned', 'Enqueued', 'Missed', 'Cancelled')");
            table.HasCheckConstraint("ck_scheduled_notification_type", "type IN ('Monthly', 'Saturday', 'DayTwo', 'DayOne')");
            table.HasCheckConstraint("ck_scheduled_notification_outbox", "(status = 'Enqueued' AND outbox_id IS NOT NULL) OR (status <> 'Enqueued' AND outbox_id IS NULL)");
        });
    }
}

internal sealed class NotificationHistoryConfiguration : IEntityTypeConfiguration<NotificationHistory>
{
    public void Configure(EntityTypeBuilder<NotificationHistory> builder)
    {
        builder.ToTable("notification_history");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.TemplateKey).HasMaxLength(NotificationHistory.MaximumTemplateKeyLength);
        builder.Property(item => item.DedupeKey).HasMaxLength(NotificationHistory.MaximumDedupeKeyLength);
        builder.HasIndex(item => item.OutboxId).IsUnique();
        builder.HasIndex(item => new { item.EventId, item.SentAt });
        builder.HasIndex(item => new { item.UserId, item.SentAt });
        builder.HasOne<NotificationOutboxRecord>().WithMany().HasForeignKey(item => item.OutboxId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Event>().WithMany().HasForeignKey(item => item.EventId).OnDelete(DeleteBehavior.Restrict);
    }
}
