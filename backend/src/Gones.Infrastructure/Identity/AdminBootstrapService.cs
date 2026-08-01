using System.Text.Json;
using Gones.Domain.Identity;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.Infrastructure.Identity;

public sealed class AdminBootstrapService(GonesDbContext database, IClock clock)
{
    public async Task<AdminBootstrapDecision> BootstrapAsync(string email, string? configuredBootstrapEmail, CancellationToken cancellationToken = default)
    {
        AdminBootstrapPolicy.EnsureConfiguredEmailMatches(configuredBootstrapEmail, email);
        var normalizedEmail = AdminBootstrapPolicy.NormalizeEmail(email);
        var displayEmail = email.Trim();
        var now = clock.GetCurrentInstant();

        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var marker = await LockOrCreateMarkerAsync(now, cancellationToken);
        var user = await database.Users
            .FromSqlInterpolated($"SELECT * FROM asp_net_users WHERE normalized_email = {normalizedEmail} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new InvalidOperationException("Bootstrap target account does not exist.");

        if (!user.EmailConfirmed)
        {
            throw new InvalidOperationException("Bootstrap target account email must be verified.");
        }

        if (marker.IsConsumed)
        {
            var noop = user.GlobalRole == GlobalRoles.Admin
                ? AdminBootstrapDecision.AlreadyAdmin(displayEmail)
                : AdminBootstrapDecision.AlreadyConsumed();
            database.AuditRecords.Add(NewAudit(user.Id, "admin.bootstrap.noop", "system_marker", AdminBootstrapPolicy.MarkerKey,
                JsonSerializer.Serialize(new { outcome = noop.Outcome.ToString(), email = RedactEmail(displayEmail) }), now));
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return noop;
        }

        if (user.GlobalRole == GlobalRoles.Admin)
        {
            marker.Consume(user.Id, now);
            var already = AdminBootstrapDecision.AlreadyAdmin(displayEmail);
            database.AuditRecords.Add(NewAudit(user.Id, "admin.bootstrap.noop", "system_marker", AdminBootstrapPolicy.MarkerKey,
                JsonSerializer.Serialize(new { outcome = already.Outcome.ToString(), email = RedactEmail(displayEmail) }), now));
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
                fields = new[] { "globalRole", "securityStamp" },
                email = RedactEmail(displayEmail)
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

        database.SystemMarkers.Add(new SystemMarker
        {
            Key = AdminBootstrapPolicy.MarkerKey,
            CreatedAt = now
        });
        try
        {
            await database.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            database.ChangeTracker.Clear();
        }

        return await database.SystemMarkers
            .FromSqlInterpolated($"SELECT * FROM system_markers WHERE key = {AdminBootstrapPolicy.MarkerKey} FOR UPDATE")
            .SingleAsync(cancellationToken);
    }

    private static string RedactEmail(string email)
    {
        var at = email.IndexOf('@');
        if (at <= 1) return "***";
        return $"{email[0]}***{email[at..]}";
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
