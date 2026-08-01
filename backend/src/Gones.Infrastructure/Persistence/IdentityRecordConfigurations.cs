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

internal sealed class RefreshSessionConfiguration : VersionedEntityConfiguration<RefreshSession>
{
    public override void Configure(EntityTypeBuilder<RefreshSession> builder)
    {
        base.Configure(builder);
        builder.Property(session => session.SecurityStamp).HasMaxLength(256);
        builder.Property(session => session.DeviceLabel).HasMaxLength(RefreshSession.MaximumDeviceLabelLength);
        builder.Property(session => session.RevocationReason).HasConversion<string>().HasMaxLength(40);
        builder.HasIndex(session => new { session.UserId, session.RevokedAt });
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(session => session.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class RefreshTokenConfiguration : VersionedEntityConfiguration<RefreshToken>
{
    public override void Configure(EntityTypeBuilder<RefreshToken> builder)
    {
        base.Configure(builder);
        builder.Property(token => token.TokenHash).HasMaxLength(64).IsFixedLength();
        builder.HasIndex(token => token.TokenHash).IsUnique();
        builder.HasIndex(token => token.SessionId);
        builder.HasOne<RefreshSession>().WithMany().HasForeignKey(token => token.SessionId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<RefreshToken>().WithOne().HasForeignKey<RefreshToken>(token => token.ReplacedById).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class AccountActionTokenConfiguration : VersionedEntityConfiguration<AccountActionToken>
{
    public override void Configure(EntityTypeBuilder<AccountActionToken> builder)
    {
        base.Configure(builder);
        builder.Property(token => token.Purpose).HasConversion<string>().HasMaxLength(30);
        builder.Property(token => token.TokenHash).HasMaxLength(64).IsFixedLength();
        builder.Property(token => token.SecurityStamp).HasMaxLength(256);
        builder.Property(token => token.TargetEmail).HasMaxLength(254);
        builder.Property(token => token.NormalizedTargetEmail).HasMaxLength(254);
        builder.HasIndex(token => token.TokenHash).IsUnique();
        builder.HasIndex(token => new { token.UserId, token.Purpose })
            .IsUnique()
            .HasFilter("consumed_at IS NULL AND superseded_at IS NULL");
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(token => token.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class UserEmailHistoryConfiguration : VersionedEntityConfiguration<UserEmailHistory>
{
    public override void Configure(EntityTypeBuilder<UserEmailHistory> builder)
    {
        base.Configure(builder);
        builder.Property(history => history.Email).HasMaxLength(254);
        builder.HasIndex(history => new { history.UserId, history.RecordedAt });
        builder.HasIndex(history => new { history.RedactedAt, history.RetainUntil });
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(history => history.UserId).OnDelete(DeleteBehavior.Cascade);
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
