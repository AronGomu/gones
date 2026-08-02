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

internal sealed class OrganizationBlockedUserConfiguration : VersionedEntityConfiguration<OrganizationBlockedUser>
{
    public override void Configure(EntityTypeBuilder<OrganizationBlockedUser> builder)
    {
        base.Configure(builder);
        builder.ToTable("organization_blocked_users");
        builder.Property(block => block.Reason).HasMaxLength(OrganizationBlockedUser.MaximumReasonLength);
        builder.HasIndex(block => new { block.OrganizationId, block.UserId })
            .IsUnique()
            .HasFilter("is_active")
            .HasDatabaseName("ix_organization_blocked_users_active");
        builder.HasIndex(block => new { block.OrganizationId, block.UserId, block.ExpiresAt });
        builder.HasOne<Organization>().WithMany().HasForeignKey(block => block.OrganizationId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(block => block.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(block => block.BlockedByUserId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(block => block.UnblockedByUserId).OnDelete(DeleteBehavior.Restrict);
        builder.ToTable(table =>
        {
            table.HasCheckConstraint("ck_organization_block_expiry", "expires_at IS NULL OR expires_at > blocked_at");
            table.HasCheckConstraint(
                "ck_organization_block_inactive_metadata",
                "(is_active AND unblocked_by_user_id IS NULL AND unblocked_at IS NULL) OR (NOT is_active AND unblocked_by_user_id IS NOT NULL AND unblocked_at IS NOT NULL)");
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
