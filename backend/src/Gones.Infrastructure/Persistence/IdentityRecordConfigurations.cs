using Gones.Domain.Identity;
using Gones.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Gones.Infrastructure.Persistence;

internal sealed class ApplicationUserConfiguration : IEntityTypeConfiguration<ApplicationUser>
{
    public void Configure(EntityTypeBuilder<ApplicationUser> builder)
    {
        builder.Property(user => user.GlobalRole).HasMaxLength(20);
        builder.HasIndex(user => user.NormalizedEmail).IsUnique();
    }
}

internal sealed class UserProfileConfiguration : VersionedEntityConfiguration<UserProfile>
{
    public override void Configure(EntityTypeBuilder<UserProfile> builder)
    {
        base.Configure(builder);
        builder.Property(profile => profile.Username).HasMaxLength(120);
        builder.Property(profile => profile.NormalizedUsername).HasMaxLength(120);
        builder.Property(profile => profile.FirstName).HasMaxLength(100);
        builder.Property(profile => profile.LastName).HasMaxLength(100);
        builder.Property(profile => profile.Location).HasMaxLength(200);
        builder.Property(profile => profile.PreferredLanguage).HasMaxLength(2);
        builder.HasIndex(profile => profile.UserId).IsUnique();
        builder.HasIndex(profile => profile.NormalizedUsername).IsUnique();
        builder.HasOne<ApplicationUser>().WithOne().HasForeignKey<UserProfile>(profile => profile.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.ToTable(table =>
        {
            table.HasCheckConstraint("ck_user_profile_birth_year", "birth_year IS NULL OR birth_year >= 1900");
            table.HasCheckConstraint("ck_user_profile_language", "preferred_language IN ('fr', 'en')");
        });
    }
}
