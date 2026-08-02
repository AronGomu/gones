using Gones.Domain.Calendar;
using Gones.Domain.Catalog;
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
        builder.HasIndex(tournament => new { tournament.OrganizationId, tournament.Slug }).IsUnique();
        builder.HasIndex(tournament => new { tournament.VenueStartDate, tournament.VenueStartTime, tournament.Id });
        builder.HasIndex(tournament => tournament.StartsAtUtc);
        builder.HasIndex(tournament => tournament.Status);
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
