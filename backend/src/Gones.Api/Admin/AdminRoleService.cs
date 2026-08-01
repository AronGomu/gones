using System.Text.Json;
using Gones.Api.Errors;
using Gones.Api.Identity;
using Gones.Domain.Identity;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.Api.Admin;

internal sealed class AdminRoleService(
    GonesDbContext database,
    RefreshSessionService sessionService,
    IClock clock)
{
    public async Task ChangeRoleAsync(
        Guid actorUserId,
        Guid subjectUserId,
        string targetRole,
        GlobalRoleChangeKind kind,
        CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var subject = await database.Users
            .FromSqlInterpolated($"SELECT * FROM asp_net_users WHERE id = {subjectUserId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new ResourceNotFoundException();

        var adminCount = await database.Users.CountAsync(user => user.GlobalRole == GlobalRoles.Admin, cancellationToken);
        var decision = GlobalRolePolicy.Evaluate(subject.GlobalRole, targetRole, kind, actorUserId, subjectUserId, adminCount);
        if (!decision.Allowed)
        {
            throw new ResourceConflictException();
        }

        var previousRole = subject.GlobalRole;
        var nextRole = decision.ResultingRole ?? previousRole;
        if (string.Equals(previousRole, nextRole, StringComparison.Ordinal))
        {
            database.AuditRecords.Add(NewAudit(actorUserId, "admin.role.unchanged", "user", subjectUserId,
                JsonSerializer.Serialize(new { kind = kind.ToString(), role = targetRole, globalRole = previousRole }),
                clock.GetCurrentInstant()));
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return;
        }

        subject.AssignGlobalRole(nextRole);
        subject.SecurityStamp = Guid.NewGuid().ToString("N");
        await sessionService.RevokeAllForRoleChangeAsync(subjectUserId, cancellationToken);
        database.AuditRecords.Add(NewAudit(actorUserId, kind == GlobalRoleChangeKind.Grant ? "admin.role.granted" : "admin.role.revoked", "user", subjectUserId,
            JsonSerializer.Serialize(new
            {
                kind = kind.ToString(),
                role = targetRole,
                before = previousRole,
                after = nextRole,
                fields = new[] { "globalRole", "securityStamp" }
            }),
            clock.GetCurrentInstant()));
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    private static AuditRecord NewAudit(Guid actorId, string action, string entityType, Guid entityId, string diff, Instant now) => new()
    {
        ActorId = actorId,
        Action = action,
        EntityType = entityType,
        EntityId = entityId.ToString("D"),
        RedactedDiff = diff,
        OccurredAt = now
    };
}
