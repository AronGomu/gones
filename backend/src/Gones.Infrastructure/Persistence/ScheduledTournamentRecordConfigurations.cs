using Gones.Domain.Calendar;
using Gones.Domain.Catalog;
using Gones.Domain.Notifications;
using Gones.Domain.Organizations;
using Gones.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Gones.Infrastructure.Persistence;

internal sealed class ScheduledTournamentConfiguration : VersionedEntityConfiguration<ScheduledTournament>
{
    public override void Configure(EntityTypeBuilder<ScheduledTournament> builder)
    {
        base.Configure(builder);
        builder.ToTable("scheduled_tournaments");
        builder.Property(tournament => tournament.Title).HasMaxLength(ScheduledTournament.MaximumTitleLength);
        builder.Property(tournament => tournament.Slug).HasMaxLength(ScheduledTournament.MaximumSlugLength);
        builder.Property(tournament => tournament.Summary).HasMaxLength(ScheduledTournament.MaximumSummaryLength);
        builder.Property(tournament => tournament.BodyHtml).HasMaxLength(ScheduledTournament.MaximumBodyHtmlLength);
        builder.Property(tournament => tournament.StreetAddress).HasMaxLength(ScheduledTournament.MaximumAddressLength);
        builder.Property(tournament => tournament.PostalCode).HasMaxLength(ScheduledTournament.MaximumPostalCodeLength);
        builder.Property(tournament => tournament.City).HasMaxLength(ScheduledTournament.MaximumCityLength);
        builder.Property(tournament => tournament.Country).HasMaxLength(ScheduledTournament.MaximumCountryLength);
        builder.Property(tournament => tournament.TimeZoneId).HasMaxLength(ScheduledTournament.MaximumTimeZoneLength);
        builder.Property(tournament => tournament.Status).HasConversion<string>().HasMaxLength(20);
        builder.Property(tournament => tournament.DeletedReason).HasMaxLength(ScheduledTournament.MaximumDeletedReasonLength);
        builder.Property(tournament => tournament.NormalizedSearchText).HasMaxLength(ScheduledTournament.MaximumSearchTextLength);
        builder.HasIndex(tournament => tournament.Slug).IsUnique();
        builder.HasIndex(tournament => new { tournament.OrganizationId, tournament.Slug });
        builder.HasIndex(tournament => new { tournament.VenueStartDate, tournament.VenueStartTime, tournament.Id });
        builder.HasIndex(tournament => tournament.StartsAtUtc);
        builder.HasIndex(tournament => tournament.Status);
        builder.HasIndex(tournament => new { tournament.Status, tournament.StartsAtUtc });
        builder.HasIndex(tournament => new { tournament.Status, tournament.EndsAtUtc });
        builder.HasIndex(tournament => new { tournament.City, tournament.Country });
        builder.HasIndex(tournament => tournament.OrganizationId);
        builder.HasIndex(tournament => tournament.NormalizedSearchText);
        builder.HasOne<Organization>().WithMany().HasForeignKey(tournament => tournament.OrganizationId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(tournament => tournament.CreatedByUserId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(tournament => tournament.DeletedByUserId).OnDelete(DeleteBehavior.Restrict);
        builder.HasMany(tournament => tournament.Formats).WithOne().HasForeignKey(format => format.ScheduledTournamentId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(tournament => tournament.Formats).AutoInclude(false);
        builder.ToTable(table =>
        {
            table.HasCheckConstraint("ck_scheduled_tournament_capacity", "capacity IS NULL OR capacity > 0");
            table.HasCheckConstraint("ck_scheduled_tournament_time_order", "ends_at_utc >= starts_at_utc");
            table.HasCheckConstraint("ck_scheduled_tournament_status", "status IN ('Published', 'InProgress', 'Completed', 'Cancelled')");
            table.HasCheckConstraint("ck_scheduled_tournament_deleted_metadata", "(deleted_at IS NULL AND deleted_by_user_id IS NULL) OR (deleted_at IS NOT NULL AND deleted_by_user_id IS NOT NULL)");
        });
    }
}

internal sealed class TournamentRegistrationAttemptConfiguration : VersionedEntityConfiguration<TournamentRegistrationAttempt>
{
    public override void Configure(EntityTypeBuilder<TournamentRegistrationAttempt> builder)
    {
        base.Configure(builder);
        builder.ToTable("tournament_registration_attempts");
        builder.Property(attempt => attempt.Status).HasConversion<string>().HasMaxLength(40);
        builder.HasIndex(attempt => new { attempt.TournamentId, attempt.UserId })
            .IsUnique()
            .HasFilter("status = 'Confirmed'")
            .HasDatabaseName("ix_tournament_registration_attempts_active");
        builder.HasIndex(attempt => new { attempt.UserId, attempt.RegisteredAt, attempt.Id });
        builder.HasIndex(attempt => new { attempt.TournamentId, attempt.Status });
        builder.HasOne<ScheduledTournament>().WithMany().HasForeignKey(attempt => attempt.TournamentId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(attempt => attempt.UserId).OnDelete(DeleteBehavior.Restrict);
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

internal sealed class ScheduledTournamentFormatConfiguration : IEntityTypeConfiguration<ScheduledTournamentFormat>
{
    public void Configure(EntityTypeBuilder<ScheduledTournamentFormat> builder)
    {
        builder.ToTable("scheduled_tournament_formats");
        builder.HasKey(format => new { format.ScheduledTournamentId, format.TournamentFormatId });
        builder.HasIndex(format => format.TournamentFormatId);
        builder.HasOne<TournamentFormat>().WithMany().HasForeignKey(format => format.TournamentFormatId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class TournamentLifecycleEventConfiguration : IEntityTypeConfiguration<TournamentLifecycleEvent>
{
    public void Configure(EntityTypeBuilder<TournamentLifecycleEvent> builder)
    {
        builder.ToTable("tournament_lifecycle_events");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.EventType).HasConversion<string>().HasMaxLength(40);
        builder.Property(item => item.ReminderPlanAction).HasConversion<string>().HasMaxLength(40);
        builder.HasIndex(item => new { item.TournamentId, item.OccurredAt });
        builder.HasIndex(item => new { item.ReminderPlanAction, item.ReminderPlanProcessedAt, item.OccurredAt });
        builder.HasOne<ScheduledTournament>().WithMany().HasForeignKey(item => item.TournamentId).OnDelete(DeleteBehavior.Restrict);
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
        builder.HasIndex(item => new { item.TournamentId, item.RegistrationAttemptId, item.Status });
        builder.HasOne<ScheduledTournament>().WithMany().HasForeignKey(item => item.TournamentId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<TournamentRegistrationAttempt>().WithMany().HasForeignKey(item => item.RegistrationAttemptId).OnDelete(DeleteBehavior.Restrict);
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
        builder.HasIndex(item => new { item.TournamentId, item.SentAt });
        builder.HasIndex(item => new { item.UserId, item.SentAt });
        builder.HasOne<NotificationOutboxRecord>().WithMany().HasForeignKey(item => item.OutboxId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<ScheduledTournament>().WithMany().HasForeignKey(item => item.TournamentId).OnDelete(DeleteBehavior.Restrict);
    }
}
