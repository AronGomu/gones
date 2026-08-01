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
        builder.HasIndex(user => user.GlobalRole);
        builder.ToTable(table =>
        {
            table.HasCheckConstraint("ck_asp_net_users_global_role", "global_role IN ('User', 'Organizer', 'Admin')");
        });
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

internal sealed class ExternalIdentityConfiguration : VersionedEntityConfiguration<ExternalIdentity>
{
    public override void Configure(EntityTypeBuilder<ExternalIdentity> builder)
    {
        base.Configure(builder);
        builder.Property(identity => identity.Provider).HasMaxLength(20);
        builder.Property(identity => identity.ProviderSubject).HasMaxLength(255);
        builder.Property(identity => identity.ProviderEmail).HasMaxLength(254);
        builder.HasIndex(identity => new { identity.Provider, identity.ProviderSubject }).IsUnique();
        builder.HasIndex(identity => new { identity.UserId, identity.Provider }).IsUnique();
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(identity => identity.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class OAuthAttemptConfiguration : VersionedEntityConfiguration<OAuthAttempt>
{
    public override void Configure(EntityTypeBuilder<OAuthAttempt> builder)
    {
        base.Configure(builder);
        builder.ToTable("oauth_attempts");
        builder.Property(attempt => attempt.Provider).HasMaxLength(20);
        builder.Property(attempt => attempt.Purpose).HasConversion<string>().HasMaxLength(20);
        builder.Property(attempt => attempt.Status).HasConversion<string>().HasMaxLength(30);
        builder.Property(attempt => attempt.StateHash).HasMaxLength(64).IsFixedLength();
        builder.Property(attempt => attempt.CorrelationHash).HasMaxLength(64).IsFixedLength();
        builder.Property(attempt => attempt.CompletionHash).HasMaxLength(64).IsFixedLength();
        builder.Property(attempt => attempt.EmailVerificationHash).HasMaxLength(64).IsFixedLength();
        builder.Property(attempt => attempt.ProviderSubject).HasMaxLength(255);
        builder.Property(attempt => attempt.ProviderEmail).HasMaxLength(254);
        builder.Property(attempt => attempt.ProposedEmail).HasMaxLength(254);
        builder.Property(attempt => attempt.ProposedUsername).HasMaxLength(120);
        builder.Property(attempt => attempt.ProposedFirstName).HasMaxLength(100);
        builder.Property(attempt => attempt.ProposedLastName).HasMaxLength(100);
        builder.HasIndex(attempt => attempt.StateHash).IsUnique();
        builder.HasIndex(attempt => attempt.CompletionHash).IsUnique();
        builder.HasIndex(attempt => attempt.EmailVerificationHash).IsUnique();
        builder.HasIndex(attempt => attempt.ExpiresAt);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(attempt => attempt.UserId).OnDelete(DeleteBehavior.Cascade);
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
