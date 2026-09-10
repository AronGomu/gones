using System.Text.Json;
using Gones.Domain.Identity;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Persistence;
using Gones.Infrastructure.Configuration;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using NodaTime;

namespace Gones.Infrastructure.Identity;

public sealed class AdminBootstrapService(GonesDbContext database, IClock clock, StagingAccessPolicy policy, IConfiguration configuration)
{
    public async Task<AdminBootstrapDecision> BootstrapAsync(string email, string? configuredBootstrapEmail, CancellationToken cancellationToken = default, bool requireOwnerSetup = false)
    {
        AdminBootstrapPolicy.EnsureConfiguredEmailMatches(configuredBootstrapEmail, email);
        var normalizedEmail = AdminBootstrapPolicy.NormalizeEmail(email);
        var displayEmail = email.Trim();
        var now = clock.GetCurrentInstant();
        if (!policy.IsEligible(email)) throw new InvalidOperationException("owner_setup_unavailable");

        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var setup = await OwnerSetupService.LockAsync(database, cancellationToken);
        var marker = await LockOrCreateMarkerAsync(now, cancellationToken);
        if (marker.IsConsumed) return AdminBootstrapDecision.AlreadyConsumed();
        if (setup.OwnerEmail is not null)
        {
            if (await OwnerSetupService.DisqualifyAsync(database, setup, cancellationToken))
            {
                await database.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                throw new InvalidOperationException("owner_setup_unavailable");
            }
            var options = OwnerSetupOptions.Load(configuration);
            if (!setup.Enabled || setup.CompletedAt is null
                || !setup.Matches(options.Email, options.Environment, options.PublicOrigin) || normalizedEmail != setup.OwnerEmail)
                throw new InvalidOperationException("owner_setup_unavailable");
        }
        else if (requireOwnerSetup) throw new InvalidOperationException("owner_setup_unavailable");
        var user = await database.Users
            .FromSqlInterpolated($"SELECT * FROM asp_net_users WHERE normalized_email = {normalizedEmail} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new InvalidOperationException("Bootstrap target account does not exist.");

        if (!user.EmailConfirmed)
            throw new InvalidOperationException("Bootstrap target account email must be verified.");
        if (string.IsNullOrWhiteSpace(user.PasswordHash)
            || !await database.UserProfiles.AnyAsync(profile => profile.UserId == user.Id, cancellationToken)
            || setup.OwnerEmail is not null && setup.UserId != user.Id)
            throw new InvalidOperationException("Bootstrap target account must have a password and complete profile.");

        if (user.GlobalRole == GlobalRoles.Admin)
        {
            marker.Consume(user.Id, now);
            var already = AdminBootstrapDecision.AlreadyAdmin(displayEmail);
            database.AuditRecords.Add(NewAudit(user.Id, "admin.bootstrap.noop", "system_marker", AdminBootstrapPolicy.MarkerKey,
                JsonSerializer.Serialize(new { outcome = already.Outcome.ToString() }), now));
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return already;
        }

        var previousRole = user.GlobalRole;
        user.AssignGlobalRole(GlobalRoles.Admin);
        user.SecurityStamp = Guid.NewGuid().ToString("N");
        marker.Consume(user.Id, now);

        var activeSessions = await database.RefreshSessions
            .FromSqlInterpolated($"SELECT * FROM refresh_sessions WHERE user_id = {user.Id} AND revoked_at IS NULL FOR UPDATE")
            .ToListAsync(cancellationToken);
        foreach (var session in activeSessions)
        {
            session.Revoke(now, RefreshSessionRevocationReason.RoleChanged);
        }

        database.AuditRecords.Add(NewAudit(user.Id, "admin.bootstrap.promoted", "user", user.Id.ToString("D"),
            JsonSerializer.Serialize(new
            {
                outcome = AdminBootstrapOutcome.Promoted.ToString(),
                before = previousRole,
                after = GlobalRoles.Admin,
                fields = new[] { "globalRole", "securityStamp" }
            }),
            now));
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return AdminBootstrapDecision.Promoted(displayEmail);
    }

    private async Task<SystemMarker> LockOrCreateMarkerAsync(Instant now, CancellationToken cancellationToken)
    {
        var marker = await database.SystemMarkers
            .FromSqlInterpolated($"SELECT * FROM system_markers WHERE key = {AdminBootstrapPolicy.MarkerKey} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);
        if (marker is not null) return marker;

        await database.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO system_markers (id, version, key, created_at)
            VALUES ({Guid.NewGuid()}, 1, {AdminBootstrapPolicy.MarkerKey}, {now})
            ON CONFLICT (key) DO NOTHING
            """, cancellationToken);

        return await database.SystemMarkers
            .FromSqlInterpolated($"SELECT * FROM system_markers WHERE key = {AdminBootstrapPolicy.MarkerKey} FOR UPDATE")
            .SingleAsync(cancellationToken);
    }

    private static AuditRecord NewAudit(Guid? actorId, string action, string entityType, string entityId, string diff, Instant now) => new()
    {
        ActorId = actorId,
        Action = action,
        EntityType = entityType,
        EntityId = entityId,
        RedactedDiff = diff,
        OccurredAt = now
    };
}
