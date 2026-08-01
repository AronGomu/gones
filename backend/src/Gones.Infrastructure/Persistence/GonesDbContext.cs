using Gones.Domain.Identity;
using Gones.Domain.Notifications;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Gones.Infrastructure.Persistence;

public sealed class GonesDbContext(DbContextOptions<GonesDbContext> options)
    : IdentityUserContext<ApplicationUser, Guid>(options)
{
    public DbSet<SchemaVersion> SchemaVersions => Set<SchemaVersion>();
    public DbSet<IdempotencyRecord> IdempotencyRecords => Set<IdempotencyRecord>();
    public DbSet<AuditRecord> AuditRecords => Set<AuditRecord>();
    public DbSet<OutboxRecord> OutboxRecords => Set<OutboxRecord>();
    public DbSet<NotificationOutboxRecord> NotificationOutboxRecords => Set<NotificationOutboxRecord>();
    public DbSet<WorkerHeartbeatRecord> WorkerHeartbeats => Set<WorkerHeartbeatRecord>();
    public DbSet<UserProfile> UserProfiles => Set<UserProfile>();
    public DbSet<RefreshSession> RefreshSessions => Set<RefreshSession>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(GonesDbContext).Assembly);
        foreach (var entityType in modelBuilder.Model.GetEntityTypes().Where(type => typeof(VersionedEntity).IsAssignableFrom(type.ClrType)))
        {
            var versionProperty = entityType.FindProperty(nameof(VersionedEntity.Version))
                ?? throw new InvalidOperationException($"{entityType.ClrType.Name} lacks a Version property.");
            versionProperty.IsConcurrencyToken = true;
        }
        modelBuilder.UseSnakeCaseNames();
    }

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        IncrementVersions();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        IncrementVersions();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    private void IncrementVersions()
    {
        if (ChangeTracker.Entries<AuditRecord>().Any(entry => entry.State is EntityState.Modified or EntityState.Deleted))
        {
            throw new InvalidOperationException("Audit records are append-only.");
        }

        foreach (var entry in ChangeTracker.Entries<VersionedEntity>())
        {
            if (entry.State == EntityState.Added)
            {
                entry.Property(entity => entity.Version).CurrentValue = 1;
            }
            else if (entry.State == EntityState.Modified)
            {
                var originalVersion = entry.Property(entity => entity.Version).OriginalValue;
                if (originalVersion == long.MaxValue) throw new InvalidOperationException("Entity version overflow.");
                entry.Property(entity => entity.Version).CurrentValue = originalVersion + 1;
            }
        }
    }
}
