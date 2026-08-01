using Gones.Domain.Organizations;
using Gones.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Gones.Infrastructure.Persistence;

internal sealed class OrganizationConfiguration : VersionedEntityConfiguration<Organization>
{
    public override void Configure(EntityTypeBuilder<Organization> builder)
    {
        base.Configure(builder);
        builder.ToTable("organizations");
        builder.Property(organization => organization.Name).HasMaxLength(Organization.MaximumNameLength);
        builder.Property(organization => organization.NormalizedName).HasMaxLength(Organization.MaximumNameLength);
        builder.Property(organization => organization.Description).HasMaxLength(Organization.MaximumDescriptionLength);
        builder.Property(organization => organization.Website).HasMaxLength(Organization.MaximumWebsiteLength);
        builder.Property(organization => organization.ContactEmail).HasMaxLength(Organization.MaximumContactEmailLength);
        builder.HasIndex(organization => organization.NormalizedName).IsUnique();
        builder.HasIndex(organization => new { organization.DeletedAt, organization.Name });
    }
}

internal sealed class OrganizationMemberConfiguration : VersionedEntityConfiguration<OrganizationMember>
{
    public override void Configure(EntityTypeBuilder<OrganizationMember> builder)
    {
        base.Configure(builder);
        builder.ToTable("organization_members");
        builder.Property(member => member.Role).HasMaxLength(20);
        builder.HasIndex(member => new { member.OrganizationId, member.UserId }).IsUnique();
        builder.HasIndex(member => new { member.UserId, member.OrganizationId });
        builder.HasIndex(member => member.OrganizationId)
            .IsUnique()
            .HasFilter("role = 'Owner'")
            .HasDatabaseName("ix_organization_members_one_owner");
        builder.HasOne<Organization>().WithMany().HasForeignKey(member => member.OrganizationId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(member => member.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.ToTable(table =>
        {
            table.HasCheckConstraint("ck_organization_member_role", "role IN ('Owner', 'Organizer')");
        });
    }
}

internal sealed class OrganizationNotificationSettingsConfiguration : VersionedEntityConfiguration<OrganizationNotificationSettings>
{
    public override void Configure(EntityTypeBuilder<OrganizationNotificationSettings> builder)
    {
        base.Configure(builder);
        builder.ToTable("organization_notification_settings");
        builder.HasIndex(settings => settings.OrganizationId).IsUnique();
        builder.HasOne<Organization>().WithMany().HasForeignKey(settings => settings.OrganizationId).OnDelete(DeleteBehavior.Cascade);
    }
}
