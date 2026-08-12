using Gones.Domain.Calendar;
using Gones.Domain.Catalog;
using Gones.Domain.Identity;
using Gones.Domain.Leagues;
using Gones.Domain.Live;
using Gones.Domain.Notifications;
using Gones.Domain.Organizations;
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
    public DbSet<ConsumedEventPreviewTicket> ConsumedEventPreviewTickets => Set<ConsumedEventPreviewTicket>();
    public DbSet<OutboxRecord> OutboxRecords => Set<OutboxRecord>();
    public DbSet<NotificationOutboxRecord> NotificationOutboxRecords => Set<NotificationOutboxRecord>();
    public DbSet<NotificationDeliveryEvent> NotificationDeliveryEvents => Set<NotificationDeliveryEvent>();
    public DbSet<WorkerHeartbeatRecord> WorkerHeartbeats => Set<WorkerHeartbeatRecord>();
    public DbSet<UserProfile> UserProfiles => Set<UserProfile>();
    public DbSet<RefreshSession> RefreshSessions => Set<RefreshSession>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<AccountActionToken> AccountActionTokens => Set<AccountActionToken>();
    public DbSet<UserEmailHistory> UserEmailHistories => Set<UserEmailHistory>();
    public DbSet<ExternalIdentity> ExternalIdentities => Set<ExternalIdentity>();
    public DbSet<OAuthAttempt> OAuthAttempts => Set<OAuthAttempt>();
    public DbSet<TournamentFormat> TournamentFormats => Set<TournamentFormat>();
    public DbSet<DeckArchetype> DeckArchetypes => Set<DeckArchetype>();
    public DbSet<SystemMarker> SystemMarkers => Set<SystemMarker>();
    public DbSet<Organization> Organizations => Set<Organization>();
    public DbSet<OrganizationMember> OrganizationMembers => Set<OrganizationMember>();
    public DbSet<OrganizationBlockedUser> OrganizationBlockedUsers => Set<OrganizationBlockedUser>();
    public DbSet<OrganizationNotificationSettings> OrganizationNotificationSettings => Set<OrganizationNotificationSettings>();
    public DbSet<Event> Events => Set<Event>();
    public DbSet<EventFormat> EventFormats => Set<EventFormat>();
    public DbSet<EventProposal> EventProposals => Set<EventProposal>();
    public DbSet<EventProposalRecipient> EventProposalRecipients => Set<EventProposalRecipient>();
    public DbSet<EventLifecycleEntry> EventLifecycleEntries => Set<EventLifecycleEntry>();
    public DbSet<EventRegistrationAttempt> EventRegistrationAttempts => Set<EventRegistrationAttempt>();
    public DbSet<ScheduledNotification> ScheduledNotifications => Set<ScheduledNotification>();
    public DbSet<NotificationHistory> NotificationHistory => Set<NotificationHistory>();
    public DbSet<LeagueArchiveAggregate> LeagueArchiveAggregates => Set<LeagueArchiveAggregate>();
    public DbSet<LiveAggregate> LiveAggregates => Set<LiveAggregate>();

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
