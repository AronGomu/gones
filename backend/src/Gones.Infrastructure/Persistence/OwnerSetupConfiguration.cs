using Gones.Domain.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Gones.Infrastructure.Persistence;

internal sealed class OwnerSetupConfiguration : IEntityTypeConfiguration<OwnerSetup>
{
    public void Configure(EntityTypeBuilder<OwnerSetup> builder)
    {
        builder.ToTable("owner_setups", table => table.HasCheckConstraint("ck_owner_setup_singleton", "key = 'owner-setup'"));
        builder.HasKey(setup => setup.Key);
        builder.Property(setup => setup.Key).HasMaxLength(40);
        builder.Property(setup => setup.OwnerEmail).HasMaxLength(254);
        builder.Property(setup => setup.Environment).HasMaxLength(20);
        builder.Property(setup => setup.PublicOrigin).HasMaxLength(2048);
        builder.Property(setup => setup.TokenHash).HasMaxLength(64).IsFixedLength();
    }
}
